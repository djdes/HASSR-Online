# Evidence — tg-client-location-2026-11

| AC | Где | Проверка |
|----|-----|----------|
| AC1 | `src/lib/ip-geo.ts` `clientLocationLine` | `src/lib/ip-geo.test.ts` — «🇷🇺 Россия, Казань · 14:32», fallback на город/пояс организации |
| AC2 | `src/lib/blank-download.ts` `buildBlankDownloadAdminText`, `api/public/blank-download/route.ts` | `blank-download.test.ts`, `blank-download-extras.test.ts`, `blank-download-phone-autoreg.test.ts` — «📥 Скачивание журнала: …», «✅ Кабинет создан, доступ отправлен», последней строкой `<a>Открыть</a>` |
| AC3 | `src/lib/admin-client-context(.server).ts` | организация → `/root/organizations/<id>`, иначе CRM-контакт по почте/телефону; `admin-client-context.test.ts` |
| AC4 | `notifyPlatformAdmin(..., { client })` в `platform-admin.ts`; вызовы: instant-register, register/confirm, demo-request, feedback (сайт и кабинет), support widget, support chat (сайт и кабинет), бот поддержки, NPS, отзывы (2), анкета, заявки на услуги/доставку, счета (2), оплата, пополнение, триал-опрос, реферал, партнёрские события с организацией | typecheck; хвост — чистая функция `appendAdminClientLines` с тестом; сбои гео/БД перехвачены |
| AC5 | `root/organizations/[id]/page.tsx` + `client-local-time.tsx` | часы рядом с телефоном владельца, тикают каждые 20 с; пояс по IP входа, иначе организации |
| AC6 | `prisma/schema.prisma` (`Organization.city`, `countryCode` nullable), `geo-places.ts`, `organization-place.server.ts`, `/api/public/place-hint`, `register-client.tsx`, `hero-email-start.tsx`, `instant-account.server.ts`, `blank-download-extras.server.ts` | `geo-places.test.ts` (каталог валиден, подсказки, итоговый пояс) |
| AC7 | `organization-contacts-form.tsx`, `organization-profile-patch.ts` (`city`, `countryCode`) | typecheck; выбор города ставит пояс |
| AC8 | `OrgTimeZoneProvider` в `(dashboard)/layout.tsx`; чек-листы (UI, страница, PDF), подписи бракеража скоропорта (UI и PDF через `DOCUMENT_ORG_SELECT.timezone`) | typecheck; `custom-checklist-display.test.ts` |
| AC9 | `src/i18n/messages/{ru,en,uz}.json`, `npm run i18n:types` | typecheck + тесты |

Сырые результаты — `raw/`.
