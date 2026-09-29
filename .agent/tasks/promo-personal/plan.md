# План: promo-personal (персональные промокоды, скидка навсегда, ссылка /promo/CODE)

Ветка `feat/promo-personal-2026-09-29`, рабочая копия `d:/wt/promo`, база `wesetup_wt_promo`, порт 3191.
Спека — `spec.md` рядом (заморожена). Критерии AC1–AC4 — оттуда.

## Решения (что и почему)

- **Где скидка считается.** Одна серверная функция `resolveCheckoutDiscount` (lib/promo/checkout.ts):
  введённый код + скидка навсегда аккаунта → выгоднейшая из двух (не вместе), от цены с акцией.
  Её зовут создание заказа (карта), счёт по безналу, `/api/promo/check`, страницы `/order` и
  `/settings/subscription` (показ). Браузер сумму не считает — показывает то, что вернул сервер.
- **Чей аккаунт.** Скидка навсегда — аккаунта, который продлит этот заказ: организация из сессии
  руководителя, иначе организация пользователя с почтой заказа (как в `fulfillPaidOrder`).
- **Персональный код.** Совпадение — почта заказа или почта владельца аккаунта = `personalEmail`;
  либо организация заказа (или организация того же аккаунта) = `organizationId`. Чужому — отказ
  «Этот промокод персональный — он выдан другой организации». Без почты (аноним на `/api/promo/check`)
  — «проверим по почте при оплате», окончательно решает создание заказа.
- **Заказ.** `promoCode`/`discountRub` — код и скидка, которые реально применились. Новое поле
  `PaymentOrder.lifetimeDiscountId` — скидка навсегда применилась сама; такие заказы не считаются
  использованием кода (лимит `maxUses` тратит только первая оплата с кодом).
- **Привязка.** В `fulfillPaidOrder` после продления: заказ с lifetime-кодом, введённым вручную →
  `AccountLifetimeDiscount` (снимок kind/value). Идемпотентно (тот же заказ / тот же код — no-op,
  гонка — unique на `accountId`). Отменённая ROOT'ом — переписывается новой привязкой; действующая
  с другим кодом — заменяется (заказ выбрал этот код как более выгодный). Лог
  `[promo] lifetime bound account=… code=…`, аудит `promo.lifetime.bind`.
- **Ссылка.** `/promo/[code]` — route handler (как `/r/[code]`): код действует → cookie
  `wesetup.promo` на 30 дней → руководитель: `/settings/subscription?promo=CODE`; другой вошедший:
  `/order?plan=monthly&promo=CODE`; без входа: `/register?promo=CODE&s=<сфера>&next=/settings/subscription?promo=CODE`.
  Не действует → `/promo?code=CODE` — страница «Промокод больше не действует» со ссылкой на тарифы.
- **Регистрация со сферой.** `/register?s=<сфера>` показывает выбор сферы (подставлена), `instant-register`
  принимает `sphere` (только значения `ORG_SPHERES`): `Organization.type` и набор журналов сферы.
- **Тестируемость.** Ядро без `db` (DI, как `custom-names-save`): `checkout-core.ts`, `lifetime-core.ts`,
  `personal-codes-core.ts`; обёртки с `db` — рядом. Чистые правила — `rules.ts`, `discounts.ts`, `personal-link.ts`.

## Задачи и файлы

1. **Схема** (`prisma/schema.prisma`, аддитивно):
   - `PromoCode`: `lifetime`, `personalEmail`, `organizationId`, `campaignId` (+ индексы);
   - `AccountLifetimeDiscount` (accountId @unique, promoCodeId, code, kind, value, orderId, boundAt,
     revokedAt?, revokedById?);
   - `PaymentOrder.lifetimeDiscountId`, связь `Account.lifetimeDiscount`.
2. **Чистые правила + тесты:**
   - `rules.ts`: причина `personal-foreign`, `personalCodeMatches`, `validatePromo` с плательщиком;
   - `discounts.ts`: `pickBestDiscount`, подписи «Ваша скидка −10 % навсегда», пояснение «что применено»;
   - `personal-link.ts`: `suggestPersonalCode`, `promoLinkUrl`, транслит, суффикс коллизий,
     cookie, цель редиректа ссылки.
3. **Сервер:**
   - `checkout-core.ts` + `checkout.ts` (`resolveCheckoutDiscount`);
   - `lifetime-core.ts` + `lifetime.ts` (привязка, отмена, список ROOT);
   - `personal-codes-core.ts` + `personal-codes.ts` (`createPersonalPromoCodes`, `readPromoForOffer`,
     реэкспорт `suggestPersonalCode`/`promoLinkUrl`, типы запросов — сигнатуры из спеки без изменений).
4. **Пути оплаты:**
   - `api/payments/robokassa/create` — скидка из `resolveCheckoutDiscount`, `lifetimeDiscountId`, 409 с разбивкой;
   - `api/payments/invoice` + `invoices/service` — промокод и скидка навсегда в счёте;
   - `api/promo/check` — выгоднейший из двух, пояснение, персональный код;
   - `payment-fulfillment.ts` — привязка после продления (все три ветки);
   - `service.ts` — учёт использований без авто-скидок.
5. **Витрины:**
   - `PromoPrice`/`PlanCard` — персональная скидка (зачёркнутая цена + плашка) рядом с акцией;
   - `/order` (page + client) — `?promo=`/cookie, авто-скидка навсегда, пояснения;
   - `/settings/subscription` — `?promo=`/cookie, карточка «Промокод и скидки», цена со скидкой в
     тарифе, счёте, автопродлении.
6. **Ссылка и регистрация:** `app/promo/[code]/route.ts`, `app/promo/page.tsx`, `register` (сфера + плашка
   промокода), `instant-register` (сфера).
7. **ROOT `/root/promo-codes`:** поля в создании и правке (навсегда, персональные почта/организация, метка
   рассылки), пометки и фильтр «персональные» в списке, раздел «Скидки навсегда» с «Отменить»
   (ConfirmDialog + аудит `promo.lifetime.revoke`); аудит создания/правки кодов; подписи в `/root/audit`.
8. **Проверки:** `npm run typecheck`, `npm test` (+ `test:gate`), e2e Playwright (390 и 1280) по сценариям
   спеки с тестовой кассой (фиктивный тестовый магазин в env dev-сервера, запросы к robokassa.ru
   перехвачены, ResultURL — наш `/payment` с подписью фиктивным паролем №2, как в price-promotions),
   скриншоты и `evidence.md`.

## Интерфейсы для соседей (proposal-kp, mailing) — по спеке, без изменений

```ts
// src/lib/promo/personal-codes.ts
export type PersonalCodeRequest = { key: string; email: string | null; organizationId?: string | null; companyName?: string | null };
export type PersonalCodeOptions = { kind: "percent" | "fixed"; value: number; lifetime: boolean; endsAt: Date | null; note?: string | null; campaignId?: string | null };
export async function createPersonalPromoCodes(requests: PersonalCodeRequest[], options: PersonalCodeOptions): Promise<Map<string, { id: string; code: string }>>;
export function suggestPersonalCode(companyName: string | null | undefined, value: number): string;
export function promoLinkUrl(code: string, opts?: { sphere?: string | null; baseUrl?: string }): string;
export async function readPromoForOffer(code: string): Promise<{ code: string; kind: "percent" | "fixed"; value: number; lifetime: boolean; endsAt: Date | null } | null>;
```
