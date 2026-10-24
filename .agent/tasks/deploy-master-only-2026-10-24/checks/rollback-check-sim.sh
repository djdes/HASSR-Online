#!/usr/bin/env bash
# Runs the deploy.yml step «Не откатывать прод на старый коммит» exactly as
# written in the workflow, with fake `curl` and `gh`, across the scenarios of
# AC3. Usage: bash checks/rollback-check-sim.sh [path/to/deploy.yml]
set -u
WF=${1:-.github/workflows/deploy.yml}
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
mkdir -p "$T/bin"

python3 -I - "$WF" "$T/step.sh" <<'PY'
import sys, yaml
d = yaml.safe_load(open(sys.argv[1]))
step = [s for s in d["jobs"]["deploy"]["steps"] if s.get("name") == "Не откатывать прод на старый коммит"][0]
open(sys.argv[2], "w").write(step["run"])
PY

cat > "$T/bin/curl" <<'EOF'
#!/usr/bin/env bash
[ "${FAKE_CURL_FAIL:-0}" = 1 ] && { echo "curl: (22) The requested URL returned error: 429" >&2; exit 22; }
printf '%s' "$FAKE_BUILD_INFO"
EOF
cat > "$T/bin/gh" <<'EOF'
#!/usr/bin/env bash
# gh api repos/R/compare/BASE...HEAD --jq .status
echo "gh $*" >> "$FAKE_LOG"
path="$2"; head="${path##*...}"
[ "${FAKE_GH_FAIL:-0}" = 1 ] && { echo '{"message":"Not Found","status":"404"}'; echo "gh: Not Found (HTTP 404)" >&2; exit 1; }
if [ "$head" = "master" ]; then echo "$FAKE_STATUS_MASTER"; else echo "$FAKE_STATUS_INCOMING"; fi
EOF
chmod +x "$T/bin/"*

fails=0
run() { # name expected_exit env...
  local name=$1 exp=$2 out code
  shift 2
  : > "$T/gh.log"
  # GitHub runs `run:` steps with `bash -e`.
  out=$(env -i PATH="$T/bin:/usr/bin:/bin" HOME="$T" FAKE_LOG="$T/gh.log" \
    GITHUB_REPOSITORY=djdes/HASSR-Online GITHUB_SHA=aaaaaaaa1111111111111111111111111111aaaa \
    PROD_URL=https://wesetup.ru GH_TOKEN=x "$@" bash -e "$T/step.sh" 2>&1)
  code=$?
  if [ "$code" = "$exp" ]; then printf 'PASS'; else printf 'FAIL'; fails=$((fails + 1)); fi
  printf ' | %-56s | exit=%s (expected %s) | gh calls: %s\n    %s\n' "$name" "$code" "$exp" \
    "$(wc -l < "$T/gh.log")" "$(printf '%s' "$out" | tr '\n' ' ' | cut -c1-200)"
}

BI='{"buildId":"1644384","buildTime":"x","fullBuildId":"16443845556ede621dbb241898b9c5086710fd4e"}'
run "1 incoming newer than prod (ahead)"                    0 FAKE_BUILD_INFO="$BI" FAKE_STATUS_INCOMING=ahead
run "2 same commit (identical, re-run of latest)"           0 FAKE_BUILD_INFO="$BI" FAKE_STATUS_INCOMING=identical
run "3 re-run of old run: behind, prod commit in master"    1 FAKE_BUILD_INFO="$BI" FAKE_STATUS_INCOMING=behind FAKE_STATUS_MASTER=ahead
run "4 behind, prod == master tip"                          1 FAKE_BUILD_INFO="$BI" FAKE_STATUS_INCOMING=behind FAKE_STATUS_MASTER=identical
run "5 behind, prod not in master (rewound master/branch)"  0 FAKE_BUILD_INFO="$BI" FAKE_STATUS_INCOMING=behind FAKE_STATUS_MASTER=behind
run "6 behind, prod diverged from master"                   0 FAKE_BUILD_INFO="$BI" FAKE_STATUS_INCOMING=behind FAKE_STATUS_MASTER=diverged
run "7 incoming diverged from prod"                         0 FAKE_BUILD_INFO="$BI" FAKE_STATUS_INCOMING=diverged
run "8 GitHub API error (404 body on stdout)"               0 FAKE_BUILD_INFO="$BI" FAKE_GH_FAIL=1
run "9 site unreachable / 429"                              0 FAKE_CURL_FAIL=1
run "10 site reports dev build"                             0 FAKE_BUILD_INFO='{"buildId":"dev","fullBuildId":"dev"}'
run "11 site returns HTML instead of JSON"                  0 FAKE_BUILD_INFO='<html>oops</html>'
run "12 only short buildId, behind + in master"             1 FAKE_BUILD_INFO='{"buildId":"1644384"}' FAKE_STATUS_INCOMING=behind FAKE_STATUS_MASTER=ahead
echo "failed: $fails"
[ "$fails" = 0 ]
