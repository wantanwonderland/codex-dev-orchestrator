#!/usr/bin/env python3
import json
import pathlib
import re
import subprocess
import sys

root = pathlib.Path(__file__).resolve().parents[1]
manifest = json.loads((root / ".codex-plugin" / "plugin.json").read_text())
required = ["name", "version", "description", "author", "interface"]
missing = [key for key in required if key not in manifest]
if missing:
    raise SystemExit(f"missing plugin fields: {', '.join(missing)}")
if manifest["name"] != root.name:
    try:
        worktrees = subprocess.check_output(["git", "-C", str(root), "worktree", "list", "--porcelain"], text=True)
        primary = next(line.removeprefix("worktree ") for line in worktrees.splitlines() if line.startswith("worktree "))
        if pathlib.Path(primary).name != manifest["name"]:
            raise SystemExit("plugin name must match its folder")
    except (OSError, subprocess.CalledProcessError, StopIteration):
        raise SystemExit("plugin name must match its folder")
if not re.fullmatch(r"\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?", manifest["version"]):
    raise SystemExit("plugin version must be semver")
for relative in [manifest.get("skills"), manifest.get("mcpServers"), "hooks/hooks.json"]:
    if relative and not (root / relative.removeprefix("./")).exists():
        raise SystemExit(f"missing plugin component: {relative}")
if "[TODO:" in json.dumps(manifest):
    raise SystemExit("plugin manifest contains a TODO placeholder")
print("plugin validation OK")
