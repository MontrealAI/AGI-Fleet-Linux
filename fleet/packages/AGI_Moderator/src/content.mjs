import https from "node:https";
import dns from "node:dns/promises";
import net from "node:net";
import { ensure, sha256 } from "./util.mjs";
export function publicIPv4(ip) {
  if (net.isIP(ip) !== 4) return false;
  const [a, b, c] = ip.split(".").map(Number);
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113)
  );
}
export async function fetchPublic(
  url,
  { hosts, maxBytes, timeoutMs },
  resolver = dns.resolve4,
) {
  const u = new URL(url);
  ensure(
    u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      (!u.port || u.port === "443") &&
      !u.hash,
    "CONTENT_URL_REJECTED",
  );
  ensure(hosts.includes(u.hostname.toLowerCase()), "CONTENT_HOST_NOT_ALLOWED");
  ensure(!net.isIP(u.hostname), "CONTENT_IP_LITERAL_REJECTED");
  let dnsTimer;
  let addresses;
  try {
    addresses = await Promise.race([
      resolver(u.hostname),
      new Promise((_, reject) => {
        dnsTimer = setTimeout(
          () => reject(new Error("CONTENT_DNS_TIMEOUT")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(dnsTimer);
  }
  ensure(
    addresses.length > 0 && addresses.every(publicIPv4),
    "CONTENT_PRIVATE_OR_RESERVED_ADDRESS",
  );
  return new Promise((resolve, reject) => {
    let complete = false;
    const done = (e, data) => {
      if (complete) return;
      complete = true;
      clearTimeout(timer);
      e ? reject(e) : resolve(data);
    };
    const req = https.request(
      u,
      {
        method: "GET",
        headers: {
          Accept:
            "application/octet-stream,application/vnd.ipld.raw,application/json",
          "Accept-Encoding": "identity",
          "User-Agent": "MONTREAL.AI-Private-AGI-Node/1.0",
        },
        lookup: (_host, opts, cb) =>
          opts?.all
            ? cb(null, [{ address: addresses[0], family: 4 }])
            : cb(null, addresses[0], 4),
      },
      (res) => {
        if (
          res.statusCode !== 200 ||
          (res.headers["content-encoding"] &&
            res.headers["content-encoding"] !== "identity")
        ) {
          res.destroy();
          done(new Error("CONTENT_HTTP_REJECTED"));
          return;
        }
        if (Number(res.headers["content-length"] ?? 0) > maxBytes) {
          res.destroy();
          done(new Error("CONTENT_TOO_LARGE"));
          return;
        }
        let size = 0;
        const chunks = [];
        res.on("data", (chunk) => {
          size += chunk.length;
          if (size > maxBytes) {
            res.destroy();
            done(new Error("CONTENT_TOO_LARGE"));
          } else chunks.push(chunk);
        });
        res.on("end", () => done(null, Buffer.concat(chunks)));
        res.on("error", (e) => done(e));
      },
    );
    const timer = setTimeout(() => {
      req.destroy();
      done(new Error("CONTENT_TIMEOUT"));
    }, timeoutMs);
    req.on("error", (e) => done(e));
    req.end();
  });
}
const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function unbase58(s) {
  let n = 0n;
  ensure(s.length <= 100, "CID_SIZE");
  for (const x of s) {
    const i = ALPHABET.indexOf(x);
    ensure(i >= 0, "CID_BASE58");
    n = n * 58n + BigInt(i);
  }
  let hex = n.toString(16);
  if (hex.length % 2) hex = "0" + hex;
  return Buffer.concat([
    Buffer.alloc(s.match(/^1*/)[0].length),
    n === 0n ? Buffer.alloc(0) : Buffer.from(hex, "hex"),
  ]);
}
function base32(b) {
  let out = "",
    n = 0,
    bits = 0;
  for (const v of b) {
    n = (n << 8) | v;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += "abcdefghijklmnopqrstuvwxyz234567"[(n >>> bits) & 31];
    }
  }
  if (bits) out += "abcdefghijklmnopqrstuvwxyz234567"[(n << (5 - bits)) & 31];
  return out;
}
function unbase32(s) {
  ensure(/^[a-z2-7]+$/.test(s) && s.length < 120, "CID_BASE32");
  let n = 0,
    bits = 0,
    out = [];
  for (const c of s) {
    n = (n << 5) | "abcdefghijklmnopqrstuvwxyz234567".indexOf(c);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((n >>> bits) & 255);
    }
  }
  ensure(bits === 0 || (n & ((1 << bits) - 1)) === 0, "CID_PADDING");
  return Buffer.from(out);
}
export function varint(b, start = 0) {
  let n = 0,
    scale = 1,
    i = start;
  for (; i < b.length && i < start + 8; i++) {
    n += (b[i] & 127) * scale;
    ensure(Number.isSafeInteger(n), "PROTOBUF_INTEGER");
    if (!(b[i] & 128)) return [n, i + 1];
    scale *= 128;
  }
  throw new Error("PROTOBUF_VARINT");
}
export function cidInfo(cid) {
  ensure(typeof cid === "string", "CID_STRING");
  let raw = cid.startsWith("Qm")
    ? unbase58(cid)
    : cid.startsWith("b")
      ? unbase32(cid.slice(1))
      : null;
  ensure(raw, "CID_ENCODING");
  let codec = 0x70,
    pos = 0;
  if (!cid.startsWith("Qm")) {
    let version;
    [version, pos] = varint(raw);
    ensure(version === 1, "CID_VERSION");
    [codec, pos] = varint(raw, pos);
  }
  ensure([0x55, 0x70].includes(codec), "CID_CODEC");
  let code, len;
  [code, pos] = varint(raw, pos);
  [len, pos] = varint(raw, pos);
  ensure(code === 0x12 && len === 32 && raw.length === pos + 32, "CID_HASH");
  return { codec, digest: raw.subarray(pos).toString("hex") };
}
export function rawCID(bytes, codec = 0x55) {
  return (
    "b" +
    base32(
      Buffer.concat([
        Buffer.from([1, codec, 0x12, 32]),
        Buffer.from(sha256(bytes), "hex"),
      ]),
    )
  );
}
function linkedCID(bytes) {
  if (bytes.length === 34 && bytes[0] === 0x12 && bytes[1] === 32)
    return "b" + base32(Buffer.concat([Buffer.from([1, 0x70]), bytes]));
  return "b" + base32(bytes);
}
export function protobuf(bytes) {
  let i = 0,
    fields = [];
  while (i < bytes.length) {
    let key;
    [key, i] = varint(bytes, i);
    const field = Math.floor(key / 8),
      wire = key % 8;
    ensure(field > 0, "PROTOBUF_FIELD");
    let value;
    if (wire === 0) {
      [value, i] = varint(bytes, i);
    } else if (wire === 2) {
      let len;
      [len, i] = varint(bytes, i);
      ensure(i + len <= bytes.length, "PROTOBUF_LENGTH");
      value = bytes.subarray(i, i + len);
      i += len;
    } else throw new Error("PROTOBUF_WIRE");
    fields.push({ field, wire, value });
  }
  return fields;
}
function single(fields, n, optional = false) {
  const f = fields.filter((x) => x.field === n);
  ensure(f.length === 1 || (optional && f.length === 0), "UNIXFS_FIELD");
  return f[0]?.value;
}
export class ContentReader {
  constructor(c, fetcher = fetchPublic) {
    this.c = c;
    this.fetcher = fetcher;
  }
  async readBundle(uri) {
    return new ContentReader({...this.c,maxContentBytes:94371840,maxIpfsBlocks:512},this.fetcher).read(uri);
  }
  async readImage(uri) {
    return new ContentReader({...this.c, maxContentBytes: 4 * 1024 * 1024, maxIpfsBlocks: 64}, this.fetcher).read(uri);
  }
  async read(uri) {
    ensure(typeof uri === "string" && uri.length <= 2048, "CONTENT_URI");
    const u = new URL(uri);
    let data;
    if (u.protocol === "ipfs:") {
      ensure(
        !u.username &&
          !u.password &&
          !u.port &&
          !u.search &&
          (u.pathname === "" || u.pathname === "/"),
        "IPFS_PATH_UNSUPPORTED",
      );
      const cid = uri.slice(7).split(/[\/#?]/)[0];
      cidInfo(cid);
      let count = 0,
        total = 0;
      const seen = new Set();
      const visit = async (id, depth) => {
        ensure(
          depth <= 12 && ++count <= this.c.maxIpfsBlocks && !seen.has(id),
          "IPFS_DAG_LIMIT",
        );
        seen.add(id);
        const info = cidInfo(id),
          gateway = new URL(this.c.ipfsGateway);
        const bytes = await this.fetcher(
          `${gateway.origin}/ipfs/${id}?format=raw`,
          {
            hosts: [gateway.hostname],
            maxBytes: this.c.maxContentBytes + 8192,
            timeoutMs: this.c.contentTimeoutMs,
          },
        );
        total += bytes.length;
        ensure(
          total <= this.c.maxContentBytes * 2 + 65536,
          "IPFS_TRANSFER_LIMIT",
        );
        ensure(sha256(bytes) === info.digest, "IPFS_HASH_MISMATCH");
        if (info.codec === 0x55) {
          seen.delete(id);
          return bytes;
        }
        const node = protobuf(bytes);
        ensure(
          node.every((x) => [1, 2].includes(x.field)),
          "UNIXFS_NODE",
        );
        const unix = protobuf(single(node, 1));
        ensure(
          unix.every((x) => [1, 2, 3, 4].includes(x.field)),
          "UNIXFS_METADATA_UNSUPPORTED",
        );
        const type = single(unix, 1);
        ensure(type === 2 || type === 0, "UNIXFS_NOT_FILE");
        const pieces = [single(unix, 2, true) ?? Buffer.alloc(0)],
          links = node.filter((x) => x.field === 2),
          sizes = unix.filter((x) => x.field === 4).map((x) => x.value);
        ensure(
          !sizes.length || sizes.length === links.length,
          "UNIXFS_BLOCK_SIZES",
        );
        for (let i = 0; i < links.length; i++) {
          const link = protobuf(links[i].value);
          const child = await visit(linkedCID(single(link, 1)), depth + 1);
          if (sizes.length)
            ensure(child.length === sizes[i], "UNIXFS_CHILD_SIZE");
          pieces.push(child);
          ensure(
            pieces.reduce((a, b) => a + b.length, 0) <= this.c.maxContentBytes,
            "CONTENT_TOO_LARGE",
          );
        }
        const out = Buffer.concat(pieces),
          size = single(unix, 3, true);
        if (size !== undefined) ensure(size === out.length, "UNIXFS_FILE_SIZE");
        seen.delete(id);
        return out;
      };
      data = await visit(cid, 0);
    } else {
      ensure(
        u.protocol === "https:" && /^#sha256=[0-9a-f]{64}$/.test(u.hash),
        "HTTPS_REQUIRES_SHA256_FRAGMENT",
      );
      const expected = u.hash.slice(8);
      u.hash = "";
      data = await this.fetcher(u.href, {
        hosts: this.c.allowedHttpsHosts,
        maxBytes: this.c.maxContentBytes,
        timeoutMs: this.c.contentTimeoutMs,
      });
      ensure(sha256(data) === expected, "HTTPS_HASH_MISMATCH");
    }
    ensure(data.length <= this.c.maxContentBytes, "CONTENT_TOO_LARGE");
    if (u.protocol === "ipfs:" && u.hash) {
      ensure(
        /^#sha256=[0-9a-f]{64}$/.test(u.hash) &&
          sha256(data) === u.hash.slice(8),
        "CONTENT_HASH_FRAGMENT",
      );
    }
    return { bytes: data, sha256: sha256(data) };
  }
}
