# Spec (frozen 2026-09-29): персональные промокоды, скидка «навсегда», ссылка/QR с промокодом

Задача владельца: в КП и рассылке — «для вас скидка 10 % навсегда — перечёркнутая цена; оплата по QR-коду или введите на
сайте персональный промокод, и скидка заработает». Нужны: персональные коды (только для конкретного адресата), скидка
навсегда (на все будущие оплаты аккаунта), ссылка/QR, которая сама применяет код, массовое создание кодов для рассылки.

Сейчас (master): `PromoCode` (code, kind percent|fixed, value, active, startsAt/endsAt, maxUses, newClientsOnly, note),
правила `src/lib/promo/rules.ts` (`validatePromo`, `computeDiscountRub`), цена/акция `src/lib/promo/offer.ts`,
`promotions.ts` (`computeCheckoutAmounts`: промокод поверх цены с акцией), ROOT `/root/promo-codes`, оплата —
Robokassa (`src/app/api/payments/*`), выставление счёта по безналу, `src/lib/payment-fulfillment.ts` (`fulfillPaidOrder`),
тариф живёт на `Account`. Ветка: `feat/promo-personal-2026-09-29`, рабочая копия `d:/wt/promo`, порт 3191.

## Сделать
1. **Схема.**
   - `PromoCode` + `lifetime Boolean @default(false)` — «скидка навсегда».
   - `PromoCode` + `personalEmail String?` (нижний регистр) и `organizationId String?`: код только для этого адреса или организации.
   - `PromoCode` + `campaignId String?` — метка рассылки. Просто строка, без связи.
   - Новая модель `AccountLifetimeDiscount`:
     - поля: `accountId` @unique, `promoCodeId`, `kind`, `value` (снимок на момент привязки), `orderId`, `boundAt`, `revokedAt?`, `revokedById?`;
     - это история привязки: правка кода потом не меняет уже привязанные скидки.
2. **Оформление оплаты.** Где проверяется и применяется код: создание заказа, счёт по безналу, расчёт цены на
   `/settings/subscription` и `/order`.
   - Персональный код чужому — отказ с понятной причиной: «Этот промокод персональный — он выдан другой организации».
     Сверять с почтой плательщика (пользователь/организация) и `organizationId`.
   - У аккаунта есть действующая скидка навсегда — она применяется сама к каждой оплате подписки и к счёту. Вводить
     ничего не нужно.
     - На странице тарифа и в оплате: «Ваша скидка −10 % навсегда», старая цена зачёркнута. Компонент `PromoPrice` и соседние — как у акций.
   - Ввели другой код при действующей скидке навсегда — применяется выгоднейший из двух, коды не складываются. Пояснить
     человеку, что применено.
   - Порядок со скидкой-акцией — как уже принято: код (и скидка навсегда) считается от цены с акцией.
   - Первая оплаченная подписка с `lifetime`-кодом → привязка к аккаунту в `fulfillPaidOrder`:
     - идемпотентно;
     - лог `[promo] lifetime bound account=… code=…`;
     - аудит.
   - Сумму к оплате считает только сервер (как сейчас).
3. **Ссылка с промокодом (цель QR в КП): маршрут `/promo/[code]`.** Контракт URL: `https://wesetup.ru/promo/<CODE>?s=<sphere>`,
   `sphere` — значения `ORG_SPHERES`, необязателен. На этот адрес уже ссылаются КП и рассылка — не менять.
   - Код действует → сохранить его (cookie на 30 дней, httpOnly не обязателен), затем:
     - вошёл руководитель → `/settings/subscription?promo=<CODE>` (код подставлен в форму оплаты);
     - не вошёл → регистрация с подставленной сферой (если регистрация умеет — проверить, иначе научить);
     - после регистрации код подставлен на оплате.
   - Код не действует или неизвестен → понятная страница «Промокод больше не действует» со ссылкой на тарифы.
   - `?promo=` на `/order` и `/settings/subscription` тоже подставляет код.
   - Логи на каждом шаге.
4. **Массовое создание персональных кодов** — `src/lib/promo/personal-codes.ts` (его зовут рассылка и генератор КП):
   ```ts
   export type PersonalCodeRequest = { key: string; email: string | null; organizationId?: string | null; companyName?: string | null };
   export type PersonalCodeOptions = { kind: "percent" | "fixed"; value: number; lifetime: boolean; endsAt: Date | null; note?: string | null; campaignId?: string | null };
   /** key → созданный код. Один запрос — один новый активный код, персональный (email и/или organizationId). */
   export async function createPersonalPromoCodes(requests: PersonalCodeRequest[], options: PersonalCodeOptions): Promise<Map<string, { id: string; code: string }>>;
   /** «ROMASHKA10»: транслит названия A–Z0–9 + размер скидки, до 16 знаков; пусто — случайный «KP7F3Q10». */
   export function suggestPersonalCode(companyName: string | null | undefined, value: number): string;
   export function promoLinkUrl(code: string, opts?: { sphere?: string | null; baseUrl?: string }): string;
   /** Данные кода для текста предложения; null — нет/не действует. */
   export async function readPromoForOffer(code: string): Promise<{ code: string; kind: "percent" | "fixed"; value: number; lifetime: boolean; endsAt: Date | null } | null>;
   ```
   - Коллизии кодов — суффикс.
   - Коды проходят `isValidPromoCodeFormat`.
   - Всё создаётся одной транзакцией.
5. **ROOT `/root/promo-codes`:**
   - новые поля в создании и правке: навсегда, персональный email/организация;
   - в списке: пометки «навсегда», «персональный», метка рассылки; фильтр «персональные»;
   - раздел «Скидки навсегда»: аккаунты с привязанной скидкой, с какого заказа, кнопка «Отменить» (с подтверждением и аудитом).

## Проверка
- **Юнит:**
  - персональный код: свой / чужой / чужая организация;
  - навсегда: привязка идемпотентна, автоприменение, выгоднейший из двух, отмена;
  - транслит и уникальность кодов;
  - `promoLinkUrl`.
- **E2E** (телефон 390, компьютер 1280):
  - `/promo/CODE?s=cafe` без входа → регистрация (сфера подставлена) → оплата с кодом;
  - с входом → тариф с кодом;
  - код протух → понятная страница;
  - после оплаты с lifetime-кодом (тестовый путь оплаты, как в прошлых e2e задачи promos) — следующая оплата сама со скидкой, зачёркнутая цена;
  - чужой персональный код — отказ.
  - Скриншоты.
- `npm run typecheck`, `npm test`.

## Критерии приёмки
- AC1: персональные коды и скидка навсегда работают на всех путях оплаты (карта, счёт), сумму считает сервер.
- AC2: `/promo/<CODE>?s=<sphere>` доводит до оплаты с подставленным кодом (с входом и без).
- AC3: `createPersonalPromoCodes` / `promoLinkUrl` / `readPromoForOffer` — по сигнатурам выше, с тестами.
- AC4: ROOT видит и отменяет скидки навсегда; всё в логах и аудите.
