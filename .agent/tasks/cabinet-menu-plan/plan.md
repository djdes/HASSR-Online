# План

1. `src/lib/cabinet-plan.ts` (чистые функции, client-safe):
   - `subscriptionTotal({ employees, tariffRub, promotion, personal })` → quote + цена с акцией + скидка + итог;
   - `overageBreakdown(quote)` → «1 990 ₽ + 28 × 100 ₽ сверх 10»;
   - `cabinetPlanTitle(state, settings, plan)`; `cabinetPlanAccess({ canManagePlan, inMobileApp })`;
   - `buildCabinetPlanCard(...)` → сериализуемый `CabinetPlanCard` для шапки.
   Тест `cabinet-plan.test.ts`.
2. `billing-period.ts`: `voluntaryDowngradeCheck(state)` (разрешён: legacy / free_period / paid / needs_decision / free;
   запрещён: exempt, пауза). Тест.
3. `billing.server.ts`: режим `voluntary` в `transitionToFree` (проверка из п. 2; оплаченный срок обнуляется,
   автопродление выключается; аудит `billing.transition.voluntary_free`; лог `[billing] voluntary downgrade`).
4. `transition/route.ts`: `POST { keepUserId, voluntary?: true }`; GET отдаёт `paidUntil`.
5. `billing-view.server.ts`: `nowPrice` в `BillingView`. `(dashboard)/layout.tsx`: собрать `CabinetPlanCard`, передать в `Header`.
6. `header.tsx`, `profile-sheet.tsx`: карточка `CabinetPlanCardView` (`src/components/layout/cabinet-plan-card.tsx`),
   «Организации этого кабинета», «Другие кабинеты»; убрать `planLine` и «Моя организация».
7. `plan-upgrade.tsx` + страница тарифа: «Ваш план» строками, название «Подписка», кнопка «Перейти на бесплатный»
   (`VoluntaryFreeButton` из `billing-transition-gate.tsx`).
8. typecheck, test, verify-worktree, коммиты.
