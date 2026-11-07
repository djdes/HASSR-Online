# Evidence: ИИ-отчёт на /reports, чек-лист «Готовы к проверке», отзывы с цифрами, план публикации роликов (07.11.2026)

Ветка `claude/serene-mccarthy-rhrl3e` от master `ce5615cc`. Проверка — на текущем коде: production-сборка (`next build`
+ `next start`) на локальном стенде (PostgreSQL 16, база `wesetup_e2e`, демо-данные, локальный приёмник SMTP
`e2e/smtp-sink.cjs` этапа 3). Итог до выкладки: **AC1–AC4 — PASS**, AC5 — ворота до слияния; слияние, выкладка и
прод — в разделе «После выкладки».

| AC | Статус | Доказательство |
| --- | --- | --- |
| AC1 ИИ-отчёт на /reports | PASS (без правок кода) | Ошибка `NextIntlClientProvider was not found` в `AiPeriodReportCard` — только при первой (холодной) компиляции страницы в `next dev`: в журнале стенда этапа 3 одна ошибка перед первым `GET /reports`, следующие 4 открытия чистые. Production-сборка: /reports у управляющего — 200 три раза из трёх, «ИИ-отчёт за период» в HTML сервера, кнопка «Сгенерировать» после гидратации, 0 ошибок в журнале сервера и браузера (`raw/reports-ai-card-investigation.txt`, `raw/reports-prod-probe.json`). Чинить в коде нечего; правка «на всякий случай» не нужна |
| AC2 Чек-лист | PASS | `lib/sanpin-checklist.ts` (7 вопросов: `hygiene`, `cold_equipment_control`, `incoming_control`, `finished_product`, `cleaning`, `disinfectant_usage` — все с основанием 4282-26 в каталоге — и «показать журналы за любой период»; итог, пробелы, текст для показа ≤ 500), `components/public/sanpin-checklist.tsx` (радиогруппы «Да/Нет», итог «N из 7», что добавить со ссылками на /journals-info, «Показать, как закрыть, за 15 минут» — запись на показ `sanpin-checklist` с заполненным «Что показать», «14 дней бесплатно»; цель Метрики `sanpin_checklist` с баллом, один раз), ссылка «Проверить себя за минуту» в шапке страницы. `DemoRequestButton`: вариант `primary`, проп `topic`. Тест `sanpin-checklist.test.ts` (4). Браузер (Pixel 7, production): 4 «да» и 3 «нет» → «Закрыто 4 из 7», пробелы «Гигиенический журнал (сотрудники)», «Журнал бракеража готовой пищевой продукции», «Журналы за любой период…»; в окне записи — «Чек-лист СанПиН: 4 из 7. Не закрыто: …» (`raw/ui-check.txt`, `raw/checklist-*.jpg`). Заявку не отправляли |
| AC3 Отзывы с цифрами | PASS | a) `lib/review-requests.ts` / `.server.ts`, ROOT «Кого попросить об отзыве» (`root/reviews/review-request-candidates.tsx`), `POST /api/root/reviews/request` (requireRoot, gate «support» по префиксу `/api/root/reviews`): старше 21 дня, от 30 записей за 30 дней (без пустых автосозданных строк), без отзыва на проверке/одобренного, не просили 30 дней, есть руководитель с почтой; сначала 4–5 в опросе; письмо — не отписавшимся, отметка `review.requested` в журнале платформы только после отправки. b) `CustomerReview.showStats` (по умолчанию false), галочка в «Баланс и бонусы» и в опросе, оба API, отметка «цифры на сайте» в модерации. c) `lib/review-stats.ts` / `.server.ts` (журналы с записями за 30 дней, записи округлённо «4 300+», месяцы в WeSetup; кэш 10 минут), строка цифр в карточке, блок отзывов на /pricing. Тесты `review-requests.test.ts` (6), `nps-review.test.ts` (+1: отметка доходит только как `true`). Стенд: кандидат «Кафе «Проверка отзывов»» (40 записей, опрос 5 из 5) в списке, «Попросить отзыв» → письмо в приёмнике SMTP, повтор → 409 «Уже просили 07.11.2026 — повторно через 30 дней»; отзыв управляющего с отметкой «цифры» → одобрен → на /pricing и главной «6 журналов в работе · 30 записей» (`raw/ui-check.txt`, `raw/smtp-sink.txt`, `raw/*testimonials*.jpg`, `raw/root-*.jpg`) |
| AC4 План публикации | PASS | `docs/clips-publication-plan.md` (генератор `scripts/landing-video/clips-plan.ts`): пн 9, ср 11, пт 13, пн 16, ср 18 ноября, 12:00 МСК, VK Клипы и Telegram (MAX — по желанию); тексты из `autofillClipCaption(id, platform)`, ссылки `autofillClipUrl` с `utm_source=vk|telegram|max`, `utm_medium=clip`, `utm_campaign=autofill-<сцена>`; как отложить публикацию, что смотреть в «Воронке». `npm run video:render:clips` пишет `-vk/-telegram/-max.txt`. Тест `autofill-clips.test.ts` (6: метки → каналы воронки VK/Telegram/MAX, текст плана совпадает с кодом). Владельцу отправлены план, календарь `.ics` (5 напоминаний за 15 минут) и обновлённый архив роликов с текстами по площадкам |
| AC5 Ворота | до слияния PASS | eslint изменённых — 0 ошибок (`raw/eslint.txt`); `npm run i18n:check` 97/97 (первый прогон поймал разные ICU-аргументы в узбекском — исправлено плюральной формой); `npm run typecheck` EXIT 0 на финальном коде (`raw/typecheck.txt`); `npm run test:gate` 5783/5783 (`raw/test-gate.txt`); целевые тесты 70/70 (`raw/targeted-tests.txt`); `next build` — успешно. Слияние, выкладка и прод — ниже |

## Что нашла проверка и что исправлено до слияния

- Ссылка в письме «Попросить отзыв» вела на `/bonuses` — это «Премии за работу» сотрудников, а форма отзыва
  в «Баланс и бонусы» (`/settings/balance`). Исправлено на `/settings/balance#review`, у формы — якорь
  (spec.md, уточнение).
- Узбекские строки с `{count}` расходились с плюральными русскими по ICU-аргументам — приведены к
  `{count, plural, other {…}}`.
- Тип `ReviewView` получил обязательное `showStats` — тестовые объекты в четырёх тестах дополнены.
- Полный `test:gate`, запущенный одновременно с production-сборкой, уронил два теста маршрутов
  (`inspector/[token]/visits`, `invite/[token]/accept`); отдельно они проходят 13/13, итоговый прогон на свободной
  машине — в `raw/test-gate.txt`.

Скриншоты (`raw/*.jpg`) по правилу `.gitignore` (`.agent/**/*.jpg`) в репозиторий не попадают и остались на
стенде; в git — текстовые журналы и JSON.
