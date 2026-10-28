# Evidence — pricing-per-point-2026-10-28

Ветка `feat/pricing-per-point`, worktree `F:\wt\price` от `origin/master` 83bffc75.

| AC | Статус | Доказательство |
|----|--------|----------------|
| AC1 | PASS | `planPointMonthlyRub` (`src/lib/tariff-plans.ts`); тест «цена одной точки в месяц»: 14 точек помесячно — 2 850, за год — 1 891. Живой `/pricing` (dev 3031, своя БД `wesetup_price`): «2 850 ₽/мес за точку», «1 891 ₽/мес за точку». |
| AC2 | PASS | Живой `/pricing`, 14 точек: «За 14 точек — 317 604 ₽ за год · экономия 161 196 ₽ · −5 % за точки»; помесячно — «За 14 точек — 39 900 ₽ в месяц · −5 % за точки»; 1 точка — «23 880 ₽ за год · экономия 12 120 ₽». Тест с акцией −20 %: итог 19 104 ₽. |
| AC3 | PASS | `useState<BillingCycle>("year")`; тест «a monthly subscriber with 14 points opens on per year»: `aria-checked="true"`, кнопка `cta.switchYear` 297 654 ₽ (317 604 − 39 900 × 15/30). |
| AC4 | PASS | ru/en/uz: `price.perPointMonth`, `price.totalYear`, `price.totalMonth`; неиспользуемый `forPoints` убран; `npm run i18n:types`; тесты проверяют отсутствие кириллицы в en/uz и падают на пропущенном ключе. |
| AC5 | PASS | `src/lib/tariff-plans.test.ts`, `src/components/pricing/tariff-comparison.test.ts` — сценарии кабинета переведены на годовую подписку (renew 23 880, upgrade 986, с акцией 19 104 / 789). |
| AC6 | PASS | `WHATS_NEW_NOTES` — категория «Тарифы: цена за точку», иконка `Coins` в `CATEGORY_ICONS`. |
| AC7 | см. ниже | typecheck, test:gate, eslint — результаты в описании PR. |

Скриншоты (1280 и 390 px, 1/14 точек, год/месяц) сняты Playwright в scratchpad сессии, в репозиторий не кладутся.
