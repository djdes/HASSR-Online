import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import {
  PLATFORM_PRESETS,
  PLATFORM_SECTIONS,
  PLATFORM_SECTION_KEYS,
  canAccessPlatformPath,
  canEnterClientCabinets,
  canImpersonateFromToken,
  canUseTranslationEditor,
  effectivePlatformSections,
  hasPlatformPanel,
  matchPlatformPreset,
  matchPlatformRule,
  normalizePlatformSections,
  platformEntryHref,
  platformEntryTarget,
  platformGateFor,
  platformHomeHref,
} from "@/lib/platform-access";

function walk(dir: string, file: string): string[] {
  const found: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) found.push(...walk(full, file));
    else if (name === file) found.push(full);
  }
  return found;
}

/** `src/app/root/organizations/[id]/page.tsx` → `/root/organizations/x`. */
function routePath(file: string, base: string, prefix: string): string {
  const rel = relative(base, file).split(sep).slice(0, -1);
  const parts = rel.filter((part) => !part.startsWith("(")).map((part) => (part.startsWith("[") ? "x" : part));
  return [prefix, ...parts].join("/");
}

test("every /root page and /api/root route is classified explicitly", () => {
  const pages = walk("src/app/root", "page.tsx").map((file) => routePath(file, "src/app/root", "/root"));
  const routes = walk("src/app/api/root", "route.ts").map((file) => routePath(file, "src/app/api/root", "/api/root"));
  assert.ok(pages.length > 20 && routes.length > 40, "the walk found the panel");
  const missing = [...pages, ...routes].filter((path) => !matchPlatformRule(path));
  assert.deepEqual(missing, [], "add a rule to PLATFORM_RULES for each new page/route");
});

test("gates: clients card, billing mutations, owner-only actions, unknown paths", () => {
  assert.equal(platformGateFor("/root"), "clients");
  assert.equal(platformGateFor("/root/organizations/org-1"), "clients");
  assert.equal(platformGateFor("/api/root/organizations/org-1/activity"), "clients");
  assert.equal(platformGateFor("/api/root/organizations/org-1/contracts/c1/pdf"), "clients");
  assert.equal(platformGateFor("/api/root/organizations/org-1", "PATCH"), "billing");
  assert.equal(platformGateFor("/api/root/organizations/org-1", "DELETE"), "superadmin");
  assert.equal(platformGateFor("/api/root/organizations/org-1/balance", "POST"), "billing");
  assert.equal(platformGateFor("/api/root/impersonate", "POST"), "administrator");
  assert.equal(platformGateFor("/root/team"), "superadmin");
  assert.equal(platformGateFor("/root/me"), "self");
  assert.equal(platformGateFor("/root/some-new-page"), "superadmin");
  assert.equal(platformGateFor("/root/blog?x=1"), "content");
  assert.equal(platformGateFor("/root/seo/links"), "seo");
  assert.equal(platformGateFor("/api/root/gogetlinks/overview", "GET"), "seo");
  assert.equal(platformGateFor("/api/root/gogetlinks/account", "GET"), "seo");
  assert.equal(platformGateFor("/api/root/gogetlinks/account", "POST"), "superadmin");
  assert.equal(platformGateFor("/api/root/gogetlinks/account", "PUT"), "superadmin");
  assert.equal(platformGateFor("/api/root/gogetlinks/account", "DELETE"), "superadmin");
  assert.equal(platformGateFor("/dashboard"), null);
  assert.equal(platformGateFor("/rooted"), null);
});

test("delegated viewer sees only own sections; superadmin sees everything", () => {
  const seo = { superadmin: false, sections: normalizePlatformSections(["seo", "content", "bogus", "seo"]) };
  assert.deepEqual(seo.sections, ["content", "seo"]);
  assert.equal(canAccessPlatformPath(seo, "/root/blog"), true);
  assert.equal(canAccessPlatformPath(seo, "/api/root/topvisor/positions", "POST"), true);
  assert.equal(canAccessPlatformPath(seo, "/api/root/gogetlinks/applications", "GET"), true);
  assert.equal(canAccessPlatformPath(seo, "/api/root/gogetlinks/applications", "POST"), true);
  assert.equal(canAccessPlatformPath({ superadmin: false, sections: ["support"] }, "/api/root/gogetlinks/applications", "GET"), false);
  assert.equal(canAccessPlatformPath({ superadmin: false, sections: [] }, "/api/root/gogetlinks/applications", "POST"), false);
  assert.equal(canAccessPlatformPath(seo, "/root"), false);
  assert.equal(canAccessPlatformPath(seo, "/root/team"), false);
  assert.equal(canAccessPlatformPath(seo, "/root/me"), true);
  assert.equal(canAccessPlatformPath(seo, "/dashboard"), false);
  assert.equal(platformHomeHref(seo), "/root/blog");

  const nobody = { superadmin: false, sections: [] };
  assert.equal(canAccessPlatformPath(nobody, "/root/me"), false);

  const owner = { superadmin: true, sections: [] };
  assert.equal(canAccessPlatformPath(owner, "/root/team"), true);
  assert.equal(canAccessPlatformPath(owner, "/api/root/organizations/x", "DELETE"), true);
  assert.equal(platformHomeHref(owner), "/root");
});

test("presets use known sections and are recognised back", () => {
  for (const preset of PLATFORM_PRESETS) {
    for (const key of preset.sections) assert.ok(PLATFORM_SECTION_KEYS.includes(key));
    assert.equal(matchPlatformPreset([...preset.sections].reverse()), preset.key);
  }
  assert.equal(matchPlatformPreset(["seo"]), null);
  assert.equal(PLATFORM_SECTIONS.length, PLATFORM_SECTION_KEYS.length);
  for (const section of PLATFORM_SECTIONS) {
    assert.equal(canAccessPlatformPath({ superadmin: false, sections: [section.key] }, section.home), true, section.home);
  }
});

// Переводы — вкладка панели (владелец, 2026-11-09): право переводчика = раздел «Переводы».
test("a translator gets the «Переводы» section on top of the granted ones", () => {
  assert.deepEqual(effectivePlatformSections({ platformSections: [], canEditTranslations: true }), ["translations"]);
  assert.deepEqual(
    effectivePlatformSections({ platformSections: ["sales", "crm", "clients"], canEditTranslations: true }),
    ["crm", "clients", "sales", "translations"],
  );
  assert.deepEqual(effectivePlatformSections({ platformSections: ["translations"], canEditTranslations: true }), ["translations"]);
  assert.deepEqual(effectivePlatformSections({ platformSections: ["seo", "bogus"], canEditTranslations: false }), ["seo"]);
  assert.deepEqual(effectivePlatformSections({ platformSections: null, canEditTranslations: null }), []);
  assert.deepEqual(effectivePlatformSections({ platformSections: ["seo"] }), ["seo"]);
});

test("a translator alone opens the panel on «Переводы» and nothing else", () => {
  const translator = { superadmin: false, sections: effectivePlatformSections({ platformSections: [], canEditTranslations: true }) };
  assert.equal(hasPlatformPanel(translator), true);
  assert.equal(platformHomeHref(translator), "/root/translations");
  assert.equal(canAccessPlatformPath(translator, "/root/translations"), true);
  assert.equal(canAccessPlatformPath(translator, "/root"), false);
  assert.equal(canAccessPlatformPath(translator, "/root/crm"), false);
  assert.equal(canAccessPlatformPath(translator, "/root/blog"), false);
  assert.equal(canAccessPlatformPath(translator, "/root/team"), false);
});

test("appointing translators is the owner's: it hands out panel access", () => {
  assert.equal(platformGateFor("/api/root/translators"), "superadmin");
  assert.equal(platformGateFor("/api/root/translators", "POST"), "superadmin");
  assert.equal(platformGateFor("/root/translations"), "translations");
  const seo = { superadmin: false, sections: normalizePlatformSections(["content", "seo", "translations"]) };
  assert.equal(canAccessPlatformPath(seo, "/root/translations"), true);
  assert.equal(canAccessPlatformPath(seo, "/api/root/translators", "POST"), false);
  assert.equal(canAccessPlatformPath({ superadmin: true, sections: [] }, "/api/root/translators", "POST"), true);
});

test("the panel entry link can carry the tab to open", () => {
  assert.equal(platformEntryHref(), "/api/me/platform-panel");
  assert.equal(platformEntryHref(null), "/api/me/platform-panel");
  assert.equal(platformEntryHref("/root/translations"), "/api/me/platform-panel?next=%2Froot%2Ftranslations");
});

test("the panel entry opens `next` only when it is a panel page the person may open", () => {
  const translator = { superadmin: false, sections: ["translations" as const] };
  const admin = { superadmin: false, sections: [...PLATFORM_SECTION_KEYS] };
  const manager = { superadmin: false, sections: normalizePlatformSections(["crm", "clients", "sales"]), scope: "own" as const };
  const owner = { superadmin: true, sections: [] };

  assert.equal(platformEntryTarget(translator, null), "/root/translations");
  assert.equal(platformEntryTarget(admin, null), "/root/crm");
  assert.equal(platformEntryTarget(owner, undefined), "/root");

  assert.equal(platformEntryTarget(admin, "/root/translations"), "/root/translations");
  assert.equal(platformEntryTarget(admin, "/root/blog?tab=drafts"), "/root/blog?tab=drafts");
  assert.equal(platformEntryTarget(owner, "/root/team"), "/root/team");
  // Not theirs — their first tab instead of a 404.
  assert.equal(platformEntryTarget(manager, "/root/translations"), "/root/crm");
  assert.equal(platformEntryTarget(manager, "/root/health"), "/root/crm");
  assert.equal(platformEntryTarget(admin, "/root/team"), "/root/crm");
  // Only panel pages: no API, no other site paths, no foreign or tricky addresses.
  for (const next of ["/api/root/translators", "/dashboard", "//evil.com/root", "https://evil.com/root", "/root/../dashboard", "/root/%2E%2e/dashboard", "/root\\..\\x", "root/blog", ""]) {
    assert.equal(platformEntryTarget(owner, next), "/root", next);
  }
});

test("translation editor: owner, translator or the «Переводы» section; never disabled or archived people", () => {
  const person = { isRoot: false, canEditTranslations: false, platformSections: [] as string[], isActive: true, archivedAt: null as Date | null };
  assert.equal(canUseTranslationEditor({ ...person, isRoot: true }), true);
  assert.equal(canUseTranslationEditor({ ...person, canEditTranslations: true }), true);
  assert.equal(canUseTranslationEditor({ ...person, platformSections: ["content", "seo", "translations"] }), true);
  assert.equal(canUseTranslationEditor({ ...person, platformSections: [...PLATFORM_SECTION_KEYS] }), true);
  assert.equal(canUseTranslationEditor({ ...person, platformSections: ["crm", "clients", "sales"] }), false);
  assert.equal(canUseTranslationEditor(person), false);
  assert.equal(canUseTranslationEditor({ ...person, canEditTranslations: true, isActive: false }), false);
  assert.equal(canUseTranslationEditor({ ...person, platformSections: ["translations"], archivedAt: new Date("2026-11-01") }), false);
});

test("«Войти» в кабинет клиента: владелец и администратор, не частичный набор", () => {
  const admin = { superadmin: false, sections: PLATFORM_SECTION_KEYS };
  const support = { superadmin: false, sections: ["clients", "support", "assistant"] as const };
  assert.equal(canEnterClientCabinets({ superadmin: true, sections: [] }), true);
  assert.equal(canEnterClientCabinets(admin), true);
  assert.equal(canEnterClientCabinets(support), false);
  assert.equal(canEnterClientCabinets({ ...admin, scope: "own" }), false);
  assert.equal(canAccessPlatformPath(admin, "/api/root/impersonate", "POST"), true);
  assert.equal(canAccessPlatformPath(support, "/api/root/impersonate", "POST"), false);
  // Удаление организаций и команда — по-прежнему только владелец.
  assert.equal(canAccessPlatformPath(admin, "/api/root/organizations/org-1", "DELETE"), false);
  assert.equal(canAccessPlatformPath(admin, "/root/team"), false);
  assert.equal(canImpersonateFromToken({ isRoot: true }), true);
  assert.equal(canImpersonateFromToken({ platformSections: [...PLATFORM_SECTION_KEYS] }), true);
  assert.equal(canImpersonateFromToken({ platformSections: ["clients", "support"] }), false);
  assert.equal(canImpersonateFromToken({}), false);
});
