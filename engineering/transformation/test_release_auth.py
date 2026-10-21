"""Inert API-predicate fixtures; never scanner, native or publication evidence."""
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock

SPEC = importlib.util.spec_from_file_location('ti_release_auth_fixture', Path(__file__).with_name('release.py'))
R = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(R)
S, H, T = 'a' * 40, 'b' * 40, 'c' * 40


class InertAPI:
    def __init__(self, mapping):
        self.mapping = mapping
        self.calls = []

    def __call__(self, path, **kwargs):
        self.calls.append((path, kwargs))
        if kwargs:
            raise AssertionError('No effects are permitted in the API-predicate fixture')
        return copy.deepcopy(self.mapping[path])


def run_fixture():
    run = {'id': 12, 'run_attempt': 2, 'repository': {'full_name': R.REPOSITORY},
           'head_repository': {'full_name': R.REPOSITORY}, 'head_sha': S, 'head_branch': 'main',
           'path': '.github/workflows/repository-checks.yml', 'event': 'push', 'workflow_id': 34,
           'status': 'completed', 'conclusion': 'success', 'created_at': '2026-10-19T00:00:00Z'}
    job = {'id': 56, 'run_id': 12, 'run_attempt': 2, 'head_sha': S, 'name': 'repository',
           'status': 'completed', 'conclusion': 'success', 'steps': [{'name': 'inert required check', 'status': 'completed', 'conclusion': 'success'}],
           'check_run_url': 'https://api.github.com/repos/' + R.REPOSITORY + '/check-runs/56'}
    check = {'id': 56, 'head_sha': S, 'name': 'repository', 'status': 'completed', 'conclusion': 'success',
             'app': {'id': 15368, 'slug': 'github-actions', 'owner': {'login': 'github'}}}
    return InertAPI({'/actions/runs/12': run, '/actions/runs/12/attempts/2': run,
        '/actions/workflows/34': {'path': run['path']},
        '/actions/workflows/34/runs?head_sha=' + S + '&branch=main&per_page=100&page=1': {'workflow_runs': [run]},
        '/actions/runs/12/attempts/2/jobs?per_page=100&page=1': {'jobs': [job]}, '/check-runs/56': check})


def review_fixture():
    association = {'id': 1144995, 'slug': 'chatgpt-codex-connector', 'owner': {'id': 14957082}}
    prefix = 'https://api.github.com/repos/' + R.REPOSITORY
    summary = {'id': 2, 'issue_url': prefix + '/issues/61', 'user': R.BOT,
               'performed_via_github_app': association, 'updated_at': '2026-10-19T00:00:00Z',
               'body': '<!-- codex-review-state:v1 ' + json.dumps({'code_review': {'commit_sha': H,
                    'status': 'completed', 'has_any_findings': False, 'has_unresolved_findings': False},
                    'security_review': {'commit_sha': None, 'status': None}}) + ' -->'}
    receipt = {'id': 3, 'issue_url': prefix + '/issues/61', 'user': R.BOT,
               'performed_via_github_app': association,
               'body': '<!-- codex-review-receipt:v1 -->\n**Reviewed commit:** `' + H[:10] + '`'}
    owner = {'id': 4, 'commit_id': H, 'state': 'COMMENTED', 'author_association': 'OWNER',
             'user': {'id': 123, 'login': 'MontrealAI'}, 'submitted_at': '2026-10-19T00:00:00Z',
             'body': 'INERT API PREDICATE FIXTURE ONLY. Reviewer role: isolated test. Owner authorization: inert fixture. Findings: none. Disposition: SCOPED_SOURCE_CLEAR.'}
    pull = {'merged': True, 'merge_commit_sha': S, 'base': {'ref': 'main', 'repo': {'full_name': R.REPOSITORY}},
            'head': {'sha': H, 'repo': {'full_name': R.REPOSITORY}}}
    mapping = {'/pulls/61': pull, '/issues/61/comments?per_page=100&page=1': [summary],
               '/issues/comments/2': summary, '/issues/comments/3': receipt,
               '/git/commits/' + S: {'sha': S, 'tree': {'sha': T}, 'parents': [{'sha': 'd' * 40}, {'sha': H}]},
               '/git/commits/' + H: {'sha': H, 'tree': {'sha': T}, 'parents': [{'sha': 'e' * 40}]},
               '/pulls/61/reviews?per_page=100&page=1': [owner], '/pulls/61/reviews/4': owner}
    return InertAPI(mapping), {'pull': 61, 'summary': 2, 'receipt': 3, 'ownerReview': 4}


class ProducerAuthentication(unittest.TestCase):
    def test_exact_original_attempt_and_check_application(self):
        result = R.authenticate_run(run_fixture(), '12:2', 'repository', S)
        self.assertEqual(result['jobs'][0]['authenticatedCheck']['id'], 56)

    def test_stale_failed_wrong_source_and_substitute_application_refuse(self):
        for change in ('stale-attempt', 'wrong-workflow', 'wrong-source', 'failed', 'skipped-step', 'missing-steps', 'empty-steps', 'post-only-steps', 'other-app', 'wrong-check-source', 'newer-run'):
            with self.subTest(change=change):
                api = run_fixture()
                if change == 'stale-attempt': api.mapping['/actions/runs/12']['run_attempt'] = 3
                if change == 'wrong-workflow': api.mapping['/actions/runs/12']['path'] = '.github/workflows/unrelated.yml'
                if change == 'wrong-source': api.mapping['/actions/runs/12']['head_sha'] = H
                if change == 'failed': api.mapping['/actions/runs/12']['conclusion'] = 'failure'
                if change == 'skipped-step': api.mapping['/actions/runs/12/attempts/2/jobs?per_page=100&page=1']['jobs'][0]['steps'][0]['conclusion'] = 'skipped'
                if change == 'missing-steps': api.mapping['/actions/runs/12/attempts/2/jobs?per_page=100&page=1']['jobs'][0].pop('steps')
                if change == 'empty-steps': api.mapping['/actions/runs/12/attempts/2/jobs?per_page=100&page=1']['jobs'][0]['steps'] = []
                if change == 'post-only-steps': api.mapping['/actions/runs/12/attempts/2/jobs?per_page=100&page=1']['jobs'][0]['steps'][0]['name'] = 'Post checkout'
                if change == 'other-app': api.mapping['/check-runs/56']['app']['id'] = 99
                if change == 'wrong-check-source': api.mapping['/check-runs/56']['head_sha'] = H
                if change == 'newer-run':
                    key = '/actions/workflows/34/runs?head_sha=' + S + '&branch=main&per_page=100&page=1'
                    api.mapping[key]['workflow_runs'].append({**api.mapping['/actions/runs/12'], 'id': 13, 'created_at': '2026-10-19T00:01:00Z', 'conclusion': 'failure'})
                with self.assertRaises(ValueError): R.authenticate_run(api, '12:2', 'repository', S)

    def test_missing_source_proof_has_no_api_or_publication_effect(self):
        api = InertAPI({})
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / 'not-created'
            with self.assertRaises(ValueError): R.audit(api, None, None, output)
            self.assertFalse(output.exists())
            self.assertEqual(api.calls, [])

    def test_original_successful_collector_is_historical_not_relabelled(self):
        api = run_fixture()
        original = copy.deepcopy(api.mapping['/actions/runs/12/attempts/2'])
        original.update(path='.github/workflows/transformation-release.yml', event='workflow_dispatch')
        api.mapping['/actions/runs/12/attempts/2'] = original
        api.mapping['/actions/runs/12'] = {**original, 'run_attempt': 3, 'status': 'in_progress', 'conclusion': None}
        api.mapping['/actions/workflows/34'] = {'path': original['path']}
        jobs = []
        for number, name in enumerate(('audit', 'publish'), 56):
            job = copy.deepcopy(api.mapping['/actions/runs/12/attempts/2/jobs?per_page=100&page=1']['jobs'][0])
            job.update(id=number, name=name, check_run_url='https://api.github.com/repos/' + R.REPOSITORY + '/check-runs/' + str(number))
            jobs.append(job)
            api.mapping['/check-runs/' + str(number)] = {**copy.deepcopy(api.mapping['/check-runs/56']), 'id': number, 'name': name}
        api.mapping['/actions/runs/12/attempts/2/jobs?per_page=100&page=1'] = {'jobs': jobs}
        result = R.authenticate_run(api, '12:2', 'publication', S, historical_collector=True)
        self.assertEqual(result['attempt']['run_attempt'], 2)
        self.assertEqual(result['run']['run_attempt'], 3)
        self.assertFalse(any('/runs?head_sha=' in path for path, _ in api.calls))
        for change in ('wrong-source', 'failed-attempt', 'nonmanual-attempt', 'missing-publish'):
            with self.subTest(change=change):
                bad = InertAPI(copy.deepcopy(api.mapping))
                if change == 'wrong-source': bad.mapping['/actions/runs/12/attempts/2']['head_sha'] = H
                if change == 'failed-attempt': bad.mapping['/actions/runs/12/attempts/2']['conclusion'] = 'failure'
                if change == 'nonmanual-attempt': bad.mapping['/actions/runs/12/attempts/2']['event'] = 'push'
                if change == 'missing-publish': bad.mapping['/actions/runs/12/attempts/2/jobs?per_page=100&page=1']['jobs'].pop()
                with self.assertRaises(ValueError): R.authenticate_run(bad, '12:2', 'publication', S, historical_collector=True)

    def test_missing_main_metadata_refuses_without_effects(self):
        api = InertAPI({'/git/ref/heads/main': None})
        with self.assertRaises(ValueError): R.current_main(api, S)

    def test_missing_collector_context_refuses_before_api_or_output(self):
        for missing in ('GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT'):
            with self.subTest(missing=missing), tempfile.TemporaryDirectory() as temporary:
                api = InertAPI({})
                output = Path(temporary) / 'not-created'
                context = {'GITHUB_REPOSITORY': R.REPOSITORY, 'GITHUB_REF': 'refs/heads/main',
                           'GITHUB_EVENT_NAME': 'workflow_dispatch', 'GITHUB_SHA': S,
                           'GITHUB_RUN_ID': '12', 'GITHUB_RUN_ATTEMPT': '2'}
                context.pop(missing)
                with mock.patch.dict(R.os.environ, context, clear=True):
                    with self.assertRaises(ValueError): R.audit(api, S, {**dict.fromkeys(R.WORKFLOWS, '12:2'), 'review': {}}, output)
                self.assertFalse(output.exists())
                self.assertEqual(api.calls, [])


class ConfiguredReviewAuthentication(unittest.TestCase):
    def test_normal_merge_equal_tree_retains_comment_identity(self):
        api, selectors = review_fixture()
        result = R.authenticate_review(api, selectors, S)
        self.assertEqual(result['ownerReview']['state'], 'COMMENTED')
        self.assertEqual(result['reviewedCommit']['sha'], H)
        self.assertEqual(result['mainCommit']['sha'], S)

    def test_null_unresolved_stale_bot_and_nonmerge_review_refuse(self):
        for change in ('null', 'unresolved', 'other-bot', 'different-tree', 'unmerged', 'not-parent', 'blocked-owner', 'unauthorized-comment', 'outstanding-change-request'):
            with self.subTest(change=change):
                api, selectors = review_fixture()
                if change in ('null', 'unresolved'):
                    summary = api.mapping['/issues/comments/2']
                    value = {'commit_sha': H, 'status': 'completed', 'has_any_findings': False, 'has_unresolved_findings': None if change == 'null' else True}
                    summary['body'] = '<!-- codex-review-state:v1 ' + json.dumps({'code_review': value}) + ' -->'
                if change == 'other-bot': api.mapping['/issues/comments/3']['performed_via_github_app']['id'] = 99
                if change == 'different-tree': api.mapping['/git/commits/' + H]['tree']['sha'] = 'f' * 40
                if change == 'unmerged': api.mapping['/pulls/61']['merged'] = False
                if change == 'not-parent': api.mapping['/git/commits/' + S]['parents'][1]['sha'] = 'f' * 40
                if change == 'blocked-owner': api.mapping['/pulls/61/reviews/4']['body'] = 'Reviewer role: fixture. Owner authorization: fixture. Findings: blocking. Disposition: BLOCKED.'
                if change == 'unauthorized-comment': api.mapping['/pulls/61/reviews/4']['user']['login'] = 'inert-non-owner'
                if change == 'outstanding-change-request':
                    api.mapping['/pulls/61/reviews?per_page=100&page=1'].append({'id': 5, 'state': 'CHANGES_REQUESTED', 'user': {'id': 456}, 'submitted_at': '2026-10-19T00:01:00Z'})
                with self.assertRaises(ValueError): R.authenticate_review(api, selectors, S)

    def test_historical_success_cannot_replace_latest_review(self):
        api, selectors = review_fixture()
        fresh = {**api.mapping['/issues/comments/2'], 'id': 8, 'updated_at': '2026-10-19T00:01:00Z'}
        api.mapping['/issues/61/comments?per_page=100&page=1'].append(fresh)
        with self.assertRaises(ValueError): R.authenticate_review(api, selectors, S)


class PrerequisiteLeaseAuthentication(unittest.TestCase):
    def test_refresh_ignores_only_download_counters_and_preserves_original_records(self):
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary)
            producers = {kind: {'fixture': 'inert original producer', 'kind': kind} for kind in R.WORKFLOWS}
            review = {'fixture': 'inert original review'}
            previous = {}
            mapping = {'/git/ref/heads/main': {'ref': 'refs/heads/main', 'object': {'type': 'commit', 'sha': S}}}
            for number, key in enumerate(('linux', 'local'), 1):
                release = {'id': number, 'draft': False, 'prerelease': True, 'body': 'Inert unchanged prerequisite notes.'}
                asset = {'id': number * 10, 'name': key + '-inert.zip', 'size': 123,
                         'digest': 'sha256:' + 'a' * 64, 'state': 'uploaded', 'download_count': 3,
                         'uploader': {'id': 41898282, 'login': 'github-actions[bot]'}}
                previous[key] = {'release': release, 'assets': [copy.deepcopy(asset)]}
                mapping['/releases/' + str(number)] = release
                mapping[f'/releases/{number}/assets?per_page=100&page=1'] = [{**asset, 'download_count': 47}]
            manifest = {'producers': producers, 'review': review, 'prerequisites': previous}
            (output / ('Local-TI-Manifest-' + R.VERSION + '.json')).write_bytes(R.encoded(manifest))
            original = copy.deepcopy(manifest)
            plan = {'source': S, 'selectors': {**dict.fromkeys(R.WORKFLOWS, '12:2'), 'review': {}}, '_output': str(output)}
            api = InertAPI(mapping)
            with mock.patch.object(R, 'authenticate_run', side_effect=lambda api, selector, kind, source: producers[kind]), \
                    mock.patch.object(R, 'authenticate_review', return_value=review), mock.patch.object(R, 'tag_commit', return_value=S):
                R.refresh_proof(api, plan)
                for field, altered in (('id', 11), ('digest', 'sha256:' + 'b' * 64), ('size', 124),
                                       ('state', 'new'), ('uploader', {'login': 'other-inert-user'})):
                    with self.subTest(field=field):
                        bad = InertAPI(copy.deepcopy(mapping))
                        bad.mapping['/releases/1/assets?per_page=100&page=1'][0][field] = altered
                        with self.assertRaises(ValueError): R.refresh_proof(bad, plan)
            self.assertEqual(manifest, original, 'Historical metadata must remain unchanged')
            self.assertEqual(R.load(output / ('Local-TI-Manifest-' + R.VERSION + '.json')), original)


if __name__ == '__main__':
    unittest.main()
