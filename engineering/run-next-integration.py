#!/usr/bin/env python3
"""Exercise the saved candidate against the pinned manager using local mock USDC."""
import argparse
from pathlib import Path
import sys

from next_release_tools import adapt_baseline, candidate_tools, load_candidate, provenance, verify_candidate, write_json


def bind_runner(candidate):
    runner = adapt_baseline('run-job-integration.py', {(str, '1.0.9'): candidate['version']})
    bound = candidate_tools(candidate)
    for name in ('ASSET', 'PREFIX', 'SHA256', 'SIZE', 'verify_archive', 'extract'):
        setattr(runner, name, getattr(bound, name))
    runner.MANAGER_BASELINE = candidate['integration']['commit']
    return runner


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--metadata', type=Path, required=True)
    parser.add_argument('--archive', type=Path, required=True)
    parser.add_argument('--work', type=Path, required=True)
    parser.add_argument('--evidence', type=Path, required=True)
    args = parser.parse_args()
    candidate = load_candidate(args.metadata, args.archive)
    verify_candidate(args.archive, candidate)
    runner = bind_runner(candidate)
    previous = sys.argv
    sys.argv = [runner.__file__, '--work', str(args.work), '--evidence', str(args.evidence),
                '--archive', str(args.archive.resolve()), '--manager-ref', runner.MANAGER_BASELINE]
    try:
        runner.main()
    finally:
        sys.argv = previous
        if args.evidence.is_dir():
            write_json(args.evidence / 'candidate-binding.json', provenance(candidate))


if __name__ == '__main__':
    main()
