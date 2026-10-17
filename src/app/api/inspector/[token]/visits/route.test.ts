import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { createCanvas } from "@napi-rs/canvas";
import { PDFDocument } from "pdf-lib";

import { db } from "@/lib/db";
import { INSPECTION_VISIT_ERRORS, INSPECTION_VISIT_MAX_REQUEST_BYTES } from "@/lib/inspection-visits";
import { ORDER_SCAN_ERRORS } from "@/lib/journal-order-scans";
import { POST } from "./route";

/**
 * POST /api/inspector/[token]/visits — запись проверяющего в журнал
 * посещений по токену QR (AC2, AC8). БД подменена: проверяется, что
 * организация берётся из токена, отказы не пишут ничего, а файл проверяется
 * по содержимому.
 */

const original = {
  findToken: db.inspectorToken.findUnique,
  countVisits: db.inspectionVisit.count,
  createVisit: db.inspectionVisit.create,
  audit: db.auditLog.create,
};

type TokenRow = { id: string; revokedAt: Date | null; expiresAt: Date; organizationId: string };
let tokenRow: TokenRow | null;
let visitsToday: number;
let created: Array<Record<string, unknown>>;
let audits: Array<Record<string, unknown>>;
let ipCounter = 0;

function tokenRecord(row: TokenRow) {
  return {
    ...row,
    label: "QR",
    periodFrom: new Date("2026-07-01T00:00:00Z"),
    periodTo: new Date("2026-10-17T00:00:00Z"),
    organization: {
      id: row.organizationId,
      name: "Кафе",
      journalShortName: null,
      legalProfileJson: null,
      inn: null,
      address: null,
      timezone: "Europe/Moscow",
      disabledJournalCodes: [],
    },
  };
}

beforeEach(() => {
  tokenRow = { id: "tok-1", revokedAt: null, expiresAt: new Date(Date.now() + 86_400_000), organizationId: "org-a" };
  visitsToday = 0;
  created = [];
  audits = [];
  db.inspectorToken.findUnique = (async () => (tokenRow ? tokenRecord(tokenRow) : null)) as unknown as typeof db.inspectorToken.findUnique;
  db.inspectionVisit.count = (async () => visitsToday) as unknown as typeof db.inspectionVisit.count;
  db.inspectionVisit.create = (async (args: { data: Record<string, unknown> }) => {
    created.push(args.data);
    const files = (args.data.files as { create: unknown[] } | undefined)?.create ?? [];
    return { id: "visit-1", visitedAt: new Date("2026-10-17T09:00:00Z"), files: files.map((_, i) => ({ id: `f-${i}` })) };
  }) as unknown as typeof db.inspectionVisit.create;
  db.auditLog.create = (async (args: { data: Record<string, unknown> }) => {
    audits.push(args.data);
    return args.data;
  }) as unknown as typeof db.auditLog.create;
});

afterEach(() => {
  db.inspectorToken.findUnique = original.findToken;
  db.inspectionVisit.count = original.countVisits;
  db.inspectionVisit.create = original.createVisit;
  db.auditLog.create = original.audit;
});

const RAW_TOKEN = "A".repeat(43);
const params = (token = RAW_TOKEN) => ({ params: Promise.resolve({ token }) });

const FIELDS = {
  inspectorName: "Иванова Анна Петровна",
  inspectorPosition: "Главный специалист-эксперт",
  authority: "Управление Роспотребнадзора по Московской области",
  kind: "unplanned",
  basisNumber: "12-р",
  basisDate: "2026-10-01",
};

function png(): Uint8Array {
  const canvas = createCanvas(40, 30);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#336";
  ctx.fillRect(0, 0, 40, 30);
  return new Uint8Array(canvas.toBuffer("image/png"));
}

async function pdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  return doc.save();
}

/** Новый IP на каждый запрос: лимит на токен+IP не мешает соседним тестам. */
function visitRequest(
  files: Array<{ bytes: Uint8Array; name: string; type: string }> = [],
  fields: Record<string, string> = FIELDS,
  headers: Record<string, string> = {}
): Request {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  for (const file of files) form.append("file", new File([Buffer.from(file.bytes)], file.name, { type: file.type }));
  ipCounter += 1;
  return new Request(`https://wesetup.ru/api/inspector/${RAW_TOKEN}/visits`, {
    method: "POST",
    headers: { "x-forwarded-for": `10.0.0.${ipCounter}`, "user-agent": "test-agent", ...headers },
    body: form,
  });
}

test("запись по токену: организация и токен — из токена, сканы проверены, событие inspector.visit", async () => {
  const response = await POST(
    visitRequest([
      { bytes: png(), name: "решение-лист1.png", type: "image/png" },
      { bytes: await pdf(), name: "решение.pdf", type: "application/pdf" },
    ]),
    params()
  );
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.deepEqual(body, { ok: true, visitId: "visit-1", visitedAt: "2026-10-17T09:00:00.000Z", files: 2 });

  assert.equal(created.length, 1);
  const data = created[0];
  assert.equal(data.organizationId, "org-a");
  assert.equal(data.tokenId, "tok-1");
  assert.equal(data.source, "inspector");
  assert.equal(data.inspectorName, "Иванова Анна Петровна");
  assert.equal(data.kind, "unplanned");
  assert.equal(data.basisNumber, "12-р");
  assert.equal((data.basisDate as Date).toISOString(), "2026-10-01T00:00:00.000Z");
  assert.equal(data.userAgent, "test-agent");
  const files = (data.files as { create: Array<Record<string, unknown>> }).create;
  assert.deepEqual(
    files.map((file) => [file.organizationId, file.mimeType, file.fileName]),
    [
      ["org-a", "image/png", "решение-лист1.png"],
      ["org-a", "application/pdf", "решение.pdf"],
    ]
  );

  assert.equal(audits.length, 1);
  assert.equal(audits[0].action, "inspector.visit");
  assert.equal(audits[0].organizationId, "org-a");
  assert.equal(audits[0].entityId, "tok-1");
  assert.match(String(response.headers.get("set-cookie")), /wsi_viewer_/);
});

test("запись без скана разрешена: основание можно приложить позже", async () => {
  const response = await POST(visitRequest([], { ...FIELDS, basisNumber: "", basisDate: "" }), params());
  assert.equal(response.status, 201);
  assert.equal((created[0].files as { create: unknown[] }).create.length, 0);
  assert.equal(created[0].basisNumber, null);
});

test("неизвестный токен — 404, отозванный и просроченный — 410; ничего не пишется", async () => {
  const notFormat = await POST(visitRequest(), params("short"));
  assert.equal(notFormat.status, 404);

  tokenRow = null;
  assert.equal((await POST(visitRequest(), params())).status, 404);

  tokenRow = { id: "tok-r", revokedAt: new Date(), expiresAt: new Date(Date.now() + 86_400_000), organizationId: "org-a" };
  assert.equal((await POST(visitRequest(), params())).status, 410);

  tokenRow = { id: "tok-e", revokedAt: null, expiresAt: new Date(Date.now() - 1000), organizationId: "org-a" };
  assert.equal((await POST(visitRequest(), params())).status, 410);

  assert.equal(created.length, 0);
  assert.equal(audits.length, 0);
});

test("тип файла — по содержимому: HEIC, чужой формат и битый PDF отклоняются", async () => {
  const heic = new Uint8Array([0, 0, 0, 24, ...Buffer.from("ftypheic"), 0, 0, 0, 0]);
  const cases = [
    { file: { bytes: heic, name: "IMG_0001.jpg", type: "image/jpeg" }, error: ORDER_SCAN_ERRORS.heic },
    { file: { bytes: new Uint8Array(Buffer.from("<html><script>alert(1)</script></html>")), name: "решение.pdf", type: "application/pdf" }, error: ORDER_SCAN_ERRORS.type },
    { file: { bytes: new Uint8Array(Buffer.from("%PDF-1.7\nмусор")), name: "решение.pdf", type: "application/pdf" }, error: ORDER_SCAN_ERRORS.pdf },
    { file: { bytes: new Uint8Array(0), name: "пусто.png", type: "image/png" }, error: INSPECTION_VISIT_ERRORS.empty },
  ];
  for (const { file, error } of cases) {
    const response = await POST(visitRequest([file]), params());
    assert.equal(response.status, 400, file.name);
    const body = await response.json();
    assert.equal(body.error, error);
    assert.equal(body.field, "file");
  }
  assert.equal(created.length, 0);
});

test("больше пяти файлов — отказ; обязательные поля проверяются", async () => {
  const six = Array.from({ length: 6 }, (_, i) => ({ bytes: png(), name: `${i}.png`, type: "image/png" }));
  const tooMany = await POST(visitRequest(six), params());
  assert.equal(tooMany.status, 400);
  assert.equal((await tooMany.json()).error, INSPECTION_VISIT_ERRORS.tooMany);

  const noAuthority = await POST(visitRequest([], { ...FIELDS, authority: "" }), params());
  assert.equal(noAuthority.status, 400);
  assert.equal((await noAuthority.json()).field, "authority");
  assert.equal(created.length, 0);
});

test("лимиты: размер запроса — 413, записей по токену за сутки — 429", async () => {
  const big = await POST(visitRequest([], FIELDS, { "content-length": String(INSPECTION_VISIT_MAX_REQUEST_BYTES + 1) }), params());
  assert.equal(big.status, 413);

  visitsToday = 10;
  const daily = await POST(visitRequest(), params());
  assert.equal(daily.status, 429);
  assert.equal((await daily.json()).error, INSPECTION_VISIT_ERRORS.dailyLimit);
  assert.equal(created.length, 0);
});

test("лимит запросов на токен+IP — 429 до разбора формы", async () => {
  tokenRow = { id: "tok-rate", revokedAt: null, expiresAt: new Date(Date.now() + 86_400_000), organizationId: "org-a" };
  const sameIp = () =>
    new Request(`https://wesetup.ru/api/inspector/${RAW_TOKEN}/visits`, {
      method: "POST",
      headers: { "x-forwarded-for": "192.0.2.77", "content-type": "multipart/form-data; boundary=x" },
      body: "не форма",
    });
  const statuses: number[] = [];
  for (let i = 0; i < 11; i += 1) statuses.push((await POST(sameIp(), params())).status);
  assert.deepEqual(statuses.slice(0, 10), Array(10).fill(400));
  assert.equal(statuses[10], 429);
  assert.equal(created.length, 0);
});
