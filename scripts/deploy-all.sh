#!/usr/bin/env bash
#
# Combined deploy: the CURRENT machine's platform FIRST, then every remote target
# configured in .env — each with the plugin. Soft or hard is controlled by
# MX_HARD (0/1) and applies to all of them. Targets are detected by the presence
# of <PLAT>_HOST in .env; a platform with no host set is skipped silently.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

HARD="${MX_HARD:-0}"
if [[ -f .env ]]; then set -o allexport; # shellcheck disable=SC1091
  source .env; set +o allexport; fi

# Current machine → platform name used by the matrix.
local_plat(){
  case "$(uname -s)" in
    Darwin) echo mac ;;
    Linux) if grep -qi steamos /etc/os-release 2>/dev/null; then echo deck; else echo linux; fi ;;
    MINGW*|MSYS*|CYGWIN*) echo windows ;;
    *) echo "" ;;
  esac
}

run_one(){ # run_one <plat>
  echo ""
  echo "──────── deploy:all → $1 (plugin, $( [[ $HARD == 1 ]] && echo hard || echo soft )) ────────"
  MX_PLAT="$1" MX_PLUGIN=1 MX_HARD="$HARD" bash "$ROOT/scripts/deploy-matrix.sh"
}

envof(){ eval "printf '%s' \"\${$1:-}\""; }

FAILS=0
LOCAL="$(local_plat)"
[[ -n "$LOCAL" ]] && { run_one "$LOCAL" || FAILS=$((FAILS+1)); } || echo "[deploy:all] unknown local platform ($(uname -s)) — skipping local"

# Remote targets, keyed by <PLAT>_HOST in .env. DECK_HOST drives deck; others
# use their own prefix. Skip the one matching the local platform (already done).
declare -a PLATS=(deck linux arm windows)
for p in "${PLATS[@]}"; do
  [[ "$p" == "$LOCAL" ]] && continue
  pfx="$(echo "$p" | tr '[:lower:]' '[:upper:]')"
  [[ -n "$(envof "${pfx}_HOST")" ]] || continue
  run_one "$p" || FAILS=$((FAILS+1))
done

echo ""
if [[ "$FAILS" -eq 0 ]]; then echo "[deploy:all] all targets done."; else echo "[deploy:all] $FAILS target(s) failed."; fi
exit "$FAILS"
