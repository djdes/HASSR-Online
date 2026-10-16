# Как сняты скриншоты кабинета для слайдера на главной

Файлы: `public/landing/screens/<id>-desktop.webp` (2400×1500, снято 1440×900
при плотности 2×) и `<id>-mobile.webp` (780×1600, снято 390×800 при 2×).
Подключение и подписи — `SHOWCASE_SLIDES` в `src/app/page.tsx` и
`landing.showcase.*` в каталогах `src/i18n/messages/{ru,en,uz}.json`.

Снимки — с локальной демо-базы, не с прода (на проде данные клиентов):

1. Пустая база `wesetup_showcase` на локальном PostgreSQL (`D:/pg`, порт 5432),
   `prisma db push`, затем `prisma/seed.ts`, `prisma/seed-haccp-demo.ts`,
   ещё раз `prisma/seed.ts` и `prisma/seed-job-positions.ts`.
2. Организация переименована в «Столовая «Берёзка»» (как в QR-ролике),
   набор журналов сужен до 18 типичных для столовой (`disabledJournalCodes`).
3. Вход `admin@haccp.local` / `admin1234`, обход `/journals/<code>` по 18
   журналам — кабинет создаёт демо-документы; демо-записи гигиены и
   здоровья сдвинуты на текущий месяц; «Автозаполнить» на `/dashboard`.
4. Снято Playwright: `/dashboard`, `/journals`, документ журнала
   холодильников (прокрутка 230 px), `/settings/qr-posters?origin=https://wesetup.ru`
   (иначе на плакатах домен localhost), `/inspection`, `/settings/users`.
   Скрыты оверлей Next dev и плавающие кнопки чата (`.fixed.bottom-5.right-5`).
5. PNG → webp (Pillow, quality 78/80).

Чтобы обновить снимки после изменений интерфейса — повторить шаги 3–5 на
той же базе (или пересоздать её шагами 1–2).
