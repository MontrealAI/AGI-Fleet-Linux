import crypto from 'node:crypto';
import { HDNodeWallet, Mnemonic, getAddress, wordlists } from 'ethers';
import { ensure } from '../util.mjs';

export const ETHEREUM_PATH = "m/44'/60'/0'/0/0";
export function normalizePhrase(value) {
  ensure(typeof value === 'string' && value.length <= 1024, 'RECOVERY_PHRASE_INVALID');
  const phrase = value.normalize('NFKD').trim().toLowerCase().split(/\s+/u).join(' ');
  ensure([12,24].includes(phrase.split(' ').length) && Mnemonic.isValidMnemonic(phrase, wordlists.en), 'RECOVERY_PHRASE_INVALID');
  return phrase;
}
function validPath(value) {
  ensure(typeof value === 'string' && /^m\/44'\/60'\/(0|[1-9]\d{0,9})'\/0\/(0|[1-9]\d{0,9})$/.test(value), 'RECOVERY_PATH_INVALID');
  ensure(value.split('/').slice(3).every(x => Number(x.replace("'", '')) < 2147483648), 'RECOVERY_PATH_INVALID');
  return value;
}
function derive(phrase, passphrase, path) {
  ensure(typeof passphrase === 'string' && passphrase.length <= 1024, 'RECOVERY_PASSPHRASE_INVALID');
  try { return HDNodeWallet.fromPhrase(phrase, passphrase.normalize('NFKD'), validPath(path), wordlists.en); }
  catch (e) { if (e.message === 'RECOVERY_PATH_INVALID') throw e; throw Error('RECOVERY_PHRASE_INVALID'); }
}
function result(wallet, phrase, passphrase, path) {
  return { wallet, recovery: { schema: 1, type: 'bip39', phrase, passphrase: passphrase.normalize('NFKD'), path, address: wallet.address, confirmed: false } };
}
export function createSeedWallet(wordCount = 24) {
  ensure(wordCount === 12 || wordCount === 24, 'RECOVERY_WORD_COUNT');
  const entropy = crypto.randomBytes(wordCount === 12 ? 16 : 32);
  try {
    const phrase = Mnemonic.fromEntropy(entropy, '', wordlists.en).phrase;
    return result(derive(phrase, '', ETHEREUM_PATH), phrase, '', ETHEREUM_PATH);
  } finally { entropy.fill(0); }
}
export function importSeedWallet({ phrase, passphrase = '', path = ETHEREUM_PATH, expectedAddress } = {}) {
  phrase = normalizePhrase(phrase);
  const wallet = derive(phrase, passphrase, path);
  let expected;
  try { expected = getAddress(expectedAddress); } catch { throw Error('RECOVERY_EXPECTED_ADDRESS_REQUIRED'); }
  ensure(expected === wallet.address, 'RECOVERY_ADDRESS_MISMATCH');
  return result(wallet, phrase, passphrase, path);
}
export function checkRecovery(recovery, privateKey, address) {
  ensure(recovery && recovery.schema === 1 && recovery.type === 'bip39' && typeof recovery.confirmed === 'boolean', 'RECOVERY_RECORD_INVALID');
  const phrase = normalizePhrase(recovery.phrase);
  const wallet = derive(phrase, recovery.passphrase, recovery.path);
  ensure(wallet.privateKey === privateKey && wallet.address === getAddress(address) && wallet.address === recovery.address, 'RECOVERY_RECORD_MISMATCH');
  return recovery;
}
export function publicRecovery(vault, address) {
  if (!address) return { type: 'none' };
  if (!vault.unlocked) return { type: 'locked' };
  const r = vault.get('walletRecovery');
  return r ? { type: 'bip39', wordCount: r.phrase.split(' ').length, path: r.path, hasPassphrase: r.passphrase !== '', confirmed: r.confirmed === true } : { type: 'private-key', confirmed: false };
}
