import importlib.util
import io
import json
from pathlib import Path
import unittest
from unittest.mock import MagicMock, patch
import urllib.error

spec = importlib.util.spec_from_file_location('readonly', Path(__file__).resolve().parents[1] / 'read-only-rpc.py')
rpc = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rpc)


class ReadOnlyTransport(unittest.TestCase):
    def setUp(self):
        self.value = {'url': 'https://rpc.example/?key=PRIVATE_TEST_TOKEN', 'requests': [
            {'jsonrpc': '2.0', 'id': 1, 'method': 'eth_chainId', 'params': []},
            {'jsonrpc': '2.0', 'id': 2, 'method': 'eth_blockNumber', 'params': []}]}

    def response(self, data):
        opener = MagicMock()
        opener.open.return_value = io.BytesIO(data)
        return patch.object(rpc.urllib.request, 'build_opener', return_value=opener)

    def test_reordered_complete_batch_is_accepted(self):
        rows = [{'jsonrpc': '2.0', 'id': 2, 'result': '0x10'}, {'jsonrpc': '2.0', 'id': 1, 'result': '0x1'}]
        with self.response(json.dumps(rows).encode()):
            self.assertEqual(rpc.fetch(self.value), rows)

    def test_transactions_are_rejected_before_network_access(self):
        self.value['requests'][0]['method'] = 'eth_sendRawTransaction'
        with patch.object(rpc.urllib.request, 'build_opener') as opener:
            with self.assertRaisesRegex(ValueError, 'read-only'):
                rpc.fetch(self.value)
            opener.assert_not_called()

    def test_non_https_and_fragment_urls_are_rejected(self):
        for url in ['http://rpc.example/', 'https://rpc.example/#secret']:
            self.value['url'] = url
            with self.assertRaisesRegex(ValueError, 'HTTPS'):
                rpc.fetch(self.value)

    def test_duplicate_request_ids_are_rejected(self):
        self.value['requests'][1]['id'] = 1
        with self.assertRaisesRegex(ValueError, 'uniquely identified'):
            rpc.fetch(self.value)

    def test_missing_or_duplicate_responses_fail_closed(self):
        for rows in [[], [{'jsonrpc': '2.0', 'id': 1, 'result': '0x1'}] * 2]:
            with self.response(json.dumps(rows).encode()):
                self.assertTrue(all('error' in row for row in rpc.fetch(self.value)))

    def test_oversized_response_fails_closed(self):
        with self.response(b' ' * (rpc.MAX_BYTES + 1)):
            self.assertTrue(all('error' in row for row in rpc.fetch(self.value)))

    def test_provider_errors_do_not_expose_credentials(self):
        opener = MagicMock()
        opener.open.side_effect = urllib.error.HTTPError(self.value['url'], 403, 'PRIVATE_TEST_TOKEN', {}, None)
        with patch.object(rpc.urllib.request, 'build_opener', return_value=opener):
            result = rpc.fetch(self.value)
        self.assertNotIn('PRIVATE_TEST_TOKEN', json.dumps(result))
        self.assertIn('403', result[0]['error']['message'])

    def test_redirect_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'redirects'):
            rpc.NoRedirect().redirect_request(None, None, 302, '', {}, 'http://other.example/')


if __name__ == '__main__':
    unittest.main()
