import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createControlServer } from "../src/control/server.mjs";
test("control server enforces one-use session, cookie auth, Host, Origin and CSRF boundaries", async () => {
  let paused = 0;
  const controller = {
    status: () => ({ version: "2.0.0" }),
    report: () => ({}),
    pause: () => ({ paused: ++paused }),
    mutate: async (_, fn) => fn(),
    lab: () => ({ decision: "approve" }),
  };
  const app = await createControlServer(controller, { port: 0 });
  const origin = `http://127.0.0.1:${app.port}`;
  const send = async (route, body, extra = {}) =>
    fetch(origin + route, {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json", ...extra },
      body: JSON.stringify(body),
    });
  try {
    assert.equal((await fetch(origin + "/api/status")).status, 401);
    const token = app.url.split("#")[1],
      session = await send("/api/session", { token }),
      cookie = session.headers.get("set-cookie").split(";")[0],
      csrf = (await session.json()).csrf;
    assert.equal(session.status, 200);
    assert.ok(
      session.headers.get("set-cookie").includes("HttpOnly; SameSite=Strict"),
    );
    assert.equal((await send("/api/session", { token })).status, 401);
    assert.equal(
      (await fetch(origin + "/api/status", { headers: { Cookie: cookie } }))
        .status,
      200,
    );
    assert.equal(
      (await send("/api/pause", {}, { Cookie: cookie })).status,
      403,
    );
    assert.equal(
      (await send("/api/pause", {}, { Cookie: cookie, "X-AGI-CSRF": "a" }))
        .status,
      403,
    );
    assert.equal(
      (
        await send(
          "/api/pause",
          {},
          { Cookie: cookie, "X-AGI-CSRF": csrf, Origin: "https://evil.test" },
        )
      ).status,
      403,
    );
    assert.equal(paused, 0);
    assert.equal(
      (await send("/api/pause", {}, { Cookie: cookie, "X-AGI-CSRF": csrf }))
        .status,
      200,
    );
    assert.equal(paused, 1);
    assert.equal(
      (await fetch(origin + "/app.js")).headers
        .get("content-security-policy")
        .includes("frame-ancestors 'none'"),
      true,
    );
    const wrongHost = await new Promise((resolve) => {
      http.get(origin, { headers: { Host: "evil.test" } }, (r) => {
        r.resume();
        r.on("end", () => resolve(r.statusCode));
      });
    });
    assert.equal(wrongHost, 403);
    assert.equal(
      (
        await send(
          "/api/lab",
          { specification: "x".repeat(1024 * 1024) },
          { Cookie: cookie, "X-AGI-CSRF": csrf },
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await send(
          "/api/launch",
          {},
          { Authorization: "Bearer " + app.launchSecret },
        )
      ).status,
      200,
    );
  } finally {
    await app.close();
  }
});


test("original and seed profiles retain separate sessions in one host cookie jar", async () => {
  const makeController = (profile) => ({
    status: () => ({ profile }),
    pause: () => ({ profile, paused: true }),
  });
  const original = await createControlServer(makeController("original"), { port: 0 });
  const seed = await createControlServer(makeController("seed"), { port: 0 });
  const jar = new Map();
  const request = (app, route, body, headers = {}) => {
    const origin = `http://127.0.0.1:${app.port}`;
    return fetch(origin + route, {
      method: body === undefined ? "GET" : "POST",
      headers: { Origin: origin, "Content-Type": "application/json", ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  };
  const login = async (app, url = app.url) => {
    const response = await request(app, "/api/session", { token: url.split("#")[1] });
    assert.equal(response.status, 200);
    const cookie = response.headers.get("set-cookie").split(";")[0];
    const [name, value] = cookie.split("=");
    // A browser replaces equal-name cookies on 127.0.0.1 regardless of port.
    jar.set(name, value);
    return { cookie, name, value, csrf: (await response.json()).csrf };
  };
  const browserCookies = () => [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
  try {
    const a = await login(original), b = await login(seed);
    assert.notEqual(a.name, b.name);
    assert.equal(jar.size, 2);
    for (const [app, session, foreign, profile] of [
      [original, a, b, "original"], [seed, b, a, "seed"],
    ]) {
      const status = await request(app, "/api/status", undefined, { Cookie: browserCookies() });
      assert.equal(status.status, 200);
      assert.equal((await status.json()).profile, profile);
      assert.equal((await request(app, "/api/status", undefined, { Cookie: foreign.cookie })).status, 401);
      assert.equal((await request(app, "/api/status", undefined, { Cookie: `${session.name}=${foreign.value}` })).status, 401);
      assert.equal((await request(app, "/api/pause", {}, { Cookie: browserCookies(), "X-AGI-CSRF": foreign.csrf })).status, 403);
      const pause = await request(app, "/api/pause", {}, { Cookie: browserCookies(), "X-AGI-CSRF": session.csrf });
      assert.equal(pause.status, 200);
      assert.deepEqual(await pause.json(), { profile, paused: true });
    }
    await login(original, original.bootstrap());
    assert.equal(jar.size, 2);
    for (const app of [original, seed])
      assert.equal((await request(app, "/api/status", undefined, { Cookie: browserCookies() })).status, 200);
  } finally {
    await original.close();
    await seed.close();
  }
});
