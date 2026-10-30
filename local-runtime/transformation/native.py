# SPDX-License-Identifier: MIT
"""Thin CLI over Alpha's installed TI handlers, not the complete Alpha CLI."""
from __future__ import annotations

import argparse
import json

from alpha_factory_v1.core.runtime.store import Journal
from alpha_factory_v1.core.runtime.successor import transformation, transformation_library_cli


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--home", required=True)
    commands = parser.add_subparsers(dest="command", required=True)
    transformation.add_commands(commands)
    transformation_library_cli.add_commands(commands)
    commands.add_parser("init")
    commands.add_parser("verify")
    commands.add_parser("current-binding").add_argument("campaign_id")
    args = parser.parse_args()
    from pathlib import Path

    args.home = Path(args.home)
    if args.command == "successor-transform":
        result = transformation.handle(args)
    elif args.command == "successor-library":
        result = transformation_library_cli.handle(args)
    elif args.command == "init":
        result = Journal.initialize(args.home).verify()
    elif args.command == "current-binding":
        from alpha_factory_v1.core.runtime.successor.protocol import digest

        loop = transformation.DiscoveryLoop(Journal(args.home))
        record = loop.show(args.campaign_id)
        request = transformation.DiscoveryRequest.model_validate(record["request"])
        current = digest("ti-bindings", loop.bindings(request))
        result = {"campaign_id": args.campaign_id, "bindings_digest": current,
                  "matches_retained": current == record["binding_digest"]}
    else:
        result = Journal(args.home).verify()
    print(json.dumps(result, ensure_ascii=False, sort_keys=True, separators=(",", ":")))


if __name__ == "__main__":
    main()
