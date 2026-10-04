#!/usr/bin/env bash
# Start ProjectTodo (README.md). Flags, or the environment variables they set:
#   --port N        PORT                          default 3004
#   --host H        HOST                          default 127.0.0.1 (0.0.0.0 for other machines)
#   --data DIR      PROJECTTODO_DATA_DIR          where todos.json lives, default ./data
#   --docs DIR      PROJECTTODO_DOCS_DIR          a to-do's doc path is read from here
#   --project NAME  PROJECTTODO_DEFAULT_PROJECT   the project made for rows from before projects existed
#   --dev           PROJECTTODO_DEV=1             restart when server.mjs or public/ change; open pages reload themselves
# Example:  ./start.sh --port 3004 --data ~/notes/todos --docs ~/notes
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

usage() {
  sed -n '2,9p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --port) PORT="$2"; shift 2 ;;
    --host) HOST="$2"; shift 2 ;;
    --data) PROJECTTODO_DATA_DIR="$2"; shift 2 ;;
    --docs) PROJECTTODO_DOCS_DIR="$2"; shift 2 ;;
    --project) PROJECTTODO_DEFAULT_PROJECT="$2"; shift 2 ;;
    --dev) PROJECTTODO_DEV=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) printf "Unknown option: %s\n\n" "$1" >&2; usage >&2; exit 1 ;;
  esac
done

if ! command -v node >/dev/null 2>&1; then
  printf "ProjectTodo needs Node 18 or newer, and node was not found.\n" >&2
  exit 1
fi
major="$(node -p 'process.versions.node.split(".")[0]')"
if (( major < 18 )); then
  printf "ProjectTodo needs Node 18 or newer; this is Node %s.\n" "$(node -v)" >&2
  exit 1
fi

export PORT="${PORT:-3004}" HOST="${HOST:-127.0.0.1}"
[[ -n "${PROJECTTODO_DATA_DIR:-}" ]] && export PROJECTTODO_DATA_DIR
[[ -n "${PROJECTTODO_DOCS_DIR:-}" ]] && export PROJECTTODO_DOCS_DIR
[[ -n "${PROJECTTODO_DEFAULT_PROJECT:-}" ]] && export PROJECTTODO_DEFAULT_PROJECT

if [[ "${PROJECTTODO_DEV:-0}" == "1" ]]; then
  # Watch mode: Node restarts the server when its files change; the open pages notice the new boot id and reload.
  # --watch-path (the public folder too) exists on macOS and Windows; elsewhere --watch follows the imported modules.
  case "$(uname -s)" in
    Darwin|MINGW*|MSYS*|CYGWIN*) exec node --watch-path="$DIR/server.mjs" --watch-path="$DIR/public" "$DIR/server.mjs" ;;
    *) exec node --watch "$DIR/server.mjs" ;;
  esac
fi
exec node "$DIR/server.mjs"
