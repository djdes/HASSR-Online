/* eslint-disable react/no-children-prop -- typed SSR provider fixture. */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { loadMessages } from "@/i18n/messages";
import type { Locale } from "@/i18n/locales";
import { composeRoomQrMessages } from "@/app/room-fill/[roomId]/room-fill-presentation";
import { messageArguments } from "@/i18n/catalog-validation";

type Options = { cookie?: string; personal?: Locale | null; authenticated?: boolean; orgLocale?: string; invalid?: boolean; noToken?: boolean; authMode?: boolean; customTitle?: string; unrelated?: boolean; temperature?: boolean; humidity?: boolean; noDocument?: boolean; builtinRole?: boolean };
async function fixture(input: Options = {}) {
  const require = createRequire(import.meta.url), calls: string[] = [];
  const source = ts.transpileModule(readFileSync("src/app/room-fill/[roomId]/page.tsx", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const mod = { exports: {} };
  const employee = { id: "person", name: "Customer O‘tkir", role: "cook", positionTitle: input.builtinRole ? null : "Customer position", qrPinHash: null, canManageSettings: false, jobPosition: null };
  const norms = { temperature: { enabled: input.temperature ?? true, min: 18, max: 25 }, humidity: { enabled: input.humidity ?? true, min: 15, max: 75 } };
  vm.runInNewContext(source, { module: mod, exports: mod.exports, console, Date, require: (id: string) => {
    if (id === "next/navigation") return { notFound: () => { throw Error("not-found"); }, redirect: (url: string) => { throw Error(`redirect:${url}`); } };
    if (id === "next/headers") return { cookies: async () => ({ get: () => input.cookie ? { value: input.cookie } : undefined }) };
    if (id === "@/lib/auth") return { authOptions: {} };
    // Точки выключены: список без фильтра по точке (правило — в building-scope.test.ts).
    if (id === "@/lib/qr-point-roster") return { loadQrPointScope: async () => null, filterByQrPoint: <T,>(users: T[]) => users, employeeWorksAtQrPoint: async () => true };
    if (id === "@/lib/server-session") return { getServerSession: async () => input.authenticated ? { user: { id: "viewer", locale: input.personal, organizationLocale: "ru", organizationId: "unrelated" } } : null };
    if (id === "@/i18n/site-locale-server") return { getSiteLocale: async () => input.cookie ?? "ru" };
    if (id === "@/lib/qr-fill-token") return { verifyQrFillTokenFor: (token: string, kind: string, objectId: string) => { assert.equal(token, "fixture-token"); assert.equal(kind, "room"); assert.equal(objectId, "room"); return input.invalid ? { ok: false, reason: "invalid" } : { ok: true }; } };
    if (id === "@/lib/db") return { db: {
      room: { findUnique: async () => { calls.push("room"); return { id: "room", name: "Customer room", climateNorms: norms, buildingId: "building", fillerUserIds: [], building: { name: "Customer building", organizationId: "verified-org", organization: { name: "Customer organization", timezone: "Asia/Tashkent", qrFillMode: input.authMode ? "auth" : "public", locale: input.orgLocale ?? "uz" } } }; } },
      user: { findMany: async (query: { where: { organizationId: string } }) => { assert.equal(query.where.organizationId, "verified-org"); return [employee]; } },
      journalDocument: { findMany: async (query: { where: { organizationId: string; template: { code: string } } }) => { assert.equal(query.where.organizationId, "verified-org"); assert.equal(query.where.template.code, "climate_control"); return input.noDocument ? [] : [{ id: "doc", buildingId: "building", config: { rooms: [{ id: "row", roomId: "room", name: "Customer row", ...norms }], controlTimes: ["10:00"] } }]; } },
    } };
    if (id === "@/lib/org-custom-names") return { getOrgCustomNames: async (org: string) => { assert.equal(org, "verified-org"); calls.push("custom"); return { journals: input.customTitle ? { [input.unrelated ? "cold_equipment_control" : "climate_control"]: input.customTitle } : {}, sections: {} }; } };
    if (id === "@/lib/journal-qr-rollover") return { ensureQrPeriodDocuments: async (args: { organizationId: string; templateCode: string }) => { assert.equal(args.organizationId, "verified-org"); assert.equal(args.templateCode, "climate_control"); calls.push("rollover"); } };
    if (id === "@/lib/qr-fill-actor") return { normalizeQrFillMode: (value: string) => value, sessionEmployeeForQr: async () => ({ ok: false, reason: "no-session" }) };
    if (id === "@/lib/qr-object-pass") return { passEmployeeIdFromCookie: async () => null };
    if (id === "@/lib/qr-remember") return { readRememberValue: () => null, rememberCookieName: () => "remember" };
    if (id === "@/lib/qr-fill-siblings") return { listRoomSiblings: async () => [] };
    if (id === "@/lib/plan-limits.server") return { hasPaidPlan: async () => false };
    if (id === "@/lib/reading-photo-fixation.server") return { getReadingPhotoSettings: async () => ({ enabled: false, required: false }) };
    if (id.startsWith("./")) return require(`@/app/room-fill/[roomId]/${id.slice(2)}`);
    return require(id);
  } });
  const page = mod.exports as { default: (props: unknown) => Promise<ReactNode>; generateMetadata: (props: unknown) => Promise<{ title: string }> };
  const props = { params: Promise.resolve({ roomId: "room" }), searchParams: Promise.resolve(input.noToken ? {} : { token: "fixture-token" }) };
  const metadata = await page.generateMetadata(props);
  assert.equal(calls.filter(call => call === "rollover").length, 0, "metadata must never create period documents");
  const tree = await page.default(props);
  const router = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch: async () => {} };
  return { html: renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: router, children: tree })), metadata, calls };
}

test("actual room page and metadata use personal/cookie/verified organization locale with business timezone", async () => {
  const errors: string[] = [], original = console.error; console.error = (...args: unknown[]) => errors.push(args.map(String).join(" "));
  try {
    for (const choice of [
      { cookie: "en", expected: "en" }, { cookie: "invalid", expected: "uz" }, { expected: "uz" }, { orgLocale: "bad", expected: "ru" },
      { authenticated: true, personal: "en" as const, cookie: "ru", expected: "en" },
      { authenticated: true, personal: null, cookie: "en", expected: "uz" },
    ]) {
      const result = await fixture(choice), messages = await loadMessages(choice.expected as Locale);
      assert.equal(result.metadata.title, messages.roomFill.page.metadataTitle);
      assert.ok(result.html.includes(messages.roomFill.page.journalTitle));
      assert.ok(result.html.includes(messages.roomFill.reading.slotHint.replace("{slot}", "10:00")));
      assert.ok(result.html.includes("Customer row")); assert.ok(result.html.includes("Customer organization"));
      assert.equal(result.calls.filter(call => call === "rollover").length, 1);
    }
    assert.deepEqual(errors, [], "No intl missing-message or ENVIRONMENT_FALLBACK errors in actual SSR");
  } finally { console.error = original; }
});
test("actual climate custom title wins; unrelated equipment title cannot override; invalid token reads no room context", async () => {
  for (const cookie of ["ru", "en", "uz"] as const) {
    assert.ok((await fixture({ cookie, customTitle: "Customer original journal" })).html.includes("Customer original journal"));
    assert.ok(!(await fixture({ cookie, customTitle: "Unrelated title", unrelated: true })).html.includes("Unrelated title"));
    const invalid = await fixture({ cookie, invalid: true }); assert.deepEqual(invalid.calls, []);
    assert.ok(invalid.html.includes((await loadMessages(cookie)).roomFill.page.invalidDescription));
  }
  await assert.rejects(fixture({ noToken: true }), /not-found/);
  await assert.rejects(fixture({ authMode: true }), /redirect:\/login\?next=%2Froom-fill%2Froom%3Ftoken%3Dfixture-token/);
});
test("actual room page preserves all metric configurations and no-document presentation", async () => {
  for (const temperature of [false, true]) for (const humidity of [false, true]) {
    const result = await fixture({ cookie: "en", temperature, humidity });
    assert.equal(result.html.includes('id="room-fill-temperature"'), temperature);
    assert.equal(result.html.includes('id="room-fill-humidity"'), humidity);
    assert.ok(!result.html.includes("MISSING_MESSAGE"));
  }
  const result = await fixture({ cookie: "uz", noDocument: true });
  assert.ok(result.html.includes((await loadMessages("uz")).roomFill.reading.noDocument));
});
test("room scoped presentation preserves all shared message contracts and overrides only two parameter-free leaves", async () => {
  for (const locale of ["ru", "en", "uz"] as const) {
    const messages = await loadMessages(locale), composed = composeRoomQrMessages(messages);
    assert.deepEqual(messageArguments(messages.equipmentFill.pin.remember), []);
    assert.deepEqual(messageArguments(messages.roomFill.pin.rememberRoom), []);
    assert.deepEqual(messageArguments(messages.equipmentFill.errors.invalidSticker), []);
    assert.deepEqual(messageArguments(messages.roomFill.errors.invalidCode), []);
    assert.equal(composed.pin.remember, messages.roomFill.pin.rememberRoom);
    assert.equal(composed.errors.invalidSticker, messages.roomFill.errors.invalidCode);
    const restored = { ...composed, pin: { ...composed.pin, remember: messages.equipmentFill.pin.remember }, errors: { ...composed.errors, invalidSticker: messages.equipmentFill.errors.invalidSticker } };
    assert.deepEqual(restored, messages.equipmentFill);
    assert.notEqual(composed, messages.equipmentFill);
  }
});
