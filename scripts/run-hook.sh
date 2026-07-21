#!/usr/bin/env bash
set -euo pipefail

if command -v node >/dev/null 2>&1; then
  node_bin="$(command -v node)"
else
  candidates=(/opt/homebrew/bin/node /usr/local/bin/node)
  if [[ -n "${HOME:-}" ]]; then
    candidates+=("$HOME/.volta/bin/node" "$HOME/.local/share/mise/shims/node" "$HOME"/.nvm/versions/node/*/bin/node)
  fi
  node_bin=""
  for candidate in "${candidates[@]}"; do
    if [[ -x "$candidate" ]]; then
      node_bin="$candidate"
    fi
  done
fi

if [[ -z "${node_bin:-}" ]]; then
  printf 'CDO hook could not find Node.js; install Node 20+ or expose it in PATH\n' >&2
  exit 127
fi

exec "$node_bin" "${PLUGIN_ROOT:?PLUGIN_ROOT is required}/dist/hook.js"
