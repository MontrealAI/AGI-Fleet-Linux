// SPDX-License-Identifier: MIT
// Arithmetic and event/transaction binding over retained disposable-EVM receipts.
import assert from 'node:assert/strict';
export function inspectMockGas(jobs){
  const gas=jobs.gasObservation;assert.equal(gas.classification,'DISPOSABLE_MOCK_GAS_NOT_REAL_EXPENDITURE');assert.equal(gas.publicNetworkEstimate,false);assert.equal(gas.realAssetExpenditure,false);
  assert(Number.isSafeInteger(gas.firstIncludedBlock)&&gas.firstIncludedBlock>0);assert(Number.isSafeInteger(gas.lastIncludedBlock)&&gas.lastIncludedBlock>=gas.firstIncludedBlock);assert(Array.isArray(gas.receipts)&&gas.receipts.length>0);
  const records=new Map();let total=0n,fees=0n;
  for(const row of gas.receipts){assert.match(row.transactionHash,/^0x[a-f0-9]{64}$/);assert.match(row.blockHash,/^0x[a-f0-9]{64}$/);assert(!records.has(row.transactionHash));records.set(row.transactionHash,row);assert(Number.isSafeInteger(row.blockNumber)&&row.blockNumber>=gas.firstIncludedBlock&&row.blockNumber<=gas.lastIncludedBlock);assert(Number.isSafeInteger(row.transactionIndex)&&row.transactionIndex>=0);assert([0,1].includes(row.status));for(const name of ['gasUsed','effectiveGasPriceWei','mockFeeWei'])assert.match(row[name],/^(?:0|[1-9][0-9]*)$/);assert(BigInt(row.gasUsed)>0n);assert.equal(BigInt(row.mockFeeWei),BigInt(row.gasUsed)*BigInt(row.effectiveGasPriceWei));total+=BigInt(row.gasUsed);fees+=BigInt(row.mockFeeWei);}
  assert.equal(total.toString(),gas.totalGasUsed);assert.equal(fees.toString(),gas.totalMockFeeWei);
  for(const outcome of [jobs.accepted,jobs.rejected]){
    assert(Number.isFinite(outcome.elapsedMilliseconds)&&outcome.elapsedMilliseconds>0);
    const creation=records.get(outcome.creationTransaction);assert(creation&&creation.status===1);
    for(const key of ['assignment','submission','validation',...(outcome===jobs.accepted?['finalization']:[])]){const event=outcome[key],receipt=records.get(event.transactionHash);assert(receipt&&receipt.status===1);assert.equal(receipt.blockHash,event.blockHash);assert.equal(receipt.blockNumber,event.blockNumber);}
  }
  assert.equal(jobs.rejected.finalization,null);assert(Number.isFinite(jobs.elapsedMilliseconds)&&jobs.elapsedMilliseconds>=jobs.accepted.elapsedMilliseconds+jobs.rejected.elapsedMilliseconds);
  return {totalGasUsed:total.toString(),totalMockFeeWei:fees.toString(),receipts:records.size,realAssetExpenditure:false};
}
