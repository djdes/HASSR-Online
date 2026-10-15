import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { createTranslator } from "use-intl/core";
import { loadMessages } from "@/i18n/messages";
import { FORMAT_LOCALES, type Locale } from "@/i18n/locales";
import ruMessages from "@/i18n/messages/ru.json";

type Reply = { text: string; options: { parse_mode?: string; link_preview_options?: { is_disabled: boolean } } };
type Handler = (context: { from?: { id: number }; reply: (text: string, options: Reply["options"]) => Promise<void> }) => Promise<void>;
type User = {
  id: string;
  name: string | null;
  organizationId: string;
  role: string;
  isRoot: boolean;
  locale: string | null;
  organization: { locale: string | null };
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
  const handlers = new Map<string, Handler>();
  const calls: Array<{ source: string; args: unknown }> = [];
  const state: {
    user: User | null;
    summary: { done: number; total: number; pending: number; employeesWithPending: number };
    pending: Array<{ userId: string; template: { name: string; code: string }; user: { name: string | null } }>;
    shifts: Array<{ id?: string; userId?: string; status: string; user: { name: string | null }; jobPosition?: { name: string } | null }>;
    recent: Array<{ filledById: string | null }>;
    customNames: { journals: Record<string, string>; sections: Record<string, string> };
  } = {
    user: { id: "user-1", name: "<Otkir> Chef & Co", organizationId: "org-1", role: "owner", isRoot: false, locale: "en", organization: { locale: "uz" } },
    summary: { done: 3, total: 4, pending: 1, employeesWithPending: 2 },
    pending: [],
    shifts: [],
    recent: [],
    customNames: { journals: {}, sections: {} },
  };
  const mockedDb = {
    user: {
      findFirst: async (args: unknown) => { calls.push({ source: "user.findFirst", args }); return state.user; },
    },
    journalObligation: {
      findMany: async (args: unknown) => { calls.push({ source: "journalObligation.findMany", args }); return state.pending; },
    },
    workShift: {
      findMany: async (args: unknown) => { calls.push({ source: "workShift.findMany", args }); return state.shifts; },
    },
    journalEntry: {
      findMany: async (args: unknown) => { calls.push({ source: "journalEntry.findMany", args }); return state.recent; },
    },
  };
  const source = ts.transpileModule(readFileSync(new URL("./owner-stats.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const compiledModule = { exports: {} as Record<string, unknown> };
  const mocks: Record<string, unknown> = {
    "@/lib/db": { db: mockedDb },
    "@/lib/role-access": require("@/lib/role-access"),
    "@/lib/journal-obligations": { getManagerObligationSummary: async (organizationId: string, now: Date) => { calls.push({ source: "getManagerObligationSummary", args: { organizationId, now } }); return state.summary; } },
    "@/lib/telegram": require("@/lib/telegram"),
    "@/lib/org-custom-names": { getOrgCustomNames: async (organizationId: string) => { calls.push({ source: "getOrgCustomNames", args: organizationId }); return state.customNames; } },
    "@/lib/custom-names": require("@/lib/custom-names"),
    "@/i18n/locales": require("@/i18n/locales"),
    "@/i18n/messages": { loadMessages },
    "@/i18n/journal-presentation": require("@/i18n/journal-presentation"),
    "@/i18n/messages/ru.json": require("@/i18n/messages/ru.json"),
    "use-intl/core": require("use-intl/core"),
  };
  vm.runInNewContext(source, {
    module: compiledModule,
    exports: compiledModule.exports,
    Date: FixedDate,
    Intl,
    console: { error() {}, warn() {} },
    require: (id: string) => Object.hasOwn(mocks, id) ? mocks[id] : require(id),
  }, { filename: "owner-stats.ts" });
  const exported = compiledModule.exports as {
    registerOwnerStatsHandlers: (composer: { command: (name: string, handler: Handler) => void }) => void;
    registerOwnerExtendedHandlers: (composer: { command: (name: string, handler: Handler) => void }) => void;
  };
  const composer = { command: (name: string, handler: Handler) => handlers.set(name, handler) };
  exported.registerOwnerStatsHandlers(composer);
  exported.registerOwnerExtendedHandlers(composer);

  async function invoke(command: string, sender: number | null = 71) {
    const replies: Reply[] = [];
    await handlers.get(command)!({
      ...(sender === null ? {} : { from: { id: sender } }),
      reply: async (text, options) => { replies.push({ text, options }); },
    });
    assert.equal(replies.length, 1, `${command} should reply once`);
    return replies[0]!;
  }
  return { state, calls, invoke };
}

function translator(locale: Locale, messages: Awaited<ReturnType<typeof loadMessages>>) {
  return createTranslator({
    locale, messages, namespace: "telegramManagerSummary", onError: (error: Error) => { throw error; },
  });
}

function richString(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.every((part) => typeof part === "string" || typeof part === "number")) return value.join("");
  throw new Error("Expected translated Telegram text");
}

test("/today uses recipient locale, keeps localized date and counts, and escapes the first name", async () => {
  for (const [personal, organization, locale] of [
    ["en", "uz", "en"], ["uz", "en", "uz"], [null, "en", "en"], ["invalid", "uz", "uz"], [null, null, "ru"],
  ] as const) {
    const f = fixture();
    f.state.user!.locale = personal;
    f.state.user!.organization.locale = organization;
    const result = await f.invoke("today");
    const messages = await loadMessages(locale);
    const t = translator(locale, messages);
    assert.equal(result.options.parse_mode, "HTML");
    assert.ok(result.text.includes("&lt;Otkir&gt;"));
    assert.ok(result.text.includes(richString(t.rich("today.completed", {
      done: 3, total: 4, percentage: 75, b: (children) => `<b>${String(children)}</b>`,
    }))));
    assert.ok(result.text.includes("75%"));
    const date = new Intl.DateTimeFormat(FORMAT_LOCALES[locale], { day: "2-digit", month: "long" }).format(new Date(FIXED_NOW));
    assert.ok(result.text.includes(t("today.dateHeading", { date })));
    assert.ok(result.text.includes(richString(t.rich("today.pending", { count: 1, b: (children) => `<b>${String(children)}</b>` }))));
    assert.ok(result.text.includes(t("today.employeesWithPending", { count: 2 })));
    assert.ok(result.text.includes("15"));
    assert.deepEqual(JSON.parse(JSON.stringify(f.calls.find((call) => call.source === "getManagerObligationSummary")?.args)), {
      organizationId: "org-1", now: FIXED_NOW,
    });
    assert.deepEqual(JSON.parse(JSON.stringify(f.calls.find((call) => call.source === "user.findFirst")?.args)), {
      where: { telegramChatId: "71", isActive: true, archivedAt: null },
      select: { id: true, name: true, organizationId: true, role: true, isRoot: true, locale: true, organization: { select: { locale: true } } },
    });
  }
});

test("two manager recipients in one handler instance do not share locale state", async () => {
  const f = fixture();
  f.state.user!.locale = "en";
  const english = await f.invoke("today");
  f.state.user!.locale = "uz";
  const uzbek = await f.invoke("today");
  assert.ok(english.text.includes("Today ("));
  assert.ok(uzbek.text.includes("Bugun ("));
  assert.notEqual(english.text, uzbek.text);
});

test("/missing translates known unmodified defaults but preserves organization titles and user names", async () => {
  const f = fixture();
  f.state.user!.locale = "uz";
  f.state.customNames.journals.cleaning = "<Our Cleaning Log> & custom";
  f.state.pending = [
    { userId: "u1", template: { code: "climate_control", name: ruMessages.journals.names.climate_control }, user: { name: "<A> & Co" } },
    { userId: "u2", template: { code: "cleaning", name: ruMessages.journals.names.cleaning }, user: { name: "B <Chef>" } },
  ];
  const result = await f.invoke("missing");
  const messages = await loadMessages("uz");
  const t = translator("uz", messages);
  assert.ok(result.text.includes(richString(t.rich("missing.heading", { count: 2, b: (children) => `<b>${String(children)}</b>` }))));
  assert.ok(result.text.includes(messages.journals.names.climate_control), "official, source-matched title is localized by stable journal code");
  assert.ok(result.text.includes("&lt;Our Cleaning Log&gt; &amp; custom"), "organization override is preserved and HTML escaped");
  assert.ok(result.text.includes("&lt;A&gt; &amp; Co"));
  assert.ok(result.text.includes("B &lt;Chef&gt;"));
  assert.equal(result.options.parse_mode, "HTML");
  f.state.pending = [];
  assert.equal((await f.invoke("missing")).text, richString(t.rich("missing.allComplete", { b: (children) => `<b>${String(children)}</b>` })));
  const query = f.calls.find((call) => call.source === "journalObligation.findMany")?.args as { where: { organizationId: string; status: string }; take: number };
  assert.equal(query.where.organizationId, "org-1");
  assert.equal(query.where.status, "pending");
  assert.equal(query.take, 20);
});

test("/staff translates stable statuses and counts while preserving escaped names and position labels", async () => {
  const f = fixture();
  f.state.user!.locale = "en";
  f.state.shifts = [
    { status: "working", user: { name: "<A> & Co" }, jobPosition: { name: "Chef <Night> & prep" } },
    { status: "scheduled", user: { name: "Baker" }, jobPosition: null },
    { status: "future-status", user: { name: "Unknown" }, jobPosition: null },
  ];
  const result = await f.invoke("staff");
  const messages = await loadMessages("en");
  const t = translator("en", messages);
  assert.ok(result.text.includes(richString(t.rich("staff.heading", { count: 3, b: (children) => `<b>${String(children)}</b>` }))));
  assert.ok(result.text.includes(t("staff.status.working")));
  assert.ok(result.text.includes(t("staff.status.scheduled")));
  assert.ok(result.text.includes("future-status"));
  assert.ok(result.text.includes("3 shifts"));
  assert.ok(result.text.includes("&lt;A&gt; &amp; Co"));
  assert.ok(result.text.includes("Chef &lt;Night&gt; &amp; prep"));
  assert.equal(result.options.parse_mode, "HTML");
  f.state.shifts = [];
  const empty = await f.invoke("staff");
  assert.equal(empty.text, richString(t.rich("staff.noShifts", { b: (children) => `<b>${String(children)}</b>` })));
});

test("/who_late keeps its two-hour query and translates empty, all-present, and late states", async () => {
  const f = fixture();
  f.state.user!.locale = "uz";
  const messages = await loadMessages("uz");
  let result = await f.invoke("who_late");
  assert.equal(result.text, messages.telegramManagerSummary.whoLate.noActiveShifts);

  f.state.shifts = [{ id: "s1", userId: "u1", status: "working", user: { name: "<Late> & Co" } }];
  f.state.recent = [{ filledById: "u1" }];
  result = await f.invoke("who_late");
  assert.equal(result.text, messages.telegramManagerSummary.whoLate.allPresent);

  f.state.recent = [];
  result = await f.invoke("who_late");
  assert.ok(result.text.includes(messages.telegramManagerSummary.whoLate.status.working));
  assert.ok(result.text.includes("2 soatdan ortiq"));
  assert.ok(result.text.includes("&lt;Late&gt; &amp; Co"));
  const activity = f.calls.filter((call) => call.source === "journalEntry.findMany").at(-1)?.args as { where: { organizationId: string; createdAt: { gte: Date }; filledById: { in: string[] } }; distinct: string[] };
  assert.equal(activity.where.organizationId, "org-1");
  assert.deepEqual(activity.where.filledById.in, ["u1"]);
  assert.equal(activity.where.createdAt.gte.getTime(), new Date(FIXED_NOW).getTime() - 2 * 60 * 60 * 1000);
  assert.deepEqual(JSON.parse(JSON.stringify(activity.distinct)), ["filledById"]);
});

test("manager denial uses linked recipient locale without running protected queries; missing sender falls back to RU", async () => {
  for (const command of ["today", "missing", "staff", "who_late"]) {
    const f = fixture();
    f.state.user!.role = "cook";
    f.state.user!.locale = "en";
    const denied = await f.invoke(command);
    assert.equal(denied.text, (await loadMessages("en")).telegramManagerSummary.common.notAuthorized);
    assert.deepEqual(f.calls.map((call) => call.source), ["user.findFirst"]);
    assert.deepEqual(JSON.parse(JSON.stringify(f.calls[0]!.args)), {
      where: { telegramChatId: "71", isActive: true, archivedAt: null },
      select: { id: true, name: true, organizationId: true, role: true, isRoot: true, locale: true, organization: { select: { locale: true } } },
    });

    const missing = fixture();
    const fallback = await missing.invoke(command, null);
    assert.equal(fallback.text, (await loadMessages("ru")).telegramManagerSummary.common.notAuthorized);
    assert.deepEqual(missing.calls, [], "unlinked sender cannot trigger a user or tenant lookup");
  }

  const organizationFallback = fixture();
  organizationFallback.state.user!.role = "cook";
  organizationFallback.state.user!.locale = "invalid";
  organizationFallback.state.user!.organization.locale = "uz";
  const deniedByOrganization = await organizationFallback.invoke("missing");
  assert.equal(deniedByOrganization.text, (await loadMessages("uz")).telegramManagerSummary.common.notAuthorized);
  assert.deepEqual(organizationFallback.calls.map((call) => call.source), ["user.findFirst"]);
});
