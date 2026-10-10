import path from 'node:path';
export const SEED_PROFILE_SUFFIX = ' — Seed Wallet';
export function isSeedProfile(home) { return path.resolve(home).endsWith(SEED_PROFILE_SUFFIX); }
export function seedProfileHome(home) { return path.resolve(isSeedProfile(home) ? home : home + SEED_PROFILE_SUFFIX); }
export function profilePort(home) { return isSeedProfile(home) ? 8790 : 8787; }
export function profileService(home) { return 'ai.montreal.agi-node' + (isSeedProfile(home) ? '.seed-wallet' : ''); }
