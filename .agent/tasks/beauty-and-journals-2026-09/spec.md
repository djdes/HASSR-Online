# Spec (frozen 2026-09-24): недостающие журналы по сверке с Service Inspector, сфера «Салон красоты», чек-листы с учётом сферы

Основа — сверка с Service Inspector (тестовый доступ в админку + 293 публичные страницы, 24.09.2026). Почти все их журналы у нас есть. Не хватает четырёх; у них есть сфера «салоны красоты / барбершопы», которой нет у нас; их чек-листы для фитнеса, отелей и салонов привязаны к особенностям сферы. Их тексты не копируем — только состав.

Опирается на то, что сделано в `.agent/tasks/sphere-docs-2026-09` (реестровые журналы в `src/lib/register-journals.ts`, `SPHERE_RULES` с `ordersRequired/ordersRecommended/checklistJournals`, `src/lib/checklist-defaults.ts`, `src/lib/sphere-public-content.ts`, страницы `/dlya-*` из правил, одноразовый сид выключения новых журналов у существующих организаций). Делать ровно тем же путём.

## A. Четыре новых реестровых журнала (расширенный тариф)

| code | Название | Поля (key: label, type) | Сферы |
|---|---|---|---|
| `inventory_condition` | Журнал оценки состояния металлического и пластикового инвентаря | date: Дата, date · zone: Цех / участок, text · item: Инвентарь, text · material: Материал, select(Металл/Пластик) · condition: Состояние, select(Исправен/Есть повреждения/Изъят из работы) · action: Что сделано, text · responsible: Ответственный, text | реком.: restaurant, cafe, canteen, fastfood, catering, bakery, production |
| `instrument_sterilization` | Журнал контроля стерилизации инструментов | date · instruments: Инструменты (наименование, кол-во), text · method: Способ, select(Воздушный (сухожар)/Паровой (автоклав)/Химический/Гласперленовый) · mode: Режим (°C, мин), text · indicator: Индикатор сработал, select(Да/Нет) · sterilizer: Стерилизатор, text · responsible | обяз.: beauty; реком.: medical |
| `medical_waste_b` | Журнал учёта отходов класса Б | date · wasteType: Вид отходов, text · amount: Количество, кг, number · disinfection: Обеззараживание, text · packaging: Упаковка, select(Жёлтый пакет/Жёлтый контейнер для острого) · handedTo: Кому передано, text · responsible | обяз. при наличии косметологии/инъекций: beauty; реком.: medical |
| `batch_release` | Журнал допуска партии продукции к отгрузке | date · product: Продукция, text · batch: Номер партии, text · quantity: Количество, text · checks: Проверено (органолептика, маркировка, упаковка), text · decision: Решение, select(Допущено/Не допущено) · responsible | реком.: production, bakery |

- Тот же путь, что у шести журналов 24.09: поля в `register-journals.ts`, сид шаблонов, каталог (в конец, sortOrder дальше 41), `REGISTER_DOCUMENT_TEMPLATE_CODES`, `ALL_JOURNAL_CODES`, `JOURNAL_INFO`, `JOURNAL_SEO`, фикстуры образцов, картинки `public/journal-samples/<code>.{png,webp}` (через `render-journal-sample-thumbs.ts` с `ONLY_CODES`), периодичность, конфиги по умолчанию, пресеты ответственных, инструкции, иконки — всё, что требует рецепт и тесты.
- У существующих организаций новые коды выключены: НОВЫЙ одноразовый сид (флаг `once:new-journals-2026-09b-default-off:v1`; сид 24.09 уже отработал на проде со своим флагом и повторно не запустится) и подключение в `deploy.yml` рядом с прошлым.
- Правовые основания без номеров пунктов, если их нет в коде или официальном тексте: стерилизация и отходы — СанПиН 2.1.3678-20 и СанПиН 2.1.3684-21 (пометка «проверить у юриста» — только в `note`, на публичные страницы не выводится); инвентарь и допуск партии — `haccp`/`practice`.

## B. Сфера `beauty` — «Салон красоты / Барбершоп / Маникюр»

- `ORG_SPHERES` (preset `other`), ОКВЭД 96.02 → `beauty` (+ тест), должности: администратор, парикмахер, мастер маникюра, косметолог, уборщица.
- `SPHERE_RULES.beauty`: required — `instrument_sterilization`, `general_cleaning`, `disinfectant_usage`; `medical_waste_b` с условием «если есть косметология или инъекции»; recommended — `cleaning`, `uv_lamp_runtime`, `pest_control`, `staff_training`, `accident_journal`, `complaint_register`, `climate_control`, `med_books`; бумажные — `PAPER_FULL`; ordersRequired — `sanitary-responsible`, `journals-intro`, `ppk-approval`, `disinfection`; ordersRecommended — `cleaning-schedule`, `medical-examinations`, `workwear`; checklistJournals — `cleaning`, `general_cleaning`, `disinfectant_usage`, `uv_lamp_runtime`, `instrument_sterilization`. Вступление своими словами: для салона основа — стерилизация инструментов, дезинфекция, уборки; пищевые журналы не нужны.
- Остальным сферам разнести новые журналы по таблице раздела A.
- Страница `/dlya-salona-krasoty` (запись в `niches.ts` с `sphere: "beauty"`, обёртка `src/app/dlya-salona-krasoty/page.tsx`), карточка в `industries-grid.tsx` (группа «Красота и уход»), sitemap подхватывает сам, тест коллизий маршрутов зелёный.

## C. Типовые чек-листы с учётом сферы

- `checklist-defaults.ts`: переопределения по сфере `CHECKLIST_DEFAULTS_BY_SPHERE: Partial<Record<sphere, Partial<Record<code, DefaultChecklistItem[]>>>>` и `defaultChecklistFor(code, sphere?)` — сначала пункты сферы, иначе общие.
- Наполнить (5–7 конкретных шагов, в стиле «1) возьми… → 2) …», своими словами):
  - fitness: `cleaning` (залы, раздевалки, душевые, санузлы, тренажёры и коврики), `general_cleaning`, `disinfectant_usage`;
  - hotel: `cleaning` (номер после выезда гостя, коридоры, ресепшн), `general_cleaning`;
  - beauty: `cleaning` (рабочее место мастера между клиентами, кресла, раковины, инструменты в дезрастворе), `general_cleaning`, `instrument_sterilization` (общие пункты для этого журнала — в основной таблице, раз его нет ни у кого).
- Этап «Документы» (`/api/settings/onboarding/checklists` fill-defaults) и страницы сфер берут пункты с учётом сферы организации/страницы.

## Не делать
- Не править `src/lib/whats-new-notes.ts` и CHANGES.md (их обновит оркестратор).
- Не трогать мастер-кабинет и чужие незакоммиченные файлы; не писать в `D:/www/Wesetup.ru`.

## Критерии приёмки
- AC1: 4 журнала есть в каталоге и на `/journals-info/<code>`, создаются и заполняются как реестры, печать PDF 200, у существующих организаций выключены (сид дважды: второй раз — «уже выполнено»).
- AC2: сфера «Салон красоты / Барбершоп / Маникюр» выбирается, ОКВЭД 96.02 её подсказывает; у новой организации этой сферы обязательные включены, рекомендуемые выключены.
- AC3: у каждой сферы правила согласованы (тесты `sphere-journal-rules`), новые журналы разнесены по сферам.
- AC4: «Заполнить типовыми» у фитнеса, отеля и салона даёт пункты своей сферы; у остальных — общие; тесты `checklist-defaults`.
- AC5: `/dlya-salona-krasoty` строится из правил (журналы с основаниями, приказы, чек-листы с примерами пунктов сферы), есть в сетке отраслей и sitemap; служебных пометок «юрист» на публичной странице нет.
- AC6: typecheck, `npm test`, `npm run build` — зелёные; e2e на своей базе со скриншотами 1440 и 390.
