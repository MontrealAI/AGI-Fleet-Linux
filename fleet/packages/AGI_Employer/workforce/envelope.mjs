import crypto from "node:crypto";
import { canonical, digest, need, exact, hash, integer } from "./core.mjs";
const MAX = 94371840;
function pub(key) {
  const k = typeof key === "string" ? crypto.createPublicKey(key) : key;
  need(k.asymmetricKeyType === "x25519", "RECIPIENT_KEY");
  return k;
}
export const recipientId = (key) =>
  digest(pub(key).export({ type: "spki", format: "der" }));
function b64(s, max) {
  need(
    typeof s === "string" && s.length <= 4 * Math.ceil(max / 3),
    "ENVELOPE_SIZE",
  );
  const b = Buffer.from(s, "base64");
  need(b.length <= max && b.toString("base64") === s, "BASE64");
  return b;
}
function encrypt(key, plain, aad) {
  const nonce = crypto.randomBytes(12),
    cipher = crypto.createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from(aad));
  return {
    nonce: nonce.toString("base64"),
    ciphertext: Buffer.concat([cipher.update(plain), cipher.final()]).toString(
      "base64",
    ),
    tag: cipher.getAuthTag().toString("base64"),
  };
}
function decrypt(key, box, aad, max) {
  exact(box, ["nonce", "ciphertext", "tag"]);
  const nonce = b64(box.nonce, 12),
    tag = b64(box.tag, 16);
  need(nonce.length === 12 && tag.length === 16, "ENVELOPE");
  const c = crypto.createDecipheriv("aes-256-gcm", key, nonce);
  c.setAAD(Buffer.from(aad));
  c.setAuthTag(tag);
  return Buffer.concat([c.update(b64(box.ciphertext, max)), c.final()]);
}
function context(c) {
  exact(c, ["specSha256", "purpose", "expiresAt"]);
  need(
    hash(c.specSha256) &&
      [
        "job",
        "delivery",
        "review",
        "commissioning",
        "trace",
        "checkpoint",
      ].includes(c.purpose) &&
      integer(c.expiresAt, 1, Number.MAX_SAFE_INTEGER),
    "ENVELOPE_CONTEXT",
  );
}
export function seal(plain, recipients, scope) {
  context(scope);
  need(
    Buffer.isBuffer(plain) &&
      plain.length > 0 &&
      plain.length <= MAX &&
      Array.isArray(recipients) &&
      recipients.length > 0 &&
      recipients.length <= 8,
    "ENVELOPE_SIZE",
  );
  const keys = recipients.map(pub),
    ids = keys.map(recipientId);
  need(new Set(ids).size === ids.length, "DUPLICATE_RECIPIENT");
  const pair = crypto.generateKeyPairSync("x25519"),
    salt = crypto.randomBytes(32),
    header = {
      schema: "agi-private-envelope/v1",
      context: scope,
      ephemeral: pair.publicKey
        .export({ format: "der", type: "spki" })
        .toString("base64"),
      salt: salt.toString("base64"),
      recipients: ids,
    },
    aad = canonical(header),
    dataKey = crypto.randomBytes(32);
  try {
    return {
      header,
      keys: keys.map((key, i) => {
        const shared = crypto.diffieHellman({
            privateKey: pair.privateKey,
            publicKey: key,
          }),
          wrapping = Buffer.from(
            crypto.hkdfSync(
              "sha256",
              shared,
              salt,
              "agi-envelope/v1/" + ids[i],
              32,
            ),
          );
        try {
          return encrypt(wrapping, dataKey, aad + "/" + ids[i]);
        } finally {
          shared.fill(0);
          wrapping.fill(0);
        }
      }),
      data: encrypt(dataKey, plain, aad),
    };
  } finally {
    dataKey.fill(0);
  }
}
export function open(
  envelope,
  privateKey,
  expected,
  { now = Math.floor(Date.now() / 1000) } = {},
) {
  exact(envelope, ["header", "keys", "data"]);
  const h = envelope.header;
  exact(h, ["schema", "context", "ephemeral", "salt", "recipients"]);
  context(h.context);
  context(expected);
  need(
    h.schema === "agi-private-envelope/v1" &&
      canonical(h.context) === canonical(expected) &&
      now < h.context.expiresAt,
    "ENVELOPE_CONTEXT",
  );
  need(
    Array.isArray(h.recipients) &&
      h.recipients.length > 0 &&
      h.recipients.length <= 8 &&
      h.recipients.every(hash) &&
      new Set(h.recipients).size === h.recipients.length &&
      Array.isArray(envelope.keys) &&
      envelope.keys.length === h.recipients.length,
    "RECIPIENTS",
  );
  const key =
    typeof privateKey === "string"
      ? crypto.createPrivateKey(privateKey)
      : privateKey;
  need(key.asymmetricKeyType === "x25519", "RECIPIENT_KEY");
  const i = h.recipients.indexOf(recipientId(crypto.createPublicKey(key)));
  need(i >= 0, "RECIPIENT_NOT_AUTHORIZED");
  const ephemeral = pub(
      crypto.createPublicKey({
        key: b64(h.ephemeral, 64),
        type: "spki",
        format: "der",
      }),
    ),
    salt = b64(h.salt, 32);
  need(salt.length === 32, "ENVELOPE");
  const shared = crypto.diffieHellman({
      privateKey: key,
      publicKey: ephemeral,
    }),
    wrapping = Buffer.from(
      crypto.hkdfSync(
        "sha256",
        shared,
        salt,
        "agi-envelope/v1/" + h.recipients[i],
        32,
      ),
    ),
    aad = canonical(h);
  let dataKey;
  try {
    dataKey = decrypt(
      wrapping,
      envelope.keys[i],
      aad + "/" + h.recipients[i],
      32,
    );
    need(dataKey.length === 32, "ENVELOPE");
    return decrypt(dataKey, envelope.data, aad, MAX);
  } finally {
    shared.fill(0);
    wrapping.fill(0);
    dataKey?.fill(0);
  }
}
