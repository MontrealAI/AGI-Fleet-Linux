import {isComputerSpec,MAX_BUNDLE_BYTES} from './artifacts.mjs';
import { deliveryBytes, deliveryPlan } from './delivery.mjs';
import { isImageSpec, MAX_IMAGE_BYTES } from './images.mjs';
import { ensure, sha256 } from "./util.mjs";
import { ContentReader, rawCID } from "./content.mjs";
import { boundedJSON } from "./review.mjs";
export class Publisher {
  constructor(c, { fetchImpl = fetch, reader = new ContentReader(c) } = {}) {
    Object.assign(this, { c, fetch: fetchImpl, reader });
  }
  async request(route, body, maxBytes = 32768) {
    const response = await this.fetch(
      `http://127.0.0.1:${this.c.execution.kuboPort}/api/v0/${route}`,
      {
        method: "POST",
        redirect: "error",
        body,
        signal: AbortSignal.timeout(20000),
      },
    );
    ensure(response.ok, "PUBLISHER_UNAVAILABLE");
    const parts = [];
    let size = 0;
    for await (const p of response.body) {
      size += p.length;
      ensure(size <= maxBytes, "PUBLISHER_RESPONSE_TOO_LARGE");
      parts.push(p);
    }
    return Buffer.concat(parts);
  }
  async check() {
    const r = boundedJSON(await this.request("version"));
    ensure(typeof r.Version === "string", "PUBLISHER_INVALID");
    return { ready: true, version: r.Version };
  }
  async publish(content, spec) {
    ensure(!["scoped", "confidential", "restricted"].includes((spec?.acceptance ?? spec)?.dataPolicy), "SCOPED_CONTENT_REQUIRES_ENCRYPTED_HANDOFF");
    ensure(this.c.execution.publicPublishing, "PUBLIC_PUBLISHING_NOT_AUTHORIZED");
    const bytes = deliveryBytes(content, spec), image = isImageSpec(spec?.acceptance ?? spec);
    ensure(bytes.length > 0 && bytes.length <= (isComputerSpec(spec?.acceptance ?? spec) ? MAX_BUNDLE_BYTES : image ? MAX_IMAGE_BYTES : 12000), "DELIVERY_SIZE");
    const plan = deliveryPlan(bytes);
    for(const block of plan.blocks) {
      const form = new FormData(); form.append("file", new Blob([block.bytes]), "block");
      const r = boundedJSON(await this.request(`block/put?cid-codec=${block.codec}&mhtype=sha2-256&pin=true`,form));
      ensure(r.Key === block.cid && r.Size === block.bytes.length, "PUBLISHER_HASH_MISMATCH");
      const local = await this.request("block/get?arg="+block.cid, undefined, 270336);
      ensure(sha256(local) === sha256(block.bytes), "PUBLISHER_HASH_MISMATCH");
    }
    if (plan.blocks.length > 1) await this.request("pin/add?arg="+plan.uri.slice(7)+"&recursive=true");
    await this.verify(plan.uri, content, spec);
    return plan.uri;
  }
  async verify(uri, content, spec) {
    const d = isComputerSpec(spec?.acceptance ?? spec) ? await this.reader.readBundle(uri) : isImageSpec(spec?.acceptance ?? spec) ? await this.reader.readImage(uri) : await this.reader.read(uri);
    ensure(
      d.sha256 === sha256(deliveryBytes(content, spec)),
      "PUBLIC_DELIVERY_UNAVAILABLE",
    );
    return true;
  }
}
