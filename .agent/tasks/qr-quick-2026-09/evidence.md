# Evidence — G-quick (2026-09-23)

## AC1 Галка — PASS
- `src/lib/qr-pin-ui.ts`: общие `QR_CHECK_SVG`, `QR_CHECK_CSS`, `qrCheckHtml()`, `QR_SUCCESS_CHECK_HTML`, `QR_CHECK_COLOR`; `QR_PIN_OK_HTML` — круг 120px; `.qp-ok` max-height 190px + padding 16/18px (ореол не режется), схлопывание в 0,9 с.
- `src/components/qr-fill/success-check.tsx`: та же разметка/CSS (React 19 `<style href precedence>`), 112px.
- Скриншоты 390px: `shots/check-static-before.png` (до), `shots/check-static-after.png`, `shots/check-static-after-reduced.png` (animationName=none), `shots/after-pin-ok-390.png`, `shots/after-fridge-saved-390.png`, `shots/after-room-saved-390.png`.
- e2e: фон rgb(5,150,105), border 0, box-shadow с rgba(5,150,105,.14), ореол целиком внутри `.qp-ok`; reduced-motion → animation none.

## AC2 PIN 30 минут — PASS
- `qr-pin-pass.ts`: TTL 30 мин, формат v3 с отпечатком PIN (`qrPinFingerprint` = 8 симв. sha256 от qrPinHash), `qrPassCookieName/qrPassSetCookie/qrPassClearCookie/readQrPass`; v2 оставлен для плакатов журналов.
- `qr-object-pass.ts`: `isObjectPassValid` (подпись + организация + flow any + срок + отпечаток текущего PIN + нет блокировки), `readObjectPassCookie`, `passEmployeeIdFromCookie`, `resolveObjectActor({ cookiePass })`.
- `/api/qr-fill/pass`: cookie ставится только при remember=true; remember=false снимает; `logout: true` снимает пропуск и запомненный выбор.
- e2e (smoke.ts): F5, второй холодильник, склад, УФ-лампа — без PIN; другой сотрудник — PIN и API 4xx; чужая организация — 4xx; «Не вы? Сменить» — cookie снята; remember off — cookie нет и F5 → PIN; JSON-пропуск без cookie — 200; сброс PIN → API 4xx и страница снова PIN; блокировка → 423.

## AC3 «Следующий QR» — PASS
- `src/lib/qr-next-scan.ts` + `qr-next-scan.test.ts` (2 теста, 14 проверок).
- `src/components/qr-fill/next-qr-button.tsx` (ScanLine, QrCameraSheet, подсказка «Это не наклейка холодильника или склада»); на «Записано» холодильника и склада — главной кнопкой, «Записать ещё замер» — вторичной.
- e2e: кнопка есть, открывает сканер (`shots/after-next-qr-camera-390.png`: «Камера не найдена.» в headless — ожидаемо), на экране нет id/токенов других объектов.

## AC4 Проверки — PASS
- `NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck` — без ошибок.
- `npx eslint <19 изменённых файлов>` — 0 проблем.
- `npm test` — 2059/2059 pass.
- `BASE=http://localhost:3025 npx tsx .agent/tasks/qr-quick-2026-09/e2e/smoke.ts` — 28/28 PASS (`e2e/smoke.json`).
