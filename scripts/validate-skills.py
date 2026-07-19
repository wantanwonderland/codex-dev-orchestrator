#!/usr/bin/env python3
import pathlib
import re

root = pathlib.Path(__file__).resolve().parents[1]
skills = list((root / "skills").glob("*/SKILL.md"))
if not skills:
    raise SystemExit("no skills found")
for path in skills:
    text = path.read_text()
    match = re.match(r"^---\n(.*?)\n---\n", text, re.S)
    if not match or "name:" not in match.group(1) or "description:" not in match.group(1):
        raise SystemExit(f"invalid skill front matter: {path}")
    if "TODO" in text:
        raise SystemExit(f"skill contains TODO: {path}")
print(f"skill validation OK ({len(skills)} skill)")
