#!/usr/bin/env bash
# Runs scripts/deploy.sh --dry-run in a throwaway repo with a local bare
# "origin" across the scenarios of AC4. Nothing leaves the machine: in dry-run
# plink/pscp are only printed, and origin is a local directory.
# Usage: bash checks/deploy-sh-guard-sim.sh [path/to/deploy.sh]
set -u
SRC=$(cd "$(dirname "${1:-scripts/deploy.sh}")" && pwd)/$(basename "${1:-scripts/deploy.sh}")
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
g() { git -c user.email=t@t -c user.name=t "$@"; }

mkdir -p "$T/home"
git init -q --bare -b master "$T/origin.git"
git clone -q "$T/origin.git" "$T/work" 2>/dev/null
mkdir -p "$T/work/scripts" && cp "$SRC" "$T/work/scripts/deploy.sh"
printf 'x\n' > "$T/work/app.txt"
g -C "$T/work" add -A && g -C "$T/work" commit -qm init && g -C "$T/work" push -q origin master 2>/dev/null

fails=0
run() { # name expected_exit dir
  local name=$1 exp=$2 dir=$3 out code
  out=$(cd "$dir" && env -i PATH=/usr/bin:/bin HOME="$T/home" DEPLOY_SSH_PASS=dummy bash scripts/deploy.sh --dry-run 2>&1)
  code=$?
  if [ "$code" = "$exp" ]; then printf 'PASS'; else printf 'FAIL'; fails=$((fails + 1)); fi
  printf ' | %-52s | exit=%s (expected %s) | %s\n' "$name" "$code" "$exp" \
    "$(printf '%s' "$out" | grep -m2 -E '✖|⚠|==> Deploying' | tr '\n' ' ' | cut -c1-150)"
}

W=$T/work
run "A clean, HEAD == origin/master"                  0 "$W"
run "B again, leftover .build-sha/.build-time"        0 "$W"
printf 'y\n' >> "$W/app.txt"
run "C modified tracked file"                         1 "$W"
git -C "$W" checkout -q app.txt
mkdir -p "$W/src" && printf 'new\n' > "$W/src/new.ts"
run "D untracked file"                                1 "$W"
rm -rf "$W/src"
g -C "$W" commit -q --allow-empty -m local-only
run "E local commit not pushed"                       1 "$W"
git -C "$W" reset -q --hard origin/master
git clone -q "$T/origin.git" "$T/other" 2>/dev/null
g -C "$T/other" commit -q --allow-empty -m newer && g -C "$T/other" push -q origin master 2>/dev/null
run "F origin/master moved ahead (local is old)"      1 "$W"
git -C "$W" pull -q --ff-only origin master 2>/dev/null
git -C "$W" worktree add -q --detach "$T/wt" origin/master 2>/dev/null
run "G detached worktree at origin/master"            0 "$T/wt"
git -C "$W" remote set-url origin "$T/missing.git"
run "H fetch fails, HEAD == last known origin/master" 0 "$W"
echo "failed: $fails"
[ "$fails" = 0 ]
