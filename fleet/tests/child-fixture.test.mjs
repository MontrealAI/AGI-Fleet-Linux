import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {startFixtureChild,stopFixtureChild} from '../packages/AGI_Agent/tests/child-fixture.mjs';

test('Agent and Node use the same bounded child fixture',()=>{
  assert.deepEqual(fs.readFileSync(new URL('../packages/AGI_Agent/tests/child-fixture.mjs',import.meta.url)),fs.readFileSync(new URL('../packages/AGI_Node/tests/child-fixture.mjs',import.meta.url)));
});
test('readiness accepts split writes, then confirms child termination',async()=>{
  const child=await startFixtureChild(process.execPath,['-e',"process.stdout.write('rea');setImmediate(()=>process.stdout.write('dy'));setInterval(()=>{},1000)"]);
  await stopFixtureChild(child);
  assert.ok(child.exitCode!==null||child.signalCode!==null);
  await stopFixtureChild(child);
});
test('early child exit is reported promptly instead of waiting for stdout forever',async()=>{
  const start=Date.now();
  await assert.rejects(startFixtureChild(process.execPath,['-e','process.exit(9)']),error=>error.message==='FIXTURE_CHILD_EXITED_BEFORE_READY'&&error.exitCode===9);
  assert.ok(Date.now()-start<2000);
});
test('spawn failure retains its cause and does not hang cleanup',async()=>{
  await assert.rejects(startFixtureChild('/nonexistent/agi-test-child',[]),error=>error.message==='FIXTURE_CHILD_SPAWN_FAILED'&&error.cause.code==='ENOENT');
});
test('startup deadline terminates an unresponsive child',async()=>{
  const start=Date.now();
  await assert.rejects(startFixtureChild(process.execPath,['-e','setInterval(()=>{},1000)'],{timeoutMs:100}),error=>error.message==='FIXTURE_CHILD_READY_TIMEOUT'&&!error.cleanupFailure);
  assert.ok(Date.now()-start<2000);
});
test('excessive startup output is bounded and the child is terminated',async()=>{
  await assert.rejects(startFixtureChild(process.execPath,['-e',"process.stdout.write('x'.repeat(70000));setInterval(()=>{},1000)"]),error=>error.message==='FIXTURE_CHILD_OUTPUT_LIMIT'&&!error.cleanupFailure);
});
test('a child that ignores termination receives a bounded forced stop',async()=>{
  const child=await startFixtureChild(process.execPath,['-e',"process.on('SIGTERM',()=>{});process.stdout.write('ready');setInterval(()=>{},1000)"]);
  await stopFixtureChild(child,{graceMs:30});
  assert.equal(child.signalCode,'SIGKILL');
});
