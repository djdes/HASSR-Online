import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  INSPECTION_VISIT_ERRORS,
  INSPECTION_VISIT_FILE_MAX_BYTES,
  INSPECTION_VISIT_MAX_REQUEST_BYTES,
  INSPECTION_VISIT_MAX_TOTAL_BYTES,
  canHideInspectionVisits,
  canUseInspectionVisits,
  inspectionVisitBasisRu,
  inspectionVisitFileAccessible,
  inspectionVisitFieldsSchema,
  inspectionVisitFileName,
  inspectionVisitHideSchema,
  inspectionVisitKindLabelRu,
  parseInspectionVisitFields,
  parseVisitedAt,
  planBundleAttachments,
} from "@/lib/inspection-visits";
import {
  checkInspectionVisitFiles,
  inspectionVisitRequestSizeError,
  storedVisitFileName,
} from "@/lib/inspection-visits.server";

function form(values: Record<string, string>) {
  return { get: (name: string) => (name in values ? values[name] : null) };
}

const valid = {
  inspectorName: "  Иванова   Анна Петровна ",
  inspectorPosition: "Главный специалист-эксперт",
  authority: "Управление Роспотребнадзора по Московской области",
  kind: "unplanned",
  basisNumber: "12-р",
  basisDate: "2026-10-01",
};

test("поля посещения: пробелы схлопываются, дата решения — полночь UTC", () => {
  const parsed = parseInspectionVisitFields(form(valid));
  assert.ok(parsed.ok);
  assert.equal(parsed.fields.inspectorName, "Иванова Анна Петровна");
  assert.equal(parsed.fields.kind, "unplanned");
  assert.equal(parsed.fields.kindNote, null);
  assert.equal(parsed.fields.basisNumber, "12-р");
  assert.equal(parsed.fields.basisDate?.toISOString(), "2026-10-01T00:00:00.000Z");
});

test("поля посещения: ФИО, должность, орган и вид обязательны, основание — нет", () => {
  for (const missing of ["inspectorName", "inspectorPosition", "authority"]) {
    const parsed = parseInspectionVisitFields(form({ ...valid, [missing]: " " }));
    assert.equal(parsed.ok, false, missing);
    if (!parsed.ok) assert.equal(parsed.field, missing);
  }
  const noKind = parseInspectionVisitFields(form({ ...valid, kind: "raid" }));
  assert.equal(noKind.ok, false);
  const noBasis = parseInspectionVisitFields(form({ ...valid, basisNumber: "", basisDate: "" }));
  assert.ok(noBasis.ok);
  if (noBasis.ok) {
    assert.equal(noBasis.fields.basisNumber, null);
    assert.equal(noBasis.fields.basisDate, null);
  }
});

test("поля посещения: необязательных ключей может не быть совсем (JSON без kindNote и основания)", () => {
  // С zod 4.4 ключ с `z.undefined()` внутри union стал обязательным —
  // схема держит необязательные поля через `.nullish()`.
  const parsed = inspectionVisitFieldsSchema.safeParse({
    inspectorName: valid.inspectorName,
    inspectorPosition: valid.inspectorPosition,
    authority: valid.authority,
    kind: "planned",
  });
  assert.ok(parsed.success, JSON.stringify(parsed.error?.issues));
  assert.equal(parsed.data.kindNote, null);
  assert.equal(parsed.data.basisNumber, null);
  assert.equal(parsed.data.basisDate, null);
});

test("вид «иное» требует пояснения, у других видов пояснение отбрасывается", () => {
  const other = parseInspectionVisitFields(form({ ...valid, kind: "other" }));
  assert.equal(other.ok, false);
  if (!other.ok) assert.equal(other.field, "kindNote");
  const explained = parseInspectionVisitFields(form({ ...valid, kind: "other", kindNote: "профилактический визит" }));
  assert.ok(explained.ok);
  if (explained.ok) assert.equal(inspectionVisitKindLabelRu(explained.fields.kind, explained.fields.kindNote), "Иное: профилактический визит");
  const planned = parseInspectionVisitFields(form({ ...valid, kind: "planned", kindNote: "лишнее" }));
  assert.ok(planned.ok);
  if (planned.ok) assert.equal(planned.fields.kindNote, null);
});

test("дата решения: только существующая дата ГГГГ-ММ-ДД", () => {
  for (const bad of ["01.10.2026", "2026-02-30", "2026-13-01"]) {
    const parsed = parseInspectionVisitFields(form({ ...valid, basisDate: bad }));
    assert.equal(parsed.ok, false, bad);
  }
});

test("время посещения: пусто — сейчас, будущее и старше года — ошибка", () => {
  const now = new Date("2026-10-17T12:00:00Z");
  const empty = parseVisitedAt("", now);
  assert.ok(empty.ok && empty.date === now);
  const earlier = parseVisitedAt("2026-10-17T09:30:00.000Z", now);
  assert.ok(earlier.ok && earlier.date.toISOString() === "2026-10-17T09:30:00.000Z");
  assert.equal(parseVisitedAt("2026-10-18T09:30:00.000Z", now).ok, false);
  assert.equal(parseVisitedAt("2025-09-01T09:30:00.000Z", now).ok, false);
  assert.equal(parseVisitedAt("вчера", now).ok, false);
});

test("журнал посещений в кабинете: руководство и заведующая с «проверкой задач», не повар", () => {
  assert.equal(canUseInspectionVisits({ role: "manager" }), true);
  assert.equal(canUseInspectionVisits({ role: "owner" }), true);
  assert.equal(canUseInspectionVisits({ role: "head_chef" }), true);
  assert.equal(canUseInspectionVisits({ role: "cook", isRoot: true }), true);
  assert.equal(canUseInspectionVisits({ role: "cook", permissionPreset: "head_chef" }), true);
  assert.equal(canUseInspectionVisits({ role: "cook" }), false);
  assert.equal(canUseInspectionVisits({ role: "waiter", permissionPreset: "cashier" }), false);
});

const file = (organizationId: string, tokenId: string | null, opts: { visitId?: string; hiddenAt?: Date | null } = {}) => ({
  organizationId,
  visitId: opts.visitId ?? "visit-1",
  visit: { organizationId, tokenId, hiddenAt: opts.hiddenAt ?? null },
});

test("вложение: кабинет — только своя организация и только с правом (скрытые тоже)", () => {
  const own = file("org-a", "tok-1");
  assert.equal(inspectionVisitFileAccessible({ file: own, viewer: { kind: "cabinet", organizationId: "org-a", allowed: true } }), true);
  assert.equal(inspectionVisitFileAccessible({ file: own, viewer: { kind: "cabinet", organizationId: "org-a", allowed: false } }), false);
  assert.equal(inspectionVisitFileAccessible({ file: own, viewer: { kind: "cabinet", organizationId: "org-b", allowed: true } }), false);
  assert.equal(inspectionVisitFileAccessible({ file: null, viewer: { kind: "cabinet", organizationId: "org-a", allowed: true } }), false);
  const hidden = file("org-a", "tok-1", { hiddenAt: new Date() });
  assert.equal(inspectionVisitFileAccessible({ file: hidden, viewer: { kind: "cabinet", organizationId: "org-a", allowed: true } }), true);
});

test("вложение: проверяющий — только свои записи (токен + cookie браузера), не скрытые, пока токен действует", () => {
  const viewer = { kind: "token" as const, organizationId: "org-a", tokenId: "tok-1", active: true, visitIds: ["visit-1"] };
  assert.equal(inspectionVisitFileAccessible({ file: file("org-a", "tok-1"), viewer }), true);
  assert.equal(inspectionVisitFileAccessible({ file: file("org-a", "tok-2"), viewer }), false, "чужой токен");
  assert.equal(inspectionVisitFileAccessible({ file: file("org-a", null), viewer }), false, "запись руководства");
  assert.equal(inspectionVisitFileAccessible({ file: file("org-b", "tok-1"), viewer }), false, "чужая организация");
  assert.equal(inspectionVisitFileAccessible({ file: file("org-a", "tok-1"), viewer: { ...viewer, active: false } }), false, "токен истёк");
  // Тот же постоянный QR, но запись внёс другой проверяющий (не в cookie этого браузера).
  assert.equal(inspectionVisitFileAccessible({ file: file("org-a", "tok-1", { visitId: "visit-march" }), viewer }), false, "чужая запись того же QR");
  assert.equal(inspectionVisitFileAccessible({ file: file("org-a", "tok-1"), viewer: { ...viewer, visitIds: [] } }), false, "без cookie");
  assert.equal(inspectionVisitFileAccessible({ file: file("org-a", "tok-1", { hiddenAt: new Date() }), viewer }), false, "скрыта");
  // Подделанная строка: организация файла и посещения расходятся — отказ.
  assert.equal(
    inspectionVisitFileAccessible({
      file: { organizationId: "org-a", visitId: "visit-1", visit: { organizationId: "org-b", tokenId: "tok-1", hiddenAt: null } },
      viewer,
    }),
    false
  );
});

test("скрыть как ошибочную: причина обязательна, вернуть — без причины; только руководитель", () => {
  assert.equal(inspectionVisitHideSchema.safeParse({ hidden: true, reason: "  " }).success, false);
  assert.equal(inspectionVisitHideSchema.safeParse({ hidden: true }).success, false);
  const ok = inspectionVisitHideSchema.safeParse({ hidden: true, reason: "  тестовая   запись " });
  assert.ok(ok.success && ok.data.reason === "тестовая запись");
  assert.equal(inspectionVisitHideSchema.safeParse({ hidden: true, reason: "я".repeat(301) }).success, false);
  assert.ok(inspectionVisitHideSchema.safeParse({ hidden: false }).success);
  assert.equal(canHideInspectionVisits({ role: "manager" }), true);
  assert.equal(canHideInspectionVisits({ role: "cook", permissionPreset: "head_chef" }), false, "заведующая только смотрит и вносит");
  assert.equal(canHideInspectionVisits({ role: "cook" }), false);
});

test("архив: вложения в пределах объёма, остальные — в счёт пропущенных", () => {
  const files = [
    { id: "a", sizeBytes: 40 },
    { id: "b", sizeBytes: 70 },
    { id: "c", sizeBytes: 50 },
    { id: "d", sizeBytes: 10 },
  ];
  const plan = planBundleAttachments(files, 100);
  assert.deepEqual(plan.included.map((item) => item.id), ["a", "c", "d"]);
  assert.deepEqual(plan.skipped, { count: 1, bytes: 70 });
  assert.equal(planBundleAttachments(files).skipped.count, 0, "по умолчанию 100 МБ");
});

test("размер тела: без Content-Length — 411, больше предела — 413", async () => {
  const req = (headers: Record<string, string>) => new Request("https://wesetup.ru/x", { method: "POST", headers });
  const missing = inspectionVisitRequestSizeError(req({}));
  assert.equal(missing?.status, 411);
  assert.equal((await missing?.json()).error, INSPECTION_VISIT_ERRORS.lengthRequired);
  assert.equal(inspectionVisitRequestSizeError(req({ "content-length": "abc" }))?.status, 411);
  assert.equal(inspectionVisitRequestSizeError(req({ "content-length": String(INSPECTION_VISIT_MAX_REQUEST_BYTES + 1) }))?.status, 413);
  assert.equal(inspectionVisitRequestSizeError(req({ "content-length": "1024" })), null);
});

test("имя файла и основание для печати", () => {
  assert.equal(inspectionVisitFileName("Решение: 12/р.HEIC", "image/jpeg"), "Решение 12 р.jpg");
  assert.equal(inspectionVisitFileName("", "application/pdf"), "osnovanie.pdf");
  assert.equal(inspectionVisitBasisRu("12-р", "2026-10-01"), "№ 12-р от 01.10.2026");
  assert.equal(inspectionVisitBasisRu(null, null), "—");
  assert.equal(storedVisitFileName("лист\u0000 1\r\n.jpg"), "лист 1 .jpg");
  assert.equal(storedVisitFileName("   "), "osnovanie");
});

test("предел запроса помещается в буфер proxy: форма не приходит обрезанной", () => {
  const config = readFileSync(path.join(process.cwd(), "next.config.ts"), "utf8");
  const match = config.match(/proxyClientMaxBodySize:\s*"(\d+)mb"/);
  assert.ok(match, "в next.config.ts задан proxyClientMaxBodySize");
  const proxyLimit = Number(match[1]) * 1024 * 1024;
  assert.ok(INSPECTION_VISIT_MAX_REQUEST_BYTES < proxyLimit);
  assert.ok(INSPECTION_VISIT_MAX_TOTAL_BYTES < INSPECTION_VISIT_MAX_REQUEST_BYTES);
  // Хотя бы два файла по 10 МБ в одном запросе.
  assert.ok(INSPECTION_VISIT_MAX_TOTAL_BYTES >= 2 * INSPECTION_VISIT_FILE_MAX_BYTES);
});

test("проверка вложений до чтения содержимого: число, размер файла и сумма", async () => {
  const fake = (size: number, name = "a.jpg") => ({ size, name, type: "image/jpeg", arrayBuffer: async () => assert.fail("не читаем") }) as unknown as File;
  const six = await checkInspectionVisitFiles(Array.from({ length: 6 }, () => fake(10)));
  assert.deepEqual(six, { ok: false, error: INSPECTION_VISIT_ERRORS.tooMany, status: 400 });
  const attachOver = await checkInspectionVisitFiles([fake(10), fake(10)], 4);
  assert.deepEqual(attachOver, { ok: false, error: INSPECTION_VISIT_ERRORS.tooMany, status: 409 });
  const big = await checkInspectionVisitFiles([fake(INSPECTION_VISIT_FILE_MAX_BYTES + 1)]);
  assert.deepEqual(big, { ok: false, error: INSPECTION_VISIT_ERRORS.tooBig, status: 413 });
  const sum = await checkInspectionVisitFiles([fake(9 * 1024 * 1024), fake(9 * 1024 * 1024), fake(9 * 1024 * 1024)]);
  assert.deepEqual(sum, { ok: false, error: INSPECTION_VISIT_ERRORS.requestTooBig, status: 413 });
});
