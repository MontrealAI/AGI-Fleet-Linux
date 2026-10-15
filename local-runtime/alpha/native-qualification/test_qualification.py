"""Synthetic checks of native evidence rejection; no OS isolation is claimed."""
import copy
import importlib.util
from pathlib import Path
import unittest

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('native_ipc_qualification', HERE / 'qualify.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def attempt(name='isolation'):
    success = name in ('isolation', 'detached-exit')
    code = {'cancel': 'RUN_CANCELLED', 'cancel-after-exit': 'RUN_CANCELLED', 'timeout': 'RUN_TIMEOUT', 'launcher-death': 'ALPHA_WORKER_FAILED',
            'cpu': 'ALPHA_WORKER_FAILED', 'output': 'ALPHA_OUTPUT_SIZE'}.get(name)
    probe = {'pidNamespace': 'pid:[11]', 'networkNamespace': 'net:[12]', 'trustedChannelsAbsent': True,
             'cpuLimitSeconds': [5, 5], 'detachedChild': True}
    transport = {'processGroupGone': True, 'privateNamespacesEnded': True, 'namespaceLifetimeEOF': True,
                 'status': {'namespaces': {'pid': 11, 'net': 12}, 'exitCode': 137 if name == 'cpu' else 0},
                 'exitStatus': 0 if success else 137, 'wallMilliseconds': 5000}
    return {'driver': {'probeSeen': True, 'ok': success, 'code': code, 'observation': transport},
            'probeObservations': [probe], 'liveNamespaceMembersObserved': {'pid:[11]': [123]},
            'namespaceMembersRemaining': {'pid:[11]': []}, 'namespaceCpuSecondsObserved': 4.99}


class NativeEvidenceTests(unittest.TestCase):
    def test_all_fixed_probe_contracts(self):
        for name in ('isolation', 'detached-exit', 'cancel', 'cancel-after-exit', 'timeout', 'launcher-death', 'cpu', 'output'):
            module.check_probe(name, attempt(name))

    def test_eof_alone_is_never_cleanup(self):
        for key in ('processGroupGone', 'privateNamespacesEnded', 'namespaceLifetimeEOF'):
            value = attempt()
            value['driver']['observation'][key] = False
            with self.assertRaises(ValueError):
                module.check_probe('isolation', value)

    def test_actual_live_and_disappeared_namespace_required(self):
        for change in (lambda v: v.update(liveNamespaceMembersObserved={}),
                       lambda v: v.update(namespaceMembersRemaining={'pid:[11]': [123]}),
                       lambda v: v.update(namespaceMembersRemaining={}),
                       lambda v: v.update(namespaceMembersRemaining={'pid:[11]': None}),
                       lambda v: v.update(liveNamespaceMembersObserved={'pid:[11]': '123'}),
                       lambda v: v.update(namespaceMembersRemaining={'pid:[99]': []}),
                       lambda v: v.update(liveNamespaceMembersObserved={'pid:[99]': [123]}, namespaceMembersRemaining={'pid:[99]': []}),
                       lambda v: v.update(liveNamespaceMembersObserved={'pid:[11]': []}),
                       lambda v: v.update(probeObservations=[])):
            value = attempt()
            change(value)
            with self.assertRaises(ValueError):
                module.check_probe('isolation', value)

    def test_child_report_cannot_disagree_with_bwrap(self):
        for key, changed in [('pidNamespace', 'pid:[99]'), ('networkNamespace', 'net:[99]'),
                             ('trustedChannelsAbsent', False), ('cpuLimitSeconds', [10, 10])]:
            value = attempt()
            value['probeObservations'][0][key] = changed
            with self.assertRaises(ValueError):
                module.check_probe('isolation', value)

    def test_detached_child_is_mandatory(self):
        value = attempt('cancel')
        value['probeObservations'][0]['detachedChild'] = False
        with self.assertRaises(ValueError):
            module.check_probe('cancel', value)

    def test_cpu_needs_real_namespace_ticks_and_sigkill(self):
        for seconds in (0.002, 3.9, 6.1):
            value = attempt('cpu')
            value['namespaceCpuSecondsObserved'] = seconds
            with self.assertRaises(ValueError):
                module.check_probe('cpu', value)
        value = attempt('cpu')
        value['driver']['observation']['status']['exitCode'] = 0
        with self.assertRaises(ValueError):
            module.check_probe('cpu', value)

    def test_wrong_refusal_or_success_is_rejected(self):
        value = attempt('cancel')
        value['driver']['code'] = 'CLEANUP_UNCONFIRMED'
        with self.assertRaises(ValueError):
            module.check_probe('cancel', value)
        value = attempt('detached-exit')
        value['driver']['ok'] = False
        with self.assertRaises(ValueError):
            module.check_probe('detached-exit', value)


if __name__ == '__main__':
    unittest.main()
