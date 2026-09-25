# /claude-api prompt-audit — правила и промпты WeSetup под новый Opus (2026-09-26)

## Допущения (Step 0)
- **Цель — Claude Opus 5.5**: «новый опус» из задачи владельца; на нём сейчас работают сессии Claude Code на этой машине. Промпты сайта исполняет воркер диспетчера с `--model sonnet` (Sonnet 5): для них цель — Sonnet, правки только предлагаются.
- **Охват**: правила агентов — `D:\www\Wesetup.ru\CLAUDE.md` (вне git, `.gitignore`), `AGENTS.md` (в git), `.claude/skills/*` и `.claude/agents/*` (вне git); промпты сайта — `src/lib/ai-vision/instructions.ts`, `src/lib/ai-assistant/job-text.ts`, `src/lib/assistant/prompt.ts`, `src/app/api/ai/*`, `src/app/api/capa/[id]/suggest`, `src/app/api/cron/weekly-ai-digest`, системные промпты в `dispatcher/wesetup-worker.ps1`. `.cursorrules` и `.codex/agents/*` — для других инструментов, вне охвата.
- Провайдеры, кроме Anthropic, в промптах не найдены; `@anthropic-ai/sdk` остался в `package.json`, но сайт им больше не пользуется.

## Итог
- Находок: группа 1 (устаревший текст) — 6, группа 2 (правила/скилы) — 7, группа 4 (конфиг и состав агентов) — 2, пометки без правки — 6.
- Самое важное:
  1. **154 агента в `.claude/agents`** (коллекция VoltAgent: angular, blockchain, cpp, kubernetes, wordpress…). Их описания попадают в каждую сессию Wesetup, это налог на токены и шум при выборе агента. Оставить около 19 для этого стека, остальные убрать в архив.
  2. **Устаревшая копия скила `anthropic-claude-api`** (2026-04-18) требует «ALWAYS use claude-opus-4-7 … non-negotiable» и спорит со встроенным актуальным `claude-api`. Убрать в архив.
  3. **Неверные факты в CLAUDE.md и AGENTS.md**, из-за которых сессия делает не то:
     - «Что нового» показывается по отпечатку текста, а не по SHA;
     - база — Postgres на 5432, а не PGlite;
     - `src/proxy.ts` вместо `middleware.ts`;
     - путь репозитория `D:`, а не `C:`;
     - в AGENTS.md: «нет автотестов, запускать вручную» при хуках с typecheck и тестами;
     - SMTP-переменные.

## Находки (по убыванию уверенности)

| # | Где | Что написано | Паттерн | Почему устарело для Opus 5.5 | Увер. | Действие |
|---|---|---|---|---|---|---|
| 1 | `.claude/agents/*` (154 файла, 1,3 МБ) | «140 VoltAgent specialists plus task-proof-loop agents» | Гр. 4 — лишние специалисты; гр. 3 — каталог из 30+ всегда загруженных | Описание каждого агента едет в каждом запросе. Дубли (`code-reviewer` и `everything-code-reviewer`) и чужой стек мешают выбору | Высокая | Оставить `task-spec-freezer`, `task-builder`, `task-verifier`, `task-fixer`, `code-reviewer`, `debugger`, `nextjs-developer`, `react-specialist`, `typescript-pro`, `postgres-pro`, `security-auditor`, `accessibility-tester`, `ui-designer`, `qa-expert`, `seo-specialist`, `performance-engineer`, `payment-integration`, `design-bridge`, `ai-writing-auditor`; остальное → `.claude/references/agents-archive/` |
| 2 | `.claude/skills/anthropic-claude-api/SKILL.md:30,173` | «ALWAYS use `claude-opus-4-7` … This is non-negotiable» | Гр. 2 — устаревшие факты об API | Копия от 2026-04-18 с таблицей моделей того времени; встроенный скил `claude-api` актуален (Opus 5 / 5.5) | Высокая | Убрать в `.claude/references/skills-archive/` |
| 3 | `CLAUDE.md:199-213, 224-225` | «Обновить `LATEST_NOTES_BUILD_SHA`…», «Modal привязан к … `last-seen-build-sha`», `{ category, icon, items[] }` | Гр. 2 — неверный факт | В коде показ зависит от `whatsNewVersion` (отпечаток текста), SHA «ни на что не влияет», иконок в данных нет. Модель выполнит устаревший ритуал | Высокая | Переписать (см. diff) |
| 4 | `CLAUDE.md:309-311, 573-575, 639-643` | PGlite на 5433 «default dev» и раздел про проблемы PGlite | Гр. 2 | `.env.shared`: Postgres `localhost:5432` | Высокая | Переписать и убрать раздел PGlite |
| 5 | `CLAUDE.md:344, 388, 396, 398, 558` | `(root)/`, «email.ts (Resend)», `middleware.ts`, «870+ lines» | Гр. 2 | В Next 16 это `src/proxy.ts`, папка `root/`, отправка через nodemailer, схема больше 3700 строк | Высокая | Исправить |
| 6 | `CLAUDE.md:273` | `safe.directory C:/www/Wesetup.ru` | Гр. 2 | Репозиторий лежит в `D:\www\Wesetup.ru` | Высокая | Исправить путь |
| 7 | `CLAUDE.md:694-699`, `AGENTS.md:219-229` | Только `tsc` и `lint`; «No automated CI test suite… run manually» | Гр. 2 + «добавить» | Есть `npm run typecheck`, `npm test`, `test:gate`, хуки pre-commit и pre-push, деплой падает на typecheck | Высокая | Добавить команды и хуки |
| 8 | `AGENTS.md:62, 68, 120, 275` | `@anthropic-ai/sdk`, `c:\www\Wesetup.ru`, `middleware.ts`, `EMAIL_SERVER_*` | Гр. 2 | ИИ работает через очередь диспетчера; путь, proxy и SMTP-переменные изменились | Высокая | Исправить |
| 9 | `CLAUDE.md` (новое) | — | Гр. 1e / «добавить» | Сбой воспроизводился в этой же работе: субагенты коммитили с `--no-verify` | Высокая | Добавить: «хуки не обходим» |
| 10 | `CLAUDE.md:149-154` | «обязательно вызывать… Skills не optional» | Гр. 1a — давление, принудительный вызов | Текущие модели сами берут подходящий инструмент; приказ ведёт к лишнему процессу в простых задачах | Средняя | Переписать: «бери, когда помогает» |
| 11 | `CLAUDE.md:672-682`, `AGENTS.md:294-296` | «At the start of every session, check…», «invoke … before acting», «brainstorming first» | Гр. 1a/1c — ритуал | Модель планирует без ритуала; осталось одно настоящее ограничение — единая дизайн-система | Средняя | Переписать, оставив дизайн-систему с причиной |
| 12 | `CLAUDE.md:10-14, 245` | «**ВАЖНО:** … **ОБЯЗАТЕЛЬНО**» | Гр. 1a — капс | Opus 5.5 точно следует тексту и нормальной громкости; причина уже рядом | Средняя | Обычный тон, причину оставить |
| 13 | `CLAUDE.md:263` | Пример `git commit -m "feat: short description"` | Гр. 1c — пример сильнее правила | Пример противоречит правилу «коммиты по-русски»: модель повторяет пример | Средняя | Пример на русском |
| 14 | `CLAUDE.md:239-241` | Повтор «после деплоя… обязательно обновляй» | Гр. 1c — повтор для усиления | Одно правило дважды разными словами | Средняя | Слито с п. 3 |
| 15 | `CLAUDE.md:404-483` | «Detailed File Descriptions» | Гр. 2 — модель может узнать сама, текст гниёт | Пофайловые описания устарели (например, «mini/documents — No tables»), код читается напрямую | Средняя | Удалить раздел (архитектура, Data Flow и Key Behaviors остаются) |
| 16 | `.claude/skills/everything-clickhouse-io`, `everything-project-guidelines-example` | ClickHouse; «пример» правил | Гр. 2 | ClickHouse в стеке нет; пример чужого проекта — не правила WeSetup | Средняя | В архив |

### Пометки без правки
- `CLAUDE.md:7` «Утверждены 2026-05-09…» — история, но это провенанс принципов; оставить.
- `CLAUDE.md:749-781` блок repo-task-proof-loop («If init just created…») — генерируется инструментом, правка затрётся при переинициализации.
- `CLAUDE.md:270, 646-647` — «scratch files seen before», «Background tasks may timeout after 900s»: похоже на одноразовые случаи, проверить при следующей чистке.
- Сайт, `src/app/api/cron/weekly-ai-digest/route.ts:33` — «(150–200 слов)» (гр. 1f, числовой потолок). Лучше описать цель: «руководитель читает с телефона за полминуты». Меняет вывод продукта, поэтому только после проверки на реальных данных.
- Сайт: «Ты — технолог-консультант с 20 годами опыта» и похожие — короткая роль с контекстом задачи; не находка.
- Сайт: «строго один JSON» (`job-text.ts:85`, `instructions.ts:170`) — транспорт `claude -p` без structured outputs, формат несущий. Оставить; разбор ответа устойчивый (`parse.ts`).
- Сайт: «Не выдумывай» / «НИКОГДА не выдумывай значения измерений» — держим: 2026-09-25 модель выдумала названия на нечитаемом фото, а выдуманные замеры в журнале — нарушение.

## Что применено
- `AGENTS.md` (в git): находки 7, 8, 11 — коммит в master вместе с остальными задачами.
- `CLAUDE.md` и `.claude/*` лежат вне git в рабочей копии `D:\www\Wesetup.ru`. Правки подготовлены: `CLAUDE.md.new` / `CLAUDE.md.diff` и скрипт `apply-claude-rules.ps1`. Применяет сессия Wesetup в своей копии.

## Проверка (Step 7)
- Правки CLAUDE.md и AGENTS.md — факты, сверенные с кодом (`src/proxy.ts`, `.env.shared`, `package.json`, `.husky/*`, `whats-new-notes.ts`), поведенческих рисков нет.
- Архив агентов и скилов обратим: файлы переносятся, не удаляются.
