import assert from "node:assert/strict";
import test from "node:test";

import { parseNextQrTarget } from "@/lib/qr-next-scan";

/**
 * «Следующий QR» на экране «Записано»: камера принимает только наклейки
 * холодильников и складов своего сайта — следующий объект открывается
 * лишь его наклейкой перед камерой (физическое присутствие).
 */
const ORIGIN = "https://wesetup.ru";

test("своя наклейка холодильника и склада — открываем", () => {
  assert.equal(parseNextQrTarget("https://wesetup.ru/equipment-fill/eq1?token=abc.def", ORIGIN), "/equipment-fill/eq1?token=abc.def");
  assert.equal(parseNextQrTarget("  https://wesetup.ru/room-fill/r_2?token=t1&x=1 ", ORIGIN), "/room-fill/r_2?token=t1&x=1");
});

test("чужой домен, другие страницы, без token, javascript: — нет", () => {
  assert.equal(parseNextQrTarget("https://evil.example/equipment-fill/eq1?token=abc", ORIGIN), null);
  assert.equal(parseNextQrTarget("http://wesetup.ru/equipment-fill/eq1?token=abc", ORIGIN), null, "другая схема — другой origin");
  assert.equal(parseNextQrTarget("https://wesetup.ru.evil.example/room-fill/r1?token=abc", ORIGIN), null);
  assert.equal(parseNextQrTarget("https://wesetup.ru/journal-fill/org1/hygiene?t=abc", ORIGIN), null);
  assert.equal(parseNextQrTarget("https://wesetup.ru/equipment-fill/eq1", ORIGIN), null);
  assert.equal(parseNextQrTarget("https://wesetup.ru/equipment-fill/eq1?token=", ORIGIN), null);
  assert.equal(parseNextQrTarget("https://wesetup.ru/equipment-fill/eq1/uv?token=abc", ORIGIN), null);
  assert.equal(parseNextQrTarget("https://wesetup.ru/room-fill/?token=abc", ORIGIN), null);
  assert.equal(parseNextQrTarget("javascript:alert(1)//https://wesetup.ru/equipment-fill/eq1?token=abc", ORIGIN), null);
  assert.equal(parseNextQrTarget("/equipment-fill/eq1?token=abc", ORIGIN), null, "только полная ссылка");
  assert.equal(parseNextQrTarget("просто текст", ORIGIN), null);
  assert.equal(parseNextQrTarget("", ORIGIN), null);
});
