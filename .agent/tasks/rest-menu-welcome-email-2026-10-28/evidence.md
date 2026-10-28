# Доказательства — rest-menu-welcome-email-2026-10-28

Ветка `feat/rest-menu-welcome-email` от `origin/master` 23319d62, worktree `D:\wt\qr-point-uv`.

| AC | Итог | Чем подтверждено |
| --- | --- | --- |
| AC1 карточки на «Остальном», правило = guard | PASS | `settings-cards.ts` (5 карточек, группа `work`); `app-nav.test.ts` «правило каждой вкладки и карточки повторяет guard страницы», «каждая вкладка и карточка ведёт на существующую страницу» |
| AC2 пути принадлежат «Остальному» | PASS | `/competencies` убран из `hiddenMatch` «Сотрудников», `/batches` `/losses` `/changes` `/bonuses` — из `hiddenMatch` «Остального» (их держат карточки); тест «путь достаётся разделу…» зелёный |
| AC3 тексты и иконки | PASS | `settings-cards.test.ts` «у каждой карточки есть название и описание во всех языках»; `app-nav.test.ts` «у каждой иконки…» (добавлены `GitBranch`, `GraduationCap`, `TrendingDown`) |
| AC4 план из 5 шагов со ссылками | PASS | `welcome-email.test.ts` (порядок шагов, страницы существуют, ссылки в ru/en/uz); `raw/welcome-ru-720.png` |
| AC5 кнопка и телефон | PASS | `welcome-email.test.ts`: `data-welcome-start` → `/settings/onboarding`, «8 (925) 305-80-77» |
| AC6 языки, экранирование, телефон 390 px | PASS | тест: `<script>` в имени экранирован, нет `{…}` и сырых ключей; `raw/shot.mjs`: прокрутка вбок 0 px на 720 и 390 px (`raw/welcome-ru-390.png`) |
| AC7 проверки | PASS* | `npm run typecheck` — 0 ошибок; eslint изменённых файлов — 0; `npm run i18n:check` 95/95 (после `i18n:types`; в Windows-чекауте confirm/errors с CRLF — известное); `npm run test:gate`: падения — message-contract и prewarm-routes (известные Windows), `inspector/[token]/visits` — флак под нагрузкой (отдельно 10/10 дважды, правка его не касается) |

Не проверено: живой показ `/more` в браузере (данные карточек проверены тестами, страница
рисует их общим `SectionSettingsPage`); письмо на реальный ящик — только превью HTML.
