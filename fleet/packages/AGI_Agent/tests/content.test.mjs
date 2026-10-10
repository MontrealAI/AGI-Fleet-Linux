import test from "node:test";
import assert from "node:assert/strict";
import {
  ContentReader,
  rawCID,
  cidInfo,
  publicIPv4,
  fetchPublic,
  protobuf,
} from "../src/content.mjs";
import { DEFAULT } from "../src/config.mjs";
import { sha256 } from "../src/util.mjs";
function v(n) {
  const out = [];
  do {
    let x = n & 127;
    n = Math.floor(n / 128);
    out.push(x | (n ? 128 : 0));
  } while (n);
  return Buffer.from(out);
}
const f = (n, b) => Buffer.concat([v(n * 8 + 2), v(b.length), b]);
function cidV0(block) {
  let n = BigInt("0x1220" + sha256(block)),
    out = "";
  const chars = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  while (n) {
    out = chars[Number(n % 58n)] + out;
    n /= 58n;
  }
  return out;
}
test("raw IPFS CID is checked against downloaded bytes", async () => {
  const b = Buffer.from("hello"),
    cid = rawCID(b);
  assert.equal(cidInfo(cid).digest, sha256(b));
  const r = new ContentReader(DEFAULT, async () => b);
  assert.deepEqual((await r.read("ipfs://" + cid)).bytes, b);
  await assert.rejects(
    r.read("ipfs://" + rawCID(Buffer.from("wrong"))),
    /IPFS_HASH_MISMATCH/,
  );
});
test("CIDv0 DAG-PB UnixFS verifies file and block size", async () => {
  const b = Buffer.from("file"),
    unix = Buffer.concat([
      Buffer.from([8, 2]),
      f(2, b),
      Buffer.from([24, b.length]),
    ]),
    block = f(1, unix),
    cid = cidV0(block);
  assert.equal(cidInfo(cid).codec, 0x70);
  assert.deepEqual(
    (await new ContentReader(DEFAULT, async () => block).read("ipfs://" + cid))
      .bytes,
    b,
  );
});
test("multi-block UnixFS follows and verifies every child", async () => {
  const a = Buffer.from("hello "),
    b = Buffer.from("world"),
    children = [a, b],
    links = children.map((x) =>
      f(2, f(1, Buffer.from("01551220" + sha256(x), "hex"))),
    );
  const unix = Buffer.concat([Buffer.from([8, 2, 24, 11, 32, 6, 32, 5])]),
    root = Buffer.concat([f(1, unix), ...links]),
    cid = cidV0(root);
  const map = new Map([[cid, root], ...children.map((x) => [rawCID(x), x])]);
  const reader = new ContentReader(DEFAULT, async (url) =>
    map.get(new URL(url).pathname.split("/")[2]),
  );
  assert.equal(
    (await reader.read("ipfs://" + cid)).bytes.toString(),
    "hello world",
  );
  map.set(rawCID(a), Buffer.from("tamper"));
  await assert.rejects(reader.read("ipfs://" + cid), /IPFS_HASH_MISMATCH/);
});
test("HTTPS requires committed digest; mutable paths and unsupported encodings fail closed", async () => {
  const b = Buffer.from("x"),
    r = new ContentReader(DEFAULT, async () => b);
  assert.deepEqual(
    (await r.read("https://example.com/file#sha256=" + sha256(b))).bytes,
    b,
  );
  await assert.rejects(
    r.read("https://example.com/file"),
    /HTTPS_REQUIRES_SHA256_FRAGMENT/,
  );
  await assert.rejects(
    r.read("https://example.com/file#sha256=" + "0".repeat(64)),
    /HTTPS_HASH_MISMATCH/,
  );
  await assert.rejects(
    r.read("ipfs://" + rawCID(b) + "/path"),
    /IPFS_PATH_UNSUPPORTED/,
  );
  assert.throws(() => cidInfo("bnotacid"));
  assert.throws(() => protobuf(Buffer.from([10, 50, 1])));
});
test("SSRF prevention rejects internal/reserved addresses, IP literals and mixed DNS answers", async () => {
  for (const ip of [
    "127.0.0.1",
    "10.1.2.3",
    "172.20.1.1",
    "192.168.0.1",
    "169.254.169.254",
    "0.0.0.0",
    "100.64.0.1",
    "198.18.0.1",
    "::1",
    "203.0.113.1",
  ])
    assert.equal(publicIPv4(ip), false, ip);
  assert.equal(publicIPv4("8.8.8.8"), true);
  const opts = {
    hosts: ["example.com", "127.0.0.1"],
    maxBytes: 100,
    timeoutMs: 1000,
  };
  await assert.rejects(fetchPublic("https://127.0.0.1/", opts), /IP_LITERAL/);
  await assert.rejects(
    fetchPublic("https://example.com/", opts, async () => [
      "8.8.8.8",
      "10.0.0.1",
    ]),
    /PRIVATE_OR_RESERVED/,
  );
  await assert.rejects(
    fetchPublic("https://elsewhere.com/", opts),
    /HOST_NOT_ALLOWED/,
  );
  await assert.rejects(
    fetchPublic("http://example.com/", opts),
    /CONTENT_URL_REJECTED/,
  );
});
test("bounded content and DAG budgets are enforced", async () => {
  const b = Buffer.alloc(300);
  await assert.rejects(
    new ContentReader({ ...DEFAULT, maxContentBytes: 128 }, async () => b).read(
      "ipfs://" + rawCID(b),
    ),
    /CONTENT_TOO_LARGE/,
  );
});
