import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { createCanvas } from "@napi-rs/canvas";
import { PDFDocument } from "pdf-lib";

import { db } from "@/lib/db";
import { INSPECTION_VISIT_ERRORS, INSPECTION_VISIT_MAX_REQUEST_BYTES } from "@/lib/inspection-visits";
import { inspectionVisitCookieName, readInspectionVisitIds } from "@/lib/inspection-visit-cookie";
import { ORDER_SCAN_ERRORS } from "@/lib/journal-order-scans";
import { POST } from "./route";

/**
 * POST /api/inspector/[token]/visits — запись проверяющего в журнал
 * посещений по токену QR (AC2, AC8, ревью безопасности). БД подменена:
 * организация берётся из токена, отказы не пишут ничего, файл проверяется
 * по содержимому, суточный лимит — внутри транзакции, лимиты запросов не
 * обходятся подменой X-Forwarded-For, id записи — в подписанной cookie.
 */

const original = {
  findToken: db.inspectorToken.findUnique,
  countVisits: db.inspectionVisit.count,
  transaction: db.$transaction,
  audit: db.auditLog.create,
};

type TokenRow = { id: string; revokedAt: Date | null; expiresAt: Date; organizationId: string };
let tokenRow: TokenRow | null;
let visitsToday: number;
let visitsInTx: number;
let created: Array<Record<string, unknown>>;
let audits: Array<Record<string, unknown>>;
let ipCounter = 0;
let savedSecret: string | undefined;

function tokenRecord(row: TokenRow) {
  return {
    ...row,
    label: "QR",
    periodFrom: new Date("2026-07-01T00:00:00Z"),
    periodTo: new Date("2099-12-31T00:00:00Z"),
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

function freshToken(id: string): TokenRow {
  return { id, revokedAt: null, expiresAt: new Date(Date.now() + 86_400_000), organizationId: "org-a" };
}

beforeEach(() => {
  savedSecret = process.env.EQUIPMENT_QR_TOKEN_SECRET;
  process.env.EQUIPMENT_QR_TOKEN_SECRET = "test-secret-for-inspection-visits";
  tokenRow = freshToken("tok-1");
  visitsToday = 0;
  visitsInTx = 0;
  created = [];
  audits = [];
  db.inspectorToken.findUnique = (async () => (tokenRow ? tokenRecord(tokenRow) : null)) as unknown as typeof db.inspectorToken.findUnique;
  db.inspectionVisit.count = (async () => visitsToday) as unknown as typeof db.inspectionVisit.count;
  const tx = {
    $queryRaw: async () => [{ locked: 1 }],
    inspectionVisit: {
      count: async () => visitsInTx,
      create: async (args: { data: Record<string, unknown> }) => {
        created.push(args.data);
        const files = (args.data.files as { create: unknown[] } | undefined)?.create ?? [];
        return { id: `visit-${created.length}`, visitedAt: new Date("2026-10-17T09:00:00Z"), files: files.map((_, i) => ({ id: `f-${i}` })) };
      },
    },
    inspectionVisitFile: { aggregate: async () => ({ _sum: { sizeBytes: 0 } }) },
  };
  db.$transaction = (async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)) as unknown as typeof db.$transaction;
  db.auditLog.create = (async (args: { data: Record<string, unknown> }) => {
    audits.push(args.data);
    return args.data;
  }) as unknown as typeof db.auditLog.create;
});

afterEach(() => {
  db.inspectorToken.findUnique = original.findToken;
  db.inspectionVisit.count = original.countVisits;
  db.$transaction = original.transaction;
  db.auditLog.create = original.audit;
  if (savedSecret === undefined) delete process.env.EQUIPMENT_QR_TOKEN_SECRET;
  else process.env.EQUIPMENT_QR_TOKEN_SECRET = savedSecret;
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

/**
 * Запрос как из браузера: multipart с Content-Length. Новый X-Real-IP на
 * каждый запрос — лимит на токен+IP не мешает соседним тестам.
 */
async function visitRequest(
  files: Array<{ bytes: Uint8Array; name: string; type: string }> = [],
  fields: Record<string, string> = FIELDS,
  headers: Record<string, string> = {},
  options: { withLength?: boolean } = {}
): Promise<Request> {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  for (const file of files) form.append("file", new File([Buffer.from(file.bytes)], file.name, { type: file.type }));
  const encoded = new Response(form);
  const body = new Uint8Array(await encoded.arrayBuffer());
  ipCounter += 1;
  return new Request(`https://wesetup.ru/api/inspector/${RAW_TOKEN}/visits`, {
    method: "POST",
    headers: {
      "content-type": encoded.headers.get("content-type") ?? "",
      ...(options.withLength === false ? {} : { "content-length": String(body.byteLength) }),
      "x-real-ip": `10.0.${Math.floor(ipCounter / 250)}.${ipCounter % 250}`,
      "user-agent": "test-agent",
      ...headers,
    },
    body,
  });
}

/** Cookie из заголовков ответа `Set-Cookie`. */
function setCookie(response: Response, name: string): { value: string; httpOnly: boolean; sameSite: string | undefined } | null {
  const line = response.headers.getSetCookie().find((item) => item.startsWith(`${name}=`));
  if (!line) return null;
  return {
    value: decodeURIComponent(line.slice(name.length + 1).split(";")[0]),
    httpOnly: /;\s*HttpOnly/i.test(line),
    sameSite: /;\s*SameSite=(\w+)/i.exec(line)?.[1]?.toLowerCase(),
  };
}

test("запись по токену: организация и токен — из токена, сканы проверены, событие inspector.visit, cookie «мои записи»", async () => {
  const response = await POST(
    await visitRequest([
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

  const visitsCookie = setCookie(response, inspectionVisitCookieName("tok-1"));
  assert.ok(visitsCookie, "cookie со списком своих записей");
  assert.equal(visitsCookie.httpOnly, true);
  assert.equal(visitsCookie.sameSite, "lax");
  assert.deepEqual(readInspectionVisitIds("tok-1", visitsCookie.value), ["visit-1"]);
  assert.ok(setCookie(response, `wsi_viewer_${"tok-1".slice(-10)}`));
});

test("cookie дописывается: вторая запись того же браузера добавляет свой id", async () => {
  const first = await POST(await visitRequest(), params());
  const value = setCookie(first, inspectionVisitCookieName("tok-1"))?.value ?? "";
  const second = await POST(
    await visitRequest([], FIELDS, { cookie: `${inspectionVisitCookieName("tok-1")}=${encodeURIComponent(value)}` }),
    params()
  );
  assert.equal(second.status, 201);
  assert.deepEqual(readInspectionVisitIds("tok-1", setCookie(second, inspectionVisitCookieName("tok-1"))?.value), ["visit-1", "visit-2"]);
});

test("запись без скана разрешена: основание можно приложить позже", async () => {
  const response = await POST(await visitRequest([], { ...FIELDS, basisNumber: "", basisDate: "" }), params());
  assert.equal(response.status, 201);
  assert.equal((created[0].files as { create: unknown[] }).create.length, 0);
  assert.equal(created[0].basisNumber, null);
});

test("неизвестный токен — 404, отозванный и просроченный — 410; ничего не пишется", async () => {
  const notFormat = await POST(await visitRequest(), params("short"));
  assert.equal(notFormat.status, 404);

  tokenRow = null;
  assert.equal((await POST(await visitRequest(), params())).status, 404);

  tokenRow = { id: "tok-r", revokedAt: new Date(), expiresAt: new Date(Date.now() + 86_400_000), organizationId: "org-a" };
  assert.equal((await POST(await visitRequest(), params())).status, 410);

  tokenRow = { id: "tok-e", revokedAt: null, expiresAt: new Date(Date.now() - 1000), organizationId: "org-a" };
  assert.equal((await POST(await visitRequest(), params())).status, 410);

  assert.equal(created.length, 0);
  assert.equal(audits.length, 0);
});

test("тип файла — по содержимому: HEIC, чужой формат, HTML перед PDF, битый PDF и PNG-бомба отклоняются", async () => {
  tokenRow = freshToken("tok-types");
  const heic = new Uint8Array([0, 0, 0, 24, ...Buffer.from("ftypheic"), 0, 0, 0, 0]);
  const bomb = new Uint8Array(33);
  bomb.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 0);
  new DataView(bomb.buffer).setUint32(16, 20_000);
  new DataView(bomb.buffer).setUint32(20, 20_000);
  const cases = [
    { file: { bytes: heic, name: "IMG_0001.jpg", type: "image/jpeg" }, error: ORDER_SCAN_ERRORS.heic },
    { file: { bytes: new Uint8Array(Buffer.from("<html><script>alert(1)</script></html>")), name: "решение.pdf", type: "application/pdf" }, error: ORDER_SCAN_ERRORS.type },
    { file: { bytes: new Uint8Array(Buffer.concat([Buffer.from("<html>"), Buffer.from(await pdf())])), name: "решение.pdf", type: "application/pdf" }, error: ORDER_SCAN_ERRORS.type },
    { file: { bytes: new Uint8Array(Buffer.from("%PDF-1.7\nмусор")), name: "решение.pdf", type: "application/pdf" }, error: ORDER_SCAN_ERRORS.pdf },
    { file: { bytes: bomb, name: "bomb.png", type: "image/png" }, error: ORDER_SCAN_ERRORS.dimensions },
    { file: { bytes: new Uint8Array(0), name: "пусто.png", type: "image/png" }, error: INSPECTION_VISIT_ERRORS.empty },
  ];
  for (const { file, error } of cases) {
    const response = await POST(await visitRequest([file]), params());
    assert.equal(response.status, 400, file.name);
    const body = await response.json();
    assert.equal(body.error, error);
    assert.equal(body.field, "file");
  }
  assert.equal(created.length, 0);
});

test("больше пяти файлов — отказ; обязательные поля проверяются", async () => {
  const six = Array.from({ length: 6 }, (_, i) => ({ bytes: png(), name: `${i}.png`, type: "image/png" }));
  const tooMany = await POST(await visitRequest(six), params());
  assert.equal(tooMany.status, 400);
  assert.equal((await tooMany.json()).error, INSPECTION_VISIT_ERRORS.tooMany);

  const noAuthority = await POST(await visitRequest([], { ...FIELDS, authority: "" }), params());
  assert.equal(noAuthority.status, 400);
  assert.equal((await noAuthority.json()).field, "authority");
  assert.equal(created.length, 0);
});

test("размер запроса: без Content-Length — 411, больше предела — 413", async () => {
  const noLength = await POST(await visitRequest([], FIELDS, {}, { withLength: false }), params());
  assert.equal(noLength.status, 411);
  const big = await POST(await visitRequest([], FIELDS, { "content-length": String(INSPECTION_VISIT_MAX_REQUEST_BYTES + 1) }), params());
  assert.equal(big.status, 413);
  assert.equal(created.length, 0);
});

test("суточный лимит записей: и до разбора формы, и окончательно — внутри транзакции", async () => {
  visitsToday = 10;
  const early = await POST(await visitRequest(), params());
  assert.equal(early.status, 429);
  assert.equal((await early.json()).error, INSPECTION_VISIT_ERRORS.dailyLimit);

  // Гонка: быстрый подсчёт пропустил, но под блокировкой записей уже 10.
  visitsToday = 9;
  visitsInTx = 10;
  const raced = await POST(await visitRequest(), params());
  assert.equal(raced.status, 429);
  assert.equal(created.length, 0);
});

test("лимит на токен+IP не обходится подменой первого элемента X-Forwarded-For", async () => {
  tokenRow = freshToken("tok-xff");
  const statuses: number[] = [];
  for (let i = 0; i < 11; i += 1) {
    const request = await visitRequest([], { ...FIELDS, authority: "" }, { "x-forwarded-for": `6.6.6.${i}, 203.0.113.9`, "x-real-ip": "" });
    statuses.push((await POST(request, params())).status);
  }
  assert.deepEqual(statuses.slice(0, 10), Array(10).fill(400));
  assert.equal(statuses[10], 429, "клиент менял только первый элемент — адрес от nginx тот же");
});

test("лимит на один токен: смена IP не помогает (20 загрузок за 10 минут)", async () => {
  tokenRow = freshToken("tok-many-ips");
  const statuses: number[] = [];
  for (let i = 0; i < 21; i += 1) {
    statuses.push((await POST(await visitRequest([], { ...FIELDS, authority: "" }), params())).status);
  }
  assert.equal(statuses.filter((status) => status === 400).length, 20);
  assert.equal(statuses[20], 429);
});
