import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {DatabaseSync} from 'node:sqlite';
import {pinnedStandardFixture,pinnedPackage} from './setup-standard-lifecycle-fixture.mjs';
import {setupCapable} from '../compute/setup.mjs';import {sqliteStandardAuthority} from '../compute/setup-runtime-sqlite.mjs';
import {captureStandardOAuthAuthority} from '../compute/setup-standard-authority.mjs';
const contract=JSON.parse(fs.readFileSync(new URL('../compute/setup-runtime-sqlite-contract.json',import.meta.url))),table='operator_approval_standing_grants';
const real={skip:!pinnedPackage,timeout:240000};
for(const role of ['agent','node'])test('real pinned '+role+' fresh Standard owner/OAuth stores keep lazy grants absent through health and completion',real,async t=>{
 const f=pinnedStandardFixture(t,role),support=path.join(f.home,'.agi-genesis-setup-'+role);let atReview=false;
 f.rl.question=async prompt=>{
  if(!prompt.includes('Type APPROVE'))return 'SEPARATE';atReview=true;const candidate=path.join(support,'transaction/candidate'),file=path.join(candidate,'state/openclaw.sqlite'),db=new DatabaseSync(file);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version,17);assert.equal(db.prepare('SELECT type FROM sqlite_schema WHERE name=?').get(table),undefined);const settings=JSON.parse(fs.readFileSync(path.join(candidate,'compute-settings.json'))),before=captureStandardOAuthAuthority(candidate,settings),objects=contract.state.objects.filter(x=>x.tableName===table&&x.sql).sort((a,b)=>(a.type==='table'?-1:1)-(b.type==='table'?-1:1));
  const pinnedSource=fs.readFileSync(path.join(pinnedPackage,'dist/operator-approval-standing-grants-DbqgikJu.mjs'),'utf8'),ddl=/const STANDING_GRANT_SCHEMA_SQL = `([\s\S]*?)`;/.exec(pinnedSource)?.[1];assert.ok(ddl);db.exec(ddl);assert.deepEqual(captureStandardOAuthAuthority(candidate,settings),before);db.exec('DROP TABLE '+table);db.close();
  return 'APPROVE '+/APPROVE ([a-f0-9]{12})/.exec(prompt)[1];
 };
 const result=await setupCapable(f.kit,f.rl,{cleanInstall:true,assuranceMode:'standard',dependencies:f.dependencies});
 assert.equal(atReview,true);assert.equal(result.supportReport.passed,true);assert.equal(result.supportReport.assuranceMode,'standard');assert.equal(result.supportReport.cleanInitialization,null);assert.equal(result.supportReport.transaction.state,'complete');assert.equal(f.loginExchanges,role==='agent'?3:2);assert.equal(result.supportReport.serviceReadiness.health.state,'passed');assert.equal(result.supportReport.serviceReadiness.finalPolicy.state,'passed');assert.ok(Object.values(result.supportReport.serviceReadiness.health.history.at(-1).predicates).every(Boolean));
});
