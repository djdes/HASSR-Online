# Spec (frozen 2026-09-24): сферы, журналы, приказы, чек-листы, страницы сфер

Источник: `docs/superpowers/plans/2026-09-24-master-cabinet-and-sphere-docs.md` (общие ограничения и Review Focus — там же, обязательны).

# Часть B — сферы, журналы, приказы, чек-листы, страницы сфер (ветка `feat/sphere-docs`, worktree `C:/wt/ws-b`)

### Task B1: данные — новые журналы, сфера «Фитнес», правила сфер с приказами и чек-листами, типовые чек-листы

**Files:**
- Modify: `src/lib/journal-catalog.ts` (новые коды в `EXTENDED_ONLY_JOURNALS`), `prisma/seed.ts` (шаблоны), `src/lib/register-document.ts` (`REGISTER_DOCUMENT_TEMPLATE_CODES` + поля), `src/lib/onboarding-presets.ts` (`ALL_JOURNAL_CODES`), `src/content/journal-info.ts`, `src/content/journal-seo.ts`, `src/lib/journal-sample-fixtures.ts` и прочие поштучные таблицы, которых требует рецепт `docs/superpowers/specs/journal-migration-recipe.md` (для реестрового журнала — по образцу `complaint_register`)
- Create: `prisma/seed-disable-new-journals-2026-09.ts` (+ подключить так же, как подключён `prisma/seed-disable-health-check.ts` в деплое) — у существующих организаций новые коды добавить в `disabledJournalCodes`, идемпотентно
- Modify: `src/lib/org-profile.ts` (`ORG_SPHERES` + `fitness`), `src/lib/org-lookup-map.ts` (ОКВЭД 93.11/93.12/93.13/93.19/96.04 → `fitness`), `src/lib/sphere-positions.ts` (должности фитнеса: администратор, тренер, уборщица, техник бассейна)
- Modify: `src/lib/sphere-journal-rules.ts` — `SphereRules` + `ordersRequired`, `ordersRecommended`, `checklistJournals`; правила для `fitness`; новые журналы и 9 «ничейных» журналов разнести по сферам
- Create: `src/lib/checklist-defaults.ts` (+ тест) — типовые пункты чек-листов по журналам
- Modify: тест `src/lib/sphere-journal-rules.test.ts` — новые проверки
- Modify: 43 места с «35 журналов» → общая константа из каталога (напр. `JOURNALS_TOTAL` в `journal-catalog.ts`, в текстах — склонение через существующий помощник плюрализации или «N журналов»)

**Новые журналы** (все — реестровые документы, как `complaint_register`; тариф — расширенный):

| code | Название | Поля (key: label, type) | Сферы |
|---|---|---|---|
| `daily_samples` | Журнал отбора и хранения суточных проб | date: Дата, date · meal: Приём пищи, select(Завтрак/Второй завтрак/Обед/Полдник/Ужин) · dish: Блюдо, text · mass: Масса пробы, г, number · takenAt: Время отбора, time · storageTemp: Температура хранения, °C, number · disposedAt: Дата и время утилизации, text · responsible: Ответственный, text | обяз.: education, medical; реком.: canteen, catering, hotel |
| `vitaminization` | Журнал проведения витаминизации третьих и сладких блюд | date · dish: Блюдо · preparation: Препарат · portions: Кол-во порций, number · amount: Внесено витамина, г, number · addedAt: Время внесения, time · servedAt: Время приёма блюда, time · responsible | обяз.: education, medical |
| `ration_control` | Ведомость контроля за рационом питания | period: Период (10 дней/месяц), text · productGroup: Группа продуктов, text · normPerPerson: Норма на 1 человека, г, number · factPerPerson: Фактически на 1 человека, г, number · deviation: Отклонение, %, number · note: Примечание, text | реком.: education, medical |
| `transport_temperature` | Журнал контроля температуры при транспортировке | date · vehicle: Транспорт / госномер · route: Маршрут / получатель · product: Продукция · loadTemp: Температура при загрузке, °C, number · unloadTemp: Температура при выгрузке, °C, number · time: Время, time · responsible | реком.: catering, production, retail |
| `tableware_breakage` | Журнал учёта боя посуды | date · item: Посуда / инвентарь · quantity: Кол-во, number · zone: Где (зал/кухня/бар), text · cause: Причина, text · fragments: Осколки собраны и утилизированы, select(Да/Нет) · responsible | реком.: restaurant, cafe, bar, canteen, fastfood |
| `pool_water_control` | Журнал контроля качества воды в бассейне | date · time: Время, time · pool: Бассейн / ванна, text · waterTemp: Температура воды, °C, number · freeChlorine: Свободный хлор, мг/л, number · boundChlorine: Связанный хлор, мг/л, number · ph: pH, number · transparency: Прозрачность, text · visitors: Посетителей за сеанс, number · responsible | обяз. при наличии бассейна: fitness; реком.: hotel |

Правовые основания в `law`/`basis`: для `daily_samples`, `vitaminization`, `ration_control` — СанПиН 2.3/2.4.3590-20 (номер приложения указывать только если он уже есть в коде или подтверждён официальным текстом; не выдумывать); `transport_temperature` — ТР ТС 021/2011, basis `haccp`; `tableware_breakage` — `practice`; `pool_water_control` — СП 2.1.3678-20, basis `sanpin`, `note: "проверить формулировку у юриста"` (как у retail).

**Сфера `fitness`** — «Фитнес-центр / Спортклуб / Бассейн», preset `other`, бумажные — `PAPER_FULL`:
- electronicRequired: `pest_control` (СанПиН 3.3686-21, sanpin); `pool_water_control` (condition «если есть бассейн»); `hygiene`, `cold_equipment_control` (condition «если есть фитнес-бар с продуктами»)
- electronicRecommended: `cleaning`, `general_cleaning`, `disinfectant_usage`, `uv_lamp_runtime`, `staff_training`, `accident_journal`, `complaint_register`, `climate_control`, `equipment_maintenance`, `breakdown_history`, `med_books`
- intro: для фитнеса пищевые журналы нужны только при баре; основа — бассейн, дезинфекция, уборки, охрана труда.

**Приказы по сферам** (коды из `src/lib/orders/catalog.ts`; проверить наличие каждого кода):
- пищевые сферы (restaurant, cafe, bar, canteen, fastfood, bakery, catering, hotel, gas_station, retail, production, other): required `haccp-responsible`, `sanitary-responsible`, `journals-intro`, `ppk-approval`; recommended `haccp-team`, `incoming-control`, `cleaning-schedule`, `disinfection`, `medical-examinations`, `workwear` (+ `metrology` для production, bakery)
- education, medical: как пищевые + `daily-samples` в required
- fitness: required `sanitary-responsible`, `journals-intro`, `ppk-approval`, `disinfection`; recommended `cleaning-schedule`, `medical-examinations`, `workwear`

**Чек-листы по сферам** (`checklistJournals` — журналы, для которых сфере показываем настройку чек-листа): пищевые — `cleaning`, `general_cleaning`, `disinfectant_usage`, `cold_equipment_control`; + `uv_lamp_runtime` для education/medical; fitness — `cleaning`, `general_cleaning`, `disinfectant_usage`, `uv_lamp_runtime`, `pool_water_control`.

**Типовые чек-листы** — `src/lib/checklist-defaults.ts`:
```ts
export type DefaultChecklistItem = { title: string; frequency: "daily" | "weekly" | "monthly"; required: boolean; category?: string };
export const CHECKLIST_DEFAULTS: Record<string, DefaultChecklistItem[]>; // 5–8 конкретных пунктов для каждого кода из checklistJournals всех сфер
export function defaultChecklistFor(code: string): DefaultChecklistItem[]; // [] если нет
```
Пункты — конкретные действия в стиле UX-принципа 3 CLAUDE.md («1) возьми… → 2) …»), не общие слова. Поля `JournalChecklistItem` сверить со схемой (`schema.prisma` ~L2389).

**Тесты** (`sphere-journal-rules.test.ts` и новый `checklist-defaults.test.ts`): у каждой сферы (включая fitness) все коды журналов есть в каталоге; required ∩ recommended = ∅; все `ordersRequired/ordersRecommended` есть в `ORDER_TEMPLATES`; каждый код в `checklistJournals` имеет непустой `defaultChecklistFor`; новые коды есть в `REGISTER_DOCUMENT_TEMPLATE_CODES`, `ALL_JOURNAL_CODES`, `JOURNAL_INFO`.

- [ ] Step 1: тесты (падают) → каталог, сид, реестр, инфо-страницы, фикстуры → зелёные.
- [ ] Step 2: сид отключения новых журналов у существующих организаций + подключение к деплою по образцу health-check; прогнать дважды на своей базе — второй раз без изменений.
- [ ] Step 3: сфера fitness, ОКВЭД, должности; правила сфер с приказами/чек-листами; типовые чек-листы.
- [ ] Step 4: «35 журналов» → константа (проверить `grep -rn "35 журнал" src` — пусто).
- [ ] Step 5: `npm run typecheck`, `npm test`; коммит «Новые журналы (суточные пробы, витаминизация, рацион, перевозка, бой посуды, вода в бассейне), сфера фитнес, приказы и чек-листы по сферам» (без push).

### Task B2: онбординг «Документы», настройки журналов, страницы сфер

**Files:**
- Modify: `prisma/schema.prisma` — `Organization.checklistsReviewedAt DateTime?` сразу после `disabledJournalCodes` (только если нет подходящего существующего поля для отметки «чек-листы проверены»)
- Modify: `src/lib/onboarding-core-status.ts` — `ordersDone` (все `ordersRequired` сферы имеют `CompanyOrder`), `checklistsDone` (`checklistsReviewedAt` задан); `setupFinished` требует оба
- Modify: `src/app/(dashboard)/settings/onboarding/page.tsx` — 4-я фаза «Документы» (Приказы + Чек-листы)
- Modify: `src/components/dashboard/quick-start-card.tsx` — шаг «Приказы и чек-листы»
- Create: `src/app/api/settings/onboarding/checklists/route.ts` — POST `{ action: "fill-defaults", code }` (вставить типовые пункты, если у журнала пунктов нет) / POST `{ action: "mark-reviewed" }`
- Modify: `src/app/(dashboard)/orders/[code]/…` — поддержать `?from=onboarding` → после сохранения вернуть в онбординг
- Modify: `src/components/settings/journals-settings-client.tsx` (или где группы required/recommended) — показать основание/условие и у выключенных обязательных — «Обязателен для вашей сферы — включите»
- Modify: `src/content/niches.ts` (поле `sphere` у ниши; ручные списки журналов больше не источник), `src/components/landing/niche-landing.tsx` (секции из `SPHERE_RULES`), `src/components/landing/industries-grid.tsx`
- Create: `src/app/dlya-fitnes-centra/page.tsx` (+ запись в `niches.ts`)

**Фаза «Документы» в `/settings/onboarding`:**
- «Приказы»: обязательные приказы сферы — строки «Название · Создан № … от … / Не оформлен · [Оформить]» (→ `/orders/<code>?from=onboarding`); рекомендуемые — свёрнутым списком. Прогресс «Оформлено 2 из 4».
- «Чек-листы»: журналы из `checklistJournals` сферы, которые включены у организации: «N пунктов» / «Пусто · [Заполнить типовыми]» / «[Открыть редактор]» (→ `/settings/journal-checklists/<code>`); внизу кнопка «Чек-листы проверены» (`mark-reviewed`).
- Фаза считается пройденной при `ordersDone && checklistsDone`; `QuickStartCard` показывает шаг до выполнения. Карточка появится у существующих организаций с неоформленными приказами — это намеренно (требование «чтобы всё было заполнено»).

**Страницы сфер `/dlya-*`:** секции в порядке: hero → «Что проверяет инспектор» (из `intro`/`introLaw`) → «Обязательные журналы» (название, основание, условие; ссылка на `/journals-info/<code>`) → «Рекомендуемые» → «Бумажные журналы (охрана труда и пожарная безопасность)» → «Приказы» (обязательные/рекомендуемые, ссылка на `/prikazy`) → «Чек-листы ежедневного контроля» (из `checklistJournals` + 2–3 пункта `CHECKLIST_DEFAULTS` для примера) → существующие боли/кейсы/FAQ/CTA. Новая `/dlya-fitnes-centra` — тексты своими словами (не копировать serviceinspector). Карточка в `industries-grid.tsx`. Sitemap подхватывает `NICHES` сам — проверить.

- [ ] Step 1: скилл `wesetup-design`; статус онбординга + тесты на `ordersDone/checklistsDone` (без сферы, с пустыми/полными приказами).
- [ ] Step 2: фаза «Документы», API чек-листов, возврат из редактора приказа.
- [ ] Step 3: настройки журналов (основание, «обязателен — включите»).
- [ ] Step 4: страницы сфер из правил + `/dlya-fitnes-centra` + сетка отраслей; тест коллизий маршрутов зелёный.
- [ ] Step 5: e2e на `wesetup_wt_b` (`next dev` из `c:/wt/ws-b`, порт 3032, `NEXT_DIST_DIR=.next-wt-b`): новая организация сферы fitness → в настройках журналов обязательные/рекомендуемые верные; фаза «Документы»: оформить 1 приказ → прогресс растёт; «Заполнить типовыми» → пункты появились; «Чек-листы проверены» → шаг закрыт; `/dlya-fitnes-centra` и `/dlya-shkoly…`/`/dlya-detskogo-sada` показывают журналы/приказы/чек-листы из правил. Скриншоты 1440 и 390 в `shots/`.
- [ ] Step 6: `npm run typecheck`, `npm test`, `npm run build`; evidence; коммит «Приказы и чек-листы в начальной настройке, страницы сфер из правил, страница для фитнес-центров» (без push).

**Критерии приёмки B (AC):**
- AC-B1: 6 новых журналов в каталоге, создаются и заполняются как табличные реестры, есть на `/journals-info`; у существующих организаций выключены.
- AC-B2: сфера «Фитнес-центр / Спортклуб / Бассейн» выбирается в анкете и настройках, ОКВЭД 93.1x/96.04 подсказывает её; обязательные включены, рекомендуемые показаны выключенными.
- AC-B3: у каждой сферы есть обязательные и рекомендуемые приказы и журналы для чек-листов; тесты согласованности правил зелёные.
- AC-B4: в начальной настройке есть фаза «Документы»: приказы (оформление с возвратом) и чек-листы (типовые одним нажатием, отметка «проверены»); `QuickStartCard` и статус учитывают её.
- AC-B5: страницы `/dlya-*` строятся из тех же правил (журналы с основаниями, приказы, чек-листы); есть `/dlya-fitnes-centra`, она в сетке отраслей и в sitemap.
- AC-B6: «35 журналов» нигде не зашито; typecheck, тесты, build — зелёные.

---
