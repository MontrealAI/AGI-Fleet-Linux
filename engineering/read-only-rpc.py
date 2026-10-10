#!/usr/bin/env python3
"""Bounded HTTPS transport for public read-only JSON-RPC batches.

RPC URLs arrive on stdin so credentials never appear in process arguments.
Error output never contains a URL, response body or provider error text.
"""
import json
import sys
import urllib.error
import urllib.parse
import urllib.request

ALLOWED = frozenset({'eth_chainId', 'eth_blockNumber', 'eth_getBlockByNumber', 'eth_getBlockByHash',
                     'eth_getTransactionReceipt', 'eth_getCode', 'eth_call'})
MAX_BYTES = 2_000_000


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError('RPC redirects are not permitted')


def fetch(value):
    url = urllib.parse.urlsplit(value['url'])
    if url.scheme != 'https' or not url.hostname or url.fragment:
        raise ValueError('HTTPS RPC URL required')
    requests = value['requests']
    if not isinstance(requests, list) or not 1 <= len(requests) <= 64:
        raise ValueError('Invalid batch size')
    ids = set()
    for row in requests:
        if (not isinstance(row, dict) or row.get('jsonrpc') != '2.0'
                or row.get('method') not in ALLOWED or not isinstance(row.get('params'), list)
                or type(row.get('id')) is not int or row['id'] in ids):
            raise ValueError('Only uniquely identified read-only requests are permitted')
        ids.add(row['id'])
    body = json.dumps(requests).encode()
    if len(body) > 65_536:
        raise ValueError('Request exceeds limit')
    request = urllib.request.Request(value['url'], data=body,
                                    headers={'Content-Type': 'application/json', 'User-Agent': 'AGI-Fleet-deployment-verifier'})
    try:
        with urllib.request.build_opener(NoRedirect).open(request, timeout=25) as response:
            raw = response.read(MAX_BYTES + 1)
        if len(raw) > MAX_BYTES:
            raise ValueError('Response exceeds limit')
        result = json.loads(raw)
        if (not isinstance(result, list) or len(result) != len(requests)
                or any(not isinstance(row, dict) or row.get('jsonrpc') != '2.0'
                       or type(row.get('id')) is not int for row in result)
                or {row['id'] for row in result} != ids):
            raise ValueError('Incomplete or duplicate batch response')
        return result
    except urllib.error.HTTPError as error:
        message = 'Read-only RPC HTTP failure: ' + str(error.code)
    except Exception:
        message = 'Read-only RPC transport failed'
    return [{'jsonrpc': '2.0', 'id': row['id'], 'error': {'code': -32000, 'message': message}}
            for row in requests]


def main():
    try:
        raw = sys.stdin.buffer.read(65_537)
        if len(raw) > 65_536:
            raise ValueError('Input exceeds limit')
        json.dump(fetch(json.loads(raw)), sys.stdout)
    except Exception:
        print('Read-only RPC request rejected', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
