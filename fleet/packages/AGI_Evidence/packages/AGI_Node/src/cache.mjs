import { ContentReader } from "./content.mjs";
export class VerifiedContentCache {
  constructor(
    reader,
    {
      maxBytes = 16 * 1024 * 1024,
      maxEntries = 128,
      ttl = 300000,
      clock = Date.now,
    } = {},
  ) {
    Object.assign(this, { reader, maxBytes, maxEntries, ttl, clock });
    this.cache = new Map();
    this.inflight = new Map();
    this.bytes = 0;
    this.hits = 0;
    this.misses = 0;
  }
  async readBundle(uri) { return this.reader.readBundle(uri); }
  async readImage(uri) { return this.reader.readImage(uri); }
  async read(uri) {
    const found = this.cache.get(uri);
    if (found && found.until > this.clock()) {
      this.hits++;
      this.cache.delete(uri);
      this.cache.set(uri, found);
      return {
        bytes: Buffer.from(found.value.bytes),
        sha256: found.value.sha256,
      };
    }
    if (found) {
      this.bytes -= found.value.bytes.length;
      this.cache.delete(uri);
    }
    if (this.inflight.has(uri)) {
      const value = await this.inflight.get(uri);
      return { bytes: Buffer.from(value.bytes), sha256: value.sha256 };
    }
    this.misses++;
    const work = this.reader.read(uri).then((value) => {
      if (value.bytes.length <= this.maxBytes) {
        while (
          this.cache.size >= this.maxEntries ||
          this.bytes + value.bytes.length > this.maxBytes
        ) {
          const first = this.cache.keys().next().value;
          this.bytes -= this.cache.get(first).value.bytes.length;
          this.cache.delete(first);
        }
        this.cache.set(uri, {
          until: this.clock() + this.ttl,
          value: { bytes: Buffer.from(value.bytes), sha256: value.sha256 },
        });
        this.bytes += value.bytes.length;
      }
      return value;
    });
    this.inflight.set(uri, work);
    try {
      return await work;
    } finally {
      this.inflight.delete(uri);
    }
  }
  clear() {
    this.cache.clear();
    this.bytes = 0;
  }
}
export const cachedReader = (c) =>
  new VerifiedContentCache(new ContentReader(c));
