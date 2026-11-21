# Как сняты экраны кабинета для слайдера на главной (21.11.2026)

> **Одной командой:** `npm run screens:landing -- --seed` (`scripts/landing-screens.ts`)
> делает шаги 2–8 ниже на локальной базе: нужна пустая база после `prisma db push` и
> `npm run dev` с той же базой (`SCREENS_BASE`, если не `http://localhost:3000`).
> Снимки — в `public/landing/screens/<дата>/`; затем поменять `SHOWCASE_SCREENS_DIR`.
> С нелокальной базой команда не запускается.

Файлы: `public/landing/screens/2026-11-21/<id>-desktop.webp` (2400×1500, снято
1440×900 при 2× и уменьшено) и `<id>-mobile.webp` (780×1600, снято 390×800 при
2×). Папка — в `SHOWCASE_SCREENS_DIR` (`src/components/landing/showcase-screens.ts`).
Картинки `/landing/*` кэшируются на неделю без хеша в имени, поэтому каждая новая
съёмка — новая папка с датой, старая удаляется.

Снимки — с локальной демо-базы, не с прода (на проде данные клиентов).

1. PostgreSQL 16 в контейнере, база `wesetup_showcase`; `.env` из `.env.shared`
   с этой базой и **пустыми** ключами Telegram/DaData/Tuya (никаких отправок
   наружу). `npx prisma db push`, затем `prisma/seed.ts`,
   `prisma/seed-haccp-demo.ts`, ещё раз `prisma/seed.ts` и
   `prisma/seed-job-positions.ts`.
2. Организация «Столовая «Берёзка»», 18 журналов столовой (остальные — в
   `disabledJournalCodes`): hygiene, health_check, general_cleaning,
   equipment_maintenance, finished_product, perishable_rejection, daily_samples,
   incoming_control, vitaminization, staff_training, cleaning, pest_control,
   disinfectant_usage, fryer_oil, uv_lamp_runtime, cold_equipment_control,
   climate_control, med_books.
3. Вход `admin@haccp.local` / `admin1234`, принять обновлённые условия, обход
   `/journals/<code>` по 18 журналам — кабинет создаёт документы. Объект —
   `POST /api/settings/buildings` («Столовая «Берёзка»», г. Москва, ул. Садовая, 12).
4. Записи за месяц: спецрежим включён (`raw/journal-controls.ts on`),
   автоматика журналов в `journalAutomationJson` и `autoFill` у документов —
   на время; `POST /api/organizations/auto-journals/apply` по каждому журналу
   догоняет месяц по сегодня. Потом автоматика журналов и `autoFill` документов
   сняты, спецрежим оставлен — на «Сегодня» видна кнопка «Автозаполнить».
   «Сегодня» снят на 6/18.
5. Для «Мониторинга» после снимка «Сегодня»: записи полевых журналов через
   `POST /api/journals` (6 шт.) → 12/18; ППК — стартовый набор «Столовая»
   (`POST /api/production-control/starter`), группа ХАССП из трёх человек,
   утверждённая политика, решения по всем значимым опасностям (2 ККТ, 2 ОПП,
   5 ПРП) → 8/14; чек-листы — три типовых шаблона, шесть назначений на объект
   (дата создания сдвинута на 20.10), четыре проведённые проверки
   (`raw/complete-checklists.ts`) → 4/6. Итог 67 % / 67 % / 57 %.
6. «Сотрудники» — отдельная вымышленная организация ООО «Пример» с нейтральными
   должностями (руководитель, администратор, специалист, уборщик); не «ООО «БФС»» —
   это юрлицо сервиса из подвала сайта, а сотрудники на снимке вымышленные:
   `raw/seed-neutral-staff.ts`, вход `owner@example.local` / `demo12345`, объект
   «Филиал на Тверской», телефон владельца — чтобы не было плашки «Завершите
   регистрацию». См. `docs/brand-content.md`.
7. Съёмка — `raw/capture-screens.cjs` (Playwright): скрыты оверлей Next dev,
   кнопка чата, «Сообщить о проблеме», MAX в шапке и плавающая «Дальше: …» на
   телефоне. Прокрутка: журнал холодильников — 290 px на ПК; «Мониторинг» на
   телефоне — к карточке «Журналы»; QR-коды на телефоне — 330 px.
8. PNG → webp (Pillow): ПК quality 78, телефон quality 80.

Даты привязаны к дню съёмки: на другой день «сегодня» обнулится, шаги 4–5
повторить.
