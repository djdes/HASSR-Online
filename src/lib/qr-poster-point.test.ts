import test from "node:test";
import assert from "node:assert/strict";

import { qrPosterPoint, qrPrintPoint, type QrPointBuilding } from "./qr-poster-point";

const office: QrPointBuilding = { id: "office", name: "Офис", address: "ул. Тверская, 1", kind: "office" };
const lenina: QrPointBuilding = { id: "lenina", name: "Кафе на Ленина", address: "ул. Ленина, 5", journalName: null };
const mira: QrPointBuilding = { id: "mira", name: "Кафе на Мира", address: null, journalName: "ООО «Доброе кафе», кафе на пр. Мира" };

test("объект с точкой — своя точка, даже если в шапке выбрана другая", () => {
  assert.deepEqual(qrPosterPoint([office, lenina, mira], "lenina", "mira"), {
    title: "Кафе на Ленина",
    detail: "ул. Ленина, 5",
    short: "Кафе на Ленина",
  });
  assert.deepEqual(qrPosterPoint([office, lenina, mira], "mira", null), {
    title: "ООО «Доброе кафе», кафе на пр. Мира",
    detail: null,
    short: "Кафе на Мира",
  });
});

test("объект без точки — точка, для которой печатают", () => {
  assert.equal(qrPosterPoint([office, lenina, mira], null, "mira")?.short, "Кафе на Мира");
});

test("наклейке — короткое название: длинные наименования точек начинаются одинаково", () => {
  const school5: QrPointBuilding = { id: "s5", name: "Пищеблок СОШ № 5", address: null, journalName: "МАУ «КП «Дружба», пищеблок МБОУ «СОШ № 5»" };
  const school112: QrPointBuilding = { id: "s112", name: "Пищеблок гимназии № 112", address: null, journalName: "МАУ «КП «Дружба», пищеблок гимназии № 112" };
  const short = [school5, school112].map((point) => qrPosterPoint([school5, school112], point.id, null)?.short);
  assert.deepEqual(short, ["Пищеблок СОШ № 5", "Пищеблок гимназии № 112"]);
});

test("без выбора точки — единственная торговая точка; офис не в счёт", () => {
  assert.equal(qrPrintPoint([office, lenina], null), lenina);
  assert.deepEqual(qrPosterPoint([lenina], null, null), { title: "Кафе на Ленина", detail: "ул. Ленина, 5", short: "Кафе на Ленина" });
});

test("несколько точек и «Вся организация» — строки точки нет", () => {
  assert.equal(qrPrintPoint([office, lenina, mira], null), null);
  assert.equal(qrPosterPoint([office, lenina, mira], null, null), null);
  assert.equal(qrPosterPoint([office, lenina, mira], "deleted", null), null);
});

test("точек нет — строки нет; помещение офиса подписано офисом", () => {
  assert.equal(qrPosterPoint([], null, null), null);
  assert.equal(qrPosterPoint([office], null, null), null);
  assert.deepEqual(qrPosterPoint([office, lenina], "office", null), { title: "Офис", detail: "ул. Тверская, 1", short: "Офис" });
});
