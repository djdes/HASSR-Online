import assert from "node:assert/strict";
import test from "node:test";

import { renderBrakerageList } from "@/lib/brakerage-qr-html";
import type { BrakerageQrList } from "@/lib/brakerage-qr";

/**
 * Список «За сегодня» по QR: подписанная строка готовой продукции без правок
 * после подписи — просто «Подписано», без «изменено после подписи» (раньше
 * пустой `organolepticResult` снимка сравнивался с оценкой и метка
 * появлялась сразу после подписи). Должность комиссии вне состава — только
 * просмотр с плашкой.
 */
const list: BrakerageQrList = {
  showPortion: false,
  gradeOptions: [{ value: "Доброкачественно", label: "Доброкачественно" }],
  rows: [
    {
      documentId: "d1",
      rowId: "r1",
      name: "Суп",
      time: "11:00",
      rejectionTime: "11:05",
      dayKey: "2026-09-23",
      fromYesterday: false,
      grade: "Доброкачественно",
      releaseAllowed: "yes",
      portionWeight: "",
      note: "",
      signatures: [
        {
          userId: "u1",
          name: "Иванова Анна",
          role: "Председатель",
          signedAt: "2026-09-23T08:10:00.000Z",
          method: "qr",
          grade: "Доброкачественно",
          snapshot: { productName: "Суп", organoleptic: "Доброкачественно", organolepticResult: "", releaseAllowed: "yes", portionWeight: "" },
        },
      ],
    },
  ],
};
const base = {
  action: "/a",
  who: "",
  tabs: "",
  list,
  employeeId: "u1",
  isFinished: true,
  timeZone: "Europe/Moscow",
  addHref: "/add",
  deleteHref: () => "/del",
};

test("подписанная без правок строка готовой продукции — без «изменено после подписи»", () => {
  const html = renderBrakerageList({ ...base, role: { evaluator: true, editor: false, viewer: false } });
  assert.match(html, /Подписано: Иванова А\. · /);
  assert.doesNotMatch(html, /изменено после подписи/);
});

test("правка после подписи — метка есть", () => {
  const edited = { ...list, rows: [{ ...list.rows[0], name: "Суп гороховый" }] };
  const html = renderBrakerageList({ ...base, list: edited, role: { evaluator: true, editor: false, viewer: false } });
  assert.match(html, /изменено после подписи/);
});

test("должность вне состава: плашка, без формы, радио и оценки", () => {
  const html = renderBrakerageList({ ...base, employeeId: "u-viewer", role: { evaluator: false, editor: false, viewer: true } });
  assert.match(html, /Вас нет в утверждённом составе бракеражной комиссии/);
  assert.doesNotMatch(html, /<form/);
  assert.doesNotMatch(html, /name="adm:/);
  assert.doesNotMatch(html, /name="grade:/);
});
