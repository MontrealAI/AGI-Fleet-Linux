import * as shared from '../shared/runtime/src/contract-profiles.mjs';
import { NodeError } from './util.mjs';
export { LEGACY_CONTRACT_PROFILE, MANAGER_117_CONTRACT_PROFILE, MANAGER_1193_CONTRACT_PROFILE, RUNTIME_CONTRACTS, CONTRACT_ARTIFACTS } from '../shared/runtime/src/contract-profiles.mjs';
const checked = fn => (...args) => {
  try { return fn(...args); }
  catch (error) {
    if (error instanceof shared.ContractProfileError) throw new NodeError(error.code);
    throw error;
  }
};
export const contractProfileID = checked(shared.contractProfileID);
export const loadContractProfile = checked(shared.loadContractProfile);
export const profilePinFields = checked(shared.profilePinFields);
export const assertProfilePin = checked(shared.assertProfilePin);
export const matchProfileRuntime = checked(shared.matchProfileRuntime);
export const assertPinnedGraph = checked(shared.assertPinnedGraph);
