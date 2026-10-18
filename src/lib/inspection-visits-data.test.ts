import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import { db } from "@/lib/db";
import { inspectorClientIp } from "@/lib/inspector-access";
import {
  INSPECTION_VISIT_ERRORS,
  INSPECTION_VISIT_TOKEN_DAILY_BYTES,
  INSPECTION_VISITS_PER_TOKEN_PER_DAY,
} from "@/lib/inspection-visits";
import {
  appendInspectionVisitId,
  cookieFromHeader,
  INSPECTION_VISIT_COOKIE_MAX_IDS,
  inspectionVisitCookieName,
  inspectionVisitIdsFromHeaders,
  readInspectionVisitIds,
  signInspectionVisitIds,
} from "@/lib/inspection-visit-cookie";
import {
  attachInspectionVisitFiles,
  createTokenInspectionVisit,
  listInspectionVisits,
  loadInspectionVisitFileContent,
  loadInspectionVisitsForBundle,
} from "@/lib/inspection-visits.server";

/**
 * Ревью безопасности: «свои» записи проверяющего по cookie, IP только от
 * nginx, атомарные суточные лимиты и предел файлов под блокировкой,
 * скрытые записи вне портала и архива. БД подменена.
 */

const original = {
  transaction: db.$transaction,
  findMany: db.inspectionVisit.findMany,
  findFile: db.inspectionVisitFile.findUnique,
};
let savedSecret: string | undefined;

beforeEach(() => {
  savedSecret = process.env.EQUIPMENT_QR_TOKEN_SECRET;
  process.env.EQUIPMENT_QR_TOKEN_SECRET = "test-secret-for-inspection-visits";
});

afterEach(() => {
  db.$transaction = original.transaction;
  db.inspectionVisit.findMany = original.findMany;
  db.inspectionVisitFile.findUnique = original.findFile;
  if (savedSecret === undefined) delete process.env.EQUIPMENT_QR_TOKEN_SECRET;
  else process.env.EQUIPMENT_QR_TOKEN_SECRET = savedSecret;
});

/* ---------------- cookie «мои записи» ---------------- */

test("cookie «мои записи»: подпись привязана к токену, подделка и чужой токен — пусто", () => {
  const value = signInspectionVisitIds("tok-1", ["visit-a", "visit-b"]);
  assert.deepEqual(readInspectionVisitIds("tok-1", value), ["visit-a", "visit-b"]);
  assert.deepEqual(readInspectionVisitIds("tok-2", value), [], "cookie другого QR");
  assert.deepEqual(readInspectionVisitIds("tok-1", value.replace("visit-a", "visit-x")), [], "подменён список");
  assert.deepEqual(readInspectionVisitIds("tok-1", "visit-a.visit-b~forged"), [], "чужая подпись");
  assert.deepEqual(readInspectionVisitIds("tok-1", null), []);
  assert.deepEqual(readInspectionVisitIds("tok-1", "x".repeat(5000)), [], "слишком длинная");
});

test("cookie «мои записи»: новая запись дописывается, список ограничен", () => {
  let value: string | null = null;
  for (let i = 0; i < INSPECTION_VISIT_COOKIE_MAX_IDS + 3; i += 1) value = appendInspectionVisitId("tok-1", value, `visit-${i}`);
  const ids = readInspectionVisitIds("tok-1", value);
  assert.equal(ids.length, INSPECTION_VISIT_COOKIE_MAX_IDS);
  assert.equal(ids.at(-1), `visit-${INSPECTION_VISIT_COOKIE_MAX_IDS + 2}`);
  assert.ok(!ids.includes("visit-0"), "старые вытесняются");
  // Повтор id не дублируется.
  const again = readInspectionVisitIds("tok-1", appendInspectionVisitId("tok-1", value, ids[0]));
  assert.equal(again.filter((id) => id === ids[0]).length, 1);
});

test("cookie читается из заголовка Cookie запроса", () => {
  const name = inspectionVisitCookieName("tok-1");
  const value = signInspectionVisitIds("tok-1", ["visit-a"]);
  const header = `other=1; ${name}=${encodeURIComponent(value)}; wsi_viewer_x=abc`;
  assert.equal(cookieFromHeader(header, name), value);
  assert.deepEqual(inspectionVisitIdsFromHeaders(new Headers({ cookie: header }), "tok-1"), ["visit-a"]);
  assert.deepEqual(inspectionVisitIdsFromHeaders(new Headers(), "tok-1"), []);
});

/* ---------------- IP ---------------- */

test("IP для лимитов — от nginx: X-Real-IP или последний элемент X-Forwarded-For, не первый", () => {
  assert.equal(inspectorClientIp(new Headers({ "x-forwarded-for": "6.6.6.6, 203.0.113.7" })), "203.0.113.7");
  assert.equal(inspectorClientIp(new Headers({ "x-forwarded-for": "6.6.6.6, 203.0.113.7", "x-real-ip": "198.51.100.2" })), "198.51.100.2");
  assert.equal(inspectorClientIp(new Headers({ "x-forwarded-for": "not-an-ip" })), null);
  assert.equal(inspectorClientIp(new Headers()), null);
});

/* ---------------- атомарные лимиты ---------------- */

type Call = { op: string; args?: unknown };

function fakeTransaction(state: { visits: number; usedBytes: number; files: number }, calls: Call[]) {
  const tx = {
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push({ op: "lock", args: { sql: strings.join("?"), values } });
      return [{ locked: 1 }];
    },
    inspectionVisit: {
      count: async (args: unknown) => {
        calls.push({ op: "visit.count", args });
        return state.visits;
      },
      create: async (args: { data: { files: { create: unknown[] } } }) => {
        calls.push({ op: "visit.create", args });
        return { id: "visit-new", visitedAt: new Date("2026-10-18T10:00:00Z"), files: args.data.files.create.map((_, i) => ({ id: `f${i}` })) };
      },
    },
    inspectionVisitFile: {
      aggregate: async (args: unknown) => {
        calls.push({ op: "file.aggregate", args });
        return { _sum: { sizeBytes: state.usedBytes } };
      },
      count: async (args: unknown) => {
        calls.push({ op: "file.count", args });
        return state.files;
      },
      createMany: async (args: unknown) => {
        calls.push({ op: "file.createMany", args });
        return { count: 1 };
      },
    },
  };
  db.$transaction = (async (fn: (client: typeof tx) => Promise<unknown>, options?: unknown) => {
    calls.push({ op: "transaction", args: options });
    return fn(tx);
  }) as unknown as typeof db.$transaction;
}

const fields = {
  inspectorName: "Иванова Анна Петровна",
  inspectorPosition: "Инспектор",
  authority: "Роспотребнадзор",
  kind: "planned" as const,
  kindNote: null,
  basisNumber: null,
  basisDate: null,
};
const scan = (size: number) => ({ fileName: "a.jpg", mimeType: "image/jpeg", bytes: new Uint8Array(size) });

test("запись по токену: блокировка токена, затем подсчёт и создание — в одной транзакции", async () => {
  const calls: Call[] = [];
  fakeTransaction({ visits: 3, usedBytes: 0, files: 0 }, calls);
  const result = await createTokenInspectionVisit({ organizationId: "org-a", tokenId: "tok-1", source: "inspector", fields, files: [scan(10)] });
  assert.ok(result.ok);
  assert.deepEqual(calls.map((call) => call.op), ["transaction", "lock", "visit.count", "file.aggregate", "visit.create"]);
  const lock = calls[1].args as { sql: string; values: unknown[] };
  assert.match(lock.sql, /pg_advisory_xact_lock/);
  assert.deepEqual(lock.values, ["inspection-visit-token:tok-1"]);
});

test("запись по токену: суточный лимит записей и объёма сканов — 429 без создания", async () => {
  const calls: Call[] = [];
  fakeTransaction({ visits: INSPECTION_VISITS_PER_TOKEN_PER_DAY, usedBytes: 0, files: 0 }, calls);
  const byCount = await createTokenInspectionVisit({ organizationId: "org-a", tokenId: "tok-1", source: "inspector", fields, files: [] });
  assert.deepEqual(byCount, { ok: false, error: INSPECTION_VISIT_ERRORS.dailyLimit, status: 429 });

  fakeTransaction({ visits: 1, usedBytes: INSPECTION_VISIT_TOKEN_DAILY_BYTES - 5, files: 0 }, calls);
  const byVolume = await createTokenInspectionVisit({ organizationId: "org-a", tokenId: "tok-1", source: "inspector", fields, files: [scan(10)] });
  assert.deepEqual(byVolume, { ok: false, error: INSPECTION_VISIT_ERRORS.dailyVolume, status: 429 });
  assert.ok(!calls.some((call) => call.op === "visit.create"));
});

test("приложить скан: файлы пересчитываются под блокировкой записи — больше 5 не получится", async () => {
  const calls: Call[] = [];
  fakeTransaction({ visits: 0, usedBytes: 0, files: 4 }, calls);
  const over = await attachInspectionVisitFiles({ visitId: "visit-1", organizationId: "org-a", files: [scan(1), scan(1)], uploadedByName: null });
  assert.deepEqual(over, { ok: false, error: INSPECTION_VISIT_ERRORS.tooMany, status: 409 });
  assert.deepEqual(calls.map((call) => call.op), ["transaction", "lock", "file.count"]);
  assert.deepEqual((calls[1].args as { values: unknown[] }).values, ["inspection-visit-files:visit-1"]);

  const okCalls: Call[] = [];
  fakeTransaction({ visits: 0, usedBytes: 0, files: 3 }, okCalls);
  const ok = await attachInspectionVisitFiles({ visitId: "visit-1", organizationId: "org-a", files: [scan(1), scan(1)], uploadedByName: "Марина" });
  assert.deepEqual(ok, { ok: true, added: 2 });
  assert.deepEqual(okCalls.map((call) => call.op), ["transaction", "lock", "file.count", "file.createMany"]);
});

/* ---------------- скрытые записи ---------------- */

test("список: скрытые по умолчанию не показываются, портал — только записи из cookie", async () => {
  const wheres: Record<string, unknown>[] = [];
  db.inspectionVisit.findMany = (async (args: { where: Record<string, unknown> }) => {
    wheres.push(args.where);
    return [];
  }) as unknown as typeof db.inspectionVisit.findMany;

  await listInspectionVisits("org-a");
  assert.deepEqual(wheres[0], { organizationId: "org-a", hiddenAt: null });
  await listInspectionVisits("org-a", { includeHidden: true });
  assert.deepEqual(wheres[1], { organizationId: "org-a" });
  await listInspectionVisits("org-a", { tokenId: "tok-1", ids: ["visit-a"] });
  assert.deepEqual(wheres[2], { organizationId: "org-a", tokenId: "tok-1", id: { in: ["visit-a"] }, hiddenAt: null });
  assert.deepEqual(await listInspectionVisits("org-a", { tokenId: "tok-1", ids: [] }), [], "без cookie — пусто");
  assert.equal(wheres.length, 3, "без cookie в БД не ходим");
});

test("архив: скрытые не попадают, содержимое файлов не грузится списком", async () => {
  let query: { where: Record<string, unknown>; select: { files: { select: Record<string, unknown> } } } | null = null;
  db.inspectionVisit.findMany = (async (args: typeof query) => {
    query = args;
    return [];
  }) as unknown as typeof db.inspectionVisit.findMany;
  await loadInspectionVisitsForBundle("org-a", new Date("2026-10-01"), new Date("2026-10-18"));
  const q = query as unknown as { where: Record<string, unknown>; select: { files: { select: Record<string, unknown> } } };
  assert.equal(q.where.hiddenAt, null);
  assert.equal(q.where.organizationId, "org-a");
  assert.equal("content" in q.select.files.select, false);

  db.inspectionVisitFile.findUnique = (async () => ({ organizationId: "org-b", content: new Uint8Array([1]) })) as unknown as typeof db.inspectionVisitFile.findUnique;
  assert.equal(await loadInspectionVisitFileContent("f1", "org-a"), null, "чужая организация");
});
