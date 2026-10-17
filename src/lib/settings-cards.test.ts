import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { SETTINGS_CARDS, settingsCardsFor } from "./settings-cards";
import { NAV_SECTIONS } from "./app-nav";

/**
 * Карточки бывшего хаба `/settings` (до 2026-10-16). Хаб растворился в
 * разделах — ни одна настройка не должна потеряться: каждая теперь либо
 * вкладка раздела, либо пункт (вкладка пункта) меню раздела, либо карточка
 * на «Настройке журналов» / «Остальном».
 */
const FORMER_HUB_HREFS = [
  "/settings/onboarding",
  "/settings/organization",
  "/settings/areas",
  "/settings/buildings",
  "/settings/equipment",
  "/settings/users",
  "/settings/staff-hierarchy",
  "/settings/position-staff-visibility",
  "/settings/journals",
  "/settings/names",
  "/settings/journal-pipelines",
  "/settings/journal-flow",
  "/settings/role-presets",
  "/settings/journal-periods",
  "/settings/products",
  "/settings/phone",
  "/settings/kiosk",
  "/settings/auto-journals",
  "/settings/permissions",
  "/settings/schedule",
  "/settings/journal-access",
  "/settings/journal-responsibles",
  "/settings/journal-task-mode",
  "/settings/onboarding-template",
  "/settings/journal-checklists",
  "/settings/journal-difficulty",
  "/settings/workload-balance",
  "/settings/task-visibility",
  "/settings/journals-by-position",
  "/settings/journal-bonuses",
  "/settings/notifications",
  "/settings/webhooks",
  "/settings/calendar",
  "/settings/security",
  "/settings/balance",
  "/settings/subscription",
  "/settings/services",
  "/orders",
  "/settings/audit",
  "/settings/compliance",
  "/settings/experimental",
  "/settings/inspector-portal",
  "/sanpin",
  "/settings/api",
  "/settings/integrations/tasksflow",
  "/settings/backup",
  "/settings/accounting",
  "/settings/consultant",
  "/settings/partner",
  "/settings/master-cabinet",
  "/settings/appearance",
];

type Catalog = Record<string, unknown>;

function catalog(locale: string): Catalog {
  const file = join(process.cwd(), "src", "i18n", "messages", `${locale}.json`);
  return JSON.parse(readFileSync(file, "utf8")) as Catalog;
}

function dig(source: Catalog, path: string[]): unknown {
  return path.reduce<unknown>(
    (node, key) => (node && typeof node === "object" ? (node as Catalog)[key] : undefined),
    source,
  );
}

/** Адреса вкладок разделов и пунктов меню раздела (с их вкладками) — всё, куда ведёт меню. */
function navMenuHrefs(): string[] {
  return NAV_SECTIONS.flatMap((section) => [
    ...section.tabs.map((tab) => tab.href),
    ...(section.menu ?? []).flatMap((group) =>
      group.items.flatMap((item) => [item.href, ...(item.tabs ?? []).map((tab) => tab.href)]),
    ),
  ]);
}

test("все 51 карточка бывшего хаба на месте — вкладкой, пунктом меню раздела или карточкой", () => {
  assert.equal(FORMER_HUB_HREFS.length, 51);
  const tabHrefs = navMenuHrefs();
  const cardHrefs = SETTINGS_CARDS.map((card) => card.href);
  const missing = FORMER_HUB_HREFS.filter(
    (href) => !tabHrefs.includes(href) && !cardHrefs.includes(href),
  );
  assert.deepEqual(missing, []);
});

test("карточка не дублирует вкладку и не повторяется", () => {
  const tabHrefs = new Set(navMenuHrefs());
  const seen = new Set<string>();
  for (const card of SETTINGS_CARDS) {
    assert.ok(!tabHrefs.has(card.href), `${card.id} уже вкладка`);
    assert.ok(!seen.has(card.href), `${card.id} повторяется`);
    seen.add(card.href);
  }
});

test("у каждой карточки есть название и описание во всех языках", () => {
  for (const locale of ["ru", "en", "uz"]) {
    const messages = catalog(locale);
    for (const card of SETTINGS_CARDS) {
      for (const field of ["title", "description"]) {
        const value = dig(messages, ["settingsManagement", "home", "cards", card.id, field]);
        assert.equal(typeof value, "string", `${locale}: ${card.id}.${field}`);
        assert.ok((value as string).length > 0, `${locale}: ${card.id}.${field}`);
      }
    }
  }
});

test("карточки раздаются по страницам разделов в своём порядке", () => {
  assert.deepEqual(
    settingsCardsFor("journals", "tasks").map((card) => card.href),
    [
      "/settings/journal-task-mode",
      "/settings/journal-flow",
      "/settings/task-visibility",
      "/settings/journal-difficulty",
      "/settings/journal-bonuses",
    ],
  );
  assert.ok(settingsCardsFor("more").some((card) => card.href === "/capa"));
});

test("карточки сотрудников и точек стали пунктами меню своих разделов (2026-10-17)", () => {
  const menuOf = (key: string) =>
    (NAV_SECTIONS.find((section) => section.key === key)?.menu ?? []).flatMap((group) =>
      group.items.flatMap((item) => [item.href, ...(item.tabs ?? []).map((tab) => tab.href)]),
    );
  for (const href of [
    "/settings/permissions",
    "/settings/role-presets",
    "/settings/staff-hierarchy",
    "/settings/position-staff-visibility",
    "/settings/workload-balance",
    "/settings/phone",
    "/settings/journal-responsibles",
    "/settings/journal-access",
    "/settings/journals-by-position",
  ]) {
    assert.ok(menuOf("staff").includes(href), href);
  }
  for (const href of ["/settings/print-agent", "/settings/kiosk", "/settings/products", "/settings/master-cabinet"]) {
    assert.ok(menuOf("points").includes(href), href);
  }
  assert.deepEqual(
    [...new Set(SETTINGS_CARDS.map((card) => card.section))].sort(),
    ["journals", "more"],
  );
});
