import assert from "node:assert/strict";
import test from "node:test";

import {
  cleanVisionName,
  extractVisionItemsArray,
  normalizeVisionDate,
  parseVisionReply,
} from "@/lib/ai-vision/parse";

test("ответ в ```json-фенсе разбирается", () => {
  const raw = '```json\n{"items":[{"name":"Борщ со сметаной","yield":"250","time":"08:30"}]}\n```';
  const parsed = parseVisionReply(raw, "menu");
  assert.equal(parsed.recognized, true);
  assert.deepEqual(parsed.items, [{ name: "Борщ со сметаной", yield: "250", time: "08:30" }]);
});

test("текст вокруг JSON и скобки внутри строк не мешают", () => {
  const raw =
    'Вот результат: {"items":[{"name":"Салат {весенний}","yield":"150/10","time":null},{"name":"Чай [чёрный]"}]} Готово.';
  const parsed = parseVisionReply(raw, "menu");
  assert.deepEqual(parsed.items, [
    { name: "Салат {весенний}", yield: "150/10", time: "" },
    { name: "Чай [чёрный]", yield: "", time: "" },
  ]);
});

test("битый первый кандидат — берём следующий объект со списком", () => {
  const raw = '{"note": oops} потом {"items":[{"name":"Компот"}]}';
  assert.deepEqual(parseVisionReply(raw, "generic").items, [{ name: "Компот" }]);
});

test("голый массив и строки вместо объектов", () => {
  assert.deepEqual(parseVisionReply('["Молоко 3,2%", "Кефир 1%"]', "generic").items, [
    { name: "Молоко 3,2%" },
    { name: "Кефир 1%" },
  ]);
});

test("нет JSON — recognized=false и пустой список", () => {
  const parsed = parseVisionReply("На фото не видно меню.", "menu");
  assert.equal(parsed.recognized, false);
  assert.deepEqual(parsed.items, []);
  assert.equal(extractVisionItemsArray(""), null);
  assert.equal(extractVisionItemsArray('{"reply":"нет"}'), null);
});

test("пустой список — recognized=true, строк нет", () => {
  const parsed = parseVisionReply('{"items":[]}', "raw");
  assert.equal(parsed.recognized, true);
  assert.deepEqual(parsed.items, []);
});

test("заглушки, строки без букв и со знаком сомнения отбрасываются", () => {
  const raw = JSON.stringify({
    items: [
      { name: "null" },
      { name: "—" },
      { name: "12345" },
      { name: "Бор??" },
      { name: "неразборчиво" },
      { name: "  1. Плов   с курицей " },
      { name: "- Хлеб" },
    ],
  });
  assert.deepEqual(parseVisionReply(raw, "generic").items, [{ name: "Плов с курицей" }, { name: "Хлеб" }]);
  assert.equal(cleanVisionName({ name: "x" }), "");
});

test("длины обрезаются, время нормализуется, мусорное время пустое", () => {
  const long = "Я".repeat(500);
  const raw = JSON.stringify({
    items: [
      { name: long, yield: "1".repeat(50), time: "8.00" },
      { name: "Каша", yield: 200, time: "25:99" },
    ],
  });
  const [first, second] = parseVisionReply(raw, "menu").items;
  assert.equal(first.name.length, 200);
  assert.equal(first.yield.length, 20);
  assert.equal(first.time, "08:00");
  assert.deepEqual(second, { name: "Каша", yield: "200", time: "" });
});

test("сырьё: поля, синонимы, единица, даты в ГГГГ-ММ-ДД", () => {
  const raw = JSON.stringify({
    items: [
      {
        name: "Молоко 3,2%",
        manufacturer: "Молокозавод №1",
        supplier: "ООО «Ферма»",
        quantity: "10",
        unit: "л",
        productionDate: "20.09.2026",
        expiryDate: "2026-09-30",
      },
      { productName: "Творог 9%", producer: "Агрокомплекс", qty: "5 кг", expirationDate: "01.10.26", productionDate: "31.02.2026" },
    ],
  });
  assert.deepEqual(parseVisionReply(raw, "raw").items, [
    {
      name: "Молоко 3,2%",
      manufacturer: "Молокозавод №1",
      supplier: "ООО «Ферма»",
      quantity: "10 л",
      productionDate: "2026-09-20",
      expiryDate: "2026-09-30",
    },
    { name: "Творог 9%", manufacturer: "Агрокомплекс", supplier: "", quantity: "5 кг", productionDate: "", expiryDate: "2026-10-01" },
  ]);
});

test("даты: неполные и невозможные — пусто", () => {
  assert.equal(normalizeVisionDate("2026-02-29"), "");
  assert.equal(normalizeVisionDate("2028-02-29"), "2028-02-29");
  assert.equal(normalizeVisionDate("09.2026"), "");
  assert.equal(normalizeVisionDate("годен 5 суток"), "");
  assert.equal(normalizeVisionDate(null), "");
});

test("дубли убираются, больше 200 строк — обрезка с флагом", () => {
  const items = Array.from({ length: 260 }, (_, i) => ({ name: `Позиция ${i + 1}` }));
  items.splice(1, 0, { name: "позиция 1" });
  const parsed = parseVisionReply(JSON.stringify({ items }), "generic");
  assert.equal(parsed.items.length, 200);
  assert.equal(parsed.truncated, true);
  assert.equal(parsed.items[1].name, "Позиция 2");
});

test("огромный мусор не подвешивает разбор", () => {
  const raw = "{".repeat(50_000) + '{"items":[{"name":"Суп"}]}';
  const started = Date.now();
  parseVisionReply(raw, "generic");
  assert.ok(Date.now() - started < 2000);
});

test("этикетка: поля PhotoCapture, даты, число, единица, уверенность", async () => {
  const { parseLabelReply } = await import("@/lib/ai-vision/parse");
  const raw =
    '```json\n{"productName":"Сметана 20%","supplier":"ООО «Молоко»","manufactureDate":"20.09.2026","expiryDate":"2026-10-05","quantity":"0,5","unit":"KG","barcode":"4600000000000","batchNumber":null,"storageTemp":"+2…+6 °C","composition":"сливки, закваска","confidence":"high"}\n```';
  assert.deepEqual(parseLabelReply(raw), {
    productName: "Сметана 20%",
    supplier: "ООО «Молоко»",
    manufactureDate: "2026-09-20",
    expiryDate: "2026-10-05",
    quantity: 0.5,
    unit: "kg",
    barcode: "4600000000000",
    batchNumber: null,
    storageTemp: "+2…+6 °C",
    composition: "сливки, закваска",
    confidence: "high",
  });
});

test("этикетка: мусор и выдуманная уверенность — null / low", async () => {
  const { parseLabelReply } = await import("@/lib/ai-vision/parse");
  assert.equal(parseLabelReply("не вижу этикетку"), null);
  const parsed = parseLabelReply('{"productName":"Мол??","confidence":"sure","unit":"ящик","quantity":-3}');
  assert.equal(parsed?.productName, null);
  assert.equal(parsed?.confidence, "low");
  assert.equal(parsed?.unit, null);
  assert.equal(parsed?.quantity, null);
});

test("показание дисплея: число, строка с минусом и запятой, единица", async () => {
  const { parseReadingReply } = await import("@/lib/ai-vision/parse");
  assert.deepEqual(parseReadingReply('```json\n{"value": -18.5, "unit": "C", "confidence": "high"}\n```'), {
    value: -18.5,
    unit: "C",
    confidence: "high",
  });
  assert.deepEqual(parseReadingReply('Показание: {"value":"−4,5","unit":"°C","confidence":"medium"}'), {
    value: -4.5,
    unit: "C",
    confidence: "medium",
  });
  assert.deepEqual(parseReadingReply('{"value":65,"unit":"%","confidence":"high"}'), { value: 65, unit: "%", confidence: "high" });
  assert.deepEqual(parseReadingReply('{"value":1203,"unit":"ч","confidence":"high"}'), { value: 1203, unit: "h", confidence: "high" });
});

test("показание дисплея: не читается — value null, угаданные цифры не берём", async () => {
  const { parseReadingReply, normalizeReadingValue } = await import("@/lib/ai-vision/parse");
  assert.deepEqual(parseReadingReply('{"value":null,"unit":null,"confidence":"low"}'), { value: null, unit: null, confidence: "low" });
  // Уверенность без числа — всё равно low; единица без числа не нужна.
  assert.deepEqual(parseReadingReply('{"value":null,"unit":"C","confidence":"high"}'), { value: null, unit: null, confidence: "low" });
  assert.equal(parseReadingReply("дисплей не виден"), null);
  for (const bad of ["18?", "-1_", "около 5", "", "1e3", "NaN", Infinity]) {
    assert.equal(normalizeReadingValue(bad), null, String(bad));
  }
  assert.equal(normalizeReadingValue("+4"), 4);
  assert.equal(normalizeReadingValue(" - 2.0 "), -2);
});

test("проверка фото: нормализация полей, valid только явное true", async () => {
  const { parsePhotoCheckReply } = await import("@/lib/ai-vision/parse");
  assert.deepEqual(parsePhotoCheckReply('```json\n{"valid":true,"confidence":0.91,"kind":"food","reason":"Тарелка супа, фото чёткое."}\n```'), {
    valid: true,
    confidence: 0.91,
    kind: "food",
    reason: "Тарелка супа, фото чёткое.",
  });
  assert.deepEqual(parsePhotoCheckReply('{"valid":"maybe","confidence":"1.7","kind":"cat","reason":42}'), {
    valid: false,
    confidence: 1,
    kind: "other",
    reason: "42",
  });
  assert.deepEqual(parsePhotoCheckReply('{"valid":false,"kind":"BLUR"}'), { valid: false, confidence: 0, kind: "blur", reason: "" });
  assert.equal(parsePhotoCheckReply('{"reply":"не знаю"}'), null);
  assert.equal(parsePhotoCheckReply("мусор"), null);
});
