#!/usr/bin/env bash
# Runs npm run test:ci и сравнивает с baseline в tests/.legacy-failures.txt.
# Exit 0 if:
#   - 0 fails (победа), или
#   - все fails именно те что в baseline (никаких новых)
# Exit 1 if появился НОВЫЙ fail (регрессия).
#
# Используется в pre-commit + CI.

set -uo pipefail

BASELINE="tests/.legacy-failures.txt"

# Запускаем tests, ловим все строки `not ok` (TAP)
# TEST_SHARD=i/N — только i-я часть файлов: CI делит тесты на параллельные
# job'ы. Флаг стоит ДО шаблона файлов: после него node молча гоняет всё.
if [ -n "${TEST_SHARD:-}" ]; then
  OUTPUT=$(node --import tsx --test --test-reporter=tap --test-shard="$TEST_SHARD" "src/**/*.test.ts" 2>&1 || true)
else
  OUTPUT=$(npm run test:ci 2>&1 || true)
fi

# Извлекаем список fail'ов (имена после "not ok N - ")
ACTUAL_FAILS=$(echo "$OUTPUT" | grep -E '^# Subtest:' -A 0 || true)
# Альтернативно из TAP: not ok строки
ACTUAL_FAILS=$(echo "$OUTPUT" | grep -E '^not ok' | sed -E 's/^not ok [0-9]+ - //' | sort -u)
PASS_COUNT=$(echo "$OUTPUT" | grep -E '^# pass ' | tail -1 | awk '{print $3}')
FAIL_COUNT=$(echo "$OUTPUT" | grep -E '^# fail ' | tail -1 | awk '{print $3}')

if [ -z "${PASS_COUNT:-}" ]; then
  echo "✗ Не удалось извлечь stats из test runner output. Прервать."
  echo "$OUTPUT" | tail -30
  exit 1
fi

echo ""
echo "=== Test stats: pass=$PASS_COUNT, fail=$FAIL_COUNT ==="

if [ "$FAIL_COUNT" -eq 0 ]; then
  echo "✓ Все тесты прошли."
  exit 0
fi

# Считаем сколько fail'ов есть в baseline
EXPECTED_LINES=$(grep -v '^#' "$BASELINE" 2>/dev/null | grep -v '^$' || true)
EXPECTED_COUNT=$(echo "$EXPECTED_LINES" | grep -c . || echo 0)

# Какие из ACTUAL_FAILS НЕТ в baseline (= новые регрессии)?
NEW_FAILS=$(comm -23 <(echo "$ACTUAL_FAILS") <(echo "$EXPECTED_LINES" | sort -u) || true)

if [ -n "$NEW_FAILS" ]; then
  echo ""
  echo "✗ НОВЫЕ регрессии (нет в baseline):"
  echo "$NEW_FAILS" | sed 's/^/  - /'
  echo ""
  echo "Если эти fails ожидаемы — добавьте в tests/.legacy-failures.txt."
  echo "Если регрессии — почините код."
  exit 1
fi

echo "✓ $FAIL_COUNT fails — все в baseline (legacy). Регрессий нет."
exit 0
