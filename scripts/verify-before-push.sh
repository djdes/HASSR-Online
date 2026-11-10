#!/usr/bin/env bash
# Быстрая проверка перед push: инкрементальный typecheck + таргетированные тесты
# по графу импортов (scripts/test-changed.mjs, с авто-эскалацией до полного
# набора при изменении ядра или >25 файлов).
# Для принудительного полного прогона всех 904 файлов: VERIFY_FULL=1 npm run verify
set -uo pipefail

fail=0

echo "=== Type-check ==="
tsc_out="$(npm run typecheck 2>&1 || true)"
src_errors="$(printf '%s\n' "$tsc_out" | grep -E '^src/.*error TS' || true)"
if [ -n "$src_errors" ]; then
  printf '%s\n' "$src_errors"
  echo "ОШИБОК В src/: $(printf '%s\n' "$src_errors" | wc -l)"
  fail=1
else
  echo "чисто"
fi

echo
echo "=== Tests (targeted gate) ==="
if [ "${VERIFY_FULL:-0}" = "1" ]; then
  TEST_FULL=1 bash scripts/test-with-baseline.sh || fail=1
else
  node scripts/test-changed.mjs || fail=1
fi

echo
if [ "$fail" -ne 0 ]; then
  echo "НЕ ПУШИТЬ: проверки не прошли."
  exit 1
fi
echo "Можно пушить."
