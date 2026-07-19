#!/usr/bin/env bash
set -euo pipefail
exec node "${PLUGIN_ROOT:?PLUGIN_ROOT is required}/dist/hook.js"
