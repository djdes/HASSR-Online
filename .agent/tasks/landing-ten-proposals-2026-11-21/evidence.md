# Evidence — landing-ten-proposals-2026-11-21

Проверено на текущем коде: `next dev`, Playwright (iPhone 13 и ПК 1440 px, светлая и тёмная
тема), локальная демо-база. Снимки — `raw/*.webp`.

| AC | Итог | Чем подтверждено |
|----|------|------------------|
| AC1 | PASS | вкладки: общепит — 6 глав, медцентр — «УФ-лампа, Холодильник, Забыли?», отель — «Раздевалка, Холодильник, Датчики, Забыли?»; «Попробуйте сами» — медцентр 1 пример, отель 2; `raw/qr-industries-and-frame.webp`; тесты «набор глав…», «вкладки вида деятельности…» |
| AC2 | PASS | `tariff-table-body` скрыт, после нажатия открыт; тест «главная: таблица сравнения свёрнута…»; /pricing без `tableCollapsed` |
| AC3 | PASS | 6 `details.motion-faq`, FAQPage — 6 вопросов; тест «FAQ на главной — шесть вопросов» |
| AC4 | PASS | подвал: группа `closed` → `open` по нажатию, ссылки видны; тест `footer-disclosure.test.ts`; `raw/phone-dark-faq-footer.webp` |
| AC5 | PASS | тёмная тема: выбранная вкладка вида деятельности `rgb(11,16,36)` на белом (было — светлый текст на белом), оценка масла — `landing-on-light`; `raw/desktop-dark.webp` |
| AC6 | PASS | строка состояния 9:41 с «чёлкой», шапка снимка видна целиком (`raw/qr-industries-and-frame.webp`); тест в `interface-showcase.test.ts` |
| AC7 | PASS | `git ls-files -s .husky/*` — 100755; pre-commit при коммите выполнился («✓ pre-commit OK») |
| AC8 | PASS | `npm run screens:landing -- --seed` на пустой базе + повтор без `--seed`: 14 снимков 2400×1500 / 780×1600, мониторинг 67/67/57 % (`raw/screens-landing-run.*`); с `DATABASE_URL` на db.example.com — отказ, код 1 |
| AC9 | PASS | `landing.demoOffer` в ru/en/uz, строки в коде нет |
| AC10 | PASS | «Ч/6» — это кнопка «Ч/б» (чёрно-белая печать), «б» в шрифте Manrope похожа на «6»; подпись — «Чёрно-белая» / «Black & white» |
| AC11 | PASS (до деплоя) | `npm run typecheck` — чисто; `npm run test:gate` — 69 файлов, 298/298; деплой — в ответе владельцу |
