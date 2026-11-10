#!/usr/bin/env sh
# Тесты, связанные со staged-файлами (сам *.test.ts, foo.ts / foo.server.ts → foo.test.ts,
# и прямые обратные импорты 1-го уровня). Вызывается из .husky/pre-commit.
exec node scripts/test-changed.mjs --staged
