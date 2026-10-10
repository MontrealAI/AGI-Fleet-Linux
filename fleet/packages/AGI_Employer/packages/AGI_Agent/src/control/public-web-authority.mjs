import crypto from 'node:crypto';
import {ensure} from '../util.mjs';

// This authority grants only bounded browser access. It never signs blockchain transactions.
// The private key stays inside the signer vault and is never part of a compute setup kit.
export function validatePublicWebAuthority(value) {
  ensure(value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === 3 && value.schema === 'agi-public-web-authority/v1' &&
    typeof value.privateKey === 'string' && value.privateKey.length <= 4096 &&
    typeof value.publicKey === 'string' && value.publicKey.length <= 4096,
    'PUBLIC_WEB_AUTHORITY_INVALID');
  try {
    const privateKey = crypto.createPrivateKey(value.privateKey);
    const publicKey = crypto.createPublicKey(value.publicKey);
    // createPublicKey also accepts private PEMs; never export that input as a public key.
    ensure(value.publicKey === publicKey.export({type:'spki', format:'pem'}), 'PUBLIC_WEB_AUTHORITY_INVALID');
    ensure(privateKey.asymmetricKeyType === 'ed25519' && publicKey.asymmetricKeyType === 'ed25519', 'PUBLIC_WEB_AUTHORITY_INVALID');
    const expected = crypto.createPublicKey(privateKey).export({type:'spki', format:'der'});
    const actual = publicKey.export({type:'spki', format:'der'});
    ensure(expected.length === actual.length && crypto.timingSafeEqual(expected, actual), 'PUBLIC_WEB_AUTHORITY_INVALID');
  } catch { throw Error('PUBLIC_WEB_AUTHORITY_INVALID'); }
  return value;
}

export function ensurePublicWebAuthority(vault) {
  const current = vault.get('publicWebAuthority');
  if (current !== undefined) return {authority: validatePublicWebAuthority(current), created: false};
  const pair = crypto.generateKeyPairSync('ed25519', {
    privateKeyEncoding: {type:'pkcs8', format:'pem'},
    publicKeyEncoding: {type:'spki', format:'pem'},
  });
  const authority = validatePublicWebAuthority({schema:'agi-public-web-authority/v1', ...pair});
  vault.set({publicWebAuthority: authority});
  return {authority, created: true};
}
