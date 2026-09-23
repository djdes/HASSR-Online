# Evidence — landing-qr-player-2026-09

Дата: 2026-09-23. Стенд: dev http://localhost:3025. Скриншоты — `shots/`, сырой лог Playwright — `verify.log`, `verify-results.json`, скрипт — `verify.mjs`.

## Итог по AC

| AC | Статус | Доказательство |
|----|--------|----------------|
| AC1 | PASS | `src/components/public/screenshot-fan.tsx` удалён; `.hero-fan`, `landing-float`, `landing-tilt-sway` удалены из `globals.css` (`.hero-point` оставлен: им пользуются пункты героя). `grep screenshot-fan\|ProductShowcase\|hero-fan src` пусто. Сразу после героя — `<section id="qr">` верхнего уровня с `QrPlayer`. Playwright: «блока «Три экрана» нет», «первый кадр отрисован на сервере». |
| AC2 | PASS | `chapters.ts`: 6 глав × 180 кадров (6 с), всего 0:36 (тест «шесть глав по ~6 с»). Сцены: холодильник, раздевалка («Допущен к работе»), УФ «Я включил / Я выключил», фритюр, «Забыли?» (12:00/17:00/21:00), датчики. В главах 1–4 телефон: видоискатель → «Кто заполняет / Кто снимает показания» → «Ваш PIN» •••• → значение → кнопка; бланк получает строку (`shots/chapter-1..6-1280.png`). |
| AC3 | PASS | Тест `qr-player.test.ts`: имена журналов ⊂ `journal-catalog.ts`; каждая строка `UI` найдена в своём файле-источнике; подписи граф ⊂ `document-pdf.ts`; поля фритюра ⊂ `DEFAULT_PIPELINE_FIELDS.fryer_oil`; решение по раздевалке — настоящим `healthDecision`. Сверки — в truthCheck ниже. |
| AC4 | PASS | Play/pause, скраббер с 5 засечками глав, «0:05 / 0:36»; `nav[aria-label="Главы ролика"]` + `aria-current="step"`, `role=tablist` нет. Клавиши: Пробел, ←/→ = ∓2 с, Shift+←/→ = глава. Playwright: кадр 100 → → 160 → ← 100 → Shift+→ 180; 300→900→300 даёт ту же сцену. |
| AC5 | PASS | Холодильник −2…+12: 9 °C → кадр итога 168, ячейка «9» цвета `#a3342c`, тост «Температура вышла за норму»; 4 °C — тоста нет (`shots/try-fridge-9C-1280.png`). Раздевалка 35,8…38,0: 37,0 — «Допущен к работе», 37,1 и 37,4 — «Сегодня вы не допущены к работе», «Статус дня: Отстранён», тост «… не допущен(а) к работе» заведующей (`shots/try-locker-37_4C-1280.png`). |
| AC6 | PASS | Playwright: до прокрутки кадр 0 и пауза; в зоне видимости идёт сам; скрытая вкладка — пауза и продолжение; прокрутка наверх — пауза. reduced-motion (390, 1280): без автозапуска, кадр 179 (итог главы 1), подпись «Раскадровка», «Следующая глава» → 359 (`shots/reduced-*.png`). |
| AC7 | PASS | Цвета сцены (бумага, экран телефона, QR, наклейка) — inline. Ночь (21:00 МСК, `data-app-theme=dark`) на всех 5 ширинах: фон бланка `rgb(255,253,248)`. Внутри сцены отключён переход темы `.app-shell *` (иначе кадр «доезжал» 0.18 с). Секция без `.grid`/`ul>li`, ничего не выходит за её коробку (`contain: paint`). |
| AC8 | PASS | Сцена `aspect-[4/5] md:aspect-video`, внутренние размеры в `cqw`/`em`; первый кадр в SSR-HTML. CLS от блока `#qr` на 10 прогонах ≤ 0.0044. |
| AC9 | PASS | `HERO_POINTS[0]` = «**Скан QR-кода** — и запись в журнале», H1 не тронут. `FEATURES[0]` = «Заполнение по QR» → `/features/qr` (200). FAQ +3 QR-вопроса, все в JSON-LD FAQPage (парсится). CTA `#start`: «Повесьте QR — журналы будут вестись у оборудования», шаги «Добавьте оборудование → Распечатайте наклейки → Сотрудники сканируют», золотая наклейка с настоящим QR, `id="start"` и `HeroEmailStart place="final"` на месте. QR в description/OG/Twitter `layout.tsx`, в metadata и JSON-LD `page.tsx`, в `og-default`. Цифр «за N секунд» нет. |
| AC10 | PASS | Новых зависимостей нет (`package.json` не менялся). esbuild точки входа `QrPlayer` (react/react-dom external, minify): 96 697 B, gzip 22 937 B — вместе с каталогом журналов и иконками lucide. Удалённый `ProductShowcase` был серверным, так что прирост ≈ 23 KB gz ≤ 30. |
| AC11 | PASS | 360/390/768/1280/1440 × день/ночь: `scrollWidth <= innerWidth` вверху, на ролике и у CTA; ошибок консоли нет (кроме 401 от запроса сессии анонима — фильтр). `npm run typecheck` exit 0, `eslint` по изменённым файлам 0 проблем, `npm test` 2029/2029. Playwright 110/110 PASS. |

## Изменённые файлы

- `src/components/landing/qr-player/clock.ts` — часы кадров (rAF), `interpolate`/`ease`, `useOnScreen` (IntersectionObserver + visibilitychange).
- `src/components/landing/qr-player/chapters.ts` — главы, «Попробуйте сами», тексты UI с источниками, подписи граф PDF.
- `src/components/landing/qr-player/scene.tsx` — кадр целиком: телефон, бланк, уведомления, дорожка шагов.
- `src/components/landing/qr-player/qr-player.tsx` — плеер: сцена, управление, главы, «Попробуйте сами», SR-текст.
- `src/components/landing/qr-player/qr-sticker.tsx`, `qr-matrix.ts` — золотая наклейка, матрица QR на сервере.
- `src/components/landing/qr-player/qr-player.test.ts` — 10 тестов (логика + сверка с продуктом).
- `src/app/page.tsx` — секция `#qr`, герой, FEATURES, FAQ, CTA, мета, JSON-LD.
- `src/app/globals.css` — удалён мёртвый `.hero-fan`, добавлены `.qrp-range` и отключение перехода темы в сцене.
- `src/content/features.ts` — страница `qr`, первая в `FEATURES_ORDER`.
- `src/app/features/page.tsx`, `src/app/features/[slug]/page.tsx` — иконка `QrCode`.
- `src/app/layout.tsx`, `src/app/og-default/route.tsx` — SEO и OG.
- удалён `src/components/public/screenshot-fan.tsx`.

## Команды

- `NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck` → exit 0
- `npx eslint src/app/page.tsx src/components/landing/qr-player src/content/features.ts src/app/features src/app/layout.tsx src/app/og-default/route.tsx` → 0 проблем
- `npm test` → 2029 pass, 0 fail
- `node verify.mjs` (Playwright, Chrome headless) → 110/110 PASS
- `npx esbuild <QrPlayer> --bundle --minify --external:react …` + gzip → 22 937 B

## Сверка правдивости (что взято откуда)

- Журналы: `JOURNALS` из `journal-catalog.ts` (cold_equipment_control, hygiene, health_check, uv_lamp_runtime, fryer_oil).
- Холодильник: штамп и колонки `drawColdEquipmentPdf` («Наименование или номер ХК», «Месяц …», «Температура °C», «Ответственный за снятие показателей», коды С1/С2, число как `formatNumberShort`); телефон — `equipment-fill-client.tsx` («Оборудование», «Сохранить замер», «Записано», «Температура вне нормы», «Руководитель получит уведомление.», «Показание вне нормы — руководителю…»), `employee-picker.tsx` («Кто снимает показания»), пресеты `deviation-correction.tsx`; уведомление — `temperature-deviations.ts` («Температура вышла за норму», ответственному).
- Раздевалка: `HEALTH_CONFIRMATIONS`/`healthDecision` (`health-qr.ts`), экраны `health-qr-html.ts` («Подписываю:», «Подписать», «Сегодня вы не допущены к работе», «Заведующий производством уже получил уведомление»), `health-qr-flow.ts` («Допущен к работе»), колонки `HYGIENE_V2_COLUMNS` и подпись формы, уведомление `hygiene-declaration-notify.ts` (Telegram+почта, «не допущен(а) к работе»). «Отстранён» показан как статус дня (`status: suspended`), а не как графа «Результат»: её заполняет заведующая.
- УФ: `uv-lamp-client.tsx` («Кто включает и выключает», «Я включил/выключил облучатель», «Облучатель включён/выключен», «Осталось ресурса»), `formatDuration`/`formatHours` из `uv-lamp.ts`, колонки `drawUvRuntimePdf`.
- Фритюр: форма собирается `tasksflow-adapters/generic.ts` («Готово — записать в журнал») из полей `DEFAULT_PIPELINE_FIELDS.fryer_oil`, колонки `drawFryerOilPdf`, оценка «Отличное» = `QUALITY_LABELS[5]`, «Отметка записана» — `renderResult`.
- PIN: `journal-fill-html.ts`/`qr-pin-step.tsx` («Ваш PIN», «PIN подтверждает…», «Продолжить»); 4–6 цифр, 5 попыток → 15 мин (`qr-fill-actor.ts`).
- Напоминания: `cron/compliance` — «Напоминание / Внимание / СРОЧНО: незаполненные журналы за сегодня», email со ступени 17:00; конец смены по гигиене — `cron/health-qr-missing`.
- Датчики: `iot-auto-fill.ts` + `cron/tuya-pull` (раз в час, отклонение → `processTemperatureReading`).

## Отклонения от плана (правдивость важнее)

- Фритюр: в QR-форме нет выбора «Использовать / Заменить» (это текст памятки `journal-filling-guides.ts`, в QR он не выводится) — в сцене показаны реальные поля формы, подпись главы без этого выбора.
- `SuccessCheck` не переиспользован: у него CSS-анимация и цвет из списка ночных переопределений; в ролике своя галка, кадровая (детерминированная).

## Открытые вопросы

- Расписание крона compliance (12/17/21) задаётся на сервере, в репозитории его нет — ступени взяты из кода и комментария маршрута.
- CLS всей страницы на телефоне при программном прыжке к `#start` 0.38–0.95 — источники `section` ниже с `content-visibility:auto` / `contain-intrinsic-size: 860px` и кнопка шапки (`NavStartButton`); это механизм страницы, не блок `#qr` (его вклад ≤ 0.0044).
- Dev-сервер один раз не подхватил правку `globals.css` (пришлось «потрогать» файл) — на прод-сборку не влияет.
