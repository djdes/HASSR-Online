import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import {
  PLATFORM_PRESETS,
  PLATFORM_SECTIONS,
  PLATFORM_SECTION_KEYS,
  canAccessPlatformPath,
  matchPlatformPreset,
  matchPlatformRule,
  normalizePlatformSections,
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
  assert.equal(platformGateFor("/api/root/impersonate", "POST"), "superadmin");
  assert.equal(platformGateFor("/root/team"), "superadmin");
  assert.equal(platformGateFor("/root/me"), "self");
  assert.equal(platformGateFor("/root/some-new-page"), "superadmin");
  assert.equal(platformGateFor("/root/blog?x=1"), "content");
  assert.equal(platformGateFor("/dashboard"), null);
  assert.equal(platformGateFor("/rooted"), null);
});

test("delegated viewer sees only own sections; superadmin sees everything", () => {
  const seo = { superadmin: false, sections: normalizePlatformSections(["seo", "content", "bogus", "seo"]) };
  assert.deepEqual(seo.sections, ["content", "seo"]);
  assert.equal(canAccessPlatformPath(seo, "/root/blog"), true);
  assert.equal(canAccessPlatformPath(seo, "/api/root/topvisor/positions", "POST"), true);
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
