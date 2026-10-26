/* eslint-disable react/no-children-prop -- typed SSR fixtures pass children explicitly. */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { createTranslator } from "use-intl/core";
import { loadMessages } from "@/i18n/messages";
import { FORMAT_LOCALES, type Locale } from "@/i18n/locales";
import { MetricsTable } from "@/app/root/metrics-table";
import { OrgRowActions } from "@/app/root/organizations/org-row-actions";
import { formatMetricsRelative, metricsDate, metricsJournalName, metricsPlanLabel } from "@/app/root/metrics-presentation";
import { ACTIVE_JOURNAL_CATALOG } from "@/lib/journal-catalog";
import { JOURNAL_TITLE_RENAMES } from "@/lib/journal-title-renames";
import type { OrgMetrics } from "@/lib/org-metrics";

const now = new Date("2026-10-15T12:30:00.000Z").getTime();
const rows: OrgMetrics[] = [
  { organizationId: "org-a", organizationName: "Customer A <&>", ownerEmail: "owner@example.test", ownerRegistrationIp: "9.9.9.9", ownerLastLoginIp: "10.0.0.2", ownerLastLoginAt: "2026-10-14T23:30:00.000Z", type: "restaurant", ownershipKind: "private", locationsCount: 2, inn: "1234567890", isDemo: true, demoExpiresAt: "2026-10-16T23:30:00.000Z", documentsCount: 12, subscriptionPlan: "paid", subscriptionEnd: null, createdAt: "2026-10-01T23:30:00.000Z", activeUsers: 14, entries7d: 1234, entries30d: 2345, weeklyTrendPct: 20, lastEntryAt: "2026-10-15T10:30:00.000Z", potentialMrrRub: 2390, actualMrrRub: 2390, balanceRub: 400 },
  { organizationId: "org-b", organizationName: "Customer B", ownerEmail: null, ownerRegistrationIp: null, ownerLastLoginIp: null, ownerLastLoginAt: null, type: "meat", ownershipKind: null, locationsCount: 1, inn: null, isDemo: false, demoExpiresAt: null, isDirectory: true, documentsCount: 0, subscriptionPlan: "Customer plan", subscriptionEnd: null, createdAt: "2026-09-01T00:00:00.000Z", activeUsers: 1, entries7d: 0, entries30d: 0, weeklyTrendPct: null, lastEntryAt: null, potentialMrrRub: 0, actualMrrRub: 0, balanceRub: 0 },
];
const router = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch: async () => {} };
async function render(locale: Locale, children: ReactNode) {
  return renderToStaticMarkup(createElement(NextIntlClientProvider, { locale, timeZone: "UTC", messages: await loadMessages(locale), onError: error => { throw error; }, children: createElement(AppRouterContext.Provider, { value: router, children }) }));
}

test("actual ROOT metrics page gates reads, retains one now anchor and original totals/pricing/customer values", async () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    const require = createRequire(import.meta.url), messages = await loadMessages(locale), events: string[] = [];
    let denied = false, anchor: Date | undefined;
    const mod = { exports: {} };
    const source = ts.transpileModule(readFileSync("src/app/root/page.tsx", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
    vm.runInNewContext(source, { module: mod, exports: mod.exports, Date, process: { env: { PLATFORM_ORG_ID: "fixture-platform" } }, require: (id: string) => {
      if (id === "@/lib/auth-helpers") return { requireRoot: async () => { events.push("guard"); if (denied) throw Error("ROOT-only"); } };
      if (id === "@/lib/org-metrics") return { getAllOrgMetrics: async (platform: string, date: Date) => { assert.equal(platform, "fixture-platform"); assert.deepEqual(events, ["guard"]); events.push("metrics"); anchor = date; return rows; } };
      if (id === "next-intl/server") return { getTranslations: async () => createTranslator({ locale, messages, namespace: "rootMetrics" }) };
      if (id === "@/i18n/site-locale-server") return { getSiteLocale: async () => locale };
      if (id === "@/components/i18n/domain-messages-boundary") return { DomainMessagesBoundary: ({ namespaces, children }: { namespaces: string[]; children: ReactNode }) => { assert.deepEqual(JSON.parse(JSON.stringify(namespaces)), ["rootMetrics", "settingsManagement", "journals"]); return children; } };
      if (id === "./metrics-table") return { MetricsTable: (props: Parameters<typeof MetricsTable>[0]) => { assert.equal(props.now, anchor?.getTime()); assert.equal(props.rows[0].organizationId, "org-a"); return createElement(MetricsTable, props); } };
      if (id.startsWith("./")) return require(`@/app/root/${id.slice(2)}`);
      if (id === "@/lib/db") throw Error("Live DB forbidden");
      return require(id);
    } });
    const Page = (mod.exports as { default: () => Promise<ReactNode> }).default;
    const html = await render(locale, await Page());
    const t = createTranslator({ locale, messages, namespace: "rootMetrics" });
    assert.ok(html.includes(messages.rootMetrics.page.title)); assert.ok(html.includes("Customer A &lt;&amp;&gt;"));
    assert.ok(html.includes(t("format.rubles", { amount: 2390 }))); assert.ok(html.includes(t("format.rubles", { amount: 400 })));
    assert.ok(html.includes(t("page.pricing", { standardSeats: 25 })));
    assert.deepEqual(events, ["guard", "metrics"]); events.length = 0; denied = true;
    await assert.rejects(Page(), /ROOT-only/); assert.deepEqual(events, ["guard"]);
  }
});
test("actual metrics table renders empty/populated/missing values in all locales and legacy row actions keep RU defaults", async () => {
  const sourceNames = (await loadMessages("ru")).journals.names;
  for (const locale of ["ru", "en", "uz"] as const) {
    const messages = await loadMessages(locale);
    const html = await render(locale, createElement(MetricsTable, { rows, now, sourceJournalNames: sourceNames }));
    for (const text of [messages.rootMetrics.columns.ownerEmail, messages.rootMetrics.table.never, messages.rootMetrics.table.noUsers, messages.rootMetrics.table.directory, "Customer plan", "1234567890", "9.9.9.9", "10.0.0.2", "owner@example.test"]) assert.ok(html.includes(text), text);
    assert.ok(html.includes(messages.settingsManagement.organizationProfile.form.spheres.restaurant));
    assert.ok(html.includes(messages.settingsManagement.organizationProfile.form.spheres.production));
    assert.ok((await render(locale, createElement(MetricsTable, { rows: [], now, sourceJournalNames: sourceNames }))).includes(messages.rootMetrics.table.noOrganizations));
    const legacy = await render(locale, createElement(OrgRowActions, { organizationId: "org-a", organizationName: "Customer name", usersCount: 14 }));
    assert.ok(legacy.includes("Войти")); assert.ok(legacy.includes("Удалить организацию"));
  }
});
test("journal presentation localizes only recognized sources and preserves custom/unknown template and plan values", async () => {
  const sourceNames = (await loadMessages("ru")).journals.names;
  for (const locale of ["ru", "en", "uz"] as const) {
    const messages = await loadMessages(locale), t = createTranslator({ locale, messages, namespace: "rootMetrics" });
    for (const [code, source] of Object.entries(sourceNames)) {
      assert.equal(metricsJournalName(locale, code, source, messages.journals.names, sourceNames), locale === "ru" ? source : messages.journals.names[code as keyof typeof sourceNames]);
      assert.equal(metricsJournalName(locale, code, "Customer custom journal", messages.journals.names, sourceNames), "Customer custom journal");
    }
    for (const item of ACTIVE_JOURNAL_CATALOG) if (Object.hasOwn(sourceNames, item.code)) assert.equal(metricsJournalName(locale, item.code, item.name, messages.journals.names, sourceNames), locale === "ru" ? item.name : messages.journals.names[item.code as keyof typeof sourceNames]);
    for (const item of JOURNAL_TITLE_RENAMES) for (const name of item.legacyTitles) assert.equal(metricsJournalName(locale, item.code, name, messages.journals.names, sourceNames), locale === "ru" ? name : messages.journals.names[item.code as keyof typeof sourceNames]);
    assert.equal(metricsJournalName(locale, "custom-code", "Customer journal", messages.journals.names, sourceNames), "Customer journal");
    for (const plan of ["free", "trial", "paid", "pro"] as const) assert.equal(metricsPlanLabel(plan, t), messages.rootMetrics.plans[plan]);
    assert.equal(metricsPlanLabel("Customer custom plan", t), "Customer custom plan");
  }
});
test("date/relative presentation preserves timezone basis, 24-hour/30-day thresholds and shared now", async () => {
  const previousTz = process.env.TZ;
  try {
    for (const timezone of ["UTC", "Asia/Tashkent", "America/Los_Angeles"]) {
      process.env.TZ = timezone;
      for (const locale of ["ru", "en", "uz"] as const) {
        const messages = await loadMessages(locale), t = createTranslator({ locale, messages, namespace: "rootMetrics" });
        const source = "2026-10-14T23:30:00.000Z";
        assert.equal(metricsDate(source, locale), new Date(source).toLocaleString(FORMAT_LOCALES[locale]));
        assert.equal(metricsDate(source, locale, undefined, true), new Date(source).toLocaleDateString(FORMAT_LOCALES[locale]));
        for (const [hours, key, count] of [[0, "relative.justNow", 0], [1, "relative.hours", 1], [23, "relative.hours", 23], [24, "relative.days", 1], [719, "relative.days", 29], [720, "relative.months", 1]] as const) {
          const expected = key === "relative.justNow" ? t(key) : t(key, { count });
          assert.equal(formatMetricsRelative(new Date(now - hours * 3600000), now, t), expected);
        }
      }
    }
  } finally { if (previousTz === undefined) delete process.env.TZ; else process.env.TZ = previousTz; }
});
