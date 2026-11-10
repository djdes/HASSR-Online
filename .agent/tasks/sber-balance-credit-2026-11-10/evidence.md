# Evidence
- Юнит-тесты: `node --import tsx --test src/lib/sber/*.test.ts src/lib/balance/*.test.ts` — все зелёные
  (balance-credit.test.ts покрывает AC1–AC3 и дату запуска).
- `npm run typecheck` — без ошибок в изменённых файлах (ошибки только про отсутствующие в общей node_modules
  пакеты imapflow/telegram/api-anything чужих модулей).
- Пробный прогон на проде не выполнен: запуск скрипта на сервере не разрешён автоматической проверкой прав;
  вместо него — отсечка STATEMENT_CREDIT_FROM = 2026-11-10.
