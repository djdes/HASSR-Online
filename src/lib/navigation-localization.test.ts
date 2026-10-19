import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import { createTranslator } from "use-intl/core";
import { loadMessages } from "@/i18n/messages";
import { FORMAT_LOCALES, type Locale } from "@/i18n/locales";
import { ROUTE_TITLES, ROUTE_TITLE_KEYS, getRouteTitle, getDynamicRouteTitle, getSiblingRoutes } from "./route-titles";
import { buildJournalSwitcherMenu, journalSwitcherOptions, filterCrumbMenu, matchingHidden } from "./crumb-menu";
import { NAV_SECTIONS } from "./app-nav";
import type { Session } from "next-auth";

test("129 static routes and dynamic journal-task route resolve typed localized titles without changing paths", async () => {
  assert.equal(Object.keys(ROUTE_TITLE_KEYS).length, 129);
  assert.deepEqual(Object.keys(ROUTE_TITLE_KEYS), Object.keys(ROUTE_TITLES));
  for (const locale of ["ru", "en", "uz"] as const) {
    const messages = await loadMessages(locale);
    const onError = (error: Error) => { throw error; };
    const t = createTranslator({ locale, messages, namespace: "navigation.routes", onError });
    const nav = createTranslator({ locale, messages, namespace: "navigation", onError });
    for (const [path, key] of Object.entries(ROUTE_TITLE_KEYS)) {
      assert.equal(getRouteTitle(path + "/", t), t(key));
      assert.equal(getRouteTitle(path), ROUTE_TITLES[path]);
      if (locale === "ru") assert.equal(t(key), ROUTE_TITLES[path]);
      else assert.doesNotMatch(t(key), /\p{Script=Cyrillic}/u);
      assert.deepEqual(getSiblingRoutes(path, t, locale).map(item => item.path).sort(), getSiblingRoutes(path).map(item => item.path).sort());
    }
    assert.equal(getDynamicRouteTitle("/settings/journals/custom-id/scope/", t), t("journal_scope"));
    assert.equal(getRouteTitle("/unknown/id", t), null);
    assert.equal(getRouteTitle("constructor", t), null);
    // Меню кабинета (девять разделов, их вкладки и меню разделов) — на каждом
    // языке. Подписи меню раздела — в своём пространстве `shell.menus.<раздел>`.
    const menuLabel = nav as unknown as (key: string) => string;
    assert.equal((messages.navigation.shell as Record<string, unknown>).items, undefined);
    assert.equal((messages.navigation.shell as Record<string, unknown>).menuGroups, undefined);
    assert.equal((messages.navigation.shell as Record<string, unknown>).subtabs, undefined);
    for (const section of NAV_SECTIONS) {
      const menuLabels = (section.menu ?? []).flatMap((group) => [
        ...(group.label ? [menuLabel(`shell.menus.${section.key}.groups.${group.label}`)] : []),
        ...group.items.flatMap((item) => [
          menuLabel(`shell.menus.${section.key}.items.${item.id}`),
          ...(item.tabs ?? []).map((tab) => menuLabel(`shell.menus.${section.key}.tabs.${tab.id}`)),
        ]),
      ]);
      const labels = [
        nav(`shell.sections.${section.key}`),
        ...section.tabs.map((tab) => nav(`shell.tabs.${tab.label}`)),
        ...menuLabels,
      ];
      for (const label of labels) {
        assert.ok(label, section.key);
        if (locale !== "ru") assert.doesNotMatch(label, /\p{Script=Cyrillic}/u, `${section.key}: ${label}`);
      }
    }
  }
});

test("localized switcher search retains original names/codes for visible and hidden journals", async () => {
  for (const locale of ["en", "uz"] as const) {
    const messages = await loadMessages(locale);
    const t = createTranslator({ locale, messages, namespace: "navigation.breadcrumbs" });
    const menu = buildJournalSwitcherMenu({
      templates: [
        { id: "a", code: "cleaning", name: messages.journals.names.cleaning, officialName: "Журнал уборки" },
        { id: "b", code: "hygiene", name: "Custom O‘tkir", officialName: "Гигиенический журнал" },
        { id: "c", code: "climate_control", name: messages.journals.names.climate_control, officialName: "Журнал климата" },
      ],
      disabledCodes: new Set(["hygiene", "climate_control"]), filledTemplateIds: new Set(["a"]),
      currentCode: "hygiene", showAllHref: "/settings/journals", t,
    });
    assert.equal(filterCrumbMenu(menu.items, "уборки")[0].href, "/journals/cleaning");
    assert.equal(filterCrumbMenu(menu.items, "hygiene")[0].label, "Custom O‘tkir");
    const current = menu.items.find(item => item.current)!;
    assert.equal(current.status, "muted");
    assert.equal(current.hint, t("disabled"));
    const options = journalSwitcherOptions(menu, t);
    assert.equal(options.menuSearch, t("searchJournals"));
    assert.equal(options.menuFooterLink!.href, "/settings/journals");
    assert.deepEqual(matchingHidden(menu.disabledLabels, "климата", menu.disabledItems), [messages.journals.names.climate_control]);
    assert.deepEqual(matchingHidden(menu.disabledLabels, "climate_control", menu.disabledItems), [messages.journals.names.climate_control]);
  }
});

function serverBuilderFixture() {
  const queries: Array<{ name: string; input: unknown }> = [];
  const source = ts.transpileModule(readFileSync("src/lib/journal-crumb-menu.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const require = createRequire(import.meta.url);
  const fixtureModule = { exports: {} };
  const templates = [
    { id: "t-cleaning", code: "cleaning", name: "Журнал уборки" },
    { id: "t-hygiene", code: "hygiene", name: "Гигиенический журнал" },
    { id: "t-climate", code: "climate_control", name: "Журнал климата" },
  ];
  vm.runInNewContext(source, {
    module: fixtureModule, exports: fixtureModule.exports,
    require: (id: string) => {
      if (id === "react") return { cache: (fn: unknown) => fn };
      if (id === "@/i18n/site-locale-server") return { getSiteLocale: async () => "ru" };
      if (id === "@/lib/auth-helpers") return { getActiveOrgId: () => "active-org" };
      if (id === "@/lib/journal-acl") return { aclActorFromSession: () => ({ id: "actor" }), getAllowedJournalCodes: async () => ["cleaning", "hygiene", "climate_control"] };
      if (id === "@/lib/role-access") return { hasFullWorkspaceAccess: (user: {role: string}) => user.role === "owner" };
      if (id === "@/lib/active-building") return { getActiveBuildingId: async () => "building-id" };
      if (id === "@/lib/org-custom-names") return { getOrgCustomNames: async () => ({ journals: { hygiene: "Своя гигиена O‘tkir" }, sections: {} }) };
      if (id === "@/lib/today-compliance") return { getTemplatesFilledToday: async (...input: unknown[]) => { queries.push({ name: "filled", input }); return new Set(["t-cleaning"]); } };
      if (id === "@/lib/db") return { db: {
        journalTemplate: { findMany: async (input: unknown) => { queries.push({ name: "templates", input }); return templates; } },
        organization: { findUnique: async (input: unknown) => { queries.push({ name: "organization", input }); return { disabledJournalCodes: ["climate_control"] }; } },
        journalDocument: { findMany: async (input: unknown) => { queries.push({ name: "documents", input }); return [
          { id: "raw-id", title: "Исходное имя документа O‘tkir", status: "active", dateFrom: new Date("2026-09-01T00:00:00Z"), building: { name: "Своя точка" } },
          { id: "closed-id", title: "Customer 2026", status: "closed", dateFrom: new Date("2026-08-01T00:00:00Z"), building: null },
        ]; } },
      } };
      return require(id);
    },
  });
  return { ...(fixtureModule.exports as typeof import("./journal-crumb-menu")), queries };
}

test("real server menu builders isolate explicit locales and retain ACL, tenant, statuses and raw document names", async () => {
  const fixture = serverBuilderFixture();
  const session = { user: { role: "owner" } } as Session;
  const locales: Locale[] = ["en", "uz", "ru"];
  const menus = await Promise.all(locales.map(locale => fixture.getJournalCrumbMenu(session, "cleaning", locale)));
  for (const [index, locale] of locales.entries()) {
    const messages = await loadMessages(locale);
    const menu = menus[index];
    assert.equal(menu.items.find(item => item.href === "/journals/cleaning")!.label, locale === "ru" ? "Журнал уборки" : messages.journals.names.cleaning);
    assert.equal(menu.items.find(item => item.href === "/journals/hygiene")!.label, "Своя гигиена O‘tkir");
    assert.equal(menu.items.find(item => item.current)!.status, "ok");
    assert.ok(!menu.items.some(item => item.href.endsWith("climate_control")));
    assert.equal(menu.showAllHref, "/settings/journals");
    const docs = await fixture.getDocumentCrumbMenu("active-org", "cleaning", "raw-id", "building-id", locale);
    assert.equal(docs[0].label, "Исходное имя документа O‘tkir");
    assert.equal(docs[0].href, "/journals/cleaning/documents/raw-id");
    assert.equal(docs[0].current, true);
    assert.equal(docs[0].status, "ok");
    assert.equal(docs[1].status, "muted");
    const period = new Intl.DateTimeFormat(FORMAT_LOCALES[locale], { month: "short", year: "numeric" }).format(new Date("2026-08-01T00:00:00Z"));
    const t = createTranslator({ locale, messages, namespace: "navigation.breadcrumbs" });
    assert.equal(docs[1].hint, t("sharedPeriod", { period }));
    assert.ok(docs[0].hint!.startsWith("Своя точка · "));
  }
  const employeeMenu = await fixture.getJournalCrumbMenu({ user: { role: "cook" } } as Session, undefined, "en");
  assert.equal(employeeMenu.showAllHref, null);
  const serialized = JSON.stringify(fixture.queries);
  assert.ok(serialized.includes('"organizationId":"active-org"'));
  assert.ok(serialized.includes('"code":{"in":["cleaning","hygiene","climate_control"]}'));
  assert.ok(serialized.includes('"buildingId":"building-id"'));
});
