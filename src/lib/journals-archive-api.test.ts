import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { loadMessages } from "@/i18n/messages";

const require = createRequire(import.meta.url);
function fixture(options: { locale?: string | null; organizationLocale?: string | null; management?: boolean; limited?: boolean; fail?: boolean } = {}) {
  const calls: { type: string; value: unknown }[] = [];
  const session = { user: { id: "user-1", locale: options.locale, organizationLocale: "ru", organizationId: "home-org", actingAsOrganizationId: "active-org" } };
  const fixtureModule = { exports: {} as { GET: (request: Request) => Promise<Response> } };
  vm.runInNewContext(ts.transpileModule(readFileSync("src/app/api/settings/export-journals/route.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, {
    module: fixtureModule, exports: fixtureModule.exports, URL, Buffer, Uint8Array, console: { error() {} },
    require: (id: string) => {
      if (id === "@/lib/auth-helpers") return { requireAuth: async () => session, getActiveOrgId: () => "active-org" };
      if (id === "@/lib/role-access") return { hasFullWorkspaceAccess: () => options.management !== false };
      if (id === "@/lib/db") return { db: { organization: { findUnique: async (query: unknown) => { calls.push({ type: "organization", value: query }); return { locale: options.organizationLocale }; } } } };
      if (id === "@/lib/rate-limit") return { createRateLimiter: (config: unknown) => { calls.push({ type: "limiterConfig", value: config }); return { consume: (key: string) => { calls.push({ type: "consume", value: key }); return !options.limited; } }; } };
      if (id === "@/lib/journals-archive") return { buildJournalsArchive: async (...args: unknown[]) => { calls.push({ type: "archive", value: args }); if (options.fail) throw new Error("RAW failure"); return { zip: Buffer.from("ZIP fixture"), documents: 2, fieldJournals: 3, truncated: true }; } };
      if (id === "@/lib/audit-log") return { recordAuditLog: async (event: unknown) => { calls.push({ type: "audit", value: event }); } };
      return require(id);
    },
  });
  return { get: fixtureModule.exports.GET, calls };
}

test("actual archive API resolves explicit/personal/active-org/RU locale without changing dates, audit or headers", async () => {
  for (const choice of [
    { query: "&locale=uz", locale: "en", organizationLocale: "ru", expected: "uz" },
    { query: "", locale: "en", organizationLocale: "uz", expected: "en" },
    { query: "", locale: null, organizationLocale: "uz", expected: "uz" },
    { query: "", locale: null, organizationLocale: null, expected: "ru" },
  ]) {
    const view = fixture(choice);
    const response = await view.get(new Request(`https://example.test/api/settings/export-journals?from=2026-10-01&to=2026-10-15${choice.query}`, { headers: { cookie: "wesetup.site-locale=ru" } }));
    assert.equal(response.status, 200); assert.equal(response.headers.get("Content-Language"), choice.expected);
    assert.equal(response.headers.get("Content-Type"), "application/zip");
    assert.equal(response.headers.get("Content-Disposition"), 'attachment; filename="wesetup-journals-2026-10-01-2026-10-15.zip"');
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal(response.headers.get("X-Archive-Documents"), "2"); assert.equal(response.headers.get("X-Archive-Field-Journals"), "3"); assert.equal(response.headers.get("X-Archive-Truncated"), "1");
    assert.equal(await response.text(), "ZIP fixture");
    const values = JSON.parse(JSON.stringify(view.calls));
    assert.deepEqual(values.find((call: {type:string}) => call.type === "organization").value, { where: { id: "active-org" }, select: { locale: true } });
    assert.deepEqual(values.find((call: {type:string}) => call.type === "archive").value, ["active-org", "2026-10-01T00:00:00.000Z", "2026-10-15T23:59:59.999Z", choice.expected]);
    assert.deepEqual(values.find((call: {type:string}) => call.type === "limiterConfig").value, { tokensPerInterval: 5, intervalMs: 600000 });
    assert.deepEqual(values.filter((call: {type:string}) => call.type === "consume").map((call: {value:string}) => call.value), ["export:active-org"]);
    const audit = values.find((call: {type:string}) => call.type === "audit").value;
    assert.equal(audit.organizationId, "active-org"); assert.equal(audit.entityId, "active-org"); assert.equal(audit.action, "journals.export"); assert.equal(audit.entity, "Organization");
    assert.deepEqual(audit.details, { from: "2026-10-01", to: "2026-10-15", documents: 2, fieldJournals: 3 });
  }
});

test("archive management/rate/date/locale/error paths localize and cannot generate or audit denied exports", async () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    for (const scenario of [
      { management: false, query: "", status: 403, code: "forbidden" },
      { limited: true, query: "", status: 429, code: "rateLimited" },
      { query: "?locale=de", status: 400, code: "invalidLocale" },
      { query: "?from=2026-10-15&to=2026-10-01", status: 400, code: "reversedDates" },
      { query: "?from=2020-01-01&to=2026-10-01", status: 400, code: "periodTooLong" },
      { fail: true, query: "", status: 500, code: "failed" },
    ]) {
      const view = fixture({ ...scenario, locale, organizationLocale: "ru" });
      const response = await view.get(new Request(`https://example.test/api/settings/export-journals${scenario.query}`));
      assert.equal(response.status, scenario.status); assert.equal(response.headers.get("Content-Language"), locale);
      const body = await response.json(); assert.equal(body.code, scenario.code);
      assert.ok(!body.error.includes("RAW"));
      const copy = (await loadMessages(locale)).archiveExport.errors;
      assert.equal(body.error, copy[scenario.code as keyof typeof copy].replace("{max, number}", "400"));
      assert.equal(view.calls.filter(call => call.type === "audit").length, 0);
      assert.equal(view.calls.filter(call => call.type === "archive").length, scenario.fail ? 1 : 0);
      if (scenario.management === false) assert.equal(view.calls.filter(call => call.type === "organization" || call.type === "consume").length, 0);
    }
  }
});
