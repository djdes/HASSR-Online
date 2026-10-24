# Поток 1 — WeSetup (основное приложение)

> Этот файл — задание для одного из трёх параллельных чатов. Работаешь только с файлами из секции «Зоны ответственности», не лезешь в bot и tasksflow — они в других потоках.

---

## Что такое WeSetup

**WeSetup** (он же HACCP-Online) — Next.js 16 SaaS для электронных журналов СанПиН/ХАССП на пищевом производстве: рестораны, столовые, кухни, мясокомбинаты. Заменяет бумажные журналы (температурный, дезинфекции, медкнижки, гигиена, отбраковка и ещё ~30 типов) электронными формами с фото-евиденцией, аудит-логом и автоматическими отчётами для РПН/Роспотребнадзора.

**Прод:** https://wesetup.ru (Next.js 16 на PM2 порту 3002, deploy через GitHub Actions на push в master).
**Репо:** `https://github.com/djdes/HACCP-Online.git` (remote `origin`).
**БД:** PostgreSQL + Prisma (схема в `prisma/schema.prisma`, ~870 строк).
**Auth:** NextAuth.js JWT, три уровня (ROOT / management / staff).
**Multi-tenancy:** все business-данные scoped по `organizationId`.

## Параллельная работа в три потока

Сейчас идут одновременно три чата:
- **Поток 1 (этот) — WeSetup core.** Дашборд, журналы, отчёты, settings, AI, billing.
- **Поток 2 — TasksFlow integration.** Отдельная репа `tasksflow` (https://github.com/djdes/TasksFlow.git) — синхронизация задач, escalations, адаптеры.
- **Поток 3 — Telegram Bot / Mini App.** Та же репа `origin`, но папки `src/app/mini`, `src/app/api/telegram`, `src/app/api/mini`, `src/lib/telegram.ts`.

Конфликтов merge быть не должно — каждый поток работает в своих папках. **Если случайно тронешь чужую зону — откатывай и согласуй через master.**

## Зоны ответственности (только эти файлы можно править)

```
src/app/(auth)/                       # login, register, invite
src/app/(dashboard)/                  # все защищённые страницы кроме mini
src/app/(root)/                       # ROOT-only (если есть)
src/app/api/auth/                     # NextAuth
src/app/api/journals/                 # field-based журналы
src/app/api/journal-documents/        # document-based журналы
src/app/api/reports/
src/app/api/settings/                 # subscription, partner, goals, webhooks, audit, organization, etc.
src/app/api/capa/
src/app/api/staff/
src/app/api/ai/                       # generate-sop, haccp-plan, translate, period-report, sanpin-chat, check-photo
src/app/api/cron/                     # все cron'ы кроме mini-digest и shift-watcher (это бот)
src/app/api/inspector/
src/app/api/certificate/
src/app/api/external/sensors/         # IoT-trigger
src/app/api/onboarding/
src/app/api/feedback/
src/app/api/payments/
src/app/api/public/                   # inn-lookup и пр.
src/app/api/health/
src/app/api/root/                     # ROOT API
src/components/dashboard/
src/components/journals/
src/components/landing/
src/components/ui/
src/lib/                              # КРОМЕ telegram.ts (поток 3) и tasksflow-adapters/* (тоже было поток 3 раньше, но эти адаптеры → поток 2 для нового кода)
prisma/schema.prisma                  # ОСТОРОЖНО — миграции согласовывать с другими потоками
```

## Бэклог фич для этого потока

### Приоритет 1 — критичное / в незакрытом MANUAL-статусе после QA-loop

1. **A7 auto-fill HH:MM в time-полях** (F-009) — UI-чек: открыть журнал с time-полем, убедиться что при tap'е сразу подставляется текущее время.
2. **J8 «Что нового» модалка** (F-013) — проверить что показывается один раз после нового deploy и не маячит на каждом visit.
3. **J4 print stylesheet + E7 compare-mode** (F-015) — открыть `/reports`, нажать Cmd+P; убедиться что print-вью читаемый. Compare-mode — сравнение двух периодов.
4. **J5 ⌘K command palette** (F-017) — открыть на dashboard, проверить что fuzzy-search по журналам работает и переходы по Enter.
5. **B5 пофамильный аудит + F5 progress-bar + H10 ROI calc** (F-018) — три виджета на `/reports`: проверить что считают по AuditLog/JournalEntry без N+1.
6. **B3 auto-block при просрочке медкнижки + E1 line-chart** (F-020) — staff с просроченной медкнижкой больше 7 дней не должен мочь логиниться (или редирект на «обнови медкнижку»).
7. **D8 glow-loader + L9 auto-classify writeoff + L5 product-suggest + J7 focus deep-link** (F-022) — четыре маленьких UX-фичи, проверить каждую отдельно.
8. **«Закрытый день» — read-only записей за прошедшие дни** (F-052) — `src/lib/closed-day.ts` есть, но нужно проверить что middleware/UI блокирует POST/PATCH на entries старше N дней.
9. **Self-audit виджет «Здоровье настройки»** (F-059) — на dashboard карточка с зелёными/красными чек-боксами: «настроена RSS», «есть medbook у всех», «есть hot/cold журнал», и т.д.
10. **Nag-модалка про просроченные CAPA** (F-060) — модалка на dashboard для management если есть открытые CAPA старше 7 дней.

### Приоритет 2 — новые идеи

11. **Экспорт «Готовый пакет к проверке РПН»** — кнопка в `/settings/rpn-appendix` собирает один ZIP: ХАССП-план PDF + последние 30 дней журналов CSV + список сертификатов сотрудников + AuditLog. Сейчас это разнесено по 3 эндпоинтам — собрать в один.
12. **Bulk-операции в `/staff`** — multi-select сотрудников и групповые действия: выдать роль, отозвать ACL, заблокировать, импортировать из 1С/CSV.
13. **Журналы-templates marketplace** — внутренний каталог готовых шаблонов журналов от ROOT (например, «журнал отбраковки для пиццерий»), которые owner организации может «установить» одним кликом.
14. **Авто-наполнение из прошлой записи + smart-default** — кнопка «как вчера» уже есть, но добавить автозаполнение fields на основе медианы за последние 7 дней (для t°, веса, объёма).
15. **Email-дайджест для owner-а** — раз в неделю: «у вас 3 просроченных CAPA, средний % заполнения 87%, 2 сотрудника с истекающей медкнижкой». Сейчас weekly-digest есть, но нужен per-org tailored.
16. **Двухфакторка для owner / inspector** — TOTP через `otpauth://`, QR в `/settings/security`. Без e-mail OTP, чисто authenticator app.
17. **«Режим инспектора» для owner-а** — owner может дать одноразовую ссылку с read-only доступом инспектору на 24 часа без создания user-аккаунта.
18. **Темная тема + системная** — toggle в `/settings`, persist в localStorage + cookie для SSR.
19. **i18n базовый — UA / KZ / EN** — для трансграничных франшиз. Только UI-строки, журналы остаются по-русски.
20. **PDF-watermark «черновик»** на любых отчётах если AuditLog показывает unfinished entries в периоде.

### Приоритет 3 — техдолг / DX

21. **Миграция `(dashboard)` layout на server-side cache invalidation** — сейчас многие места дёргают БД на каждый запрос; вынести в `unstable_cache` с теговой ревалидацией.
22. **`prisma generate` в CI** — сейчас если забыл `npx prisma generate` локально, build на проде падает с outdated client. Добавить hook в `predev`/`prebuild`.
23. **Test-suite для journal-acl.ts** — критичная функция, должна быть покрыта unit-тестами (vitest). Сейчас покрытие 0%.
24. **Sentry или альтернатива** — централизованный errors logging. Сейчас всё в console + AuditLog.
25. **Storybook для components/ui** — для visual regression testing нового дизайна.

## Правила деплоя

1. После каждой самостоятельной фичи: `git add <files>; git commit -m "<рус>"; git push origin master`.
2. Деплой автоматический через GitHub Actions (`.github/workflows/deploy.yml`). Между push'ами **жди готовности предыдущего deploy** (Monitor `.build-sha == HEAD`), иначе SCP коллизит.
3. Перед коммитом: `npx tsc --noEmit --skipLibCheck` + `npm run lint`.
4. На прод — только код из master (AGENTS.md → «Production deploy rules»). Если деплой сломался, запусти Actions → Deploy to production → Run workflow с веткой master. Старые прогоны не перезапускай: Re-run выкатывает их старый коммит. По SSH на проде — только код текущего origin/master, никаких правок и сборок другого кода.

## Не делай

- Не правь `src/app/mini/*`, `src/app/api/mini/*`, `src/app/api/telegram/*`, `src/lib/telegram.ts` — это поток 3.
- Не правь `src/lib/tasksflow-adapters/*` без согласования с потоком 2.
- Не делай миграций без `npx prisma db push` локально и согласования (миграции shared между потоками 1 и 3).
- Не пушь без type-check.
- Не force-push в master.
