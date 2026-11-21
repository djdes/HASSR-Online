#!/usr/bin/env bash
# End-to-end scenarios of the directory exchange, the multi-organization series and the new features of
# 21.11.2026 (new-features-check: acceptance hints, Poster, brakerage suggestions, QES), DB level, no
# browser: each one builds its own organizations in the database of DATABASE_URL, checks, and
# cleans up after itself. Runs them one after another, prints a summary and exits non-zero if any
# scenario failed (non-zero exit, timeout or crash).
#
#   npm run e2e:exchange                          # all of them
#   bash scripts/e2e/run-all.sh pool-check ...    # only these
#
# Nightly in GitHub Actions: .github/workflows/nightly-e2e.yml. Never point it at production.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# tsx resolves the `@/` alias from tsconfig.json of the current directory.
cd "$ROOT"

SCENARIOS=(
  part2-exchange-check
  background-check
  locked-check
  reminder-check
  skips-check
  balance-check
  root-org-trial-check
  transfer-undo-check
  cabinet-code-check
  multi-company-check
  part3-foreign-check
  pool-check
  versioning-check
  new-lists-check
  manager-check
  pay-from-account-check
  period-digest-check
  cleanup-check
  product-batch-check
  new-features-check
)
if [ "$#" -gt 0 ]; then
  SCENARIOS=("$@")
fi
# One scenario must not eat the whole job: a hung one is a failure.
PER_SCENARIO_TIMEOUT="${E2E_TIMEOUT_SECONDS:-900}"

LOG_DIR="$(mktemp -d)"
trap 'rm -rf "$LOG_DIR"' EXIT

SUMMARY=()
FAILED=0
CHECKS_PASSED=0
CHECKS_FAILED=0
STARTED=$(date +%s)
for name in "${SCENARIOS[@]}"; do
  file="scripts/e2e/${name}.ts"
  if [ ! -f "$file" ]; then
    SUMMARY+=("FAIL  ${name}: no such scenario (${file})")
    FAILED=$((FAILED + 1))
    continue
  fi
  echo
  echo "================ ${name} ================"
  begin=$(date +%s)
  timeout --kill-after=30 "$PER_SCENARIO_TIMEOUT" npx tsx "$file" 2>&1 | tee "$LOG_DIR/${name}.log"
  code=${PIPESTATUS[0]}
  seconds=$(( $(date +%s) - begin ))
  # Every scenario prints one «PASS …» / «FAIL …» line per check.
  checks_passed=$(grep -c '^PASS ' "$LOG_DIR/${name}.log")
  checks_failed=$(grep -c '^FAIL ' "$LOG_DIR/${name}.log")
  CHECKS_PASSED=$((CHECKS_PASSED + checks_passed))
  CHECKS_FAILED=$((CHECKS_FAILED + checks_failed))
  if [ "$code" -eq 0 ] && [ "$checks_failed" -eq 0 ] && [ "$checks_passed" -gt 0 ]; then
    SUMMARY+=("PASS  ${name} (${seconds}s): ${checks_passed} checks passed")
  else
    reason="exit code ${code}"
    [ "$code" -eq 124 ] && reason="timeout after ${PER_SCENARIO_TIMEOUT}s"
    [ "$code" -eq 0 ] && reason="no checks ran or a check failed"
    SUMMARY+=("FAIL  ${name} (${seconds}s, ${reason}): ${checks_passed} passed, ${checks_failed} failed")
    FAILED=$((FAILED + 1))
  fi
done

echo
echo "================ summary ================"
printf '%s\n' "${SUMMARY[@]}"
echo "scenarios: ${#SCENARIOS[@]}, passed: $(( ${#SCENARIOS[@]} - FAILED )), failed: ${FAILED}; checks: ${CHECKS_PASSED} passed, ${CHECKS_FAILED} failed; time: $(( $(date +%s) - STARTED ))s"
if [ "$FAILED" -gt 0 ]; then
  echo "RESULT: ${FAILED} scenario(s) failed"
  exit 1
fi
echo "RESULT: all scenarios passed"
