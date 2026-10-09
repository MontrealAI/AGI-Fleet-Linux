#!/usr/bin/env python3
"""Diagnostic copy only. Never a frozen-release acceptance result."""
import importlib.util
import json
from pathlib import Path
import shutil
import sys

spec = importlib.util.spec_from_file_location('frozen', Path(__file__).with_name('run-frozen-native.py'))
frozen = importlib.util.module_from_spec(spec)
spec.loader.exec_module(frozen)
original_run = frozen.run


def diagnostic_run(command, log, timeout=10800):
    if not any(str(p).endswith('/scripts/run-regressions.py') for p in command):
        return original_run(command, log, timeout)
    source = Path(command[1]).parents[1]
    evidence = log.parent
    changed = []
    for worker in source.glob('**/compute/setup-standard-readiness-service-worker.mjs'):
        text = worker.read_text()
        old = "if(warnings.length||createHash('sha256').update(managedServiceEnvironmentFile(plan.environment)).digest('hex')!==authority.environmentSHA256)"
        if old not in text:
            raise ValueError('Worker diagnostic insertion point changed')
        text = text.replace(old, "console.error('DIAGNOSTIC_RENDER '+JSON.stringify({warnings,environmentKeys:Object.keys(plan.environment),expectedSHA256:authority.environmentSHA256,actualSHA256:createHash('sha256').update(managedServiceEnvironmentFile(plan.environment)).digest('hex')}));" + old)
        text = text.replace("}catch{", "}catch(error){console.error('DIAGNOSTIC_ERROR '+JSON.stringify({name:error.name,code:error.code,message:String(error.message).slice(0,1000)}));")
        worker.write_text(text)
        changed.append(str(worker.relative_to(source)))
    for caller in source.glob('**/compute/setup-standard-readiness-resume.mjs'):
        text = caller.read_text()
        old = "need(result.status===0,'pinned-gateway-launch-render');"
        if old not in text:
            raise ValueError('Caller diagnostic insertion point changed')
        caller.write_text(text.replace(old, "if(result.status!==0)console.error('DIAGNOSTIC_WORKER '+result.stderr);" + old))
        changed.append(str(caller.relative_to(source)))
    for fixture in source.glob('packages/*/tests/setup-runtime-materialization.test.mjs'):
        text = fixture.read_text()
        old = "config.meta={lastTouchedVersion:'2026.9.5'};"
        if old not in text:
            raise ValueError('Telemetry fixture insertion point changed')
        fixture.write_text(text.replace(old, old + "config.update={checkOnStart:false};"))
        changed.append(str(fixture.relative_to(source)))
    sdk = Path(command[command.index('--openclaw') + 1])
    (evidence / 'sdk-diagnostic-source').mkdir()
    for name in ('daemon-install-helpers-BQ0CTd58.mjs', 'telemetry-CwSEtSer.mjs'):
        shutil.copyfile(sdk / 'dist' / name, evidence / 'sdk-diagnostic-source' / name)
    frozen.save(evidence / 'diagnostic-changes.json', {'classification': 'DIAGNOSTIC_ONLY_NOT_ACCEPTANCE', 'frozenArchiveUnchanged': True, 'modifiedExtractedFiles': changed, 'ownershipChecksBypassed': False, 'operatorAccountsUsed': False})
    base = command[:command.index('--out')]
    files = ['packages/AGI_Agent/tests/setup-runtime-materialization.test.mjs', 'packages/AGI_Agent/tests/setup-standard-readiness.test.mjs']
    code = original_run(base + ['--out', evidence / 'diagnostic'] + [p for name in files for p in ('--file', name)], evidence / 'diagnostic-run.log', timeout)
    result = json.loads((evidence / 'diagnostic/results.json').read_text())
    frozen.save(evidence / 'summary.json', {'classification': 'DIAGNOSTIC_ONLY_NOT_ACCEPTANCE', 'runnerExitCode': code, 'counts': result.get('counts'), 'releaseQualified': False})
    print((evidence / 'summary.json').read_text(), flush=True)
    raise SystemExit(0)


frozen.run = diagnostic_run
frozen.main()
