"""SYNTHETIC UNIT FIXTURES ONLY. No GitHub, sudo, /opt, sandbox or payload execution.

These tests validate rejection paths and fixture-envelope bookkeeping. A fabricated
successful input below is deliberately not authenticated native qualification.
"""
from __future__ import annotations
import copy
import io
import json
import os
from pathlib import Path
import stat
import shlex
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile
sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
import prepare as p
import privileged as privileged
import run as runner

SYNTHETIC = 'SYNTHETIC_UNIT_FIXTURE_NOT_NATIVE_EVIDENCE'
# Real reference labels, wholly synthetic metadata/reports/bytes. No network read.
EXPECT = dict(p.REVIEWED_EXPECTATION)
RUN_ENDPOINT = f"/actions/runs/{EXPECT['runId']}/attempts/{EXPECT['runAttempt']}"
ARTIFACT_ENDPOINT = f"/actions/runs/{EXPECT['runId']}/artifacts?per_page=100"
HASH = 'a' * 64
ROOT = Path(__file__).resolve().parents[4]


def remote_fixture():
    run = {'id': EXPECT['runId'], 'run_attempt': EXPECT['runAttempt'], 'status': 'completed', 'conclusion': 'success', 'repository': {'full_name': p.REPOSITORY}, 'path': p.WORKFLOW, 'event': 'pull_request', 'head_sha': EXPECT['headCommit'], 'pull_requests': [{'number': p.REVIEWED_PR, 'head': {'sha': EXPECT['headCommit']}}]}
    artifacts = [{'id': p.REVIEWED_ARTIFACTS[target]['id'], 'name': 'alpha-native-ipc-' + target, 'expired': False, 'digest': 'sha256:' + p.REVIEWED_ARTIFACTS[target]['sha256'], 'workflow_run': {'id': EXPECT['runId'], 'head_sha': EXPECT['headCommit']}, 'size_in_bytes': p.REVIEWED_ARTIFACTS[target]['bytes']} for target in p.TARGETS]
    return {f'/pulls/{p.REVIEWED_PR}': {'fixture': SYNTHETIC, 'state': 'open', 'merged': False, 'number': p.REVIEWED_PR, 'head': {'sha': EXPECT['headCommit'], 'repo': {'full_name': p.REPOSITORY}}}, RUN_ENDPOINT: run,
            '/git/commits/' + EXPECT['testedCommit']: {'sha': EXPECT['testedCommit'], 'tree': {'sha': EXPECT['sourceTree']}}, '/git/commits/' + EXPECT['headCommit']: {'sha': EXPECT['headCommit'], 'tree': {'sha': EXPECT['sourceTree']}},
            RUN_ENDPOINT + '/jobs?per_page=100': {'total_count': 2, 'jobs': [{'name': target, 'status': 'completed', 'conclusion': 'success', 'run_attempt': EXPECT['runAttempt']} for target in p.TARGETS]},
            ARTIFACT_ENDPOINT: {'total_count': 2, 'artifacts': artifacts}}


def observation(phase='work', namespace=123):
    return {'phase': phase, 'processGroupGone': True, 'privateNamespacesEnded': True, 'namespaceLifetimeEOF': True, 'status': {'namespaces': {'pid': namespace}}, 'stdoutBytes': 0, 'stderrBytes': 1, 'evidenceClass': 'NATIVE_FIXED_ALPHA_IPC'}


def evidence_fixture(target='linux-x64'):
    inputs = p.load((ROOT / 'local-runtime/alpha/candidate/inputs.lock.json').read_bytes())
    archive = (SYNTHETIC + target).encode()
    manifest = {'schema': 'agi-fleet/alpha-candidate-artifact/v1', 'target': target, 'sourceCommit': inputs['source']['commit'], 'productionQualified': False, 'settlementAuthority': False, 'qualification': 'NOT_RUN', 'archiveSha256': p.sha(archive), 'archiveBytes': len(archive), 'builderSha256': p.sha((ROOT / 'local-runtime/alpha/candidate/build.py').read_bytes()), 'launcherSha256': p.sha((ROOT / 'local-runtime/alpha/candidate/launcher.py.in').read_bytes()), 'assets': [inputs['targets'][target]['python'], *inputs['targets'][target]['runtimePackages'], *inputs['targets'][target]['wheels']], 'entries': [], 'treeSha256': p.sha(p.canonical([])), 'inputsSha256': p.sha((ROOT / 'local-runtime/alpha/candidate/inputs.lock.json').read_bytes())}
    common = {'fixture': SYNTHETIC, 'status': 'PASSED', 'fleetSourceDirty': False, 'fleetCommit': EXPECT['testedCommit'], 'settlementAuthority': False, 'host': {'machine': inputs['targets'][target]['machine'], 'nodeSha256': HASH}, **{key: manifest[key] for key in ('archiveSha256', 'treeSha256', 'inputsSha256', 'sourceCommit')}}
    candidate = {**copy.deepcopy(common), 'schema': 'agi-fleet/alpha-candidate-isolation/v1', 'productionQualified': False, 'fleetGrantAdapterQualified': False, 'nativeExecutionObserved': True, 'probeAttempts': [{} for _ in range(5)], 'tests': [{'case': k, 'mode': mode} for k in p.KINDS for mode in ('validate', 'work')] + [{'refusal': r, 'mode': mode} for r in p.REFUSALS for mode in ('validate', 'work')] + [{} for _ in range(6)], 'contractFixtureSha256': inputs['contractFixtureSha256'], 'nodeExecutableSha256': HASH}
    cases = [(m, k) for m in ('sequence', 'grant') for k in p.KINDS] + [('probe', v) for v in p.PROBES] + [('grant-stop', 'research')] + [('refusal', r + '-' + mode) for r in p.REFUSALS for mode in ('validate', 'work')]
    attempts = []
    for mode, case in cases:
        obs = observation()
        if mode in ('sequence', 'grant'):
            obs.update(phases=[observation('validate'), observation('work')])
        attempts.append({'mode': mode, 'case': case, 'failure': None, 'driverExitStatus': 0, 'driver': {'ok': mode != 'refusal', 'code': 'ALPHA_WORKER_FAILED' if mode == 'refusal' else None, 'adapterSha256': HASH, 'archiveSha256': manifest['archiveSha256'], 'observation': obs}, 'liveNamespaceMembersObserved': {'pid:[123]': [456]}, 'namespaceMembersRemaining': {'pid:[123]': []}})
    ipc = {**copy.deepcopy(common), 'schema': 'agi-fleet/alpha-native-ipc-qualification/v1', 'productionAdmissionQualified': False, 'productionProvisioningQualified': False, 'productionTrustTargets': 'UNPROVISIONED', 'adapterSha256': HASH, 'tests': [{'status': 'PASSED'} for _ in cases], 'attempts': attempts}
    for report, key, file in [(candidate, 'qualifierSha256', 'candidate/qualify.py'), (candidate, 'probeSha256', 'candidate/probe.py'), (candidate, 'contractBridgeSha256', 'candidate/check-contract.mjs'), (ipc, 'qualifierSha256', 'native-qualification/qualify.py'), (ipc, 'driverSha256', 'native-qualification/driver.mjs'), (ipc, 'probeSha256', 'native-qualification/probe.py')]:
        report[key] = p.sha((ROOT / 'local-runtime/alpha' / file).read_bytes())
    reproduction = {'schema': 'agi-fleet/alpha-candidate-reproduction/v1', 'fleetCommit': EXPECT['testedCommit'], 'workflowRun': str(EXPECT['runId']), 'workflowAttempt': str(EXPECT['runAttempt']), 'target': target, 'identicalBuilds': 2, 'productionQualified': False, 'productionTrustTargets': 'UNPROVISIONED', **{k: manifest[k] for k in ('archiveSha256', 'treeSha256', 'inputsSha256')}}
    return {'candidate.tar.gz': archive, 'manifest.json': p.canonical(manifest), 'native-candidate.json': p.canonical(candidate), 'native-ipc.json': p.canonical(ipc), 'reproduction.json': p.canonical(reproduction)}


def mutate(members, name, change):
    value = p.load(members[name]); change(value); members[name] = p.canonical(value)


class RemoteTests(unittest.TestCase):
    def test_current_candidate_expectation_is_exact_and_historical_pins_are_refused(self):
        current=p.load((p.HERE/'expected-pr47.json').read_bytes())
        self.assertEqual(p.REVIEWED_PR,47)
        self.assertEqual(current,p.REVIEWED_EXPECTATION)
        self.assertEqual(current,{
            'headCommit':'2d5d62369d57db9abc9f622ccb4781e6cccd90d2',
            'testedCommit':'847943561dcd6406824eb4d22a617bd52a18f381',
            'sourceTree':'7c52bc0cdd85b87f2219b46b6be6caeafa136b43',
            'runId':38716434461,'runAttempt':1})
        for name in ('expected-pr42.json','expected-pr46.json'):
            old=p.load((p.HERE/name).read_bytes())
            with self.subTest(name=name),self.assertRaisesRegex(ValueError,'reviewed PR lineage'):
                p.verify_remote(old,lambda endpoint:self.fail('Historical expectation must fail before remote reads'))

    def test_another_valid_tested_commit_run_or_attempt_is_refused_before_fetch(self):
        for key,value in (('testedCommit','2'*40),('runId',EXPECT['runId']+1),('runAttempt',2)):
            with self.subTest(key=key),self.assertRaisesRegex(ValueError,'reviewed PR lineage'):
                p.verify_remote({**EXPECT,key:value},lambda endpoint:self.fail('Unreviewed run identity must fail before remote reads'))

    def test_artifact_ids_and_digests_are_frozen_per_architecture(self):
        self.assertEqual(p.REVIEWED_ARTIFACTS,{
            'linux-x64':{'id':11969784543,'bytes':59946774,'sha256':'76af4122a07217651573a45aa00694ccca66d38ff4f8600637bcfae8ab3f32bd'},
            'linux-arm64':{'id':11968950893,'bytes':53807545,'sha256':'3e7a1bfee0db3cfb15b364f71a8443db1c9c4a5eb63276e0ab66683f5b7055af'}})
        for index,target in enumerate(p.TARGETS):
            for change in ({'id':11969784544},{'id':True},{'size_in_bytes':100},{'size_in_bytes':True},{'digest':'sha256:'+'f'*64},
                           {'id':p.REVIEWED_ARTIFACTS[p.TARGETS[1-index]]['id'],
                            'digest':'sha256:'+p.REVIEWED_ARTIFACTS[p.TARGETS[1-index]]['sha256']}):
                remote=remote_fixture();remote[ARTIFACT_ENDPOINT]['artifacts'][index].update(change)
                with self.subTest(target=target,change=change),self.assertRaisesRegex(ValueError,'reviewed ID/digest'):
                    p.verify_remote(EXPECT,remote.__getitem__)

    def test_inactive_approval_document_matches_frozen_references(self):
        packet=(p.HERE/'APPROVAL_PR47.md').read_text()
        for value in p.REVIEWED_EXPECTATION.values():
            self.assertIn(str(value),packet)
        for artifact in p.REVIEWED_ARTIFACTS.values():
            for value in artifact.values():self.assertIn(str(value),packet)
        self.assertIn('NOT_AUTHORIZED_NOT_EXECUTED',packet)
        self.assertIn('No genuine preparation.json or approval.json exists',packet)

    def test_reviewed_input_references_match_the_frozen_proposal(self):
        reference=p.load((p.HERE/'reviewed-pr47-evidence.json').read_bytes())
        self.assertEqual(reference['sourceExpectationFile'],'expected-pr47.json')
        self.assertEqual(reference['runtimeSourceTree'],p.REVIEWED_TREE)
        self.assertEqual(set(reference['targets']),set(p.TARGETS))
        for target,artifact in p.REVIEWED_ARTIFACTS.items():
            value=reference['targets'][target]
            self.assertEqual((value['rawArtifactId'],value['rawArtifactSha256'],value['rawArtifactBytes']),
                             (artifact['id'],artifact['sha256'],artifact['bytes']))
            self.assertEqual(value['installation'],'/opt/agi-fleet-alpha/'+target+'/'+value['archiveSha256'])
        for name in ('productionQualified','productionAdmissionQualified','productionProvisioningQualified'):
            self.assertIs(reference[name],False)
        for name in ('fixedPathAdmission','fixedPathProvisioning'):
            self.assertEqual(reference[name],'NOT_RUN')
        self.assertEqual(reference['productionTrustTargets'],'UNPROVISIONED')

    def test_other_pr_number_cannot_qualify_the_current_source(self):
        for old_pr in (42,46):
            for where in ('pull','run'):
                remote=remote_fixture()
                if where=='pull':remote[f'/pulls/{p.REVIEWED_PR}']['number']=old_pr
                else:remote[RUN_ENDPOINT]['pull_requests'][0]['number']=old_pr
                with self.subTest(old_pr=old_pr,where=where),self.assertRaises(ValueError):
                    p.verify_remote(EXPECT,remote.__getitem__)

    def test_injected_synthetic_remote_metadata_only(self):
        remote = remote_fixture()
        result = p.verify_remote(EXPECT, remote.__getitem__)
        self.assertEqual(set(result['artifacts']), set(p.TARGETS))
        self.assertEqual(result['pullRequest']['fixture'], SYNTHETIC)

    def test_pending_failed_wrong_attempt_and_wrong_workflow_fail_closed(self):
        for patch_value in ({'status': 'in_progress'}, {'conclusion': 'failure'}, {'run_attempt': EXPECT['runAttempt']+1}, {'path': 'other.yml'}, {'event': 'workflow_dispatch'}, {'head_sha': 'f' * 40}, {'pull_requests': []}):
            with self.subTest(patch_value=patch_value):
                remote = remote_fixture(); remote[RUN_ENDPOINT].update(patch_value)
                with self.assertRaises(ValueError): p.verify_remote(EXPECT, remote.__getitem__)

    def test_pr_head_fork_closed_and_integration_tree_mismatch_refused(self):
        mutations = [lambda r: r[f'/pulls/{p.REVIEWED_PR}']['head'].update(sha='f' * 40), lambda r: r[f'/pulls/{p.REVIEWED_PR}']['head']['repo'].update(full_name='someone/fork'), lambda r: r[f'/pulls/{p.REVIEWED_PR}'].update(state='closed'), lambda r: r['/git/commits/' + EXPECT['testedCommit']]['tree'].update(sha='f' * 40)]
        for change in mutations:
            r = remote_fixture(); change(r)
            with self.assertRaises(ValueError): p.verify_remote(EXPECT, r.__getitem__)

    def test_missing_duplicate_failed_architecture_and_pagination_refused(self):
        endpoint = RUN_ENDPOINT + '/jobs?per_page=100'
        for change in (lambda v: v.update(total_count=3), lambda v: v['jobs'][1].update(name='linux-x64'), lambda v: v['jobs'][1].update(conclusion='failure'), lambda v: v['jobs'][1].update(run_attempt=EXPECT['runAttempt']+1)):
            r=remote_fixture(); change(r[endpoint])
            with self.assertRaises(ValueError): p.verify_remote(EXPECT, r.__getitem__)

    def test_artifact_provenance_digest_expiry_and_inventory_refused(self):
        endpoint=ARTIFACT_ENDPOINT
        for change in (lambda a: a.update(expired=True), lambda a: a.update(digest=''), lambda a: a['workflow_run'].update(id=999), lambda a: a['workflow_run'].update(head_sha='f'*40), lambda a: a.update(name='wrong')):
            r=remote_fixture(); change(r[endpoint]['artifacts'][0])
            with self.assertRaises(ValueError): p.verify_remote(EXPECT,r.__getitem__)
        r=remote_fixture(); r[endpoint]['total_count']=100
        with self.assertRaises(ValueError): p.verify_remote(EXPECT,r.__getitem__)

    def test_exact_expectation_schema_and_types(self):
        for value in ({**EXPECT,'headCommit':'1'*40}, {**EXPECT,'sourceTree':'3'*40}, {**EXPECT,'sourceTree':'not-a-tree'}, {**EXPECT,'runId':True}, {**EXPECT,'runAttempt':0}, {**EXPECT,'url':'https://example.invalid'}, {k:v for k,v in EXPECT.items() if k!='headCommit'}):
            with self.assertRaises(ValueError): p.verify_remote(value, lambda _: self.fail('must not fetch'))


class MergedLineageTests(unittest.TestCase):
    BASE = 'b' * 40
    MERGE = 'c' * 40

    def fixture(self):
        remote=remote_fixture()
        remote[f'/pulls/{p.REVIEWED_PR}'].update(state='closed',merged=True,merged_at='2026-10-15T12:00:00Z',merge_commit_sha=self.MERGE,base={'ref':'main','repo':{'full_name':p.REPOSITORY}})
        parents=[{'sha':self.BASE},{'sha':EXPECT['headCommit']}]
        remote['/git/commits/'+EXPECT['testedCommit']]['parents']=copy.deepcopy(parents)
        remote['/git/commits/'+self.MERGE]={'fixture':SYNTHETIC,'sha':self.MERGE,'tree':{'sha':EXPECT['sourceTree']},'parents':copy.deepcopy(parents)}
        return remote

    def test_closed_merged_requires_actual_git_object_and_retains_provenance(self):
        remote=self.fixture();reads=[]
        def fetch(endpoint):reads.append(endpoint);return remote[endpoint]
        result=p.verify_remote(EXPECT,fetch)
        self.assertIn('/git/commits/'+self.MERGE,reads)
        self.assertEqual(result['prLifecycle'],'MERGED_EXACT_TESTED_LINEAGE')
        self.assertEqual(result['mergeCommit']['fixture'],SYNTHETIC)
        self.assertEqual(result['testedCommit']['sha'],EXPECT['testedCommit'])
        self.assertEqual(set(result['artifacts']),set(p.TARGETS))
        opened=p.verify_remote(EXPECT,remote_fixture().__getitem__)
        self.assertIsNone(opened['mergeCommit']);self.assertEqual(opened['prLifecycle'],'OPEN_REVIEWED_HEAD')

    def test_closed_unmerged_inconsistent_state_or_missing_merge_metadata_refused(self):
        for change in ({'merged':False},{'merged':None},{'merged':'true'},{'state':'open'},{'state':'unknown'},
                       {'merged_at':None},{'merged_at':''},{'merge_commit_sha':None},{'merge_commit_sha':'../unsafe'},
                       {'merge_commit_sha':EXPECT['headCommit']},{'merge_commit_sha':EXPECT['testedCommit']},
                       {'base':{'ref':'other','repo':{'full_name':p.REPOSITORY}}},
                       {'base':{'ref':'main','repo':{'full_name':'untrusted/fork'}}}):
            remote=self.fixture();remote[f'/pulls/{p.REVIEWED_PR}'].update(change)
            with self.subTest(change=change),self.assertRaises(ValueError):p.verify_remote(EXPECT,remote.__getitem__)

    def test_changed_head_tree_and_wrong_real_merge_object_refused(self):
        for mutate in (lambda r:r[f'/pulls/{p.REVIEWED_PR}']['head'].update(sha='f'*40),
                       lambda r:r['/git/commits/'+EXPECT['headCommit']]['tree'].update(sha='f'*40),
                       lambda r:r['/git/commits/'+EXPECT['testedCommit']]['tree'].update(sha='f'*40),
                       lambda r:r['/git/commits/'+self.MERGE].update(sha='f'*40),
                       lambda r:r['/git/commits/'+self.MERGE]['tree'].update(sha='f'*40)):
            remote=self.fixture();mutate(remote)
            with self.assertRaises(ValueError):p.verify_remote(EXPECT,remote.__getitem__)

    def test_wrong_missing_squashed_rebased_reordered_or_extra_merge_parents_refused(self):
        for endpoint in ('/git/commits/'+self.MERGE,'/git/commits/'+EXPECT['testedCommit']):
            for parents in (None,[],[{'sha':self.BASE}],[{'sha':'f'*40},{'sha':EXPECT['headCommit']}],
                            [{'sha':EXPECT['headCommit']},{'sha':self.BASE}],
                            [{'sha':self.BASE},{'sha':'f'*40}],
                            [{'sha':self.BASE},{'sha':EXPECT['headCommit']},{'sha':'e'*40}],
                            [{'sha':self.BASE},None]):
                remote=self.fixture();remote[endpoint]['parents']=parents
                with self.subTest(endpoint=endpoint,parents=parents),self.assertRaises(ValueError):p.verify_remote(EXPECT,remote.__getitem__)

    def test_nonexistent_or_unavailable_real_merge_is_not_accepted_from_pr_flag(self):
        remote=self.fixture();remote.pop('/git/commits/'+self.MERGE)
        with self.assertRaises(KeyError):p.verify_remote(EXPECT,remote.__getitem__)
        remote=self.fixture();remote['/git/commits/'+self.MERGE]=None
        with self.assertRaises(ValueError):p.verify_remote(EXPECT,remote.__getitem__)
        def failed_reader(endpoint):
            if endpoint=='/git/commits/'+self.MERGE:raise OSError('SYNTHETIC_TLS_OR_API_UNAVAILABLE')
            return remote[endpoint]
        with self.assertRaises(OSError):p.verify_remote(EXPECT,failed_reader)

    def test_merge_reader_uses_fixed_https_api_and_refuses_redirects(self):
        # Mocked HTTP transport only: this never contacts GitHub or authenticates
        # the synthetic commit. The production reader has no caller URL option.
        endpoint='/git/commits/'+self.MERGE
        payload=self.fixture()[endpoint]
        with patch.object(p.urllib.request,'build_opener') as build:
            response=build.return_value.open.return_value.__enter__.return_value
            response.read.return_value=p.canonical(payload)
            self.assertEqual(p.fetch_json(endpoint),payload)
            request=build.return_value.open.call_args.args[0]
            self.assertEqual(request.full_url,'https://api.github.com/repos/'+p.REPOSITORY+endpoint)
            self.assertIsNone(request.get_header('Authorization'))
            handler=build.call_args.args[0]
            for destination in ('http://api.github.com/unsafe','https://untrusted.invalid/commit'):
                with self.assertRaisesRegex(ValueError,'redirect refused'):
                    handler.redirect_request(request,None,302,'redirect',{},destination)

    def test_merged_status_does_not_bypass_exact_native_jobs_artifact_or_run_gates(self):
        for mutate in (lambda r:r[RUN_ENDPOINT].update(conclusion='failure'),
                       lambda r:r[RUN_ENDPOINT].update(run_attempt=2),
                       lambda r:r[RUN_ENDPOINT+'/jobs?per_page=100']['jobs'][1].update(conclusion='failure'),
                       lambda r:r[ARTIFACT_ENDPOINT]['artifacts'][0].update(id=999),
                       lambda r:r[ARTIFACT_ENDPOINT]['artifacts'][1].update(digest='sha256:'+'f'*64)):
            remote=self.fixture();mutate(remote)
            with self.assertRaises(ValueError):p.verify_remote(EXPECT,remote.__getitem__)

    def test_real_merge_is_never_an_additional_runtime_checkout(self):
        with tempfile.TemporaryDirectory() as tmp,patch.object(p.os,'geteuid',return_value=1000),patch.object(p,'git',return_value=self.MERGE),patch.object(p,'verify_remote') as remote:
            root=Path(tmp);source=root/'source';source.mkdir();output=root/'out'
            with self.assertRaisesRegex(ValueError,'clean exact reviewed source'):
                p.prepare(source,output,root/'synthetic-node',EXPECT,{},'linux-x64')
            remote.assert_not_called();self.assertFalse(output.exists())


class InputTests(unittest.TestCase):
    def test_duplicate_and_nonfinite_json_rejected(self):
        for raw in ('{"x":1,"x":2}', '{"x":NaN}', '{"x":Infinity}'):
            with self.assertRaises(ValueError): p.load(raw)

    def test_path_traversal_controls_and_backslashes_refused(self):
        for name in ('../x','/x','a//b','a/./b','a/../b','a\\b','a\x00b','a\nb',''):
            with self.assertRaises(ValueError): p.safe_relative(name)

    def test_digest_zip_links_special_nodes_duplicates_and_inventory(self):
        for name, mode, duplicate in [('a', stat.S_IFLNK|0o777, False), ('a',stat.S_IFCHR|0o600,False), ('../a',stat.S_IFREG|0o444,False),('a',stat.S_IFREG|0o444,True)]:
            data=io.BytesIO()
            with zipfile.ZipFile(data,'w') as z:
                info=zipfile.ZipInfo(name); info.external_attr=mode<<16; z.writestr(info,SYNTHETIC)
                if duplicate:
                    import warnings
                    with warnings.catch_warnings():
                        warnings.simplefilter('ignore'); z.writestr(info,SYNTHETIC)
            raw=data.getvalue()
            with self.assertRaises(ValueError): p.artifact_members(raw,p.sha(raw))
        with self.assertRaises(ValueError): p.artifact_members(b'wrong',HASH)

    def test_valid_zip_is_only_bytes_and_member_names_must_be_unambiguous(self):
        data=io.BytesIO()
        with zipfile.ZipFile(data,'w') as z: z.writestr('synthetic/report.json',SYNTHETIC)
        raw=data.getvalue(); values=p.artifact_members(raw,p.sha(raw))
        self.assertEqual(p.select_member(values,'report.json'),SYNTHETIC.encode())
        with self.assertRaises(ValueError): p.select_member({**values,'other/report.json':b'other'},'report.json')

    def test_file_input_symlink_and_size_refused(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp); (root/'input').write_text(SYNTHETIC); (root/'link').symlink_to(root/'input')
            with self.assertRaises(OSError): p.file_bytes(root/'link')
            with self.assertRaises(ValueError): p.file_bytes(root/'input',3)

    def test_snapshot_hashes_modes_and_empty_directories(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp); (root/'empty').mkdir(); (root/'data').write_text(SYNTHETIC)
            first=p.snapshot_tree(root); self.assertIn(['empty','directory',0o755],first)
            (root/'empty').chmod(0o700); self.assertNotEqual(first,p.snapshot_tree(root))
            (root/'outside').symlink_to('/etc')
            with self.assertRaises(ValueError): p.snapshot_tree(root)

    def test_snapshot_rejects_hardlinks_and_special_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp); (root/'data').write_text(SYNTHETIC); os.link(root/'data',root/'link')
            with self.assertRaises(ValueError): p.snapshot_tree(root)
            (root/'link').unlink(); os.mkfifo(root/'fifo')
            with self.assertRaises(ValueError): p.snapshot_tree(root)


class EvidenceTests(unittest.TestCase):
    def test_two_architecture_synthetic_envelopes_bind_separately(self):
        for target in p.TARGETS:
            descriptor,q,values,ipc=p.validate_evidence(target,evidence_fixture(target),EXPECT,ROOT)
            envelope=p.load(q)
            self.assertEqual(descriptor['qualificationSha256'],p.sha(q))
            self.assertEqual(envelope['candidateEvidenceSha256'],p.sha(values['native-candidate.json']))
            self.assertEqual(envelope['adapterEvidenceSha256'],p.sha(values['native-ipc.json']))
            self.assertEqual(envelope['target'],target)
            self.assertNotIn('productionAdmissionQualified',envelope)
            self.assertNotIn('productionProvisioningQualified',envelope)
            self.assertNotIn('productionQualified',envelope)

    def test_candidate_identity_source_coverage_and_authority_tampering(self):
        for change in (lambda v:v.update(status='FAILED'), lambda v:v.update(fleetSourceDirty=True), lambda v:v.update(fleetCommit='f'*40), lambda v:v.update(productionQualified=True), lambda v:v.update(fleetGrantAdapterQualified=True), lambda v:v.update(nativeExecutionObserved=False), lambda v:v.update(probeAttempts=[]), lambda v:v.update(qualifierSha256=HASH), lambda v:v['tests'].pop(), lambda v:v['host'].update(machine='wrong'), lambda v:v.update(nodeExecutableSha256='f'*64)):
            values=evidence_fixture(); mutate(values,'native-candidate.json',change)
            with self.assertRaises(ValueError): p.validate_evidence('linux-x64',values,EXPECT,ROOT)

    def test_manifest_bytes_source_and_historical_authority_tampering(self):
        for change in (lambda v:v.update(productionQualified=True),lambda v:v.update(qualification='PASSED'),lambda v:v.update(archiveBytes=1),lambda v:v.update(sourceCommit='f'*40),lambda v:v.update(builderSha256=HASH),lambda v:v.update(launcherSha256=HASH),lambda v:v.update(assets=[]),lambda v:v.update(entries=[{}]),lambda v:v.update(inputsSha256=HASH)):
            values=evidence_fixture(); mutate(values,'manifest.json',change)
            with self.assertRaises(ValueError): p.validate_evidence('linux-x64',values,EXPECT,ROOT)
        values=evidence_fixture();values['candidate.tar.gz']+=b'tampered'
        with self.assertRaises(ValueError):p.validate_evidence('linux-x64',values,EXPECT,ROOT)

    def test_ipc_authority_source_coverage_and_attempt_failures(self):
        for change in (lambda v:v.update(productionAdmissionQualified=True),lambda v:v.update(productionProvisioningQualified=True),lambda v:v.update(productionTrustTargets='REVIEWED_NATIVE'),lambda v:v.update(adapterSha256='invalid'),lambda v:v['attempts'].pop(),lambda v:v['tests'][0].update(status='FAILED'),lambda v:v['attempts'][0].update(failure='error'),lambda v:v['attempts'][0].update(driverExitStatus=1),lambda v:v['attempts'][0]['driver'].update(adapterSha256='f'*64),lambda v:v['attempts'][0]['driver'].update(ok=False),lambda v:v['attempts'][0].update(case='not-reviewed')):
            values=evidence_fixture();mutate(values,'native-ipc.json',change)
            with self.assertRaises(ValueError):p.validate_evidence('linux-x64',values,EXPECT,ROOT)

    def test_incomplete_cleanup_and_unobserved_namespaces_refused(self):
        for change in (lambda v:v['attempts'][0]['driver']['observation'].update(privateNamespacesEnded=False),lambda v:v['attempts'][0]['driver']['observation']['phases'][0].update(namespaceLifetimeEOF=False),lambda v:v['attempts'][8].update(liveNamespaceMembersObserved={}),lambda v:v['attempts'][8].update(namespaceMembersRemaining={'pid:[123]':[456]}),lambda v:v['attempts'][8].update(namespaceMembersRemaining={'pid:[999]':[]}),lambda v:v['attempts'][-1]['driver'].update(ok=True),lambda v:v['attempts'][-1]['driver']['observation'].update(stdoutBytes=1)):
            values=evidence_fixture();mutate(values,'native-ipc.json',change)
            with self.assertRaises(ValueError):p.validate_evidence('linux-x64',values,EXPECT,ROOT)

    def test_reproduction_run_attempt_and_two_builds_bound(self):
        for change in (lambda v:v.update(workflowRun='124'),lambda v:v.update(workflowAttempt=str(EXPECT['runAttempt']+1)),lambda v:v.update(fleetCommit=EXPECT['headCommit']),lambda v:v.update(identicalBuilds=1),lambda v:v.update(productionQualified=True),lambda v:v.update(archiveSha256=HASH)):
            values=evidence_fixture();mutate(values,'reproduction.json',change)
            with self.assertRaises(ValueError):p.validate_evidence('linux-x64',values,EXPECT,ROOT)

    def test_fixture_lock_requires_both_architectures_and_preserves_original(self):
        original=(ROOT/p.LOCK).read_bytes(); descriptors={target:p.validate_evidence(target,evidence_fixture(target),EXPECT,ROOT)[0] for target in p.TARGETS}
        result=p.load(p.build_fixture_lock(original,descriptors));self.assertEqual(result['state'],'REVIEWED_NATIVE');self.assertEqual((ROOT/p.LOCK).read_bytes(),original)
        self.assertEqual(p.load(original)['targets'],dict.fromkeys(p.TARGETS))
        with self.assertRaises(ValueError):p.build_fixture_lock(original,{'linux-x64':descriptors['linux-x64']})
        with self.assertRaises(ValueError):p.build_fixture_lock(p.canonical(result),descriptors)


class ActualEvidenceTests(unittest.TestCase):
    def fixture(self,mode='work'):
        phases=[observation('validate',123),observation('work',124)]
        obs={'runtimeIdentity':HASH,'providerCalls':0,'network':'none','phases':phases}
        interpreter={'device':'1','inode':'2','bytes':3,'sha256':HASH}
        live=[{'pid':456,'startTimeTicks':'789','phase':phase['phase'],'pidNamespace':'pid:['+str(phase['status']['namespaces']['pid'])+']','interpreter':interpreter} for phase in phases]
        request={'kind':'cancel-native-phase','nonce':'a'*64,'payload':copy.deepcopy(live[-1])}
        if mode!='work':phases[-1].update(signal='SIGKILL',exitStatus=None)
        return {'mode':mode,'failure':None,'exitStatus':0,'cancelSent':mode!='work','cancelRequest':request,'driver':{'fixture':SYNTHETIC,'ok':True,'runtimeIdentity':HASH,'receipt':{'observation':obs},'retained':{'state':'uncertain','receipt':{'error':'RUN_CANCELLED','observation':obs}},'stopRecorded':True,'grantConsumed':True,'runUncertain':True,'cancellationApplied':True,'code':'RUN_CANCELLED','cancellationRequest':copy.deepcopy(request)},'nativeProcessesObserved':live, 'namespaceMembersRemaining':{'pid:[123]':[],'pid:[124]':[]}}


    def test_complete_synthetic_observation_structure_only(self):
        for mode in ('work','stop','revoke-grant','revoke-client'):runner.check_attempt(self.fixture(mode))

    def test_driver_failure_and_missing_real_phase_observation_rejected(self):
        for change in (lambda v:v.update(exitStatus=1),lambda v:v.update(failure='timeout'),lambda v:v['driver'].update(ok=False),lambda v:v['driver']['receipt']['observation'].update(providerCalls=1),lambda v:v['driver']['receipt']['observation'].update(runtimeIdentity='f'*64),lambda v:v['driver']['receipt']['observation']['phases'][0].update(evidenceClass='SYNTHETIC'),lambda v:v.update(nativeProcessesObserved=[]),lambda v:v.update(namespaceMembersRemaining={'pid:[123]':[]}),lambda v:v['namespaceMembersRemaining'].update({'pid:[124]':[456]})):
            value=self.fixture();change(value)
            with self.assertRaises(ValueError):runner.check_attempt(value)

    def test_stop_and_revocation_require_consumption_uncertainty_and_actual_cancel(self):
        for key in ('stopRecorded','grantConsumed','runUncertain','cancellationApplied'):
            value=self.fixture('stop');value['driver'][key]=False
            with self.assertRaises(ValueError):runner.check_attempt(value)
        value=self.fixture('revoke-grant');value['cancelSent']=False
        with self.assertRaises(ValueError):runner.check_attempt(value)


class PreparationBindingTests(unittest.TestCase):
    def fixture(self, directory):
        checkout=directory/'checkout';(checkout/'local-runtime/alpha').mkdir(parents=True)
        original=(ROOT/p.LOCK).read_bytes();descriptors={t:p.validate_evidence(t,evidence_fixture(t),EXPECT,ROOT)[0] for t in p.TARGETS}
        lock=p.build_fixture_lock(original,descriptors);(checkout/p.LOCK).write_bytes(lock)
        (directory/'source-lock.json').write_bytes(original)
        (directory/'remote-provenance.json').write_bytes(p.canonical({'fixture':SYNTHETIC}))
        (directory/'fixture-lock.diff').write_text(SYNTHETIC)
        inputs={}
        for target in p.TARGETS:
            dest=directory/'inputs'/target;dest.mkdir(parents=True)
            values={**evidence_fixture(target),'qualification.json':p.validate_evidence(target,evidence_fixture(target),EXPECT,ROOT)[1]}
            for name,raw in values.items():(dest/name).write_bytes(raw)
            inputs[target]={name:p.sha(raw) for name,raw in values.items()}
        node=directory/'synthetic-node-never-executed';node.write_text(SYNTHETIC)
        snapshot=p.snapshot_tree(checkout)
        report={'schema':'agi-fleet/alpha-fixed-path-preparation/v1','fixture':SYNTHETIC,'status':'PREPARED_NOT_INSTALLED','authority':p.AUTHORITY,'productionQualified':False,'productionTrustTargets':'UNPROVISIONED','productionProvisioningQualified':False,'productionAdmissionQualified':False,'settlementAuthority':False,'checkout':str(checkout),'fixtureSnapshot':snapshot,'fixtureSnapshotSha256':p.sha(p.canonical(snapshot)),'fixtureLockSha256':p.sha(lock),'sourceLockSha256':p.sha(original),'node':str(node),'nodeSha256':p.sha(node.read_bytes()),'python':str(Path(sys.executable).resolve()),'pythonSha256':p.sha(p.file_bytes(Path(sys.executable).resolve())),'remoteProvenanceSha256':p.sha((directory/'remote-provenance.json').read_bytes()),'fixtureDiffSha256':p.sha((directory/'fixture-lock.diff').read_bytes()),'inputs':inputs,'harnessDirectory':str(p.HERE),'harnessFiles':{f.name:p.sha(f.read_bytes()) for f in p.HERE.iterdir() if f.suffix in ('.py','.mjs','.md','.json')},'nativeTarget':'linux-x64','installation':'/opt/agi-fleet-alpha/linux-x64/'+descriptors['linux-x64']['archiveSha256'],'expected':EXPECT,'sourceCheckout':str(directory/'original-source')}
        raw=p.canonical(report);(directory/'preparation.json').write_bytes(raw)
        return report,p.sha(raw)

    def test_complete_synthetic_preparation_bindings_without_execution(self):
        with tempfile.TemporaryDirectory() as tmp,patch.object(privileged.subprocess,'run') as execute:
            directory=Path(tmp);report,identity=self.fixture(directory)
            self.assertEqual(privileged.verify_preparation(directory,identity)['fixture'],SYNTHETIC)
            execute.assert_not_called()

    def test_changed_inputs_source_runtime_diff_provenance_and_extra_source_fail(self):
        for relative in ('inputs/linux-x64/candidate.tar.gz','inputs/linux-arm64/native-ipc.json',p.LOCK,'synthetic-node-never-executed','source-lock.json','fixture-lock.diff','remote-provenance.json','unlisted'):
            with self.subTest(relative=relative),tempfile.TemporaryDirectory() as tmp:
                directory=Path(tmp);_,identity=self.fixture(directory)
                target=directory/'checkout'/relative if relative in (p.LOCK,'unlisted') else directory/relative
                target.write_bytes(target.read_bytes()+b'changed' if target.exists() else b'unlisted')
                with self.assertRaises(ValueError):privileged.verify_preparation(directory,identity)

    def test_production_authority_and_destination_changes_rejected_even_rehashed(self):
        for key,value in (('authority','production'),('productionQualified',True),('productionProvisioningQualified',True),('productionAdmissionQualified',True),('productionTrustTargets','REVIEWED_NATIVE'),('settlementAuthority',True),('installation','/opt/elsewhere')):
            with self.subTest(key=key),tempfile.TemporaryDirectory() as tmp:
                directory=Path(tmp);report,_=self.fixture(directory);report[key]=value
                raw=p.canonical(report);(directory/'preparation.json').write_bytes(raw)
                with self.assertRaises(ValueError):privileged.verify_preparation(directory,p.sha(raw))

    def test_concrete_approval_packet_is_strings_only_and_fixture_limited(self):
        with tempfile.TemporaryDirectory(prefix='synthetic approval ') as tmp,patch.object(privileged.subprocess,'run') as execute:
            directory=Path(tmp);report,identity=self.fixture(directory);packet=p.approval_packet(report,identity,directory)
            command=shlex.split(packet['privilegedCommand'])
            self.assertEqual(command[0],'sudo');self.assertEqual(command[-1],identity)
            self.assertEqual(command[command.index('--preparation')+1],str(directory))
            self.assertEqual(packet['status'],'NOT_AUTHORIZED_NOT_EXECUTED')
            self.assertEqual(packet['rawArtifacts'],p.REVIEWED_ARTIFACTS)
            self.assertEqual(packet['remote'],p.REVIEWED_EXPECTATION)
            self.assertFalse(packet['changesExistingSecuritySettings']);self.assertFalse(packet['productionQualified'])
            self.assertEqual(packet['newRootDirectories'],['/opt/agi-fleet-alpha','/opt/agi-fleet-alpha/linux-x64','/opt/agi-fleet-alpha/linux-arm64'])
            self.assertNotIn('sudo',shlex.split(packet['subsequentNonrootCommand']))
            execute.assert_not_called()


class PrivilegeBoundaryTests(unittest.TestCase):
    def test_prepare_refuses_root_before_remote_or_writes(self):
        with patch.object(p.os,'geteuid',return_value=0),patch.object(p,'verify_remote') as remote:
            with self.assertRaises(ValueError):p.prepare(Path('/missing'),Path('/absent'),Path('/node'),EXPECT,{},'linux-x64')
            remote.assert_not_called()

    def test_privileged_wrapper_refuses_nonroot_before_inputs_or_writes(self):
        with patch.object(privileged.os,'geteuid',return_value=1000),patch.object(privileged,'verify_preparation') as verify,patch.object(privileged.os,'mkdir') as mkdir:
            with self.assertRaises(ValueError):privileged.provision(Path('/not-read'),HASH)
            verify.assert_not_called();mkdir.assert_not_called()

    def test_nonhosted_guard_refuses_without_privileged_operations(self):
        with patch.object(privileged.os,'geteuid',return_value=0),patch.dict(os.environ,{},clear=True),patch.object(privileged,'verify_preparation') as verify,patch.object(privileged.os,'mkdir') as mkdir:
            with self.assertRaises(ValueError):privileged.provision(Path('/not-read'),HASH)
            verify.assert_not_called();mkdir.assert_not_called()

    def test_preparation_digest_fails_before_any_execution(self):
        with tempfile.TemporaryDirectory() as tmp,patch.object(privileged.subprocess,'run') as execute:
            directory=Path(tmp);(directory/'preparation.json').write_text(SYNTHETIC)
            with self.assertRaises(ValueError):privileged.verify_preparation(directory,HASH)
            execute.assert_not_called()

    def test_existing_fixed_destination_is_never_changed(self):
        env={'GITHUB_ACTIONS':'true','RUNNER_ENVIRONMENT':'github-hosted','GITHUB_REPOSITORY':p.REPOSITORY}
        with patch.object(privileged.os,'geteuid',return_value=0),patch.dict(os.environ,env,clear=True),patch.object(privileged,'verify_preparation',return_value={}),patch.object(privileged,'root_parent'),patch.object(privileged.os.path,'lexists',return_value=True),patch.object(privileged.os,'mkdir') as mkdir,patch.object(privileged.subprocess,'run') as execute:
            with self.assertRaises(ValueError):privileged.provision(Path('/synthetic-not-read'),HASH)
            mkdir.assert_not_called();execute.assert_not_called()

    def test_no_workflow_hook_or_production_lock_change(self):
        self.assertEqual(p.load((ROOT/p.LOCK).read_bytes())['targets'],dict.fromkeys(p.TARGETS))
        for workflow in (ROOT/'.github/workflows').glob('*'):
            self.assertNotIn('provision/privileged.py',workflow.read_text())
            self.assertNotIn('provision/run.py',workflow.read_text())
        source=(p.HERE/'actual.mjs').read_text()
        self.assertIn('new LocalRuntime(state,{create:',source)
        self.assertIn('runtime.backend instanceof LinuxSandbox',source)
        self.assertNotIn('backend:',source)
        self.assertIn('staticExpectedFullTreeAdapterChecks:17',source)
        self.assertIn('staticExpectedSandboxProbes:8',source)
        self.assertIn('countsMeasured:false',source)


if __name__=='__main__':unittest.main()
