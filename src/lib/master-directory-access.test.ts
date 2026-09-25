import assert from "node:assert/strict";
import test from "node:test";

import {
  DIRECTORY_ONLY_API_ERROR,
  evaluateDirectoryRequest,
  parseOrgKind,
  tokenActiveOrgId,
} from "@/lib/master-directory-access";

const allow = { action: "allow" };
const toMaster = { action: "redirect", location: "/master" };
const toDashboard = { action: "redirect", location: "/dashboard" };
const deny = { action: "deny", status: 403, error: DIRECTORY_ONLY_API_ERROR };

test("directory session: only /master and its API are open", () => {
  for (const path of ["/master", "/master/objects", "/api/master/directory", "/api/master/directory/preview"]) {
    assert.deepEqual(evaluateDirectoryRequest(path, "directory"), allow, path);
  }
});

test("directory session: auth, org switch, login, invite and assets stay open", () => {
  for (const path of [
    "/api/auth/session",
    "/api/auth/logout",
    "/api/me/active-organization",
    "/api/build-info",
    "/login",
    "/invite/abc123",
    "/_next/static/chunk.js",
    "/favicon.ico",
    "/fonts/inter.woff2",
  ]) {
    assert.deepEqual(evaluateDirectoryRequest(path, "directory"), allow, path);
  }
});

test("directory session: «С фото» (распознавание) открыто, остальной /api/ai — нет", () => {
  assert.deepEqual(evaluateDirectoryRequest("/api/ai/vision-extract", "directory"), allow);
  for (const path of ["/api/ai/sanpin-chat", "/api/ai/translate", "/api/ai/vision-extractor", "/api/ai/vision-image/x.jpg"]) {
    assert.deepEqual(evaluateDirectoryRequest(path, "directory"), deny, path);
  }
  // Обычной сессии распознавание тоже открыто.
  assert.deepEqual(evaluateDirectoryRequest("/api/ai/vision-extract", "regular"), allow);
});

test("directory session: other pages redirect to /master", () => {
  for (const path of ["/", "/dashboard", "/journals", "/journals/finished_product", "/settings", "/staff", "/root-like", "/masterclass"]) {
    assert.deepEqual(evaluateDirectoryRequest(path, "directory"), toMaster, path);
  }
});

test("directory session: other APIs are 403", () => {
  for (const path of [
    "/api/staff",
    "/api/journal-documents",
    "/api/settings/dish-pool",
    "/api/settings/master-cabinet",
    "/api/me/theme",
    "/api/name-suggestions",
    "/api/staff.json",
  ]) {
    assert.deepEqual(evaluateDirectoryRequest(path, "directory"), deny, path);
  }
});

test("regular session: /master pages redirect to /dashboard, /api/master is 403", () => {
  assert.deepEqual(evaluateDirectoryRequest("/master", "regular"), toDashboard);
  assert.deepEqual(evaluateDirectoryRequest("/master/objects", undefined), toDashboard);
  assert.deepEqual(evaluateDirectoryRequest("/api/master/directory", "regular"), deny);
});

test("regular session: everything else is untouched", () => {
  for (const path of ["/dashboard", "/journals", "/api/staff", "/masterclass", "/api/masters"]) {
    assert.deepEqual(evaluateDirectoryRequest(path, "regular"), allow, path);
    assert.deepEqual(evaluateDirectoryRequest(path, null), allow, path);
  }
});

test("parseOrgKind: anything but directory is regular", () => {
  assert.equal(parseOrgKind("directory"), "directory");
  assert.equal(parseOrgKind("regular"), "regular");
  assert.equal(parseOrgKind(undefined), "regular");
  assert.equal(parseOrgKind("DIRECTORY"), "regular");
});

test("tokenActiveOrgId: root impersonation → active org → home org", () => {
  assert.equal(tokenActiveOrgId({ isRoot: true, actingAsOrganizationId: "x", activeOrganizationId: "a", organizationId: "h" }), "x");
  assert.equal(tokenActiveOrgId({ isRoot: false, actingAsOrganizationId: "x", activeOrganizationId: "a", organizationId: "h" }), "a");
  assert.equal(tokenActiveOrgId({ activeOrganizationId: null, organizationId: "h" }), "h");
  assert.equal(tokenActiveOrgId({}), null);
});
