import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import { translatorFor } from "@/i18n/translator";
import { loadMessages } from "@/i18n/messages";
import * as journalPresentation from "@/i18n/journal-presentation";
import * as documentPresentation from "@/i18n/journal-document-presentation";
import * as entryScope from "@/lib/journal-entry-scope";
import * as roles from "@/lib/user-roles";
import * as locales from "@/i18n/site-locale";
import * as limits from "@/lib/plan-limits";
import * as tariffPlans from "@/lib/tariff-plans";
import * as pointScope from "@/lib/worker-point-scope";
import { z } from "zod";

// Run current production modules with external persistence replaced. No database,
// network, queue, notifications or real staff/journal writes are used by this test.
function moduleWithDependencies<T>(file: string, dependencies: Record<string, unknown>): T {
  const code = ts.transpileModule(readFileSync(`src/lib/ai-assistant/${file}.ts`, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const fixtureModule = { exports: {} };
  const require = createRequire(import.meta.url);
  vm.runInNewContext(code, { module: fixtureModule, exports: fixtureModule.exports, Buffer, Date, console,
    process: { env: { NEXTAUTH_SECRET: "localization-test-only-signing-key" } },
    require: (id: string) => {
      if (id in dependencies) return dependencies[id];
      if (id === "zod" || id === "node:crypto" || id === "next/server") return require(id);
      throw new Error(`Unmocked dependency: ${id}`);
    },
  }, { filename: `${file}.ts` });
  return fixtureModule.exports as T;
}

const isoDay = (date: Date | string) => new Date(date).toISOString().slice(0, 10);
const hygiene = { HYGIENE_STATUS_OPTIONS: ["healthy", "day_off", "sick_leave", "suspended", "vacation"].map(value => ({ value, label: value })), toDateKey: isoDay, isEntryDataEmpty: () => false };
type Scope = Awaited<ReturnType<typeof pointScope.loadManagerPointScope>>;
function actionsFixture(staffRefusal?: unknown, scope: Scope = null, documentBuildingId: string | null = null) {
  const queries: unknown[] = [];
  const writes: unknown[] = [];
  const document = { id: "doc", organizationId: "org", title: "CUSTOM_TITLE", status: "open", dateFrom: new Date("2026-10-01Z"), dateTo: new Date("2026-10-31Z"), template: { code: "hygiene", name: "Журнал гигиены" }, config: {}, responsibleUserId: null, buildingId: documentBuildingId };
  const db = {
    jobPosition: { findFirst: async (args: unknown) => { queries.push(args); return { name: "CUSTOM_POSITION" }; } },
    journalDocument: { findFirst: async (args: unknown) => { queries.push(args); return document; }, findUnique: async () => document },
    user: { findMany: async () => [{ id: "employee", name: "CUSTOM_EMPLOYEE", jobPosition: { name: "CUSTOM_POSITION" } }] },
    organization: { findUnique: async () => ({ timezone: "Europe/Moscow" }) },
    journalDocumentEntry: { upsert: async (args: unknown) => { writes.push(args); return {}; } },
    $transaction: async (promises: Promise<unknown>[]) => Promise.all(promises),
    auditLog: { create: async () => ({}) },
  };
  const actions = moduleWithDependencies<typeof import("./actions")>("actions", {
    "@/lib/db": { db }, "@/i18n/translator": { translatorFor }, "@/i18n/messages": { loadMessages },
    "@/lib/plan-limits": limits, "@/i18n/journal-presentation": journalPresentation, "@/i18n/journal-document-presentation": documentPresentation,
    "@/lib/journal-acl": { canWriteJournal: async () => true },
    "@/lib/journal-staff-binding": { reconcileEntryStaffFields: (data: unknown) => data },
    "@/lib/journal-entry-write": { ...entryScope, loadEntryWriteContext: async () => ({}), checkEntryWrite: () => ({ allowed: true }), logPastDayOverride: async () => {}, maybeTriggerColdEquipmentCapaDetection() {}, toEntryDayUtc: (value: string) => new Date(`${value}T00:00:00Z`), toPrismaJsonValue: (value: unknown) => value },
    "@/lib/hygiene-document": hygiene, "@/lib/hygiene-v2": { readHygieneFormVersion: () => 1 },
    "@/lib/staff-journal-autofill": { STAFF_JOURNAL_TEMPLATE_CODES: ["hygiene", "health_check"], loadStaffScheduleMap: async () => new Map(), staffScheduleKey: () => "", buildStaffAutoFillEntryData: () => ({ status: "healthy" }) },
    "@/lib/staff-create": { createStaffMember: async (_org: string, input: unknown) => { if (staffRefusal) return staffRefusal; writes.push(input); return { ok: true, user: { name: "CUSTOM_EMPLOYEE" }, positionName: "CUSTOM_POSITION" }; } },
    "@/lib/user-roles": roles, "@/lib/timezone": { orgTodayKey: () => "2026-10-15" }, "@/lib/tariff-plans": tariffPlans,
    "@/lib/worker-point-scope": { ...pointScope, loadManagerPointScope: async () => scope },
  });
  return { actions, document, queries, writes };
}

test("assistant previews and confirmed actions keep IDs, values, guards and custom text across all locales", async () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    const { actions, queries, writes, document } = actionsFixture();
    const actor = { id: "manager", role: "manager", isRoot: false, name: "Manager" };
    const context = { orgId: "org", actor, locale };
    const added = await actions.prepareAction({ kind: "add_staff", input: { fullName: "CUSTOM_EMPLOYEE", jobPositionId: "position" } }, context);
    if (!added.ok) throw new Error(added.error);
    assert.ok(added.preview.details.join(" ").includes("CUSTOM_EMPLOYEE"));
    assert.ok(JSON.stringify(queries).includes('"organizationId":"org"'));
    const foreign = await actions.verifyAndExecuteAction(added.preview.token, { ...context, orgId: "other" });
    assert.equal(foreign.ok, false);
    assert.equal(writes.length, 0);
    const result = await actions.verifyAndExecuteAction(added.preview.token, context);
    assert.equal(result.ok, true);
    assert.equal(writes.length, 1);
    const input = { documentId: "doc", employeeIds: ["employee"], dates: ["2026-10-15"], values: { kind: "status", status: "healthy" } };
    const fill = await actions.prepareAction({ kind: "fill_journal_cells", input }, context);
    if (!fill.ok) throw new Error(fill.error);
    assert.ok(fill.preview.details.join(" ").includes("CUSTOM_TITLE"));
    const saved = await actions.verifyAndExecuteAction(fill.preview.token, context);
    assert.equal(saved.ok, true);
    assert.ok(JSON.stringify(writes).includes('"status":"healthy"'));
    const before = writes.length;
    document.status = "closed";
    assert.equal((await actions.verifyAndExecuteAction(fill.preview.token, context)).ok, false);
    assert.equal(writes.length, before);
    if (locale !== "ru") assert.doesNotMatch(JSON.stringify([added.preview, result, fill.preview, saved, foreign]), /\p{Script=Cyrillic}/u);
  }
});

test("assistant add_staff: a seat refusal names the next plan, inside the WeSetup app only the fact", async () => {
  const actor = { id: "manager", role: "manager", isRoot: false, name: "Manager" };
  const input = { fullName: "CUSTOM_EMPLOYEE", jobPositionId: "position" };
  for (const locale of ["ru", "en", "uz"] as const) {
    const t = await translatorFor(locale);
    for (const [nextTier, key, seats] of [["standard", "limitToStandard", 25], ["premium", "limitToPremium", 100], [null, "limitContact", 100]] as const) {
      const refusal = { ok: false, status: 402, error: "Места заняты", code: "billing_free_limit", limit: 25, tier: "standard", nextTier };
      const { actions, writes } = actionsFixture(refusal);
      const web = await actions.executeProposedAction({ kind: "add_staff", input }, { orgId: "org", actor, locale }, { audit: false });
      assert.deepEqual({ ...web }, { ok: false, error: t(`common.billing.${key}`, { count: 25, seats }), code: "billing_free_limit" });
      const app = await actions.executeProposedAction({ kind: "add_staff", input }, { orgId: "org", actor, locale, inApp: true }, { audit: false });
      assert.deepEqual({ ...app }, { ok: false, error: t("common.billing.limit", { count: 25 }), code: "billing_free_limit" });
      assert.equal(writes.length, 0);
      if (locale !== "ru") assert.doesNotMatch(JSON.stringify([web, app]), /\p{Script=Cyrillic}/u);
    }
  }
});

test("assistant job captures explicit locale while preserving user content and escaping untrusted context", async () => {
  const db = { organization: { findUnique: async () => ({ name: "Customer <instruction>", timezone: "Europe/Moscow" }) }, user: { findUnique: async () => ({ name: "Manager", role: "manager" }), findMany: async () => [] }, jobPosition: { findMany: async () => [] }, journalTemplate: { findMany: async () => [] }, journalDocument: { findMany: async () => [] } };
  const jobs = moduleWithDependencies<typeof import("./job-text")>("job-text", { "@/lib/db": { db }, "@/lib/hygiene-document": hygiene, "@/i18n/site-locale": locales, "@/lib/worker-point-scope": { ...pointScope, loadManagerPointScope: async () => null } });
  for (const locale of ["ru", "en", "uz"] as const) {
    const text = await jobs.buildChatJobText({ orgId: "org", userId: "manager", locale, history: [], question: "Customer <instruction>" });
    assert.ok(text.includes(`response_language: ${jobs.assistantResponseLanguage(locale)}`));
    assert.ok(text.includes("Customer ‹instruction›"));
    assert.ok(!text.includes("Customer <instruction>"));
  }
  assert.equal(jobs.assistantResponseLanguage(), "Russian");
});

test("assistant route snapshots session locale for jobs/actions and returns isolated localized errors", async () => {
  await Promise.all((["ru", "en", "uz"] as const).map(async locale => {
    const calls: { job?: Record<string, unknown>; prepare?: Record<string, unknown>; confirm?: Record<string, unknown>; queue: number } = { queue: 0 };
    let allowed = true;
    let queueOk = true;
    const route = moduleWithDependencies<typeof import("@/app/api/ai/sanpin-chat/route")>("../../app/api/ai/sanpin-chat/route", {
      "@/i18n/site-locale": locales, "@/i18n/translator": { translatorFor },
      "@/lib/auth-helpers": { requireApiAuth: async () => ({ ok: true, session: { user: { id: "manager", role: "manager", locale, organizationLocale: "ru" } } }), getActiveOrgId: () => "active-org" },
      "@/lib/rate-limit": { aiChatRateLimiter: { consume: () => allowed, remainingMs: () => 500 } },
      "@/lib/mobile-app": { isMobileAppUserAgent: (ua: string | null) => Boolean(ua?.includes("WeSetupApp/")) },
      "@/lib/ai-assistant/pf-client": { enqueueAndWait: async () => { calls.queue++; return queueOk ? { ok: true, text: "reply" } : { ok: false, code: "not_configured", error: "private upstream failure" }; } },
      "@/lib/ai-assistant/job-text": { pathnameSchema: z.string(), buildChatJobText: async (args: Record<string, unknown>) => { calls.job = args; return "job"; }, parseAssistantReply: () => ({ reply: "Original response", action: { kind: "add_staff", input: {} } }) },
      "@/lib/ai-assistant/actions": { prepareAction: async (_raw: unknown, context: Record<string, unknown>) => { calls.prepare = context; return { ok: true, preview: { token: "token" } }; }, verifyAndExecuteAction: async (_token: string, context: Record<string, unknown>) => { calls.confirm = context; return { ok: true, summary: "Original summary" }; } },
    });
    const request = (body: unknown) => new Request("https://wesetup.ru/api/ai/sanpin-chat", { method: "POST", headers: { "Content-Type": "application/json", cookie: "wesetup.site-locale=uz" }, body: JSON.stringify(body) });
    const messages = [{ role: "user", content: "Customer input" }];
    const response = await route.POST(request({ messages }));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Content-Language"), locale);
    assert.match(response.headers.get("Cache-Control") ?? "", /no-store/);
    assert.equal(calls.job?.locale, locale);
    assert.equal(calls.job?.orgId, "active-org");
    assert.equal(calls.prepare?.locale, locale);
    assert.equal(calls.prepare?.orgId, "active-org");
    await route.POST(request({ messages, confirmAction: { token: "token" } }));
    assert.equal(calls.queue, 1);
    assert.equal(calls.confirm?.locale, locale);
    assert.equal(calls.confirm?.orgId, "active-org");
    assert.equal(calls.confirm?.inApp, false);
    // Из приложения WeSetup — флаг для текстов без призыва к оплате.
    await route.POST(new Request("https://wesetup.ru/api/ai/sanpin-chat", { method: "POST", headers: { "Content-Type": "application/json", "User-Agent": "Mozilla/5.0 WeSetupApp/1.0 (ios)" }, body: JSON.stringify({ messages, confirmAction: { token: "token" } }) }));
    assert.equal(calls.confirm?.inApp, true);
    const invalid = await route.POST(request({ messages: [] }));
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).code, "AI_INVALID_REQUEST");
    allowed = false;
    const limited = await route.POST(request({ messages }));
    assert.equal(limited.status, 429);
    const limitedBody = await limited.json();
    assert.equal(limitedBody.code, "AI_RATE_LIMIT");
    assert.equal(limitedBody.retryAfterMs, 500);
    allowed = true;
    queueOk = false;
    const unavailable = await route.POST(request({ messages }));
    assert.equal(unavailable.status, 503);
    const unavailableBody = await unavailable.json();
    assert.equal(unavailableBody.code, "AI_UNAVAILABLE");
    assert.ok(!unavailableBody.error.includes("private"));
    if (locale !== "ru") assert.doesNotMatch(limitedBody.error + unavailableBody.error, /\p{Script=Cyrillic}/u);
  }));
});

test("assistant point scope: a point manager cannot fill another point's journal, new staff lands on own point", async () => {
  // Аудит 2026-11-01: помощник руководителя точки А заполнял документ точки Б.
  const scopeA = { points: ["A"], orgBuildingIds: ["A", "B"] };
  const actor = { id: "manager", role: "manager", isRoot: false, name: "Manager" };
  const input = { documentId: "doc", employeeIds: ["employee"], dates: ["2026-10-15"], values: { kind: "status", status: "healthy" } };
  const foreign = actionsFixture(undefined, scopeA, "B");
  const refused = await foreign.actions.prepareAction({ kind: "fill_journal_cells", input }, { orgId: "org", actor, locale: "ru" });
  assert.equal(refused.ok, false);
  const executed = await foreign.actions.executeProposedAction({ kind: "fill_journal_cells", input } as never, { orgId: "org", actor, locale: "ru" }, { audit: false });
  assert.equal(executed.ok, false);
  assert.equal(foreign.writes.length, 0);

  const own = actionsFixture(undefined, scopeA, "A");
  assert.equal((await own.actions.prepareAction({ kind: "fill_journal_cells", input }, { orgId: "org", actor, locale: "ru" })).ok, true);
  const shared = actionsFixture(undefined, scopeA, null);
  assert.equal((await shared.actions.prepareAction({ kind: "fill_journal_cells", input }, { orgId: "org", actor, locale: "ru" })).ok, true);

  const staff = actionsFixture(undefined, scopeA, null);
  const added = await staff.actions.executeProposedAction({ kind: "add_staff", input: { fullName: "CUSTOM_EMPLOYEE", jobPositionId: "position" } }, { orgId: "org", actor, locale: "ru" }, { audit: false });
  assert.equal(added.ok, true);
  assert.deepEqual((staff.writes[0] as { buildingIds?: string[] }).buildingIds, ["A"]);
});
