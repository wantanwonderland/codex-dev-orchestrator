#!/usr/bin/env python3
import json
import pathlib
import re
import sys

root = pathlib.Path(__file__).resolve().parents[1]
manifest = json.loads((root / ".codex-plugin" / "plugin.json").read_text())
required = ["name", "version", "description", "author", "interface"]
missing = [key for key in required if key not in manifest]
if missing:
    raise SystemExit(f"missing plugin fields: {', '.join(missing)}")
if manifest["name"] != root.name:
    raise SystemExit("plugin name must match its folder")
if not re.fullmatch(r"\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?", manifest["version"]):
    raise SystemExit("plugin version must be semver")
for relative in [manifest.get("skills"), manifest.get("mcpServers"), "hooks/hooks.json"]:
    if relative and not (root / relative.removeprefix("./")).exists():
        raise SystemExit(f"missing plugin component: {relative}")
if "[TODO:" in json.dumps(manifest):
    raise SystemExit("plugin manifest contains a TODO placeholder")
print("plugin validation OK")
