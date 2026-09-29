# Evidence: promo-personal (персональные промокоды, скидка навсегда, ссылка /promo/CODE)

Ветка `feat/promo-personal-2026-09-29`, рабочая копия `d:/wt/promo` (от `origin/master` 2c619b4f).
Коммиты: `c4a08965` спека и план · `33cabb2a` схема и ядро · `275a9568` оплата · `91fab143` витрины ·
`7b1f4379` ссылка /promo и регистрация · `1d593320` ROOT · (этот коммит) e2e и доказательства.

## Итог по критериям

| AC | Статус | Чем подтверждено |
|---|---|---|
| AC1 — персональные коды и скидка навсегда на всех путях оплаты (карта, счёт), сумму считает сервер | PASS | юнит `checkout-core.test.ts`, `rules.test.ts`, `lifetime-core.test.ts`; e2e: карта (первая оплата и продление), счёт по безналу, отказ чужому коду в API и UI, «выгоднейший из двух» |
| AC2 — `/promo/<CODE>?s=<sphere>` доводит до оплаты с подставленным кодом (с входом и без) | PASS | e2e: гость 1280 и 390 → регистрация со сферой → тариф с кодом → /order с кодом → оплата; владелец с входом → тариф с кодом; протухший и неизвестный код → понятная страница |
| AC3 — `createPersonalPromoCodes` / `promoLinkUrl` / `readPromoForOffer` по сигнатурам спеки, с тестами | PASS | `personal-codes.ts` (сигнатуры без изменений), юнит `personal-codes-core.test.ts`, `personal-link.test.ts`; на живой базе — `raw/seed-codes.json` (ROMASHKA10, коллизия → ROMASHKA10-2, LAVKA10, истёкший → null) |
| AC4 — ROOT видит и отменяет скидки навсегда; всё в логах и аудите | PASS | e2e: раздел «Скидки навсегда», «Отменить» с подтверждением → revokedAt, аудит `promo.lifetime.revoke`, лог; `/root/audit` — «Промокод создан/изменён», «Скидка навсегда закреплена/отменена» |

## Как устроено (коротко)

- **Одна точка расчёта** — `resolveCheckoutDiscount` (`src/lib/promo/checkout.ts`, ядро без БД —
  `checkout-core.ts`): введённый код + скидка навсегда аккаунта, который продлит заказ, → выгоднейшая
  из двух (не вместе), от цены с акцией. Её зовут: создание заказа (карта), счёт по безналу,
  `/api/promo/check`, страницы `/order` и `/settings/subscription`. Браузер сумму не присылает.
- **Персональный код**: совпала почта заказа / почта владельца аккаунта с `personalEmail` или
  организация заказа (любая точка того же аккаунта) с `organizationId`. Иначе — «Этот промокод
  персональный — он выдан другой организации». Аноним без почты на проверке кода — «проверим по почте
  при оплате», окончательно решает создание заказа.
- **Скидка навсегда**: первая оплаченная подписка с введённым lifetime-кодом → `AccountLifetimeDiscount`
  (снимок вида и размера) в `fulfillPaidOrder`, идемпотентно; дальше применяется сама —
  `PaymentOrder.lifetimeDiscountId` (такие заказы не тратят лимит кода). Лог
  `[promo] lifetime bound account=… code=…`, аудит `promo.lifetime.bind`.
- **Ссылка** `/promo/[code]` (route handler): cookie `wesetup.promo` на 30 дней; руководитель →
  `/settings/subscription?promo=CODE`, сотрудник → `/order?plan=monthly&promo=CODE`, гость →
  `/register?promo=…&s=…&next=/settings/subscription?promo=…`. Не действует → `/promo?code=CODE`.
- **Регистрация** научена сфере: `instant-register` принимает `sphere` (только `ORG_SPHERES`) —
  `Organization.type` и журналы сферы сразу.

## Проверки

- `npm run typecheck` — зелёный (прогон перед коммитами и в каждом pre-commit хуке).
- `npm test` / `npm run test:gate` — **pass 2903, fail 0** (в хуке каждого коммита).
- Новые юнит-тесты (60, все зелёные):
  - `rules.test.ts` — персональный код: свой (почта / организация аккаунта), чужой, чужая организация,
    «исчерпан» чужому не показываем, плательщик неизвестен;
  - `discounts.test.ts` — выгоднейший из двух, поровну → навсегда, не складываются, подписи и пояснения;
  - `checkout-core.test.ts` — автоприменение, аноним по почте, порядок с акцией, отмена (скидки больше нет),
    выгоднейший из двух, свой исчерпанный код, отказ чужому (сессия и без входа), новые клиенты, лимит;
  - `lifetime-core.test.ts` — привязка (снимок, аудит), **идемпотентность** (повтор той же оплаты, вторая
    оплата, гонка двух оплат), не привязываем авто-скидку/обычный код/неоплаченный заказ/без аккаунта,
    снимок не меняется после правки кода, перепривязка после отмены и более выгодным кодом, отмена (409/404);
  - `personal-link.test.ts` — транслит «ООО «Ромашка»» → ROMASHKA10, до 16 знаков, случайный KP…, коллизии
    «-2», `isValidPromoCodeFormat`, `promoLinkUrl` (сфера только из ORG_SPHERES, baseUrl), куда ведёт ссылка;
  - `personal-codes-core.test.ts` — одна транзакция, уникальность в пачке и в базе, гонка → повтор, ошибки входа,
    `readPromoForOffer` / статус ссылки;
  - `promotions.test.ts` — примечание к заказу со скидкой навсегда.

## E2E (Playwright headless, 390 и 1280) — 47 проверок, 0 ошибок, 0 ошибок страниц

Стенд: `next dev --webpack -p 3191` из `d:/wt/promo`, база `wesetup_wt_promo`. Касса — как в
price-promotions-2026-09: в env dev-сервера **фиктивный тестовый магазин** (`ROBOKASSA_IS_TEST=1`,
фиктивные логин и пароли), запросы браузера к `*.robokassa.ru` перехвачены (заглушка), оплату
подтверждаем POST на наш ResultURL `/payment` с подписью фиктивным паролем №2. Боевые ключи не
использовались, наружу ничего не уходило.

Запуск: `node e2e/seed.cjs && node --env-file=.env --import tsx e2e/seed-codes.mts && node e2e/e2e.cjs`
(скрипты — `e2e/`, полный вывод — `raw/e2e-run.log`, результаты — `raw/e2e-results.json`).

1. Протухший код `/promo/E2EOLD10?s=cafe` → «Промокод больше не действует» + «Посмотреть тарифы» (1280, 390);
   неизвестный → «Такого промокода нет».
2. **Без входа** (1280 и 390): `/promo/ROMASHKA10?s=cafe` → регистрация: сфера «Кафе / Кофейня»
   подставлена, плашка «Промокод ROMASHKA10: −10 % навсегда», cookie на 30 дней → аккаунт →
   `/settings/subscription?promo=…`: код применён (−199 ₽), 1 990 зачёркнута → 1 791 ₽ → «Оплатить
   картой» → `/order` с кодом: к оплате 1 791 ₽ → в кассу 1791.00 → ResultURL OK → скидка закреплена
   (снимок −10 %, с заказа №1/№2), аудит, лог `[promo] lifetime bound account=… code=…`; организация
   создана с `type=cafe`.
3. **Следующая оплата сама со скидкой**: `/settings/subscription` без кода — «Ваша скидка −10 % навсегда»;
   `/order` без кода — зачёркнутая 1 990 → 1 791, к оплате 1 791 ₽; продление картой — 1791.00, заказ с
   `lifetimeDiscountId`, привязка не изменилась (одна строка, один аудит); **счёт по безналу** —
   1 791 ₽ со скидкой навсегда.
4. **С входом**: владелец «Лавки» открывает `/promo/LAVKA10?s=cafe` → `/settings/subscription?promo=LAVKA10`,
   код применён (1280, 390).
5. **Чужой персональный код** (ROMASHKA10-2 у «Лавки»): страница тарифа и /order — «Этот промокод
   персональный — он выдан другой организации»; создание заказа — 400 (с входом и без входа по чужой почте).
6. **Выгоднейший из двух**: у аккаунта −10 % навсегда; E2E500 (−500 ₽) — применён код, пояснение;
   E2E5 (−5 %) — осталась скидка навсегда, пояснение; /order с E2E500 — к оплате 1 490 ₽.
7. **ROOT**: пометки «навсегда», «персональный», метка рассылки; фильтр «Персональные» (3 из 6); правка
   E2E5 (навсегда, персональная почта в нижнем регистре, метка); «Скидки навсегда» — 2 аккаунта с
   номерами заказов; «Отменить» → подтверждение → revokedAt/revokedById, аудит, лог; `/root/audit` с
   подписями; после отмены `/order` аккаунта — 1 990 ₽ без скидки.

Снимки (`evidence/`): `promo-expired-{1280,390}`, `register-promo-{1280,390}`,
`subscription-code-{1280,390}`, `subscription-code-plan-1280`, `order-code-{1280,390}`,
`subscription-lifetime-{1280,390}`, `order-lifetime-{1280,390}`, `subscription-invoice-lifetime-1280`,
`owner-link-subscription-{1280,390}`, `order-foreign-code-{1280,390}`, `order-best-of-two-390`,
`root-promo-codes-personal-1280`, `root-promo-codes-390`, `root-lifetime-1280`, `root-lifetime-revoked-1280`.

Логи сервера по шагам — `raw/server-log-promo.txt` (link opened/rejected, register page, sphere from promo
link, page:/order и page:/settings/subscription с источником кода, order #…, invoice #…, lifetime bound,
personal-foreign, root created/update, lifetime revoked).

## Интерфейсы для соседних задач (proposal-kp, mailing) — `src/lib/promo/personal-codes.ts`

```ts
export type PersonalCodeRequest = { key: string; email: string | null; organizationId?: string | null; companyName?: string | null };
export type PersonalCodeOptions = { kind: "percent" | "fixed"; value: number; lifetime: boolean; endsAt: Date | null; note?: string | null; campaignId?: string | null };
export async function createPersonalPromoCodes(requests: PersonalCodeRequest[], options: PersonalCodeOptions): Promise<Map<string, { id: string; code: string }>>;
export function suggestPersonalCode(companyName: string | null | undefined, value: number): string;
export function promoLinkUrl(code: string, opts?: { sphere?: string | null; baseUrl?: string }): string;
export async function readPromoForOffer(code: string): Promise<{ code: string; kind: "percent" | "fixed"; value: number; lifetime: boolean; endsAt: Date | null } | null>;
```

Поведение, которое стоит знать вызывающим:
- каждый код — активный, персональный, `maxUses = 1` (одна оплата по коду; скидка навсегда после неё
  работает сама), без «только новым»; в заметке — `note · companyName`;
- ошибка входа (нет ни почты, ни организации, повтор `key`, процент > 100, `endsAt` в прошлом) —
  исключение, ничего не создаётся; коллизии — суффикс `-2`, `-3`…, код до 16 знаков;
- `promoLinkUrl` по умолчанию — `https://wesetup.ru`, сфера только из `ORG_SPHERES` (иначе без `?s=`),
  битый код — исключение;
- `readPromoForOffer` — `null`, если кода нет, выключен, не начался, истёк или исчерпан (кому выдан, не
  проверяет — это решит оплата).

## Не сделано / ограничения

- Окно «оплатить / бесплатный» после бесплатного периода и анонс в шапке кабинета показывают цену с акцией,
  но без личной скидки (скидка видна на странице тарифа и в оплате, сумма к оплате — со скидкой).
- Возврат платежа (ROOT «возврат») привязанную скидку навсегда не отменяет — ROOT отменяет вручную в
  «Скидках навсегда».
- Привязка требует аккаунт у организации (у всех новых он есть); без аккаунта — `console.warn` и без привязки.
