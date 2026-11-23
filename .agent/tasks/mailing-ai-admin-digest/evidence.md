# Evidence

- `node --import tsx --test src/lib/mailing/ai-digest/ai-digest.test.ts` — расписание (вс 23:59 МСК, окно 3 ч, ключ слота), период недели, конфиг и проверка шаблона, задание ИИ, разбор ответа, письмо/короткий текст — PASS (AC2, AC4–AC6).
- Наборы `src/lib/platform-access*.test.ts`, `src/lib/mailing/**`, `src/app/root/mailing/*.test.ts`, `route-slug-collisions` — 214/214 PASS.
- `npm run typecheck` — ошибок в изменённых файлах нет (остальные ошибки — устаревший сгенерированный Prisma-клиент общего node_modules, к задаче не относятся).
- `eslint` по изменённым файлам — чисто.
- Не проверено вживую: локальная БД (127.0.0.1:5433) не запущена — запросы цифр проверены типами Prisma, отправка — после выката.
