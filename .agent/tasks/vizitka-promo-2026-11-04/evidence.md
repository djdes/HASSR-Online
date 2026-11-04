# Доказательства — акция по визитке (/vizitka)

Проверено локально 04.11.2026 на демо-базе `wesetup_deck` (dev-сервер worktree `D:/wt/deck-demo`, порт 3217).

| AC | Итог | Как проверено |
|---|---|---|
| AC1 | PASS | `raw/_vizitka-desk.png`, `raw/_vizitka-mob.png`; `scrollWidth` 1440 и 390 — без горизонтальной прокрутки; анимации в `vizitka.module.css` выключены под `prefers-reduced-motion`; `robots: noindex`. |
| AC2 | PASS | На странице «Промокод VIZITKA10 применён», Премиум за год 43 092 ₽ вместо 47 880 ₽, экономия 4 788 ₽ (тесты `card-offer.test.ts`: −10 % от цены по ценовой акции). Плюсы — `CARD_POINTS` + `landingComponents.tariffs.features`. |
| AC3 | PASS | `/order?plan=premium&cycle=year&promo=VIZITKA10` гостем: «К оплате 43 092 ₽… Промокод VIZITKA10 применён: −4 788 ₽», поле почты и «Перейти к оплате» (`raw/_order.png`). |
| AC4 | PASS | Код выключен в базе → «Акция по визитке сейчас не действует», ссылка `/order?plan=premium&cycle=year` без кода; включён → снова «применён» и ссылка с кодом. |
| AC5 | PASS | `GET /vizitka/contact.vcf` → 200, `text/vcard`, `attachment; filename="wesetup.vcf"`, оба телефона. |
| AC6 | PASS | `seed-card-promo.ts` без `--apply` — «создам включённым…», с `--apply` — «создан включённым…», повторно — «уже есть — не трогаю». |
| AC7 | PASS | `npx tsx --test src/lib/promo/card-offer.test.ts` 6/0; `app-nav.test.ts` 48/0; `tsc --noEmit` EXIT 0; `eslint` по новым файлам — 0 ошибок. |
| AC8 | PASS | Печатный PDF оборота визитки (`D:\presentations\vizitka-2026-11-04\print`) распознаётся zxing как `https://wesetup.ru/vizitka`. |

Замечание: worktree лежит на томе D: с известной порчей файлов; перед проверкой 200 испорченных исходников восстановлены из git (сверка `git hash-object`).
