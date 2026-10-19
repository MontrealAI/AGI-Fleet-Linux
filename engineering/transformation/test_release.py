"""Inert publication-boundary fixtures: no network, native work or real release.

The transport fixtures stand for an already audited plan. They deliberately do
not claim producer authentication, installation or operational qualification.
"""
import copy
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import stat
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import urllib.error
import urllib.parse
import zipfile


SPEC = importlib.util.spec_from_file_location(
    'fleet_ti_release_under_test', Path(__file__).with_name('release.py'))
release = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(release)

SOURCE = '1' * 40
DRIFT = '2' * 40
TREE = '3' * 40


def zip_bytes(members, *, comment=b'', compression=zipfile.ZIP_STORED):
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, 'w', compression=compression) as saved:
        saved.comment = comment
        for name, raw in members.items():
            info = zipfile.ZipInfo(name, (2026, 1, 1, 0, 0, 0))
            info.create_system = 3
            info.external_attr = (stat.S_IFREG | 0o644) << 16
            info.compress_type = compression
            saved.writestr(info, raw)
    return stream.getvalue()


class FakeAPI:
    """RAM-backed API double; every mutating request remains an in-memory event."""

    def __init__(self):
        self.events = []
        self.main = SOURCE
        self.tag = None
        self.release = None
        self.assets = []
        self.contents = {}
        self.next_asset = 101
        self.alter_asset_metadata = False
        self.alter_download = False
        self.alter_notes = False

    @staticmethod
    def missing(path):
        raise urllib.error.HTTPError(path, 404, 'inert fixture absence', {}, None)

    def ref(self):
        return {'ref': 'refs/tags/' + release.TAG,
                'object': {'type': 'commit', 'sha': self.tag}}

    def existing(self, plan, directory):
        self.tag = SOURCE
        self.release = {'id': 7, 'html_url': 'https://example.invalid/inert-release',
                        'tag_name': release.TAG, 'target_commitish': SOURCE,
                        'name': release.TITLE, 'body': plan['body'],
                        'draft': False, 'prerelease': True}
        for record in plan['assets']:
            self.retain_asset(record['name'], (directory / record['name']).read_bytes())

    def retain_asset(self, name, raw):
        asset_id = self.next_asset
        self.next_asset += 1
        self.contents[asset_id] = raw
        row = {'id': asset_id, 'name': name, 'state': 'uploaded',
               'size': len(raw), 'digest': 'sha256:' + hashlib.sha256(raw).hexdigest()}
        self.assets.append(row)
        return row

    def __call__(self, path, method='GET', data=None, upload=False):
        self.events.append((method, path, copy.deepcopy(data), upload))
        parsed = urllib.parse.urlsplit(path)
        route = parsed.path
        if method == 'GET' and route == '/git/ref/heads/main':
            return {'ref': 'refs/heads/main', 'object': {'type': 'commit', 'sha': self.main}}
        if method == 'GET' and route == '/git/ref/tags/' + release.TAG:
            if self.tag is None:
                self.missing(path)
            return self.ref()
        if method == 'GET' and route == '/releases':
            return [] if self.release is None else [copy.deepcopy(self.release)]
        if method == 'GET' and route == '/releases/latest':
            return {'id': 99, 'tag_name': 'inert-full-release'}
        if method == 'GET' and route == '/releases/7/assets':
            rows = copy.deepcopy(self.assets)
            if self.alter_asset_metadata and rows:
                rows[0]['digest'] = 'sha256:' + '0' * 64
            return rows
        if method == 'GET' and route == '/releases/7':
            value = copy.deepcopy(self.release)
            if self.alter_notes:
                value['body'] += '\nUnreviewed inert edit.\n'
            return value
        if method == 'POST' and route == '/git/refs':
            self.tag = data['sha']
            return self.ref()
        if method == 'POST' and route == '/releases':
            self.release = {'id': 7, 'html_url': 'https://example.invalid/inert-release',
                            **copy.deepcopy(data)}
            return copy.deepcopy(self.release)
        if method == 'POST' and route == '/releases/7/assets' and upload:
            name = urllib.parse.parse_qs(parsed.query)['name'][0]
            return copy.deepcopy(self.retain_asset(name, data))
        if method == 'PATCH' and route == '/releases/7':
            self.release.update(copy.deepcopy(data))
            return copy.deepcopy(self.release)
        raise AssertionError('Unexpected inert API request: ' + method + ' ' + path)

    def download(self, path, output, expected=None, maximum=release.LIMIT):
        self.events.append(('DOWNLOAD', path, copy.deepcopy(expected), False))
        asset_id = int(path.rsplit('/', 1)[1])
        raw = self.contents[asset_id]
        if self.alter_download:
            raw += b'\nInert changed download.\n'
        if len(raw) >= maximum:
            raise ValueError('inert download exceeds bound')
        with Path(output).open('xb') as stream:
            stream.write(raw)
        result = release.identity(output)
        if expected is not None and any(result[key] != expected[key] for key in ('bytes', 'sha256')):
            raise ValueError('inert downloaded bytes differ')
        return result

    def mutations(self):
        return [event for event in self.events if event[0] in ('POST', 'PATCH', 'DELETE', 'PUT')]


class InertReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='fleet-ti-release-inert-', dir='/dev/shm')
        self.root = Path(self.temporary.name)
        self.temp_patch = patch.object(tempfile, 'tempdir', str(self.root))
        self.temp_patch.start()
        self.addCleanup(self.temporary.cleanup)
        self.addCleanup(self.temp_patch.stop)

    def transport_fixture(self):
        output = self.root / 'prepared'
        output.mkdir()
        archive = output / release.ARCHIVE
        archive.write_bytes(zip_bytes({'INERT.txt': b'No native or install qualification is claimed.\n'}))
        evidence = output / ('Local-TI-Evidence-' + release.VERSION + '.zip')
        evidence.write_bytes(zip_bytes({'INERT.txt': b'Transport ordering fixture only.\n'}))
        manifest = {'schema': release.SCHEMA, 'source': {'commit': SOURCE, 'tree': TREE},
                    'packageMode': 'INERT_TRANSPORT_FIXTURE_ONLY',
                    'producers': {kind: {'run': {'id': index, 'run_attempt': 1}}
                                  for index, kind in enumerate(release.WORKFLOWS, 10)}}
        manifest_file = output / ('Local-TI-Manifest-' + release.VERSION + '.json')
        manifest_file.write_bytes(release.encoded(manifest))
        body_assets = [archive, evidence, manifest_file]
        body = release.notes(manifest, body_assets)
        checksum = output / ('SHA256SUMS-local-ti-' + release.VERSION + '.txt')
        checksum.write_text(''.join(release.digest(file) + '  ' + file.name + '\n' for file in body_assets))
        plan = {'schema': 'agi-fleet/ti-publication-plan/v1', 'source': SOURCE, 'tree': TREE,
                'tag': release.TAG, 'name': release.TITLE, 'body': body,
                'assets': [release.identity(file) for file in [*body_assets, checksum]],
                'manifestSHA256': release.digest(manifest_file), 'selectors': {'fixture': 'inert'}}
        (output / 'publication-plan.json').write_bytes(release.encoded(plan))
        return output, plan

    def package_fixture(self, arch, *, comment=b'', manifest=None, compact_manifest=False):
        folder = self.root / arch
        folder.mkdir()
        if manifest is None:
            manifest = {'fixture': 'inert', 'files': [{'path': 'README.txt', 'mode': 0o644}]}
        raw_manifest = (json.dumps(manifest, separators=(',', ':')).encode() if compact_manifest
                        else release.encoded(manifest))
        raw = zip_bytes({'local-preview-manifest.json': raw_manifest,
                         'README.txt': b'Benign identical source member.\n'}, comment=comment)
        archive = folder / release.ARCHIVE
        archive.write_bytes(raw)
        receipt = folder / 'package-receipt.json'
        receipt.write_bytes(release.encoded({'fixture': 'inert', 'archive': release.identity(archive)}))
        return {'file': archive, 'receiptFile': receipt,
                'package': {'archive': release.identity(archive), 'manifest': copy.deepcopy(manifest),
                            'manifestSHA256': hashlib.sha256(raw_manifest).hexdigest()}}

    def test_packaged_source_is_compared_with_independent_git_bytes(self):
        repository = self.root / 'inert-git'
        repository.mkdir()
        source = repository / 'local-runtime/quiet.mjs'
        source.parent.mkdir()
        source.write_bytes(b'// Inert test source.\nexport const answer = 7;\n')
        def git(*args):
            return subprocess.check_output(['git', '-c', 'user.name=Inert Fixture', '-c',
                'user.email=inert@example.invalid', *args], cwd=repository, stderr=subprocess.PIPE)
        git('init', '--quiet')
        git('add', 'local-runtime/quiet.mjs')
        git('commit', '--quiet', '-m', 'Inert test fixture only')
        commit = git('rev-parse', 'HEAD').decode().strip()
        builder = SimpleNamespace(ROOTS=('local-runtime',), TI_ROOTS=(), TI_FILES=(), EXTRA_FILES=())
        with patch.object(release, 'ROOT', repository):
            expected = release.committed_entries(commit, builder)
        checked = []
        def dependencies(entries):
            checked.append(entries)
            return {'fixture': 'inert reference'}
        entries = {**expected, 'fleet/node_modules/inert/README.txt': (b'Locked inert text.\n', 0o644)}
        self.assertEqual(release.compare_members(entries, expected, dependencies), {'fixture': 'inert reference'})
        self.assertEqual(len(checked), 1)
        entries['local-runtime/quiet.mjs'] = (b'// Benign but different source.\n', 0o644)
        with self.assertRaises(ValueError):
            release.compare_members(entries, expected, dependencies)
        self.assertEqual(len(checked), 1, 'Source mismatch must refuse before dependency blessing')

    def test_extra_member_and_executable_mode_drift_refuse_before_dependency_check(self):
        expected = {'local-runtime/quiet.mjs': (b'export const answer = 7;\n', 0o644)}
        for entries in ({**expected, 'local-runtime/extra.txt': (b'Inert extra.\n', 0o644)},
                        {'local-runtime/quiet.mjs': (expected['local-runtime/quiet.mjs'][0], 0o755)}):
            with self.subTest(entries=entries), self.assertRaises(ValueError):
                release.compare_members(entries, expected,
                    lambda _: self.fail('An unmatched source must not reach the dependency verifier'))

    def test_identical_qualified_raw_archives_keep_one_untouched_canonical_zip(self):
        packages = {arch: self.package_fixture(arch) for arch in ('x64', 'arm64')}
        output = self.root / 'assets'
        output.mkdir()
        assets, mode = release.package_assets(packages, output)
        self.assertEqual([file.name for file in assets], [release.ARCHIVE])
        self.assertEqual(assets[0].read_bytes(), packages['x64']['file'].read_bytes())
        self.assertEqual(mode, 'IDENTICAL_RAW_ARCHIVES_BOTH_NATIVE_ARCHITECTURES')

    def test_zip_serialization_difference_preserves_each_inner_zip_and_receipt(self):
        packages = {arch: self.package_fixture(arch, comment=arch.encode()) for arch in ('x64', 'arm64')}
        self.assertNotEqual(packages['x64']['file'].read_bytes(), packages['arm64']['file'].read_bytes())
        output = self.root / 'assets'
        output.mkdir()
        assets, mode = release.package_assets(packages, output)
        self.assertEqual(len(assets), 2)
        self.assertEqual(mode, 'DISTINCT_RAW_SERIALIZATION_IDENTICAL_SOURCE_MEMBERS_ARCH_LABELLED_CONTAINERS')
        for arch, outer in zip(('x64', 'arm64'), assets):
            self.assertIn('-' + arch + '.zip', outer.name)
            with zipfile.ZipFile(outer) as saved:
                self.assertEqual(set(saved.namelist()), {release.ARCHIVE, 'package-receipt.json'})
                self.assertEqual(saved.read(release.ARCHIVE), packages[arch]['file'].read_bytes())
                self.assertEqual(saved.read('package-receipt.json'), packages[arch]['receiptFile'].read_bytes())

    def test_different_manifest_members_refuse_before_any_output_asset(self):
        packages = {'x64': self.package_fixture('x64'),
                    'arm64': self.package_fixture('arm64', manifest={'fixture': 'different benign content'})}
        output = self.root / 'assets'
        output.mkdir()
        with self.assertRaises(ValueError):
            release.package_assets(packages, output)
        self.assertEqual(list(output.iterdir()), [])

    def test_equal_manifest_objects_with_different_member_bytes_are_not_zip_only_variation(self):
        packages = {'x64': self.package_fixture('x64'),
                    'arm64': self.package_fixture('arm64', compact_manifest=True)}
        self.assertEqual(packages['x64']['package']['manifest'], packages['arm64']['package']['manifest'])
        self.assertNotEqual(packages['x64']['package']['manifestSHA256'], packages['arm64']['package']['manifestSHA256'])
        output = self.root / 'assets'
        output.mkdir()
        with self.assertRaises(ValueError):
            release.package_assets(packages, output)
        self.assertEqual(list(output.iterdir()), [])

    def test_null_plan_refuses_before_api_requests_or_mutations(self):
        output = self.root / 'null-plan'
        output.mkdir()
        (output / 'publication-plan.json').write_text('null\n')
        api = FakeAPI()
        with self.assertRaises(ValueError):
            release.publish(api, output, lambda _: self.fail('Null plan must not refresh proof'))
        self.assertEqual(api.events, [])

    def test_initial_source_drift_has_no_public_effects(self):
        output, _ = self.transport_fixture()
        api = FakeAPI()
        api.main = DRIFT
        with self.assertRaises(ValueError):
            release.publish(api, output, lambda _: self.fail('Wrong source must stop before refresh'))
        self.assertEqual(api.mutations(), [])

    def test_changed_prepared_asset_has_no_public_effects(self):
        output, _ = self.transport_fixture()
        (output / release.ARCHIVE).write_bytes(b'Benign changed prepared bytes.\n')
        api = FakeAPI()
        with self.assertRaises(ValueError):
            release.publish(api, output, lambda _: self.fail('Changed asset must stop before refresh'))
        self.assertEqual(api.mutations(), [])

    def test_edited_plan_notes_cannot_replace_canonical_source_notes(self):
        output, plan = self.transport_fixture()
        plan['body'] = 'Inert but unreviewed replacement notes.\n'
        (output / 'publication-plan.json').write_bytes(release.encoded(plan))
        api = FakeAPI()
        with self.assertRaises(ValueError):
            release.publish(api, output, lambda _: None)
        self.assertEqual(api.mutations(), [])

    def test_fresh_publication_verifies_tag_and_assets_before_first_release_visibility(self):
        output, plan = self.transport_fixture()
        api = FakeAPI()
        refreshes = []
        result = release.publish(api, output, lambda value: refreshes.append(value['source']))
        self.assertEqual(result['status'], 'PUBLISHED_VERIFIED')
        self.assertEqual(refreshes, [SOURCE, SOURCE])
        events = api.events
        create_tag = next(i for i, row in enumerate(events) if row[:2] == ('POST', '/git/refs'))
        create_draft = next(i for i, row in enumerate(events) if row[:2] == ('POST', '/releases'))
        visibility = next(i for i, row in enumerate(events) if row[:2] == ('PATCH', '/releases/7'))
        tag_reads = [i for i, row in enumerate(events) if row[:2] == ('GET', '/git/ref/tags/' + release.TAG)]
        self.assertTrue(any(create_tag < i < create_draft for i in tag_reads), 'Readable verified tag must precede draft creation')
        self.assertTrue(any(create_draft < i < visibility for i in tag_reads), 'Tag lease must be checked again before visibility')
        self.assertTrue(any(i > visibility for i in tag_reads), 'Public tag must be read back')
        drafts = events[create_draft][2]
        self.assertIs(drafts['draft'], True)
        self.assertEqual(drafts['target_commitish'], SOURCE)
        self.assertEqual(drafts['make_latest'], 'false')
        self.assertEqual(events[visibility][2], {'draft': False, 'prerelease': True,
                                               'make_latest': 'false', 'body': plan['body']})
        expected = {row['name']: row for row in plan['assets']}
        self.assertEqual(set(expected), {row['name'] for row in api.assets})
        for row in api.assets:
            self.assertEqual(row['size'], expected[row['name']]['bytes'])
            self.assertEqual(row['digest'], 'sha256:' + expected[row['name']]['sha256'])
        downloads = [i for i, row in enumerate(events) if row[0] == 'DOWNLOAD']
        self.assertEqual(sum(i < visibility for i in downloads), len(expected))
        self.assertEqual(sum(i > visibility for i in downloads), len(expected))
        self.assertEqual(api.release['body'], plan['body'])
        self.assertIs(api.release['draft'], False)

    def test_source_drift_after_upload_keeps_release_draft(self):
        output, _ = self.transport_fixture()
        api = FakeAPI()
        calls = []
        def refresh(_):
            calls.append(True)
            if len(calls) == 2:
                api.main = DRIFT
        with self.assertRaises(ValueError):
            release.publish(api, output, refresh)
        self.assertIs(api.release['draft'], True)
        self.assertFalse(any(row[0] == 'PATCH' for row in api.events))

    def test_tag_drift_after_upload_keeps_release_draft(self):
        output, _ = self.transport_fixture()
        api = FakeAPI()
        calls = []
        def refresh(_):
            calls.append(True)
            if len(calls) == 2:
                api.tag = DRIFT
        with self.assertRaises(ValueError):
            release.publish(api, output, refresh)
        self.assertIs(api.release['draft'], True)
        self.assertFalse(any(row[0] == 'PATCH' for row in api.events))

    def test_existing_exact_complete_release_is_strictly_read_only(self):
        output, plan = self.transport_fixture()
        api = FakeAPI()
        api.existing(plan, output)
        result = release.publish(api, output, lambda _: None)
        self.assertEqual(result['status'], 'ALREADY_PUBLISHED_EXACT_READ_ONLY')
        self.assertEqual(api.mutations(), [])
        self.assertEqual(len([event for event in api.events if event[0] == 'DOWNLOAD']), len(plan['assets']))

    def test_existing_tag_at_different_source_is_never_moved(self):
        output, plan = self.transport_fixture()
        api = FakeAPI()
        api.existing(plan, output)
        api.tag = DRIFT
        with self.assertRaises(ValueError):
            release.publish(api, output, lambda _: None)
        self.assertEqual(api.tag, DRIFT)
        self.assertEqual(api.mutations(), [])

    def test_existing_release_with_different_asset_is_never_repaired(self):
        output, plan = self.transport_fixture()
        api = FakeAPI()
        api.existing(plan, output)
        api.alter_asset_metadata = True
        with self.assertRaises(ValueError):
            release.publish(api, output, lambda _: None)
        self.assertEqual(api.mutations(), [])

    def test_altered_remote_digest_prevents_visibility_patch(self):
        output, _ = self.transport_fixture()
        api = FakeAPI()
        api.alter_asset_metadata = True
        with self.assertRaises(ValueError):
            release.publish(api, output, lambda _: None)
        self.assertIs(api.release['draft'], True)
        self.assertFalse(any(event[0] == 'PATCH' for event in api.events))

    def test_downloaded_remote_bytes_are_checked_even_if_metadata_matches(self):
        output, _ = self.transport_fixture()
        api = FakeAPI()
        api.alter_download = True
        with self.assertRaises(ValueError):
            release.publish(api, output, lambda _: None)
        self.assertIs(api.release['draft'], True)
        self.assertFalse(any(event[0] == 'PATCH' for event in api.events))

    def test_remote_notes_edit_prevents_visibility_patch(self):
        output, _ = self.transport_fixture()
        api = FakeAPI()
        api.alter_notes = True
        with self.assertRaises(ValueError):
            release.publish(api, output, lambda _: None)
        self.assertIs(api.release['draft'], True)
        self.assertFalse(any(event[0] == 'PATCH' for event in api.events))


class ReadOnlyRetryAPI(FakeAPI):
    """Original collector metadata and immutable assets; never a live API."""

    def __init__(self):
        super().__init__()
        self.collector_source = SOURCE
        self.fresh_draft = False
        self.fresh_full_release = False
        self.preview_is_latest = False
        self.collector = {'id': 401, 'run_attempt': 4, 'head_sha': SOURCE,
                          'head_branch': 'main', 'repository': {'full_name': release.REPOSITORY},
                          'head_repository': {'full_name': release.REPOSITORY},
                          'path': '.github/workflows/transformation-release.yml',
                          'event': 'workflow_dispatch', 'status': 'in_progress',
                          'conclusion': None, 'workflow_id': 88}

    def __call__(self, path, method='GET', data=None, upload=False):
        route = urllib.parse.urlsplit(path).path
        if method != 'GET':
            self.events.append((method, path, copy.deepcopy(data), upload))
            raise AssertionError('Read-only retry attempted an inert mutation')
        if route.startswith('/actions/') or route.startswith('/check-runs/'):
            self.events.append((method, path, copy.deepcopy(data), upload))
            if route == '/actions/runs/401':
                return {**copy.deepcopy(self.collector), 'head_sha': self.collector_source}
            if route == '/actions/runs/401/attempts/1':
                return {**copy.deepcopy(self.collector), 'head_sha': self.collector_source,
                        'run_attempt': 1, 'status': 'completed', 'conclusion': 'success'}
            if route == '/actions/workflows/88':
                return {'id': 88, 'path': self.collector['path']}
            if route == '/actions/runs/401/attempts/1/jobs':
                return {'jobs': [
                    {'id': 500 + index, 'name': name, 'run_id': 401, 'run_attempt': 1,
                     'head_sha': SOURCE, 'status': 'completed', 'conclusion': 'success',
                     'steps': [{'name': 'Inert retained collector step', 'status': 'completed',
                                'conclusion': 'success'}],
                     'check_run_url': 'https://api.github.com/repos/' + release.REPOSITORY
                                      + '/check-runs/' + str(600 + index)}
                    for index, name in enumerate(('audit', 'publish'))]}
            if route in ('/check-runs/600', '/check-runs/601'):
                number = int(route.rsplit('/', 1)[1])
                return {'id': number, 'head_sha': SOURCE,
                        'name': ('audit', 'publish')[number - 600],
                        'status': 'completed', 'conclusion': 'success',
                        'app': {'id': 15368, 'slug': 'github-actions', 'owner': {'login': 'github'}}}
            raise AssertionError('Unexpected collector fixture API: ' + path)
        if route == '/releases/tags/' + release.TAG:
            self.events.append((method, path, None, False))
            return copy.deepcopy(self.release)
        if route == '/releases/7' and (self.fresh_draft or self.fresh_full_release):
            self.events.append((method, path, None, False))
            return {**copy.deepcopy(self.release), 'draft': self.fresh_draft,
                    'prerelease': not self.fresh_full_release}
        if route == '/releases/latest' and self.preview_is_latest:
            self.events.append((method, path, None, False))
            return copy.deepcopy(self.release)
        return super().__call__(path, method=method, data=data, upload=upload)

    def download(self, path, output, expected=None, maximum=release.LIMIT):
        asset_id = int(path.rsplit('/', 1)[1])
        for row in self.assets:
            if row['id'] == asset_id:
                row['download_count'] = row.get('download_count', 0) + 1
        return super().download(path, output, expected=expected, maximum=maximum)


class InertRetryTests(unittest.TestCase):
    """Reverify original bytes using fresh inputs without relabelling the run."""

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='fleet-ti-retry-inert-', dir='/dev/shm')
        self.root = Path(self.temporary.name)
        self.temp_patch = patch.object(tempfile, 'tempdir', str(self.root))
        self.temp_patch.start()
        self.addCleanup(self.temporary.cleanup)
        self.addCleanup(self.temp_patch.stop)

    @staticmethod
    def context(run, attempt):
        return {'repository': release.REPOSITORY, 'commit': SOURCE,
                'workflowRun': str(run), 'workflowAttempt': str(attempt),
                'event': 'workflow_dispatch', 'workflow': '.github/workflows/transformation-release.yml'}

    @staticmethod
    def prerequisite_asset(counter):
        return {'id': 81, 'name': 'Inert-prerequisite.zip', 'size': 123,
                'digest': 'sha256:' + 'a' * 64, 'download_count': counter,
                'state': 'uploaded', 'uploader': {'login': 'github-actions[bot]'}}

    def fixture(self, *, separate=False):
        published = self.root / 'published'
        current_output = self.root / 'current'
        published.mkdir()
        current_output.mkdir()
        mode = ('DISTINCT_RAW_SERIALIZATION_IDENTICAL_SOURCE_MEMBERS_ARCH_LABELLED_CONTAINERS'
                if separate else 'IDENTICAL_RAW_ARCHIVES_BOTH_NATIVE_ARCHITECTURES')
        packages = {}
        receipts = {}
        package_names = []
        for arch in ('x64', 'arm64'):
            inner = zip_bytes({'INERT.txt': b'Qualified-input comparison fixture only.\n'},
                              comment=arch.encode() if separate else b'')
            raw_identity = {'name': release.ARCHIVE, 'bytes': len(inner),
                            'sha256': hashlib.sha256(inner).hexdigest()}
            packages[arch] = {'archive': raw_identity,
                              'manifestSHA256': hashlib.sha256(b'Inert common manifest.').hexdigest()}
            receipts[arch] = release.encoded({'fixture': 'inert', 'architecture': arch,
                                              'archive': raw_identity})
            if separate:
                name = 'Local-TI-Package-' + release.VERSION + '-' + arch + '.zip'
                package_names.append(name)
                members = {release.ARCHIVE: inner, 'package-receipt.json': receipts[arch]}
                (published / name).write_bytes(zip_bytes(members, comment=b'original container'))
                (current_output / name).write_bytes(zip_bytes(members, comment=b'new serialization'))
            elif arch == 'x64':
                package_names.append(release.ARCHIVE)
                (published / release.ARCHIVE).write_bytes(inner)
                (current_output / release.ARCHIVE).write_bytes(inner)
        producers = {kind: {'run': {'id': index, 'run_attempt': 2}}
                     for index, kind in enumerate(release.WORKFLOWS, 100)}
        base = {'schema': release.SCHEMA, 'source': {'commit': SOURCE, 'tree': TREE},
                'packageMode': mode, 'packages': packages, 'producers': producers,
                'architectures': {arch: {'reportInventorySHA256': hashlib.sha256(arch.encode()).hexdigest()}
                                  for arch in ('x64', 'arm64')}}
        manifests = []
        plans = []
        evidence_name = 'Local-TI-Evidence-' + release.VERSION + '.zip'
        for directory, counter, context in ((published, 3, self.context(401, 1)),
                                             (current_output, 47, self.context(902, 3))):
            prerequisite = {'assets': [self.prerequisite_asset(counter)]}
            evidence = {'authenticated-producers.json': release.encoded(producers),
                        'configured-owner-review.json': release.encoded({'fixture': 'inert', 'commit': SOURCE}),
                        'source-review.json': release.encoded({'fixture': 'inert', 'tree': TREE}),
                        'prerequisite-releases.json': release.encoded(prerequisite)}
            for arch in ('x64', 'arm64'):
                evidence[arch + '/package-receipt.json'] = receipts[arch]
                evidence[arch + '/reports/execution-context.json'] = release.encoded(
                    {'fixture': 'inert retained report', 'commit': SOURCE, 'architecture': arch,
                     'qualificationProducer': '100:2'})
            (directory / evidence_name).write_bytes(zip_bytes(evidence, comment=context['workflowRun'].encode()))
            manifest = {**copy.deepcopy(base), 'prerequisites': prerequisite,
                        'publicationAuditContext': context,
                        'evidence': release.identity(directory / evidence_name),
                        'packageAssets': [release.identity(directory / name) for name in package_names]}
            manifest_name = 'Local-TI-Manifest-' + release.VERSION + '.json'
            manifest_file = directory / manifest_name
            manifest_file.write_bytes(release.encoded(manifest))
            ordered = [directory / name for name in [*package_names, evidence_name, manifest_name]]
            checksum = directory / ('SHA256SUMS-local-ti-' + release.VERSION + '.txt')
            checksum.write_text(''.join(release.digest(file) + '  ' + file.name + '\n' for file in ordered))
            plan = {'schema': 'agi-fleet/ti-publication-plan/v1', 'source': SOURCE, 'tree': TREE,
                    'tag': release.TAG, 'name': release.TITLE, 'body': release.notes(manifest, ordered),
                    'assets': [release.identity(file) for file in [*ordered, checksum]],
                    'manifestSHA256': release.digest(manifest_file), 'selectors': {'fixture': 'fresh inputs'}}
            manifests.append(manifest)
            plans.append(plan)
        api = ReadOnlyRetryAPI()
        api.existing(plans[0], published)
        for row in api.assets:
            row.update({'uploader': {'login': 'github-actions[bot]'}, 'download_count': 9})
        return published, current_output, manifests[0], manifests[1], plans[0], plans[1], api

    def rewrite_evidence(self, directory, member, raw):
        file = directory / ('Local-TI-Evidence-' + release.VERSION + '.zip')
        with zipfile.ZipFile(file) as saved:
            members = {name: saved.read(name) for name in saved.namelist()}
        members[member] = raw
        file.write_bytes(zip_bytes(members))
        return release.identity(file)

    def test_only_actual_asset_download_counter_is_ignored(self):
        original = {'asset': self.prerequisite_asset(3), 'report': {'download_count': 3, 'fixture': 'inert'}}
        newer = copy.deepcopy(original)
        newer['asset']['download_count'] = 47
        self.assertEqual(release.stable_api(original), release.stable_api(newer))
        self.assertEqual(original['asset']['download_count'], 3, 'Original API evidence must remain intact')
        newer['report']['download_count'] = 47
        self.assertNotEqual(release.stable_api(original), release.stable_api(newer))
        for key, value in (('id', 82), ('size', 124), ('digest', 'sha256:' + 'b' * 64),
                           ('uploader', {'login': 'inert-other-uploader'}), ('state', 'new')):
            altered = self.prerequisite_asset(47)
            altered[key] = value
            with self.subTest(field=key):
                self.assertNotEqual(release.stable_api(self.prerequisite_asset(3)), release.stable_api(altered))

    def test_equal_inputs_allow_original_bytes_with_distinct_collectors_and_counters(self):
        published, current_output, original, current, _, _, _ = self.fixture()
        original_before, current_before = copy.deepcopy(original), copy.deepcopy(current)
        self.assertNotEqual(original['publicationAuditContext'], current['publicationAuditContext'])
        self.assertNotEqual(original['evidence'], current['evidence'])
        self.assertEqual(release.retry_bindings(original, current, published, current_output), [release.ARCHIVE])
        self.assertEqual(original, original_before)
        self.assertEqual(current, current_before)

    def test_different_outer_containers_preserve_exact_original_inner_zip_and_receipt(self):
        published, current_output, original, current, _, _, _ = self.fixture(separate=True)
        names = release.retry_bindings(original, current, published, current_output)
        self.assertEqual(len(names), 2)
        for name in names:
            self.assertNotEqual((published / name).read_bytes(), (current_output / name).read_bytes())
            with zipfile.ZipFile(published / name) as old, zipfile.ZipFile(current_output / name) as fresh:
                for member in (release.ARCHIVE, 'package-receipt.json'):
                    self.assertEqual(old.read(member), fresh.read(member))

    def test_changed_qualified_source_or_producer_is_not_a_retry(self):
        published, current_output, original, current, _, _, _ = self.fixture()
        changed_source = copy.deepcopy(current)
        changed_source['source']['commit'] = DRIFT
        changed_producer = copy.deepcopy(current)
        changed_producer['producers']['ti']['run']['id'] += 1
        for altered in (changed_source, changed_producer):
            with self.subTest(altered=altered), self.assertRaises(ValueError):
                release.retry_bindings(original, altered, published, current_output)

    def test_rehashed_original_outer_container_cannot_change_qualified_inner_zip(self):
        published, current_output, original, current, _, _, _ = self.fixture(separate=True)
        name = original['packageAssets'][0]['name']
        with zipfile.ZipFile(published / name) as old:
            receipt = old.read('package-receipt.json')
        (published / name).write_bytes(zip_bytes({release.ARCHIVE: zip_bytes({'INERT.txt': b'Changed benign inner package.\n'}),
                                                 'package-receipt.json': receipt}))
        original['packageAssets'][0] = release.identity(published / name)
        with self.assertRaises(ValueError):
            release.retry_bindings(original, current, published, current_output)

    def test_rehashed_original_evidence_cannot_change_retained_report_bytes(self):
        published, current_output, original, current, _, _, _ = self.fixture()
        original['evidence'] = self.rewrite_evidence(published, 'x64/reports/execution-context.json',
                                                     b'{"fixture":"different benign report"}\n')
        with self.assertRaises(ValueError):
            release.retry_bindings(original, current, published, current_output)

    def test_full_retry_authenticates_historical_collector_and_preserves_both_contexts(self):
        _, current_output, original, current, old_plan, plan, api = self.fixture()
        with patch.object(release, 'refresh_proof') as refresh:
            result = release.read_only_retry(api, current_output, plan)
        self.assertEqual(result['status'], 'ALREADY_PUBLISHED_EXACT_READ_ONLY')
        self.assertEqual(result['originalPublicationContext'], original['publicationAuditContext'])
        self.assertEqual(result['verificationContext'], current['publicationAuditContext'])
        self.assertEqual(result['assets'], old_plan['assets'], 'Retry must retain the original exact public assets')
        self.assertEqual(result['originalCollectorAuthentication']['attempt']['run_attempt'], 1)
        self.assertEqual(result['originalCollectorAuthentication']['run']['run_attempt'], 4)
        paths = [event[1] for event in api.events]
        for path in ('/actions/runs/401', '/actions/runs/401/attempts/1',
                     '/actions/workflows/88', '/check-runs/600', '/check-runs/601'):
            self.assertIn(path, paths, 'Historical collector must be authenticated through the real predicate')
        self.assertTrue(any(path.startswith('/actions/runs/401/attempts/1/jobs?') for path in paths))
        self.assertFalse(any('/actions/runs/902' in path for path in paths), 'Do not relabel original publication as the current collector')
        self.assertTrue(all(row['download_count'] >= 11 for row in api.assets), 'Download counts must actually change during verification')
        refresh.assert_called_once_with(api, {**plan, '_output': str(current_output)})
        self.assertEqual(api.mutations(), [])

    def test_original_collector_api_source_mismatch_refuses_without_writes(self):
        _, current_output, _, _, _, plan, api = self.fixture()
        api.collector_source = DRIFT
        with patch.object(release, 'refresh_proof') as refresh, self.assertRaises(ValueError):
            release.read_only_retry(api, current_output, plan)
        self.assertIn('/actions/runs/401/attempts/1', [event[1] for event in api.events])
        refresh.assert_not_called()
        self.assertEqual(api.mutations(), [])

    def test_fresh_existing_release_draft_full_or_latest_classification_refuses(self):
        for field in ('fresh_draft', 'fresh_full_release', 'preview_is_latest'):
            with self.subTest(classification=field):
                case = self.root / field
                case.mkdir()
                with patch.object(self, 'root', case):
                    _, current_output, _, _, _, plan, api = self.fixture()
                setattr(api, field, True)
                with patch.object(release, 'refresh_proof') as refresh, self.assertRaises(ValueError):
                    release.read_only_retry(api, current_output, plan)
                self.assertIn('/actions/runs/401/attempts/1', [event[1] for event in api.events])
                refresh.assert_not_called()
                self.assertEqual(api.mutations(), [])


if __name__ == '__main__':
    unittest.main()
