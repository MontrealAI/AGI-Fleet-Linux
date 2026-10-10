"""Candidate identity binding; historical harness files stay byte-for-byte intact."""
import ast
from collections import Counter
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import types
import zipfile

from release_tools import LIMIT, ROOT, require, sha

BASELINES = {
    'run-linux-1.0.9-native.py': '93c3ed0df093c1e07ab818f3f7f9f76053dfb7a911ad89ef3fc7ebfd74be645e',
    'run-job-integration.py': '423b1de88924fad41f9761bc3952e78ff2ab48e3be8193e66c599c9098c223b4',
    'audit-job-evidence.py': 'f101219ccce9b08e73b3d7bfd50aacc8ca88ecd7cf5c36fbc148168bec284d49',
}


def load_module(name):
    file = ROOT / 'engineering' / name
    if name in BASELINES:
        require(sha(file) == BASELINES[name], 'Historical harness bytes differ: ' + name)
    spec = importlib.util.spec_from_file_location(name.replace('.', '_'), file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def adapt_baseline(name, replacements, extra_expected_files=()):
    file = ROOT / 'engineering' / name
    require(sha(file) == BASELINES[name], 'Historical harness bytes differ: ' + name)
    tree = ast.parse(file.read_text(), filename=str(file))
    counts = Counter()
    class BindConstants(ast.NodeTransformer):
        def visit_Constant(self, node):
            key = (type(node.value), node.value)
            if key in replacements:
                counts[key] += 1
                return ast.copy_location(ast.Constant(replacements[key]), node)
            return node
        def visit_Assign(self, node):
            node = self.generic_visit(node)
            if extra_expected_files and any(isinstance(target, ast.Name) and target.id == 'expected_files'
                                            for target in node.targets):
                require(isinstance(node.value, ast.Set), 'Evidence file coverage adapter differs')
                node.value.elts.extend(ast.Constant(name) for name in extra_expected_files)
                counts['expected_files'] += 1
            return node
    tree = BindConstants().visit(tree)
    if extra_expected_files:
        require(counts.pop('expected_files', 0) == 1, 'Evidence coverage adapter must match exactly once')
    require(set(counts) == set(replacements), 'Candidate adapter no longer matches historical harness')
    module = types.ModuleType('candidate_' + name.replace('.', '_'))
    module.__file__ = str(file)
    exec(compile(ast.fix_missing_locations(tree), str(file), 'exec'), module.__dict__)
    return module


def load_candidate(metadata, archive, specification=None):
    specification = specification or ROOT / 'engineering/next-release.json'
    expected = json.loads(Path(specification).read_text())
    value = json.loads(Path(metadata).read_text())
    for key in ('version', 'tag', 'name', 'sourceRevisionSHA256'):
        require(value.get(key) == expected.get(key), 'Candidate metadata differs: ' + key)
    require(re.fullmatch(r'\d+\.\d+\.\d+', value['version']), 'Invalid candidate version')
    require(value['tag'] == 'v' + value['version'] + '-qualification', 'Invalid qualification tag')
    prefix = 'AGI_Fleet_Linux_v' + value['version']
    require(expected['prefix'] == prefix and value['name'] == prefix + '.zip', 'Invalid candidate name')
    require(re.fullmatch(r'[0-9a-f]{64}', value['sha256']) and
            re.fullmatch(r'[0-9a-f]{64}', value['sourceRevisionSHA256']), 'Invalid candidate digest')
    require(type(value['bytes']) is int and 0 < value['bytes'] < LIMIT, 'Invalid candidate size')
    require(Path(archive).is_file() and not Path(archive).is_symlink(), 'Candidate archive must be a regular file')
    require(Path(archive).stat().st_size == value['bytes'] and sha(archive) == value['sha256'], 'Candidate archive identity differs')
    require(expected['productionQualified'] is False and value.get('productionQualified', False) is False,
            'Candidate cannot claim production qualification')
    value.update(prefix=prefix, native=expected['native'], sourceFiles=expected['sourceFiles'])
    return value


def candidate_tools(candidate):
    module = load_module('release_tools.py')
    module.VERSION = candidate['version']
    module.PREFIX = candidate['prefix']
    module.ASSET = candidate['name']
    module.SIZE = candidate['bytes']
    module.SHA256 = candidate['sha256']
    module.SOURCE_REVISION = candidate['sourceRevisionSHA256']
    return module


def verify_candidate(archive, candidate):
    verifier = candidate_tools(candidate)
    receipt = verifier.verify_archive(archive)
    with zipfile.ZipFile(archive) as saved:
        base = candidate['prefix'] + '/'
        inventory = json.loads(saved.read(base + 'source-inventory.json'))
        release = json.loads(saved.read(base + 'release-manifest.json'))
        config = json.loads(saved.read(base + 'config/companion-releases.json'))
        package = json.loads(saved.read(base + 'package.json'))
        require(inventory['revisionSHA256'] == candidate['sourceRevisionSHA256'] == release['sourceRevisionSHA256'],
                'Candidate source revision differs')
        require(len(inventory['files']) == candidate['sourceFiles'], 'Candidate source coverage differs')
        require(package['version'] == config['fleet'] == release['release']['fleet'] == candidate['version'],
                'Candidate internal version differs')
    return receipt


def provenance(candidate):
    return {'schema': 'agi-next-validation-binding/v1',
            'candidate': {key: candidate[key] for key in ('version', 'tag', 'name', 'bytes', 'sha256', 'sourceRevisionSHA256')},
            'baselineHarnesses': BASELINES, 'productionQualified': False}


def write_json(path, value):
    Path(path).write_text(json.dumps(value, indent=2) + '\n')
