# Доказательства — финансовая модель по всему сайту

Проверено 06.11.2026: прод `https://wesetup.ru/pricing` (до правок), локально `next dev` + PostgreSQL, Playwright.

До правок на проде уже действовало (данные страницы `/pricing`): standard 2990/1990, premium 4990/3990,
vip 12990/8990 ₽/мес (помесячно / за год), шкала от 5 — 5 %, от 10 — 10 %, от 15 — 20 %, от 35 — 25 %,
от 50 — индивидуально, колонка «ВИП» с горячей линией «до 10 часов в месяц».

| AC | Итог | Как проверено |
|---|---|---|
| AC1 | PASS | `raw/landing-check.json`: заголовок «Четыре тарифа. Начните бесплатно — 14 дней без карты», подсказка «…от 35 — 25 %, от 50 — индивидуальное предложение.», колонки Бесплатный/Стандарт/Премиум/ВИП; `raw/landing-pricing.png`. en/uz — тест `pricing-model.test.ts`. |
| AC2 | PASS | `raw/landing-check.json`: Offer «ВИП», price 8990, описание с горячей линией до 10 часов. |
| AC3 | PASS | `pricing-model.test.ts`: 9 ключей ru/en/uz содержат «ВИП»/VIP; в `billing-period.ts`, `billing.server.ts`, `org-conversion-core.ts`, `seo-landings.ts`, `upgrade/route.ts` нет «„Стандарт“ или „Премиум“»; `paidPlansHint` — «…«ВИП» — от 8 990 ₽/мес при оплате за год». |
| AC4 | PASS | `trial-settings-card.tsx` передаёт `vip`; `rootTariffs.paidHint` с `{vip}` (ru/en/uz); `tariff-presentation.test.ts` проверяет вывод числа «ВИП». |
| AC5 | PASS | `pricing-model.test.ts`: `DEFAULT_PLAN_RATES` = модель, шкала 1/4/5/9/10/14/15/34/35/49, от 50 — индивидуально. |
| AC6 | PASS | `raw/typecheck.log` exit 0; `raw/i18n-check.log` 97/0; `raw/eslint.log` exit 0; `raw/test-gate.log` pass=5757 fail=0 (первый прогон поймал `tariff-presentation.test.ts` без аргумента `vip` — тест обновлён, прогон повторён). |
