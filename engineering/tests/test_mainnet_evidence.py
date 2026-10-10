import copy
import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from mainnet_evidence import check_mainnet


class PublicDeploymentEvidence(unittest.TestCase):
    def setUp(self):
        self.report = json.loads((ROOT.parent / 'validation/mainnet-cfa78f9980ea9b55c705b3e44467bae383ce1fa7.json').read_text())

    def test_complete_record_replays_without_network(self):
        result = check_mainnet(self.report)
        self.assertEqual(result['runtimeContracts'], 9)
        self.assertEqual(result['managerGettersPerHost'], 42)
        self.assertFalse(result['productionQualified'])

    def test_substituted_runtime_cannot_pass(self):
        batch = next(batch for batch in self.report['rpcEvidence'] if any(
            row['method'] == 'eth_getCode' and int(row['params'][1], 16) == self.report['observation']['block']
            for row in batch['requests']))
        request = next(row for row in batch['requests'] if row['method'] == 'eth_getCode')
        response = next(row for row in batch['responses'] if row['id'] == request['id'])
        response['result'] = '0x6000'
        with self.assertRaisesRegex(ValueError, 'Runtime artifact differs'):
            check_mainnet(self.report)

    def test_changed_pause_summary_cannot_pass(self):
        self.report['state']['paused'] = False
        with self.assertRaisesRegex(ValueError, 'Manager observation differs: paused'):
            check_mainnet(self.report)

    def test_missing_secondary_library_cannot_pass(self):
        for batch in self.report['rpcEvidence']:
            if batch['rpcHost'] != self.report['observation']['rpcHosts'][1]:
                continue
            request = next((row for row in batch['requests'] if row['method'] == 'eth_getCode'
                            and row['params'][0] == self.report['deploymentPin']['contracts']['ReputationMath']['address']), None)
            if request:
                batch['requests'].remove(request)
                batch['responses'] = [row for row in batch['responses'] if row['id'] != request['id']]
                break
        with self.assertRaisesRegex(ValueError, 'Incomplete runtime'):
            check_mainnet(self.report)

    def test_rpc_disagreement_cannot_pass(self):
        for batch in self.report['rpcEvidence']:
            if batch['rpcHost'] != self.report['observation']['rpcHosts'][1]:
                continue
            request = next((row for row in batch['requests'] if row['method'] == 'eth_getBlockByNumber'
                            and row['params'][0] == hex(self.report['observation']['block'])), None)
            if request:
                next(row for row in batch['responses'] if row['id'] == request['id'])['result']['hash'] = '0x' + '0' * 64
                break
        with self.assertRaisesRegex(ValueError, 'Observation block differs'):
            check_mainnet(self.report)

    def test_wrong_chain_and_transaction_method_cannot_pass(self):
        original = copy.deepcopy(self.report)
        first = self.report['rpcEvidence'][0]
        first['responses'][0]['result'] = '0xaa36a7'
        with self.assertRaisesRegex(ValueError, 'RPC chain differs'):
            check_mainnet(self.report)
        self.report = original
        self.report['rpcEvidence'][0]['requests'][0]['method'] = 'eth_sendRawTransaction'
        with self.assertRaisesRegex(ValueError, 'non-read-only'):
            check_mainnet(self.report)

    def test_observation_cannot_be_promoted_to_production(self):
        self.report['assessment']['productionQualified'] = True
        with self.assertRaisesRegex(ValueError, 'scope or assessment differs'):
            check_mainnet(self.report)


if __name__ == '__main__':
    unittest.main()
