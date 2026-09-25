import assert from "node:assert/strict";
import test from "node:test";

import {
  ORDER_SCAN_CAMERA_CSS,
  ORDER_SCAN_CAMERA_JS,
  ORDER_SCAN_TOUCH_MEDIA,
  fitOrderScanPhoto,
  orderScanPhotoFileName,
  orderScanPhotoTitle,
  renderOrderScanCamera,
} from "@/lib/order-scan-camera";

test("камера приказа: название, имя файла и уменьшение снимка", () => {
  const at = new Date(2026, 8, 25, 14, 5);
  assert.equal(orderScanPhotoTitle(at), "Приказ — фото 25.09.2026 14:05");
  assert.equal(orderScanPhotoFileName(at), "prikaz-2026-09-25-1405.jpg");
  assert.deepEqual(fitOrderScanPhoto(4032, 3024), { width: 2400, height: 1800 });
  assert.deepEqual(fitOrderScanPhoto(1200, 1600), { width: 1200, height: 1600 });
});

test("камера приказа на QR: input с камерой, та же API, счётчик; при лимите — без кнопки", () => {
  const html = renderOrderScanCamera({ code: "hygiene", count: 2, example: "приказ <о> назначении", max: 10 });
  assert.match(html, /<section class="card oscan" id="order-scans" data-code="hygiene">/);
  assert.match(html, /<form method="post" action="\/api\/journal-order-scans" enctype="multipart\/form-data"/);
  assert.match(html, /type="file" name="file" accept="[^"]*image[^"]*" capture="environment"/);
  assert.match(html, /Загружено: <b id="oscan-count">2<\/b>/);
  assert.match(html, /приказ &lt;о&gt; назначении/);
  assert.match(ORDER_SCAN_CAMERA_JS, /fetch\("\/api\/journal-order-scans"/);
  const full = renderOrderScanCamera({ code: "hygiene", count: 10, example: "x", max: 10 });
  assert.equal(full.includes('type="file"'), false);
  assert.match(full, /Не больше 10 файлов/);
});

test("камера приказа на QR: кнопка только на сенсорных экранах, с компьютера — файлом в кабинете", () => {
  // Планшет любой ширины и телефон — `any-pointer: coarse`; компьютер с мышью — без кнопки.
  assert.equal(ORDER_SCAN_TOUCH_MEDIA, "(any-pointer: coarse)");
  assert.match(ORDER_SCAN_CAMERA_CSS, /\.btn\.oscan-cam\{display:none\}/);
  assert.match(ORDER_SCAN_CAMERA_CSS, /@media \(any-pointer: coarse\)\{\.btn\.oscan-cam\{display:flex\}\.oscan-desk\{display:none\}\}/);
  assert.doesNotMatch(ORDER_SCAN_CAMERA_CSS, /max-width|min-width/);
  const html = renderOrderScanCamera({ code: "hygiene", count: 0, example: "x", max: 10, cabinetHref: "/journals/hygiene/documents/d1" });
  assert.match(html, /<p class="muted oscan-t oscan-desk">Сфотографировать приказ можно с телефона или планшета\. С компьютера загрузите файл в кабинете — <a href="\/journals\/hygiene\/documents\/d1">открыть журнал<\/a>\.<\/p>/);
  assert.match(renderOrderScanCamera({ code: "hygiene", count: 0, example: "x", max: 10 }), /загрузите файл в кабинете\.<\/p>/);
});
