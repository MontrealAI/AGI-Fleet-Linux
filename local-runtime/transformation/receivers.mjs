// Application-installed native receivers; imports cannot select modules or grants.
import {canonical,parseStrict,need,keys} from '../primitives.mjs';
import {sha256} from '../../fleet/successor/vendor/manager/site/assets/successor/safe.mjs';

export function createTIReceivers({alpha,manager,jobs,computer,managerSha256,jobsSha256,runtimeBindings}={}) {
  need(typeof alpha?.inspectTransformationEnvelope==='function' && typeof alpha.assertPublicContent==='function',
    'TI_NATIVE_INSPECTOR_REQUIRED');
  const native=raw=>alpha.inspectTransformationEnvelope(raw);
  async function route(raw,module,asset,decimals,adapterSha256) {
    need(typeof module?.inspectTransformationWorkRequest==='function' && typeof module.createTransformationWorkDraft==='function',
      'TI_PAYMENT_INSPECTOR_REQUIRED');
    const value=await native(raw),expected=runtimeBindings?.get(value.campaign_id);
    need(typeof expected==='string'&&/^[a-f0-9]{64}$/.test(expected),'TI_CURRENT_RUNTIME_BINDING_REQUIRED');
    const options={expectedBindingsDigest:expected,inspectWorkRequest:native};
    need(canonical(await module.inspectTransformationWorkRequest(raw,options))===canonical(value),'TI_NATIVE_EXACT_OBJECT');
    need(value.charter.budgets.USDCBaseUnits==='0'&&value.charter.budgets.AGIALPHABaseUnits==='0','TI_FREE_ALLOWANCE_REQUIRED');
    let rejected=false;
    try {
      await module.createTransformationWorkDraft(raw,{...options,budgetUSDC:'1',amountBaseUnits:'1',createdAt:'2026-10-19T00:00:00.000Z'});
    } catch(error) {
      const expected=asset==='USDC'?/^TRANSFORMATION_USDC_(?:ROUTE|CAP)$/:/^TRANSFORMATION_AGIALPHA_(?:ROUTE|CAP)$/;
      need(expected.test(error.code??error.message),'TI_PAID_REFUSAL_REASON'); rejected=true;
    }
    need(rejected,'TI_PAID_PROPOSAL_MUST_REFUSE');
    return {schema:'agi-fleet/ti-route-inspection/v1',asset,decimals,nativeSha256:await sha256(raw),
      bindingsDigest:value.bindings_digest,inspection:'exact-native-object',paidProposal:'refused-native-zero-allowance',
      authority:'none',settlement:'not-connected',adapterSha256};
  }
  return {
    public:alpha.assertPublicContent,native,
    manager:raw=>route(raw,manager,'USDC',6,managerSha256),
    jobs:raw=>route(raw,jobs,'AGIALPHA',18,jobsSha256),
    handoff:raw=>{
      need(typeof computer?.inspectComputerHandoff==='function','TI_COMPUTER_INSPECTOR_REQUIRED');
      return computer.inspectComputerHandoff(raw);
    },
    computer:async raw=>{
      need(typeof computer?.inspectComputerReturn==='function','TI_COMPUTER_INSPECTOR_REQUIRED');
      const value=parseStrict(raw,4_000_000);keys(value,['handoffRaw','returnRaw']);
      return computer.inspectComputerReturn(value.handoffRaw,value.returnRaw);
    },
    library:async raw=>{
      const entry=parseStrict(raw,4_000_000);
      keys(entry,['envelope','conditions','behavior_digest','archive_digest','state','review','activation','retirement','authority_granted']);
      need(canonical(await native(canonical(entry.envelope)))===canonical(entry.envelope)
        &&entry.authority_granted===false&&entry.conditions?.evidence_scope==='local-structural-only'
        &&['pending-review','supported','rejected','retired'].includes(entry.state),'TI_LIBRARY_SCOPE');
      return entry;
    },
  };
}
