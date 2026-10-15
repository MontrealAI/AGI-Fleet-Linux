"""Synthetic proof-shape regressions. No generated fixture is release evidence."""
import hashlib
import json
from pathlib import Path
import stat
import sys
import tempfile
import unittest
import zipfile

ENGINEERING = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ENGINEERING))
import saved_profile_audit as auditor
from next_release_tools import provenance, verify_candidate


def encode(value):
    return (json.dumps(value, indent=2) + '\n').encode()


def save(path, value):
    path.write_bytes(encode(value))


class SavedProfileAudit(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(); self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.evidence = self.root / 'synthetic-proof'; self.evidence.mkdir()
        self.nested = self.evidence / 'profile-integration'; self.nested.mkdir()
        self.commit, self.run = 'a' * 40, '12345'
        self.profile = auditor.PROFILE
        self.definition = auditor.CONTRACT_PROFILES[self.profile]
        self.candidate = json.loads((ENGINEERING / 'next-release.json').read_text())
        bundle = ENGINEERING.parent / 'fleet/shared/runtime/contract-profiles'
        content = {file.relative_to(ENGINEERING.parent / 'fleet').as_posix(): file.read_bytes()
                   for file in bundle.rglob('*') if file.is_file()}
        content['docs/synthetic.md'] = b'SYNTHETIC UNIT FIXTURE ONLY\n'
        content['node_modules/synthetic/index.js'] = b'// SYNTHETIC UNIT FIXTURE ONLY\n'
        roles = {name: {'package': 'AGI_' + name.title()}
                 for name in ['agent', 'node', 'moderator', 'employer', 'evidence', 'recovery']}
        content['config/role-registry.json'] = encode({'roles': roles})
        content['config/companion-releases.json'] = encode({'fleet': self.candidate['version']})
        content['package.json'] = encode({'version': self.candidate['version']})
        for role in roles.values():
            prefix = 'packages/' + role['package'] + '/'
            empty = {'files': [], 'revisionSHA256': auditor.digest(b'[]')}
            content[prefix + 'source-inventory.json'] = encode(empty)
            content[prefix + 'MANIFEST.sha256'] = (auditor.digest(encode(empty)) + '  source-inventory.json\n').encode()
        rows = [{'path': name, 'sha256': auditor.digest(value), 'executable': False}
                for name, value in sorted(content.items()) if name.startswith('shared/runtime/')]
        revision = auditor.digest(json.dumps(rows, sort_keys=True, separators=(',', ':')).encode())
        content['source-inventory.json'] = encode({'files': rows, 'revisionSHA256': revision})
        content['release-manifest.json'] = encode({'sourceRevisionSHA256': revision,
                                                  'release': {'fleet': self.candidate['version']}})
        content['MANIFEST.sha256'] = ''.join(auditor.digest(value) + '  ' + name + '\n'
                                            for name, value in sorted(content.items())).encode()
        self.archive = self.root / self.candidate['name']
        with zipfile.ZipFile(self.archive, 'w') as saved:
            for name, value in content.items():
                entry = zipfile.ZipInfo(self.candidate['prefix'] + '/' + name)
                entry.external_attr = (stat.S_IFREG | 0o644) << 16
                saved.writestr(entry, value)
        self.candidate.update(sourceRevisionSHA256=revision, sourceFiles=len(rows),
                              sha256=auditor.sha(self.archive), bytes=self.archive.stat().st_size)
        receipt = verify_candidate(self.archive, self.candidate)
        members = {name: {'sha256': auditor.digest(value), 'bytes': len(value), 'executable': False}
                   for name, value in content.items()}
        save(self.evidence / 'archive-members.json', members)
        binding = provenance(self.candidate); save(self.evidence / 'candidate-binding.json', binding)
        source = {'files': len(rows), 'revisionSHA256': revision}
        build = json.loads((bundle / self.profile / 'BUILD_RECEIPT.json').read_text())
        manager = {'commit': self.definition['commit'],
                   'lockfileSHA256': build['files']['package-lock.json']['sha256'],
                   'hardhatLockfileSHA256': build['files']['hardhat/package-lock.json']['sha256']}
        manifest = json.loads((bundle / (self.profile + '.json')).read_text())
        compatibility = {'status': 'PASS', 'bundledSourceCommit': self.definition['commit'],
                         'contractProfile': self.profile, 'contractProfileSHA256': self.definition['manifestSHA256'],
                         'productionSources': [{'path': name.removeprefix('project/'), 'sha256': digest}
                                               for name, digest in sorted(manifest['productionSources'].items())],
                         'artifacts': []}
        for name in auditor.baseline.ARTIFACTS:
            artifact = json.loads((bundle / self.profile / 'artifacts' / (name + '.json')).read_text())
            compatibility['artifacts'].append({'name': name,
                'abiSHA256': auditor.digest(json.dumps(artifact['abi'], sort_keys=True, separators=(',', ':')).encode()),
                'bytecodeSHA256': auditor.digest(artifact['bytecode'].encode()),
                'deployedBytecodeSHA256': auditor.digest(artifact['deployedBytecode'].encode()), 'immutableOffsetsMatch': True})
        lifecycle = json.loads((ENGINEERING / 'tests/fixtures/job-evidence-fixture.json').read_text())['currentManagerLifecycle']
        lifecycle.update(contractProfile=self.profile, contractProfileSHA256=self.definition['manifestSHA256'])
        save(self.nested / 'profile-lifecycle.json', lifecycle)
        counts = {'collectedTests': 792, 'executedTests': 792, 'passedTests': 792}
        steps = []
        for name in auditor.STEPS:
            text = 'SYNTHETIC UNIT FIXTURE ONLY; NOT A REAL RUN\n'
            if name in ('legacy-artifact-reproduction', 'profile-artifact-reproduction'):
                selected = 'manager-legacy-db876a8' if name.startswith('legacy') else self.profile
                text += ''.join('MATCH ' + item + '\n' for item in auditor.baseline.ARTIFACTS)
                text += 'All 11 artifacts reproduced exactly\nVerified contract profile ' + selected + ' ' + auditor.CONTRACT_PROFILES[selected]['manifestSHA256'] + '\n'
            if name == 'manager-regression': text += json.dumps(counts, separators=(',', ':')) + '\n'
            file = self.nested / (name + '.log'); file.write_text(text)
            steps.append({'name': name, 'exitCode': 0, 'log': file.name, 'logSHA256': auditor.sha(file)})
        self.child = {'schema': 'agi-fleet-contract-profile-source-validation/v1', 'status': 'PASS',
            'classification': auditor.CLASSIFICATION, 'productionQualified': False, 'savedArchiveBinding': binding,
            'source': source, 'profile': self.profile, 'profileManifestSHA256': self.definition['manifestSHA256'],
            'managerCommit': manager['commit'], 'managerLockfileSHA256': manager['lockfileSHA256'],
            'managerHardhatLockfileSHA256': manager['hardhatLockfileSHA256'], 'node': '24.21.0', 'nodeBinarySHA256': 'b' * 64,
            'limitations': {'chainId': 31337, 'mockUSDCOnly': True, 'deterministicFixtureWallets': True,
                'liveInference': False, 'publicIPFS': False, 'publicChainDeployment': False, 'independentOperators': False,
                'physicalInstallation': False, 'savedArchiveQualification': False, 'savedArchiveBytesExercised': True},
            'steps': steps, 'managerRegression': counts, 'contractCompatibility': compatibility, 'lifecycle': lifecycle}
        self.report = {'schema': 'agi-fleet-saved-profile-integration/v1', 'status': 'PASS',
            'classification': auditor.CLASSIFICATION, 'productionQualified': False, 'completeArchiveUnchanged': True,
            'workflowCommit': self.commit, 'workflowRun': self.run, 'workflowRunAttempt': '1',
            'profile': self.profile, 'profileManifestSHA256': self.definition['manifestSHA256'], 'manager': manager,
            'candidateBinding': binding, 'archiveVerification': receipt,
            'runtime': {'node': '24.21.0', 'architecture': 'x64', 'platform': 'linux', 'nodeArchiveSHA256': auditor.baseline.NODE_SHA['x64']},
            'nodeBinarySHA256': 'b' * 64, 'limitations': {'localChainId': 31337, 'mockUSDCOnly': True,
                'physicalInstallation': False, 'publicChainDeployment': False, 'independentOperators': False},
            'before': source, 'after': source, 'archiveMembersSHA256': auditor.sha(self.evidence / 'archive-members.json'),
            'completeArchiveBefore': {'files': len(members), 'membersSHA256': auditor.digest(json.dumps(members, sort_keys=True, separators=(',', ':')).encode())},
            'completeArchiveAfter': {'files': len(members), 'membersSHA256': auditor.digest(json.dumps(members, sort_keys=True, separators=(',', ':')).encode())},
            'completeArchiveFiles': len(members), 'integrationSteps': 12, 'managerRegression': counts,
            'lifecycle': lifecycle, 'lifecycleReportSHA256': auditor.sha(self.nested / 'profile-lifecycle.json')}
        self.persist()

    def persist(self):
        save(self.nested / 'summary.json', self.child)
        self.report['integrationSummarySHA256'] = auditor.sha(self.nested / 'summary.json')
        self.report['steps'] = [{**step, 'log': 'profile-integration/' + step['log']} for step in self.child['steps']]
        save(self.evidence / 'summary.json', self.report)

    def audit(self):
        return auditor.audit_saved_profile(self.evidence, self.archive, self.candidate, self.commit, self.run)

    def test_complete_synthetic_proof_audits_both_native_architectures(self):
        for architecture in ('x64', 'arm64'):
            self.report['runtime'].update(architecture=architecture, nodeArchiveSHA256=auditor.baseline.NODE_SHA[architecture])
            self.persist()
            result = self.audit()
            self.assertEqual(result['architecture'], architecture)
            self.assertEqual(result['verifiedLogs'], 12)
            self.assertEqual(result['managerTestsPassed'], 792)
            self.assertFalse(result['productionQualified'])

    def test_wrong_archive_and_workflow_binding_fail(self):
        for commit, run in [('c' * 40, self.run), (self.commit, '999')]:
            with self.assertRaisesRegex(ValueError, 'workflow identity'):
                auditor.audit_saved_profile(self.evidence, self.archive, self.candidate, commit, run)
        with self.archive.open('ab') as output: output.write(b'changed')
        with self.assertRaisesRegex(ValueError, 'archive binding'):
            self.audit()

    def test_missing_added_and_linked_logs_fail(self):
        file = self.nested / 'extra.log'; file.write_text('added')
        with self.assertRaisesRegex(ValueError, 'coverage differs'): self.audit()
        file.unlink()
        file = self.nested / (auditor.STEPS[0] + '.log'); value = file.read_bytes(); file.unlink()
        with self.assertRaisesRegex(ValueError, 'coverage differs'): self.audit()
        target = self.root / 'log'; target.write_bytes(value); file.symlink_to(target)
        with self.assertRaisesRegex(ValueError, 'link or special'): self.audit()

    def test_failed_missing_and_duplicate_step_claims_fail(self):
        self.child['steps'][0]['exitCode'] = 1; self.persist()
        with self.assertRaisesRegex(ValueError, 'step failed'): self.audit()
        self.child['steps'][0]['exitCode'] = 0
        self.child['steps'][0]['name'] = self.child['steps'][1]['name']; self.persist()
        with self.assertRaisesRegex(ValueError, 'step coverage'): self.audit()
        self.child['steps'].pop(); self.persist()
        with self.assertRaisesRegex(ValueError, 'step coverage'): self.audit()

    def test_changed_and_rehashed_incomplete_artifact_log_fail(self):
        file = self.nested / (auditor.STEPS[0] + '.log'); file.write_text('MATCH AGIJobManager\n')
        with self.assertRaisesRegex(ValueError, 'log hash'): self.audit()
        self.child['steps'][0]['logSHA256'] = auditor.sha(file); self.persist()
        with self.assertRaisesRegex(ValueError, 'reproduction is incomplete'): self.audit()

    def test_rehashed_wrong_or_ambiguous_manager_count_fails(self):
        file = self.nested / 'manager-regression.log'
        file.write_text('{"collectedTests":780,"executedTests":780,"passedTests":780}\n')
        self.child['steps'][-1]['logSHA256'] = auditor.sha(file); self.persist()
        with self.assertRaisesRegex(ValueError, 'regression counts'): self.audit()
        file.write_text((json.dumps(self.child['managerRegression'], separators=(',', ':')) + '\n') * 2)
        self.child['steps'][-1]['logSHA256'] = auditor.sha(file); self.persist()
        with self.assertRaisesRegex(ValueError, 'regression counts'): self.audit()

    def test_rehashed_member_map_cannot_omit_non_source_members(self):
        file = self.evidence / 'archive-members.json'; members = json.loads(file.read_text())
        members.pop('docs/synthetic.md'); save(file, members)
        self.report['archiveMembersSHA256'] = auditor.sha(file)
        self.report['completeArchiveFiles'] = len(members); self.persist()
        with self.assertRaisesRegex(ValueError, 'member map differs'): self.audit()

    def test_rehashed_source_profile_and_library_substitution_fail(self):
        self.child['contractCompatibility']['artifacts'][5]['deployedBytecodeSHA256'] = 'd' * 64; self.persist()
        with self.assertRaisesRegex(ValueError, 'source/artifact comparison'): self.audit()
        self.child['profile'] = 'manager-legacy-db876a8'; self.persist()
        with self.assertRaisesRegex(ValueError, 'Nested profile identities'): self.audit()
        self.report['profile'] = 'manager-legacy-db876a8'; self.persist()
        with self.assertRaisesRegex(ValueError, 'Selected profile identity'): self.audit()

    def test_rehashed_before_after_and_candidate_binding_fail(self):
        self.report['after'] = {**self.report['after'], 'revisionSHA256': 'e' * 64}; self.persist()
        with self.assertRaisesRegex(ValueError, 'before/after'): self.audit()
        save(self.evidence / 'candidate-binding.json', {})
        with self.assertRaisesRegex(ValueError, 'candidate evidence binding'): self.audit()

    def test_full_archive_after_digest_cannot_be_replaced_by_source_identity(self):
        self.report['completeArchiveAfter'] = self.report['after']; self.persist()
        with self.assertRaisesRegex(ValueError, 'Complete archive before/after'): self.audit()

    def test_nested_summary_must_have_its_exact_recorded_hash(self):
        self.child['status'] = 'FAIL'; save(self.nested / 'summary.json', self.child)
        with self.assertRaisesRegex(ValueError, 'Nested profile summary'): self.audit()

    def test_rehashed_lifecycle_scope_or_accounting_change_fails(self):
        self.child['lifecycle']['managerTokenBalanceAfter'] = '1'
        self.report['lifecycle'] = self.child['lifecycle']
        save(self.nested / 'profile-lifecycle.json', self.child['lifecycle'])
        self.report['lifecycleReportSHA256'] = auditor.sha(self.nested / 'profile-lifecycle.json'); self.persist()
        with self.assertRaisesRegex(ValueError, 'lifecycle accounting'): self.audit()

    def test_runtime_architecture_and_profile_lock_identity_fail(self):
        self.report['runtime']['architecture'] = 'arm64'; self.persist()
        with self.assertRaisesRegex(ValueError, 'native runtime'): self.audit()
        self.report['runtime']['architecture'] = 'x64'
        self.report['manager']['lockfileSHA256'] = '0' * 64; self.persist()
        with self.assertRaisesRegex(ValueError, 'Manager lock binding'): self.audit()


if __name__ == '__main__':
    unittest.main()
