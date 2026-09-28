# План (price-promotions-2026-09)

1. Схема (аддитивно): модель `PricePromotion` (title, percent 1–90, startsAt/endsAt, active, note) +
   поля `PaymentOrder`: `baseRub?`, `promotionId?`, `promotionPercent?`, `promotionDiscountRub` (default 0).
2. Чистый client-safe модуль `src/lib/promo/promotions.ts`: выбор действующей акции (пересечение → max %,
   граница: start включительно, end исключительно), `applyPromotion` (целые рубли, как `computeDiscountRub`),
   `computeCheckoutAmounts` (акция → промокод от цены с акцией → оборудование), МСК-время (UTC+3) для ввода
   и показа, подпись плашки «−N % до <дата>», проверка ввода ROOT. Тесты.
3. Сервер `src/lib/promo/offer.ts`: `readActivePromotion(now)`, `getSubscriptionOffer(now, tariffKey)`.
4. ROOT: `/api/root/promotions` (GET/POST) + `[id]` (PATCH/DELETE) с аудитом (`organizationId=platform`) и
   `console.info("[promo] …")`; страница `/root/promotions` (идут/будущие/прошедшие, форма создать/изменить,
   выключить, удалить через ConfirmDialog, превью цены, история изменений, оплаты по акции); пункт меню.
5. Оплата: `robokassa/create`, `promo/check`, счёт по безналу — цена из `getSubscriptionOffer`, промокод от
   цены с акцией, снимок в `PaymentOrder`, защита «цена изменилась» (expectedGrossRub). Промокоды: учёт
   использований по paid+completed, «только новым» — ещё и по почте (анонимный заказ), ROOT-таблица.
6. Компонент `PromoPrice` (`src/components/pricing/promo-price.tsx`, без хуков — сервер и клиент): лендинг
   (hero, карточка, калькулятор, JSON-LD), `/pricing`, `/settings/subscription` (карточка, калькулятор, счёт,
   «В месяц»), `/order`, ROI-калькулятор.
7. `scripts/seed-promo-codes.ts` — стартовые коды, идемпотентно, выключенными.
8. Проверка: typecheck, тесты, e2e Playwright (390/1280) — `D:/wt-build/tmp-promos`, скриншоты в `evidence/`.
