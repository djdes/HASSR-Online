import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { createTranslator } from "use-intl/core";
import { loadMessages } from "@/i18n/messages";
import type { Locale } from "@/i18n/locales";

type Reply = { text: string; options: { parse_mode?: string } };
type TestContext = {
  from?: { id: number };
  api: { getMe: () => Promise<{ username?: string }> };
  reply: (text: string, options: Reply["options"]) => Promise<void>;
};
type User = {
  id: string; name: string | null; organizationId: string; role: string; isRoot: boolean;
  locale: string | null; organization: { locale: string | null };
};
type State = {
  user: User | null;
  capa: Array<{ id: string; title: string; priority: string; dueDate: Date | null; assignedToId: string | null }>;
  assignees: Array<{ id: string; name: string | null }>;
  grouped: Array<{ dateKey: Date; status: string; _count: { _all: number } }>;
  losses: Array<{ id: string; date: Date; category: string; productName: string; quantity: number; unit: string; costRub: number | null }>;
  batches: Array<{ id: string; code: string; productName: string; supplier: string | null; quantity: number; unit: string; expiryDate: Date | null; status: string }>;
  getMeError: Error | null; dbError: Error | null;
};

const FIXED_NOW = "2026-10-15T10:30:00.000Z";
class FixedDate extends Date {
  constructor(value?: string | number | Date) {
    if (value === undefined) super(FIXED_NOW);
    else if (value instanceof Date) super(value.getTime());
    else super(value);
  }
  static now() { return new Date(FIXED_NOW).getTime(); }
}

function fixture() {
  const require = createRequire(import.meta.url);
  const handlers = new Map<string, (ctx: TestContext) => Promise<void>>();
  const calls: Array<{ source: string; args: unknown }> = [];
  const state: State = {
    user: { id: "manager-1", name: "Manager", organizationId: "org-1", role: "owner", isRoot: false, locale: "en", organization: { locale: "uz" } },
    capa: [], assignees: [], grouped: [], losses: [], batches: [], getMeError: null, dbError: null,
  };
  const mockedDb = {
    user: {
      findFirst: async (args: unknown) => { calls.push({ source: "user.findFirst", args }); return state.user; },
      findMany: async (args: unknown) => { calls.push({ source: "user.findMany", args }); return state.assignees; },
    },
    capaTicket: { findMany: async (args: unknown) => { calls.push({ source: "capaTicket.findMany", args }); return state.capa; } },
    journalObligation: { groupBy: async (args: unknown) => { calls.push({ source: "journalObligation.groupBy", args }); return state.grouped; } },
    lossRecord: { findMany: async (args: unknown) => { calls.push({ source: "lossRecord.findMany", args }); return state.losses; } },
    batch: { findMany: async (args: unknown) => { calls.push({ source: "batch.findMany", args }); return state.batches; } },
    $queryRaw: async () => { calls.push({ source: "$queryRaw", args: undefined }); if (state.dbError) throw state.dbError; return 1; },
  };
  const source = ts.transpileModule(readFileSync(new URL("./owner-stats.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const compiledModule = { exports: {} as Record<string, unknown> };
  const mocks: Record<string, unknown> = {
    "@/lib/db": { db: mockedDb },
    "@/lib/role-access": require("@/lib/role-access"),
    "@/lib/journal-obligations": { getManagerObligationSummary: async () => ({ done: 0, total: 0, pending: 0, employeesWithPending: 0 }) },
    "@/lib/bot/scoped-obligation-summary": { scopedManagerObligationSummary: async () => ({ done: 0, total: 0, pending: 0, employeesWithPending: 0 }) },
    "@/lib/worker-point-scope": { ...require("@/lib/worker-point-scope"), loadManagerPointScope: async () => null, loadScopeAreaIds: async () => [] },
    "@/lib/telegram": require("@/lib/telegram"),
    "@/lib/org-custom-names": { getOrgCustomNames: async () => ({ journals: {}, sections: {} }) },
    "@/lib/custom-names": require("@/lib/custom-names"),
    "@/i18n/locales": require("@/i18n/locales"),
    "@/i18n/messages": { loadMessages },
    "@/i18n/journal-presentation": require("@/i18n/journal-presentation"),
    "@/i18n/messages/ru.json": require("@/i18n/messages/ru.json"),
    "use-intl/core": require("use-intl/core"),
  };
  vm.runInNewContext(source, {
    module: compiledModule, exports: compiledModule.exports, Date: FixedDate, Intl, Error,
    process: { env: { NEXT_PUBLIC_BUILD_ID: "build<&>", NEXT_PUBLIC_BUILD_TIME: "2026-10-15T10:00Z" } },
    console: { error() {}, warn() {} },
    require: (id: string) => Object.hasOwn(mocks, id) ? mocks[id] : require(id),
  }, { filename: "owner-stats.ts" });
  const exported = compiledModule.exports as {
    registerOwnerStatsHandlers: (composer: { command: (name: string, handler: (ctx: TestContext) => Promise<void>) => void }) => void;
    registerOwnerExtendedHandlers: (composer: { command: (name: string, handler: (ctx: TestContext) => Promise<void>) => void }) => void;
  };
  const composer = { command: (name: string, handler: (ctx: TestContext) => Promise<void>) => handlers.set(name, handler) };
  exported.registerOwnerStatsHandlers(composer);
  exported.registerOwnerExtendedHandlers(composer);

  async function invoke(command: string, sender: number | null = 71) {
    const replies: Reply[] = [];
    await handlers.get(command)!({
      ...(sender === null ? {} : { from: { id: sender } }),
      api: { getMe: async () => { if (state.getMeError) throw state.getMeError; return { username: "safe_bot" }; } },
      reply: async (text: string, options: Reply["options"]) => { replies.push({ text, options }); },
    });
    assert.equal(replies.length, 1, `${command} should reply exactly once`);
    return replies[0]!;
  }
  return { state, calls, invoke };
}

function translator(locale: Locale, messages: Awaited<ReturnType<typeof loadMessages>>) {
  return createTranslator({ locale, messages, namespace: "telegramManagerOperations", onError: (error: Error) => { throw error; } });
}

function rich(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.every((part) => typeof part === "string" || typeof part === "number")) return value.join("");
  throw new Error("Expected translated Telegram HTML text");
}

test("operations commands resolve personal, organization, and RU fallback independently per recipient", async () => {
  for (const [personal, organization, locale] of [
    ["en", "uz", "en"], ["uz", "en", "uz"], [null, "en", "en"], ["invalid", "uz", "uz"], [null, null, "ru"],
  ] as const) {
    const f = fixture();
    f.state.user!.locale = personal;
    f.state.user!.organization.locale = organization;
    const result = await f.invoke("capa");
    assert.equal(result.text, (await loadMessages(locale)).telegramManagerOperations.capa.empty);
    assert.equal(f.calls.filter((call) => call.source === "capaTicket.findMany").length, 1);
  }
  const f = fixture();
  assert.equal((await f.invoke("capa")).text, (await loadMessages("en")).telegramManagerOperations.capa.empty);
  f.state.user!.locale = "uz";
  assert.equal((await f.invoke("capa")).text, (await loadMessages("uz")).telegramManagerOperations.capa.empty);
});

test("/capa translates complete rows and fallbacks while escaping dynamic ticket data", async () => {
  const f = fixture();
  f.state.user!.locale = "uz";
  f.state.capa = [
    { id: "c1", title: "<Fix & verify>", priority: "high<&", dueDate: new Date("2026-10-16T00:00:00Z"), assignedToId: "u1" },
    { id: "c2", title: "No owner", priority: "normal", dueDate: null, assignedToId: null },
  ];
  f.state.assignees = [{ id: "u1", name: "<Otkir> & Co" }];
  const result = await f.invoke("capa");
  const messages = await loadMessages("uz");
  const t = translator("uz", messages);
  const first = rich(t.rich("capa.row", {
    priority: "high&lt;&amp;", title: "&lt;Fix &amp; verify&gt;", assignee: "&lt;Otkir&gt; &amp; Co",
    due: new Intl.DateTimeFormat("uz-UZ", { day: "2-digit", month: "long" }).format(new Date("2026-10-16T00:00:00Z")),
    b: (children) => `<b>${String(children)}</b>`,
  }));
  assert.ok(result.text.includes(first));
  assert.ok(result.text.includes(t("capa.unassigned")));
  assert.ok(result.text.includes(t("capa.noDeadline")));
  assert.ok(result.text.includes("&lt;Fix &amp; verify&gt;"));
  assert.equal(result.options.parse_mode, "HTML");
  const query = f.calls.find((call) => call.source === "capaTicket.findMany")?.args as { where: { organizationId: string; status: { in: string[] } }; take: number };
  assert.equal(query.where.organizationId, "org-1");
  assert.deepEqual(JSON.parse(JSON.stringify(query.where.status.in)), ["open", "in_progress"]);
  assert.equal(query.take, 10);
});

test("/stats preserves UTC seven-day window, grouping, percentage and bar calculations", async () => {
  const f = fixture();
  f.state.user!.locale = "en";
  f.state.grouped = [
    { dateKey: new Date("2026-10-15T00:00:00Z"), status: "done", _count: { _all: 3 } },
    { dateKey: new Date("2026-10-15T00:00:00Z"), status: "pending", _count: { _all: 1 } },
    { dateKey: new Date("2026-10-14T00:00:00Z"), status: "done", _count: { _all: 1 } },
    { dateKey: new Date("2026-10-14T00:00:00Z"), status: "pending", _count: { _all: 1 } },
  ];
  const result = await f.invoke("stats");
  const t = translator("en", await loadMessages("en"));
  assert.ok(result.text.startsWith("<pre>"));
  assert.ok(result.text.includes(rich(t.rich("stats.total", { done: 4, total: 6, percentage: 67, b: (children) => `<b>${String(children)}</b>` }))));
  assert.ok(result.text.includes("████████·· 75%"), result.text);
  assert.ok(result.text.includes("█████····· 50%"), result.text);
  assert.ok(result.text.includes("Thu 15 October"));
  const query = f.calls.find((call) => call.source === "journalObligation.groupBy")?.args as { by: string[]; where: { organizationId: string; dateKey: { gte: Date } } };
  assert.deepEqual(JSON.parse(JSON.stringify(query.by)), ["dateKey", "status"]);
  assert.equal(query.where.organizationId, "org-1");
  assert.equal(query.where.dateKey.gte.toISOString(), "2026-10-09T00:00:00.000Z");
});

test("/losses preserves fractional quantity, rounded RUB values, and zero-cost omission", async () => {
  const f = fixture();
  f.state.user!.locale = "uz";
  f.state.losses = [
    { id: "l1", date: new Date("2026-10-15T00:00:00Z"), category: "<Damaged & returned>", productName: "<Cheese>", quantity: 1.25, unit: "kg<&", costRub: 1.5 },
    { id: "l2", date: new Date("2026-10-14T00:00:00Z"), category: "Expired", productName: "Milk", quantity: 0.5, unit: "L", costRub: 0 },
  ];
  const result = await f.invoke("losses");
  assert.ok(result.text.includes("1.25"), "fractional quantity retains its source precision without ICU rounding");
  assert.ok(result.text.includes("0.5"));
  assert.ok(result.text.includes("2 ₽"), "source toFixed(0) rounding occurs before locale formatting");
  assert.ok(result.text.includes("&lt;Cheese&gt;"));
  assert.ok(result.text.includes("&lt;Damaged &amp; returned&gt;"));
  assert.equal((result.text.match(/0 ₽/g) ?? []).length, 0, "zero per-row costs remain hidden");
  const empty = fixture();
  empty.state.user!.locale = "en";
  assert.equal((await empty.invoke("losses")).text, (await loadMessages("en")).telegramManagerOperations.losses.empty);
  const query = f.calls.find((call) => call.source === "lossRecord.findMany")?.args as { where: { organizationId: string; date: { gte: Date } }; take: number };
  assert.equal(query.where.organizationId, "org-1");
  assert.equal(query.where.date.gte.toISOString(), "2026-10-08T10:30:00.000Z");
  assert.equal(query.take, 10);
});

test("/losses and /batches preserve arbitrary fractional quantity precision in every locale", async () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    const f = fixture();
    f.state.user!.locale = locale;
    f.state.losses = [{
      id: "precision-loss", date: new Date("2026-10-15T00:00:00Z"), category: "test",
      productName: "Precision item", quantity: 1.234567, unit: "kg", costRub: null,
    }];
    f.state.batches = [{
      id: "precision-batch", code: "B-precision", productName: "Precision item", supplier: null,
      quantity: 0.000012345, unit: "kg", expiryDate: null, status: "received",
    }];

    const loss = await f.invoke("losses");
    const batch = await f.invoke("batches");
    assert.ok(loss.text.includes("1.234567"), `${locale} loss quantity should retain all source digits: ${loss.text}`);
    assert.ok(batch.text.includes("0.000012345"), `${locale} batch quantity should retain all source digits: ${batch.text}`);
  }
});

test("/batches translates expiry state and keeps supplier, code, and product data escaped", async () => {
  const f = fixture();
  f.state.user!.locale = "en";
  f.state.batches = [
    { id: "b1", code: "B<&1", productName: "<Milk & cream>", supplier: "<Farm>", quantity: 1.25, unit: "kg<&", expiryDate: new Date("2026-10-14T00:00:00Z"), status: "received" },
    { id: "b2", code: "B2", productName: "Cheese", supplier: null, quantity: 2, unit: "pcs", expiryDate: new Date(FIXED_NOW), status: "in_use" },
    { id: "b3", code: "B3", productName: "Salt", supplier: " ", quantity: 1, unit: "kg", expiryDate: null, status: "received" },
  ];
  const result = await f.invoke("batches");
  assert.ok(result.text.includes("&lt;Milk &amp; cream&gt;"));
  assert.ok(result.text.includes("B&lt;&amp;1"), result.text);
  assert.ok(result.text.includes("&lt;Farm&gt;"));
  assert.ok(result.text.includes("expired"));
  assert.ok(result.text.includes("No expiry date"));
  assert.ok(result.text.includes("1.25 kg&lt;&amp;"));
  const empty = fixture();
  empty.state.user!.locale = "uz";
  assert.equal((await empty.invoke("batches")).text, (await loadMessages("uz")).telegramManagerOperations.batches.empty);
  const query = f.calls.find((call) => call.source === "batch.findMany")?.args as { where: { organizationId: string; status: { in: string[] } }; take: number };
  assert.equal(query.where.organizationId, "org-1");
  assert.deepEqual(JSON.parse(JSON.stringify(query.where.status.in)), ["received", "in_use"]);
  assert.equal(query.take, 15);
});

test("/health localizes fixed labels and escapes dynamic diagnostic/build data on success and failure", async () => {
  const f = fixture();
  f.state.user!.locale = "uz";
  let result = await f.invoke("health");
  assert.ok(result.text.includes((await loadMessages("uz")).telegramManagerOperations.health.heading));
  assert.ok(result.text.includes("build&lt;&amp;&gt;"));
  assert.ok(result.text.includes("@safe_bot"));
  assert.ok(result.text.includes("Telegram API"));
  f.state.getMeError = new Error("API <down> & retry");
  f.state.dbError = new Error("DB <down> & retry");
  result = await f.invoke("health");
  assert.ok(result.text.includes("API &lt;down&gt; &amp; retry"));
  assert.ok(result.text.includes("DB &lt;down&gt; &amp; retry"));
  assert.ok(result.text.includes("❌"));
  assert.equal(f.calls.filter((call) => call.source === "$queryRaw").length, 2);
  assert.equal(result.options.parse_mode, "HTML");
});

test("denied operations and missing sender never query protected command data", async () => {
  for (const command of ["capa", "stats", "losses", "batches", "health"]) {
    const f = fixture();
    f.state.user!.role = "cook";
    f.state.user!.locale = "en";
    const denied = await f.invoke(command);
    assert.equal(denied.text, (await loadMessages("en")).telegramManagerSummary.common.notAuthorized);
    assert.deepEqual(f.calls.map((call) => call.source), ["user.findFirst"]);

    const missing = fixture();
    const fallback = await missing.invoke(command, null);
    assert.equal(fallback.text, (await loadMessages("ru")).telegramManagerSummary.common.notAuthorized);
    assert.deepEqual(missing.calls, []);
  }
});
