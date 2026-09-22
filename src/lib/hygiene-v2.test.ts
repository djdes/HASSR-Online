import assert from "node:assert/strict";
import test from "node:test";

import {
  HYGIENE_V2_COLUMNS,
  applyHygieneVerification,
  hygieneV2View,
  readHygieneFormVersion,
} from "./hygiene-v2";

/**
 * Гигиенический журнал по форме Приложения №1: сотрудник подписывает три
 * графы по QR (с PIN), ответственный (зав. производством) по второму QR
 * ставит «допущен / отстранён» и свою подпись (тоже PIN).
 */
test("новая форма — у документов с hygieneFormVersion 2", () => {
  assert.equal(readHygieneFormVersion({ hygieneFormVersion: 2 }), 2);
  assert.equal(readHygieneFormVersion({}), 1);
  assert.equal(readHygieneFormVersion(null), 1);
});

test("колонки формы Приложения №1 — как на бланке заказчика", () => {
  assert.deepEqual(
    HYGIENE_V2_COLUMNS.map((column) => column.key),
    ["n", "date", "name", "position", "temperature", "infection", "respiratorySkin", "result", "verifier"]
  );
  assert.match(HYGIENE_V2_COLUMNS[8].label, /Подпись ответственного/);
});

test("подписи сотрудника читаются и из новых трёх, и из прежних пяти подтверждений", () => {
  const fresh = hygieneV2View({ status: "healthy", confirmedAt: "07:05", source: "qr", confirmations: { temperature: true, infection: true, respiratorySkin: false } });
  assert.deepEqual(fresh.signatures, { temperature: true, infection: true, respiratorySkin: false });
  assert.equal(fresh.declaredAt, "07:05");
  const legacy = hygieneV2View({ status: "healthy", confirmations: { temperature: true, respiratory: true, intestinal: true, skin: false, family: true } });
  assert.deepEqual(legacy.signatures, { temperature: true, infection: true, respiratorySkin: false });
  assert.equal(hygieneV2View({ _autoSeeded: true }).declared, false);
});

test("допуск ответственного: результат, подпись и статус дня", () => {
  const declared = { status: "healthy", confirmedAt: "07:05", source: "qr", confirmations: { temperature: true, infection: true, respiratorySkin: true } };
  const admitted = applyHygieneVerification(declared, { result: "admitted", byUserId: "z1", byName: "Репешко И.В.", byTitle: "Заведующий производством", at: "07:20", method: "qr" });
  assert.equal(admitted.status, "healthy");
  assert.equal((admitted.verification as { result: string }).result, "admitted");
  // Сохраняем отметку сотрудника как есть (контракт сводки дня и крона).
  assert.equal(admitted.confirmedAt, "07:05");
  assert.deepEqual(hygieneV2View(admitted).result, { result: "admitted", byName: "Репешко И.В.", byTitle: "Заведующий производством", at: "07:20" });
  const suspended = applyHygieneVerification(declared, { result: "suspended", byUserId: "z1", byName: "Репешко И.В.", byTitle: null, at: "07:21", method: "qr" });
  assert.equal(suspended.status, "suspended");
});

test("правка таблицы на сайте не стирает подписи с QR и допуск", async () => {
  const { normalizeHygieneEntryData } = await import("./hygiene-document");
  const normalized = normalizeHygieneEntryData({
    status: "healthy",
    temperatureAbove37: false,
    confirmations: { temperature: true, infection: true, respiratorySkin: true },
    confirmedAt: "07:05",
    source: "qr",
    verification: { result: "admitted", byUserId: "z1", byName: "Репешко И.В.", byTitle: null, at: "07:20", method: "qr" },
    junk: "<x>",
  }) as Record<string, unknown>;
  assert.equal(normalized.status, "healthy");
  assert.deepEqual(normalized.confirmations, { temperature: true, infection: true, respiratorySkin: true });
  assert.equal(normalized.confirmedAt, "07:05");
  assert.equal(normalized.source, "qr");
  assert.equal((normalized.verification as { result: string }).result, "admitted");
  assert.equal("junk" in normalized, false);
});

test("новые документы гигиены — по новой форме, текущие остаются прежними", async () => {
  const { withNewHygieneFormVersion, keepHygieneFormVersion } = await import("./hygiene-v2");
  assert.deepEqual(withNewHygieneFormVersion("hygiene", { a: 1 }), { a: 1, hygieneFormVersion: 2 });
  // Конфиг, скопированный из документа прошлого периода, тоже получает v2.
  assert.equal(readHygieneFormVersion(withNewHygieneFormVersion("hygiene", { hygieneFormVersion: 1 })), 2);
  assert.deepEqual(withNewHygieneFormVersion("health_check", { a: 1 }), { a: 1 });
  // Пересборка config существующего документа не меняет его форму.
  assert.deepEqual(keepHygieneFormVersion({ x: 1 }, { y: 2, hygieneFormVersion: 2 }), { y: 2 });
  assert.deepEqual(keepHygieneFormVersion({ hygieneFormVersion: 2 }, { y: 2 }), { y: 2, hygieneFormVersion: 2 });
});

test("строки бланка: день за днём, внутри дня — по ФИО; выходные и заготовки не попадают", async () => {
  const { buildHygieneV2Rows } = await import("./hygiene-v2");
  const signed = { temperature: true, infection: true, respiratorySkin: false };
  const rows = buildHygieneV2Rows({
    employees: [
      { id: "b", name: "Борисова Б.Б.", position: "Повар" },
      { id: "a", name: "Алексеев А.А.", position: "Официант" },
      { id: "c", name: "Васильев В.В.", position: "Мойщик" },
    ],
    dateKeys: ["2026-09-21", "2026-09-22"],
    entries: [
      { employeeId: "b", dateKey: "2026-09-22", data: { status: "suspended", confirmations: signed, confirmedAt: "07:05", source: "qr", verification: { result: "suspended", byUserId: "z", byName: "Репешко И.В.", byTitle: "Заведующий производством", at: "07:20", method: "qr" } } },
      { employeeId: "a", dateKey: "2026-09-22", data: { status: "healthy", confirmations: { temperature: true, infection: true, respiratorySkin: true }, confirmedAt: "07:00", source: "qr" } },
      { employeeId: "b", dateKey: "2026-09-21", data: { status: "healthy", source: "keeper" } },
      { employeeId: "c", dateKey: "2026-09-21", data: { status: "day_off" } },
      { employeeId: "c", dateKey: "2026-09-22", data: { _autoSeeded: true } },
      // Вне периода документа.
      { employeeId: "a", dateKey: "2026-09-30", data: { status: "healthy", confirmations: signed } },
    ],
  });
  assert.deepEqual(
    rows.map((row) => [row.n, row.date, row.name]),
    [
      [1, "21.09.2026", "Борисова Б.Б."],
      [2, "22.09.2026", "Алексеев А.А."],
      [3, "22.09.2026", "Борисова Б.Б."],
    ]
  );
  // Отметка хранителя без подписей — графы подписи пустые.
  assert.deepEqual([rows[0].temperature, rows[0].infection, rows[0].respiratorySkin, rows[0].result, rows[0].verifier], ["", "", "", "", ""]);
  assert.deepEqual([rows[1].temperature, rows[1].infection, rows[1].respiratorySkin, rows[1].result], ["✓", "✓", "✓", ""]);
  assert.equal(rows[2].position, "Повар");
  assert.deepEqual([rows[2].temperature, rows[2].infection, rows[2].respiratorySkin], ["✓", "✓", "✗"]);
  assert.equal(rows[2].result, "отстранен");
  assert.equal(rows[2].resultKind, "suspended");
  assert.equal(rows[2].verifier, "Репешко И.В., Заведующий производством · 07:20");
});

test("печать: ✓/✗ — словами, если шрифт PDF не знает этих знаков", async () => {
  const { hygieneV2PdfMark } = await import("./hygiene-v2");
  assert.equal(hygieneV2PdfMark("✓"), "да");
  assert.equal(hygieneV2PdfMark("✗"), "нет");
  assert.equal(hygieneV2PdfMark(""), "");
});
