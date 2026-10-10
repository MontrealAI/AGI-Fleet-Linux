import crypto from "node:crypto";
import { need, exact, integer, digest, canonical } from "./core.mjs";
const observations = new Set([
  "screenshot",
  "list_apps",
  "list_windows",
  "get_window_state",
]);
const allowed = new Set([
  ...observations,
  "left_click",
  "right_click",
  "double_click",
  "mouse_move",
  "left_click_drag",
  "scroll",
  "type",
  "key",
  "set_value",
  "bring_to_front",
]);
export const NATIVE_ACTIONS = [...allowed];
export class NativeSession {
  constructor(
    gateway,
    journal,
    run,
    limits,
    { now = Date.now, beforeDispatch = () => {} } = {},
  ) {
    Object.assign(this, { gateway, journal, run, limits, now });
    this.beforeDispatch = beforeDispatch;
    this.executionId = crypto.randomUUID();
    this.frame = null;
    this.window = null;
    this.generation = null;
    this.closed = false;
    this.busy = false;
  }
  async check() {
    const n = await this.gateway.node();
    if (this.generation === null)
      this.generation = n.computerUse.provider.generation;
    need(
      n.computerUse.provider.generation === this.generation,
      "PROVIDER_RESTARTED",
    );
    return n.computerUse;
  }
  validate(action, args, capabilities) {
    need(
      allowed.has(action) && capabilities.actions.includes(action),
      "ACTION_UNAVAILABLE",
    );
    need(
      args && typeof args === "object" && !Array.isArray(args),
      "ACTION_ARGUMENTS",
    );
    const fields = {
      screenshot: [],
      list_apps: [],
      list_windows: [],
      get_window_state: ["windowRef"],
      bring_to_front: ["windowRef"],
      left_click: ["x", "y"],
      right_click: ["x", "y"],
      double_click: ["x", "y"],
      mouse_move: ["x", "y"],
      left_click_drag: ["fromX", "fromY", "x", "y", "durationMs"],
      scroll: ["scrollDirection", "scrollAmount"],
      type: ["text"],
      key: ["keys"],
      set_value: ["elementRef", "value"],
    };
    exact(args, fields[action]);
    if (args.windowRef !== undefined)
      need(
        typeof args.windowRef === "string" &&
          args.windowRef.length > 0 &&
          args.windowRef.length <= 256,
        "WINDOW_REFERENCE",
      );
    if (args.x !== undefined)
      need(
        integer(args.x, 0, 32767) && integer(args.y, 0, 32767),
        "COORDINATES",
      );
    if (action === "left_click_drag")
      need(
        integer(args.fromX, 0, 32767) &&
          integer(args.fromY, 0, 32767) &&
          integer(args.durationMs, 1, 10000),
        "DRAG",
      );
    if (action === "scroll")
      need(
        ["up", "down", "left", "right"].includes(args.scrollDirection) &&
          integer(args.scrollAmount, 1, 50),
        "SCROLL",
      );
    if (action === "type" || action === "key" || action === "set_value") {
      const s = args.text ?? args.keys ?? args.value;
      need(
        typeof s === "string" &&
          s.length <= 12000 &&
          !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(s),
        "INPUT_TEXT",
      );
    }
    if (action === "set_value")
      need(
        this.window &&
          this.now() >= this.window.at &&
          this.now() - this.window.at <= 30000 &&
          this.window.elements.includes(args.elementRef),
        "STALE_ELEMENT",
      );
    if (
      !observations.has(action) &&
      !["bring_to_front", "set_value"].includes(action)
    )
      need(
        this.frame && this.now() >= this.frame.at && this.now() - this.frame.at <= 30000,
        "FRESH_SCREEN_REQUIRED",
      );
    if (args.x !== undefined)
      need(
        args.x < this.frame.width && args.y < this.frame.height,
        "COORDINATES",
      );
    if (action === "left_click_drag")
      need(
        args.fromX < this.frame.width && args.fromY < this.frame.height,
        "COORDINATES",
      );
    return args;
  }
  async act(action, args = {}) {
    need(!this.closed && !this.busy, "SESSION_STATE");
    this.busy = true;
    try {
      // A failed refresh must not leave older observations usable as fresh state.
      if (action === "screenshot") this.frame = null;
      if (action === "get_window_state") this.window = null;
      const capabilities = await this.check();
      this.validate(action, args, capabilities);
      let params = { action, ...args, executionId: this.executionId };
      let command = "computer.act";
      if (action === "screenshot") {
        command = "screen.snapshot";
        params = {
          executionId: this.executionId,
          maxWidth: 1600,
          format: "png",
        };
      } else if (action === "set_value")
        Object.assign(params, {
          windowRef: this.window.ref,
          observationId: this.window.id,
        });
      else if (!observations.has(action) && action !== "bring_to_front")
        Object.assign(params, {
          screenIndex: this.frame.screenIndex,
          refWidth: this.frame.width,
          ...(args.x !== undefined ? { displayFrameId: this.frame.id } : {}),
        });
      this.beforeDispatch(action);
      const actionId = this.journal.reserve(
        this.run,
        { command, params },
        { maxActions: this.limits.maxActions },
      );
      // Clear observations BEFORE transport. An uncertain mutation is never replayed.
      if (!observations.has(action)) {
        this.frame = null;
        this.window = null;
      }
      const result = await this.gateway.invoke(
        command,
        params,
        "agi:" + this.run + ":" + actionId,
      );
      this.journal.resolve(actionId, result);
      if (action === "screenshot") {
        need(
          typeof result.displayFrameId === "string" &&
            result.displayFrameId.length > 0 &&
            result.displayFrameId.length <= 512 &&
            integer(result.screenIndex ?? 0, 0, 255) &&
            integer(result.width, 1, 32768) &&
            integer(result.height, 1, 32768) &&
            typeof result.base64 === "string" &&
            ["png", "jpeg"].includes(result.format),
          "SCREEN_RESPONSE",
        );
        this.frame = {
          id: result.displayFrameId,
          width: result.width,
          height: result.height,
          screenIndex: result.screenIndex ?? 0,
          at: this.now(),
        };
      } else {
        need(result.ok === true, "ACTION_REFUSED");
        if (action === "get_window_state") {
          const o = result.observation;
          need(
            o?.observationId && Array.isArray(o.elements),
            "WINDOW_RESPONSE",
          );
          this.window = {
            ref: args.windowRef,
            id: o.observationId,
            elements: o.elements.map((x) => x.elementRef),
            at: this.now(),
          };
        }
      }
      return result;
    } finally {
      this.busy = false;
    }
  }
  async close() {
    if (this.closed) return;
    const result = await this.gateway.invoke(
      "computer.act",
      {
        action: "__close_execution",
        executionId: this.executionId,
        reason: "agi-job-finished",
      },
      "agi:close:" + this.executionId,
    );
    need(result.ok === true, "NATIVE_CLEANUP");
    this.journal.append(this.run, "execution-closed", {
      executionId: this.executionId,
    });
    this.closed = true;
  }
}
export function observationMessage(result) {
  const clone = structuredClone(result),
    images = [];
  for (const o of [clone, clone.observation].filter(Boolean)) {
    if (o.base64) {
      need(
        typeof o.base64 === "string" &&
          o.base64.length <= 12000000 &&
          ["png", "jpeg"].includes(o.format),
        "OBSERVATION_IMAGE",
      );
      images.push({
        type: "image_url",
        image_url: { url: "data:image/" + o.format + ";base64," + o.base64 },
      });
      o.base64 = "[delivered image]";
    }
  }
  return [{ type: "text", text: canonical(clone) }, ...images];
}
