/* eslint-disable react/no-children-prop -- Typed SSR fixtures pass children in props. */
import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { createElement, type ComponentType, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { createTranslator } from "use-intl/core";
import { loadMessages } from "@/i18n/messages";
import { FORMAT_LOCALES, type Locale } from "@/i18n/locales";

const prepared = process.env.ROOT_ORGANIZATION_PREPARED;
const sourceRoot = prepared ? path.resolve(prepared) : process.cwd();
const folder = "src/app/root/organizations/[id]/";
const require = createRequire(import.meta.url);
function load(file: string, mocks: Record<string, unknown> = {}, cache = new Map<string, Record<string, unknown>>()): Record<string, unknown> {
  if (cache.has(file)) return cache.get(file)!;
  const mod = { exports: {} as Record<string, unknown> }; cache.set(file, mod.exports);
  const source = ts.transpileModule(readFileSync(path.join(sourceRoot, file), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  vm.runInNewContext(source, { module: mod, exports: mod.exports, Date, Number, Request, Response, console, process, setTimeout, clearTimeout, require: (id: string) => {
    if (Object.hasOwn(mocks, id)) return mocks[id];
    const relative = id.startsWith("./") ? path.posix.join(path.posix.dirname(file), id) : id.startsWith("@/app/root/organizations/[id]/") ? "src/" + id.slice(2) : null;
    if (relative) for (const extension of [".ts", ".tsx"]) if (existsSync(path.join(sourceRoot, relative + extension))) return load(relative + extension, mocks, cache);
    if (["@/lib/db", "@/lib/auth", "@/lib/tasksflow-client"].includes(id)) throw Error("Unmocked side effect: " + id);
    return require(id);
  } });
  return mod.exports;
}
async function messages(locale: Locale) {
  const canonical = await loadMessages(locale);
  return prepared ? { ...canonical, ...JSON.parse(readFileSync(path.resolve(prepared, "..", locale + ".json"), "utf8")) } : canonical;
}
const router = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch: async () => {} };
async function render(locale: Locale, children: ReactNode) {
  return renderToStaticMarkup(createElement(NextIntlClientProvider, { locale, timeZone: "UTC", messages: await messages(locale), onError: e => { throw e; }, children: createElement(AppRouterContext.Provider, { value: router, children }) }));
}
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));
type Handler = (request: Request, context: { params: Promise<{ id: string }> }) => Promise<Response>;
const context = (id = "org-a") => ({ params: Promise.resolve({ id }) });
const req = (method = "POST", body?: unknown) => new Request("http://fixture.invalid/api", { method, ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });

test("actual organization page retains ROOT gate, tenant reads, totals, custom values and PDF eligibility in all locales", async () => {
  for (const locale of ["ru", "en", "uz"] as const) for (const empty of [false, true]) {
    const catalogs = await messages(locale), calls: unknown[] = []; let denied = false, missing = false;
    const org = { id: "org-a", name: "Customer <&>", type: "Custom sphere", inn: "001234", createdAt: new Date("2026-10-15T23:30:00Z"), subscriptionPlan: "Customer plan", subscriptionEnd: new Date("2026-11-01T00:00:00Z"), externalApiToken: "fixture-token", balanceRub: -20, referredByOrganizationId: "ref-a", _count: { users: 2, journalDocuments: 3, journalEntries: 9 }, users: [{ id: "user-a", name: "Customer employee", email: "a@example.test", role: "Custom role", isActive: true, createdAt: new Date("2026-10-15T23:30:00Z"), telegramChatId: null, journalAccessMigrated: false }] };
    const db = { organization: { findUnique: async (q: { where: { id: string } }) => { assert.equal(calls[0], "guard"); calls.push(plain(q)); return missing ? null : q.where.id === "ref-a" ? { name: "Customer referrer" } : org; }, count: async (q: unknown) => { calls.push(plain(q)); return 2; } }, journalDocument: { count: async (q: unknown) => { calls.push(plain(q)); return 2; } }, paymentOrder: { findMany: async (q: unknown) => { calls.push(plain(q)); return empty ? [] : [{ id: 101, tariffKey: "Customer tariff", amountRub: 1990, status: "paid", paidAt: new Date("2026-10-15T23:30:00Z"), createdAt: new Date(), pointsSpent: 10, isTest: false, refundedAt: null, paymentMethod: "card", promoCode: "CUSTOMER", discountRub: 100, promotionPercent: 10, promotionDiscountRub: 200 }, { id: 102, tariffKey: "Customer tariff", amountRub: 5000, status: "pending", createdAt: new Date(), pointsSpent: 0, paymentMethod: "invoice" }]; } }, balanceTransaction: { findMany: async (q: unknown) => { calls.push(plain(q)); return empty ? [] : [{ id: "tx", amount: -20, kind: "manual_adjust", description: "Оригинальный комментарий клиента", createdAt: new Date("2026-10-14T23:30:00Z") }]; } } };
    const mocks = { "@/lib/auth-helpers": { requireRoot: async () => { calls.push("guard"); if (denied) throw Error("ROOT_DENIED"); return { user: { id: "root-user", isRoot: true } }; } }, "@/lib/platform-access.server": { platformViewerForSession: async () => ({ superadmin: true, sections: [] }) }, "@/lib/root-client-card.server": { loadClientContacts: async () => null }, "@/lib/db": { db }, "@/lib/closing-documents/requisites": { readPlatformRequisites: async () => ({}) }, "@/lib/closing-documents/types": { isRequisitesComplete: () => true }, "next/navigation": { notFound: () => { throw Error("NOT_FOUND"); }, useRouter: () => router }, "next-intl/server": { getTranslations: async (namespace: string) => createTranslator({ locale, messages: catalogs, namespace }) }, "@/i18n/site-locale-server": { getSiteLocale: async () => locale }, "@/components/i18n/domain-messages-boundary": { DomainMessagesBoundary: ({ namespaces, children }: { namespaces: string[]; children: ReactNode }) => { assert.deepEqual(plain(namespaces), ["rootOrganizationManagement", "rootPanel", "rootEdo"]); return children; } },
      // Карточка договора грузит свои данные сама (src/lib/contracts) и проверяется своими тестами.
      "@/components/root/client-contract-section": { ClientContractSection: () => null } };
    const Page = load(folder + "page.tsx", mocks).default as (props: ReturnType<typeof context>) => Promise<ReactNode>;
    const html = await render(locale, await Page(context()));
    for (const literal of ["Customer &lt;&amp;&gt;", "Custom sphere", "Custom role", "Customer plan", "Customer employee", "Customer referrer", "001234", "a@example.test"]) assert.ok(html.includes(literal), literal);
    assert.ok(calls.some(c => JSON.stringify(c) === JSON.stringify({ where: { organizationId: "org-a", status: "active" } })));
    if (!empty) { assert.ok(html.includes("Оригинальный комментарий клиента")); assert.ok(html.includes('/api/closing-documents/101/pdf')); assert.ok(html.includes('/api/payments/invoice/102/pdf')); assert.ok(html.includes("CUSTOMER")); }
    calls.length = 0; denied = true; await assert.rejects(Page(context()), /ROOT_DENIED/); assert.deepEqual(calls, ["guard"]);
    denied = false; missing = true; calls.length = 0; await assert.rejects(Page(context()), /NOT_FOUND/); assert.equal(calls.length, 2);
  }
});

test("actual presenters preserve unknown values, role aliases, order distinctions, currency and unsafe descriptor rejection", async () => {
  const helper = load(folder + "organization-presentation.ts") as Record<string, (...args: unknown[]) => string>;
  for (const locale of ["ru", "en", "uz"] as const) {
    const catalogs = await messages(locale), t = createTranslator({ locale, messages: catalogs, namespace: "rootOrganizationManagement" }), roles = createTranslator({ locale, messages: catalogs, namespace: "staffManagement.roleLabels" });
    assert.equal(helper.organizationRole("owner", roles), roles("manager")); assert.equal(helper.organizationRole("Custom role", roles), "Custom role");
    assert.equal(helper.organizationOrderStatus({ status: "paid" }, t), helper.organizationOrderStatus({ status: "completed" }, t));
    assert.notEqual(helper.organizationOrderStatus({ status: "pending" }, t), helper.organizationOrderStatus({ status: "pending", paymentMethod: "invoice" }, t));
    assert.equal(helper.organizationOrderStatus({ status: "CUSTOM" }, t), "CUSTOM");
    for (const data of [null, { error: "RAW SECRET" }, { errorCode: "UNKNOWN" }, { errorCode: "ORG_BALANCE_INSUFFICIENT", errorParams: { amount: "100" } }, { errorCode: "ORG_BALANCE_INSUFFICIENT", errorParams: { amount: Infinity } }]) assert.equal(helper.organizationError(data, t, "balance.failed"), t("balance.failed"));
    assert.equal(helper.organizationError({ errorCode: "ORG_BALANCE_INSUFFICIENT", errorParams: { amount: 100 } }, t, "balance.failed"), t("errors.insufficientBalance", { amount: 100 }));
    assert.equal(helper.organizationKind("unknown", t), t("kinds.unknown"));
    const Form = load(folder + "org-settings-form.tsx").OrgSettingsForm as ComponentType<Record<string, unknown>>;
    const html = await render(locale, createElement(Form, { organizationId: "org-a", initialName: "Customer", initialPlan: "Custom plan", initialSubscriptionEnd: "2026-10-15T23:30:00Z" })); assert.ok(html.includes('value="Custom plan"')); assert.ok(html.includes('value="2026-10-15"'));
  }
  const old = process.env.TZ;
  try { for (const zone of ["UTC", "Asia/Tashkent", "America/Los_Angeles"]) { process.env.TZ = zone; for (const locale of ["ru", "en", "uz"] as const) { const instant = "2026-10-15T23:30:00Z"; assert.equal(helper.organizationDate(instant, locale, true), new Date(instant).toLocaleDateString(FORMAT_LOCALES[locale])); assert.equal(helper.organizationDate(instant, locale), new Date(instant).toLocaleString(FORMAT_LOCALES[locale])); } } } finally { if (old === undefined) delete process.env.TZ; else process.env.TZ = old; }
});

test("actual PATCH/DELETE descriptors retain legacy statuses, fields, tenant mutations and audit values", async () => {
  const calls: unknown[] = []; let exists = true, denied = false;
  const org = { id: "org-a", name: "Customer", type: "restaurant", subscriptionPlan: "paid", subscriptionEnd: null };
  const db = { organization: { findUnique: async () => exists ? org : null, update: async (q: unknown) => { calls.push(plain(q)); return org; }, delete: async (q: unknown) => { calls.push(plain(q)); } }, tasksFlowIntegration: { findMany: async (q: unknown) => { calls.push(plain(q)); return []; } } };
  const mod = load("src/app/api/root/organizations/[id]/route.ts", { "@/lib/auth-helpers": { requireRoot: async () => { if (denied) throw Error("DENIED"); return { user: { id: "root" } }; } }, "@/lib/db": { db }, "@/lib/audit-log": { recordAuditLog: async (q: unknown) => calls.push(plain(q)) }, "@/lib/tasksflow-client": { tasksflowClientFor: () => { throw Error("Unexpected provider"); } } });
  const PATCH = mod.PATCH as Handler, DELETE = mod.DELETE as Handler;
  for (const [body, code, error] of [[{ name: "x" }, "ORG_NAME_SHORT", "Слишком короткое название"], [{ subscriptionPlan: "x" }, "ORG_PLAN_UNKNOWN", "Неизвестный тариф"], [{ subscriptionEnd: "bad" }, "ORG_DATE_INVALID", "Некорректная дата"]] as const) { const response = await PATCH(req("PATCH", body), context()); assert.equal(response.status, 400); assert.deepEqual(await response.json(), { error, errorCode: code }); }
  assert.equal(calls.length, 0);
  await PATCH(req("PATCH", { name: " Original name ", subscriptionPlan: "paused", subscriptionEnd: "2026-10-15T00:00:00.000Z" }), context());
  assert.deepEqual(calls[0], { where: { id: "org-a" }, data: { name: "Original name", subscriptionPlan: "paused", subscriptionEnd: "2026-10-15T00:00:00.000Z" }, select: { id: true, name: true, subscriptionPlan: true, subscriptionEnd: true } });
  exists = false; assert.equal((await (await PATCH(req("PATCH", {}), context())).json()).errorCode, "ORG_NOT_FOUND"); exists = true;
  const old = process.env.PLATFORM_ORG_ID; process.env.PLATFORM_ORG_ID = "platform";
  try { assert.equal((await (await DELETE(req("DELETE"), context("platform"))).json()).errorCode, "ORG_PLATFORM_PROTECTED"); const response = await DELETE(req("DELETE"), context()); assert.deepEqual(await response.json(), { ok: true, tfTasksDeleted: 0, tfTasksFailed: 0 }); assert.ok(calls.some(c => JSON.stringify(c) === '{"where":{"id":"org-a"}}')); } finally { if (old === undefined) delete process.env.PLATFORM_ORG_ID; else process.env.PLATFORM_ORG_ID = old; }
  denied = true; await assert.rejects(PATCH(req("PATCH", {}), context()), /DENIED/);
});

test("actual balance route descriptors preserve validation, ledger/audit data and notification side effects", async () => {
  const calls: unknown[] = []; let insufficient = false;
  class InsufficientBalanceError extends Error {}
  const db = { organization: { findUnique: async () => ({ id: "org-a", name: "Customer", balanceRub: 50 }) } };
  const POST = load("src/app/api/root/organizations/[id]/balance/route.ts", { "@/lib/auth-helpers": { requireRoot: async () => ({ user: { id: "root" } }) }, "@/lib/db": { db }, "@/lib/balance/ledger": { InsufficientBalanceError, creditBalance: async (value: unknown) => { if (insufficient) throw new InsufficientBalanceError(); calls.push(plain(value)); } }, "@/lib/audit-log": { recordAuditLog: async (value: unknown) => calls.push(plain(value)) }, "@/lib/live-events": { publishToOrganization: (...args: unknown[]) => calls.push(plain(args)) }, "@/lib/notifications": { notifyManagement: async (value: unknown) => calls.push(plain(value)) } }).POST as Handler;
  for (const amount of [0, 1.5, 1000001]) { const response = await POST(req("POST", { amount, comment: "Reason" }), context()); assert.equal(response.status, 400); assert.equal((await response.json()).errorCode, "ORG_BALANCE_INVALID"); } assert.equal(calls.length, 0);
  insufficient = true; const response = await POST(req("POST", { amount: -100, comment: "Reason" }), context()); assert.equal(response.status, 409); const body = await response.json(); assert.equal(body.errorCode, "ORG_BALANCE_INSUFFICIENT"); assert.deepEqual(body.errorParams, { amount: 50 }); assert.ok(body.error.includes("50 ₽"));
  insufficient = false; await POST(req("POST", { amount: -20, comment: " Original comment " }), context()); assert.deepEqual(calls[0], { organizationId: "org-a", amount: -20, kind: "manual_adjust", description: "Original comment", actorUserId: "root" }); assert.equal(calls.length, 4);
});

test("actual invoice routes retain identifiers, statuses and audit output with additive descriptors", async () => {
  for (const kind of ["mark-paid", "cancel"]) { let success = false; const calls: unknown[] = [];
    const POST = load(`src/app/api/root/orders/[id]/${kind}/route.ts`, { "@/lib/auth-helpers": { requireRoot: async () => ({ user: { id: "root" } }) }, "@/lib/db": { db: { paymentOrder: { findUnique: async () => ({ organizationId: "org-a" }) } } }, "@/lib/audit-log": { recordAuditLog: async (q: unknown) => calls.push(plain(q)) }, "@/lib/invoices/service": { markInvoicePaid: async (id: number, user: string) => { calls.push([id, user]); return success ? { ok: true, order: { organizationId: "org-a", amountRub: 1990, tariffKey: "Custom tariff" } } : { ok: false, error: "Legacy service error", status: 409 }; }, cancelInvoice: async (id: number) => { calls.push(id); return success; } } }).POST as Handler;
    assert.equal((await (await POST(req(), context("bad"))).json()).errorCode, "ROOT_ORDER_NOT_FOUND");
    const failed = await POST(req(), context("00123")); assert.equal(failed.status, 409); assert.equal((await failed.json()).errorCode, kind === "cancel" ? "ROOT_ORDER_CANCEL_UNPAID_ONLY" : "ROOT_INVOICE_ACTION_FAILED");
    success = true; const ok = await POST(req(), context("00123")); assert.deepEqual(await ok.json(), { ok: true, orderId: 123, status: kind === "cancel" ? "cancelled" : "paid" }); assert.ok(calls.length >= 3);
  }
});

test("actual impersonation keeps guard, audit/customer values and session claims while hiding rewrite details in descriptors", async () => {
  let root = false, rewrite = false; const calls: unknown[] = [];
  const POST = load("src/app/api/root/impersonate/route.ts", { "@/lib/server-session": { getServerSession: async () => ({ user: { isRoot: root, id: "root", name: "Customer root" } }) }, "@/lib/auth": { authOptions: {} }, "@/lib/session-token": { rewriteSessionClaims: async (value: unknown) => { calls.push(plain(value)); return rewrite ? { ok: true } : { ok: false, reason: "Legacy reason" }; } }, "@/lib/db": { db: { organization: { findUnique: async (q: unknown) => { calls.push(plain(q)); return { id: "org-a", name: "Customer" }; } }, auditLog: { create: async (q: unknown) => calls.push(plain(q)) } } } }).POST as Handler;
  assert.equal((await POST(req("POST", { organizationId: "org-a" }), context())).status, 404); assert.equal(calls.length, 0);
  root = true; assert.equal((await (await POST(req("POST", {}), context())).json()).errorCode, "ORG_ID_REQUIRED");
  const failed = await POST(req("POST", { organizationId: "org-a" }), context()); assert.equal(failed.status, 500); assert.deepEqual(await failed.json(), { error: "Не удалось обновить сессию: Legacy reason", errorCode: "ROOT_IMPERSONATE_FAILED" });
  rewrite = true; const ok = await POST(req("POST", { organizationId: "org-a" }), context()); assert.deepEqual(await ok.json(), { ok: true, organization: { id: "org-a", name: "Customer" } }); assert.ok(calls.some(c => JSON.stringify(c) === '{"actingAsOrganizationId":"org-a"}'));
});
