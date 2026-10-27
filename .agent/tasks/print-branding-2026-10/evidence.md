# Evidence — print-branding-2026-10

Дата: 2026-10-27. Ветка `feat/print-branding` (от origin/master 5fca740c).

| AC | Статус | Доказательство |
|----|--------|----------------|
| AC1 | PASS | `prisma/schema.prisma`: Organization `brandColor2`, `brandColor3`, `website`, `qrIconUrl`, `qrBrandFrame`, `qrCenterLogo`; модель `OrganizationQrIcon`. `prisma generate` — ок. |
| AC2 | PASS | `src/lib/print-brand.test.ts` — 10/10 (цвета по умолчанию, подбор, контраст 3:1 и 4,5:1, ч/б, сайт, монограмма). |
| AC3 | PASS (без просмотра в браузере) | `organization-branding-form.tsx`, `brand-style-preview.tsx`, API `settings/organization/qr-icon`, `org-assets/[id]/icon`; тесты `organization-profile-patch`, `org-logo-file`, `organization-pages`, `app-nav` — зелёные. |
| AC4 | PASS | `brand-qr.ts`: `frameColor`, `center` (mark/image/letter); старые тесты brand-qr без изменений зелёные. |
| AC5 | PASS | `brand-qr-decode.test.ts`: 27 сочетаний (3 цвета × 3 центра × 3 размера) распознаются jsQR; модули чёрные. Образцы: scratchpad `poster-proof/qr-*.png`. |
| AC6 | PASS | `PRINT_LOGO_MM` A4 24 / A5 20 / наклейка 5,2 мм в `qr-print-sheets.tsx`; лист проверяющего h-24; политика ХАССП `largeLogo`. |
| AC7 | PASS | `qr-plate.ts` + тесты; `layout=plate`, 4 на A4. |
| AC8 | PASS | `posters.test.ts` 11/11: 17 плакатов, 4 группы, порядок. |
| AC9 | PASS | 46 SVG-иллюстраций (`poster-art/{hands,kitchen,misc}.tsx`), контактные листы просмотрены. |
| AC10 | PASS | `posters-picker.tsx`: выбор, «Печатать выбранные», «Печатать все», «Ч/б». |
| AC11 | PASS | Пробная печать всех 17 плакатов в PDF A4 (Chrome, `printBackground: false`): цвет — 17 страниц, ч/б — 17 страниц, каждый плакат ровно на одном листе; рамка и значки видны без печати фона. |
| AC12 | PASS | `poster-data.server.ts`: порядок памяток по журналу дезсредств; QR на гигиенический журнал с фирменной рамкой. |
| AC13 | PASS | `setup-helper-branding.test.ts` 6/6 (растрирование 1 бит, размеры, версия, PNG/SVG). |
| AC14 | PASS | `gradlew :core:test` и `:app:testSiteDebugUnitTest` — BUILD SUCCESSFUL (лог `D:\wt\print-branding-app-test.log`). |
| AC15 | PASS | versionCode 6, versionName 1.3.0. Выпуск APK — workflow «Сетап помощник — проверка» с publish=true. |
| AC16 | PASS | `tsc -p tsconfig.typecheck.json` — exit 0; eslint изменённых файлов — 0 ошибок; полный `npm test` — зелёный, кроме `deploy-scripts.test.ts` под нагрузкой (отдельно 13/13); `npm run build` — см. ниже. |
| AC17 | PASS | `whats-new-notes.ts`: категория «Плакаты, QR и этикетки в фирменном стиле», иконка Palette. |
| AC18 | PASS (по коду) | Страницы без desktop-only конструкций, печать через `printPage()`. |

Не проверено вручную: просмотр страниц в браузере на проде, печать этикетки на AiYin IP-802BT, сканирование QR телефонами — после выкладки.
