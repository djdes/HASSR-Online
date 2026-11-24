#!/usr/bin/env bash
# Production after a deploy, read-only and without signing in: commit, pages, list CSS, removed workload API.
# Usage: bash .agent/tasks/owner-ui-11-2026-11-23/e2e/post-deploy-check.sh [https://wesetup.ru] [expected commit]
#
# A request that gets no HTTP answer at all (curl code 000: the connection was reset or dropped on the way,
# e.g. by the checker's own network) is retried up to 5 times. Any HTTP answer, an error included, is final.
set -u
BASE="${1:-https://wesetup.ru}"
EXPECT="${2:-}"
UA="WeSetup-post-deploy-check/1.0"
TRIES=5
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
pass=0; fail=0
ok() { echo "PASS $1"; pass=$((pass + 1)); }
bad() { echo "FAIL $1"; fail=$((fail + 1)); }

# fetch METHOD PATH OUT -> sets CODE and TRY; the body goes to OUT.
fetch() {
  local method="$1" path="$2" out="$3"
  for TRY in $(seq 1 "$TRIES"); do
    CODE=$(curl -s -o "$out" -w "%{http_code}" --max-time 60 -A "$UA" -X "$method" "$BASE$path")
    [ "$CODE" != "000" ] && return 0
    sleep 3
  done
}
note() {
  if [ "$CODE" = "000" ]; then echo " (сеть не довезла ответ ни за одну из $TRY попыток)"
  elif [ "$TRY" -gt 1 ]; then echo " (с попытки $TRY: до этого сеть не довезла ответ)"; fi
}

fetch GET /api/build-info "$TMP/info"
info=$(cat "$TMP/info")
echo "build-info: $info$(note)"
if [ -n "$EXPECT" ]; then echo "$info" | grep -q "$EXPECT" && ok "прод на коммите $EXPECT" || bad "прод не на $EXPECT"; fi

for path in / /login /features; do
  fetch GET "$path" "$TMP/page"
  [ "$CODE" = "200" ] && ok "$path — 200$(note)" || bad "$path — $CODE$(note)"
done

fetch GET /login "$TMP/login"
sheet=0; base=0; files=0
for href in $(grep -oE 'href="/_next/static/[^"]+\.css"' "$TMP/login" | sed 's/href="//;s/"$//' | sort -u); do
  fetch GET "$href" "$TMP/css"
  [ "$CODE" = "200" ] || { bad "CSS $href — $CODE"; continue; }
  files=$((files + 1))
  grep -q 'wesetup-select-sheet-in' "$TMP/css" && sheet=$((sheet + 1))
  grep -q 'appearance:base-select' "$TMP/css" && base=$((base + 1))
done
echo "CSS-файлов на /login: $files"
[ "$sheet" -ge 1 ] && ok "CSS: лист снизу для списков на телефоне" || bad "CSS: нет листа списков"
[ "$base" -ge 1 ] && ok "CSS: стиль нативных списков (base-select)" || bad "CSS: нет base-select"

fetch PUT /api/settings/journal-difficulty "$TMP/api"
case "$CODE" in 404|405) ok "API сложности журналов удалён ($CODE)$(note)";; *) bad "API сложности журналов отвечает $CODE$(note)";; esac

echo "pass=$pass fail=$fail"
[ "$fail" -eq 0 ]
