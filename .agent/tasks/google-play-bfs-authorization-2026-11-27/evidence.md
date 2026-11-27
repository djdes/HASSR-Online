# Evidence: Разрешение ООО «БФС» на публикацию «Сетап помощник» в Google Play (`app.wedo4u.setuphelper`)

## Acceptance Criteria Verification

- **AC1 (`PASS`):** Создана публичная страница `src/app/setup-helper/google-play-authorization/page.tsx` (`https://wesetup.ru/setup-helper/google-play-authorization`), добавлена в `src/app/sitemap.ts` и проверена в `src/lib/robots-txt.test.ts`. Содержит точный русский текст разрешения от Генерального директора ООО «БФС» Волкова Дениса Владимировича для Ольги Каракьяновой и пакета `app.wedo4u.setuphelper`, перевод на английский язык, реквизиты ООО «БФС», карточку подписи с печатью и ссылку на PDF.
- **AC2 (`PASS`):**
  - `GET /setup-helper/google-play-authorization.pdf` (`src/app/setup-helper/google-play-authorization.pdf/route.ts`) формирует официальный A4 PDF на бланке ООО «БФС» (`brand-docs/pdf-kit.ts`) с факсимиле и печатью из `LEGAL_DIR` (проверено unit-тестом `renderGooglePlayAuthorizationPdf`).
  - `GET /setup-helper/google-play-authorization-signature.png` (`src/app/setup-helper/google-play-authorization-signature.png/route.ts`) формирует непрозрачную карточку подписи и печати с защитной микросеткой без выдачи сырых исходников `facsimile.png` / `stamp.png` (проверено unit-тестом `renderGooglePlaySignatureCardPng`).
- **AC3 (`PASS`):** Блок `GooglePlayAuthorizationCard` размещён:
  1. На отдельной официальной странице `https://wesetup.ru/setup-helper/google-play-authorization` + PDF `https://wesetup.ru/setup-helper/google-play-authorization.pdf`.
  2. В политике конфиденциальности приложения `https://wesetup.ru/setup-helper/privacy#google-play-authorization`.
  3. На странице «О компании» `https://wesetup.ru/about#google-play-authorization` (с переводами `ru`, `en`, `uz`).
  4. В общей карточке реквизитов ООО «БФС» `LegalRequisites` (`https://wesetup.ru/oferta#google-play-authorization`, `https://wesetup.ru/privacy#google-play-authorization`, `https://wesetup.ru/partner-agreement#google-play-authorization`).
- **AC4 (`PASS`):**
  - `node --max-old-space-size=12288 ./node_modules/typescript/bin/tsc --noEmit --skipLibCheck -p tsconfig.typecheck.json` — `exit 0`.
  - `npm run test:changed` — 73 файла, 313 тестов, `pass=313, fail=0`.
