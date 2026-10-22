#!/usr/bin/env sh
# Тесты рядом с изменёнными (staged) файлами: сам *.test.ts или foo.ts → foo.test.ts.
# Быстрый локальный фильтр для pre-commit; полный набор гоняет CI.
tests=""
for f in $(git diff --cached --name-only --diff-filter=ACM | grep -E '\.(ts|tsx)$'); do
  case "$f" in
    *.test.ts) [ -f "$f" ] && tests="$tests $f" ;;
    *) base="${f%.*}"; [ -f "$base.test.ts" ] && tests="$tests $base.test.ts" ;;
  esac
done
tests=$(printf '%s\n' $tests | sort -u | tr '\n' ' ')
if [ -z "$(echo "$tests" | tr -d ' ')" ]; then
  echo "→ Тестов рядом с изменениями нет — проверит CI."
  exit 0
fi
echo "→ Тесты рядом с изменениями:$tests"
node --import tsx --test $tests
