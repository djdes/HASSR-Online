import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { visibleNav } from "@/lib/app-nav";
import { decideJournalAcl } from "@/lib/journal-acl";
import type { ManagerScope } from "@/lib/manager-scope";
import {
  ALL_CAPABILITIES,
  ALL_PRESETS,
  CAPABILITY_LABELS,
  getDefaultCapabilities,
  hasCapability,
  isControlGroupMember,
  isValidPreset,
  listAllPresets,
  presetCapabilitiesFor,
} from "@/lib/permission-presets";
import { decidePresetChange } from "@/lib/staff-preset-change";
import { decideTaskAssignment } from "@/lib/task-assign-rules";
import { describeManagerScope } from "@/lib/control-group";

const ROOT = new URL("../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8");

// ------------------------------------------------------------- пресеты

test("контроль-группа: смотрит, подтверждает и назначает, но не заполняет", () => {
  const caps = getDefaultCapabilities("control_group");
  for (const capability of ["journals.view", "staff.view", "reports.view", "stats.view", "tasks.verify", "tasks.assign"] as const) {
    assert.ok(caps.includes(capability), capability);
  }
  for (const capability of ["journals.manage", "staff.manage", "admin.full", "mini.tasks"] as const) {
    assert.equal(caps.includes(capability), false, capability);
  }
  assert.equal(isValidPreset("control_group"), true);
  assert.equal(listAllPresets().find((preset) => preset.value === "control_group")?.label, "Контроль-группа");
});

test("tasks.assign есть у администратора и у контроль-группы, у остальных — нет", () => {
  assert.ok(getDefaultCapabilities("admin").includes("tasks.assign"));
  for (const preset of ALL_PRESETS) {
    if (preset === "admin" || preset === "control_group") continue;
    assert.equal(getDefaultCapabilities(preset).includes("tasks.assign"), false, preset);
  }
});

test("контроль-группа выставляется только явно — из роли не выводится", () => {
  assert.equal(isControlGroupMember({ permissionPreset: "control_group" }), true);
  assert.equal(isControlGroupMember({ permissionPreset: null }), false);
  assert.equal(isControlGroupMember({ permissionPreset: "control_group", isRoot: true }), false);
  assert.equal(hasCapability({ role: "manager", permissionPreset: "control_group" }, "admin.full"), false);
  assert.equal(hasCapability({ role: "cook", permissionPreset: "control_group" }, "tasks.assign"), true);
});

test("списки пресетов и возможностей — из одного места для API и страницы", () => {
  assert.deepEqual(Object.keys(CAPABILITY_LABELS).sort(), [...ALL_CAPABILITIES].sort());
  assert.deepEqual(listAllPresets().map((preset) => preset.value), [...ALL_PRESETS]);
  const route = read("src/app/api/settings/role-presets/route.ts");
  assert.match(route, /z\.enum\(ALL_PRESETS\)/);
  assert.match(route, /z\.enum\(ALL_CAPABILITIES\)/);
  assert.doesNotMatch(route, /const (VALID_PRESETS|ALLOWED_CAPABILITIES)/);
  const page = read("src/app/(dashboard)/settings/role-presets/page.tsx");
  assert.match(page, /CAPABILITY_LABELS/);
  assert.match(page, /ALL_CAPABILITIES/);
  assert.doesNotMatch(page, /const CAPABILITY_LABELS/);
});

test("у каждого пресета и возможности есть подписи на ru/en/uz для окна доступа", () => {
  for (const locale of ["ru", "en", "uz"]) {
    const access = JSON.parse(read(`src/i18n/messages/${locale}.json`)).staffManagement.access;
    for (const preset of ALL_PRESETS) {
      assert.ok(access.presets[preset]?.label, `${locale}: ${preset}.label`);
      assert.ok(access.presets[preset]?.description, `${locale}: ${preset}.description`);
    }
    for (const capability of ALL_CAPABILITIES) {
      assert.ok(access.capabilities[capability.replace(".", "_")], `${locale}: ${capability}`);
    }
  }
});

test("org-override меняет набор пресета, но не администратора", () => {
  const overrides = { control_group: ["journals.view"], admin: [] };
  assert.deepEqual(presetCapabilitiesFor("control_group", overrides), ["journals.view"]);
  assert.ok(presetCapabilitiesFor("admin", overrides).includes("admin.full"));
});

// ---------------------------------------------------------------- ACL

test("ACL: контроль-группа читает всё, но не пишет и не закрывает — даже руководителем", () => {
  for (const role of ["manager", "owner", "head_chef", "cook"]) {
    const actor = { role, isRoot: false, permissionPreset: "control_group" };
    assert.equal(decideJournalAcl(actor, "read", { migrated: true, row: undefined }), true, `${role} read`);
    assert.equal(decideJournalAcl(actor, "write", null), false, `${role} write`);
    assert.equal(decideJournalAcl(actor, "finalize", null), false, `${role} finalize`);
    // Даже если когда-то выдали строку ACL с записью.
    const row = { templateCode: "hygiene", canRead: true, canWrite: true, canFinalize: true };
    assert.equal(decideJournalAcl(actor, "write", { migrated: true, row }), false, `${role} write with row`);
  }
});

test("ACL: прежние правила для остальных не изменились", () => {
  const manager = { role: "manager", isRoot: false, permissionPreset: null };
  assert.equal(decideJournalAcl(manager, "write", null), true);
  const root = { role: "cook", isRoot: true, permissionPreset: "control_group" };
  assert.equal(decideJournalAcl(root, "finalize", null), true);
  const cook = { role: "cook", isRoot: false, permissionPreset: null };
  assert.equal(decideJournalAcl(cook, "write", { migrated: false, row: undefined }), true);
  const row = { templateCode: "hygiene", canRead: true, canWrite: false, canFinalize: false };
  assert.equal(decideJournalAcl(cook, "read", { migrated: true, row }), true);
  assert.equal(decideJournalAcl(cook, "write", { migrated: true, row }), false);
  assert.equal(decideJournalAcl(cook, "read", { migrated: true, row: undefined }), false);
});

test("ACL и правка документа: запрет записи стоит и в маршрутах, где руководство обходило ACL", () => {
  const route = read("src/app/api/journal-documents/[id]/route.ts");
  assert.match(route, /isControlGroupMember\(session\.user\)/);
  const acl = read("src/lib/journal-acl.ts");
  // Пресет берётся из базы, если actor его не принёс.
  assert.match(acl, /permissionPreset: true/);
});

// ------------------------------------------------------- назначение задач

const scope = (patch: Partial<ManagerScope>): ManagerScope => ({
  id: "scope",
  managerId: "cg",
  viewMode: "all",
  viewJobPositionIds: [],
  viewUserIds: [],
  assignableJournalCodes: [],
  ...patch,
});
const controller = { id: "cg", role: "cook", permissionPreset: "control_group" };
const cook = { id: "cook-1", jobPositionId: "pos-cook", permissionPreset: null };

test("назначение: администратор — кому угодно, контроль-группе — нельзя никому", () => {
  const admin = { id: "boss", role: "manager", permissionPreset: null };
  assert.deepEqual(decideTaskAssignment({ actor: admin, target: cook, journalCode: "hygiene", scope: null }), {
    ok: true,
    unrestricted: true,
  });
  const decision = decideTaskAssignment({
    actor: admin,
    target: { id: "cg-2", jobPositionId: null, permissionPreset: "control_group" },
    journalCode: "hygiene",
    scope: null,
  });
  assert.equal(decision.ok, false);
  assert.equal(!decision.ok && decision.code, "TARGET_CONTROL_GROUP");
});

test("назначение: без tasks.assign и admin.full — отказ", () => {
  const decision = decideTaskAssignment({
    actor: { id: "chef", role: "head_chef", permissionPreset: null },
    target: cook,
    journalCode: "hygiene",
    scope: null,
  });
  assert.equal(!decision.ok && decision.code, "NO_CAPABILITY");
});

test("назначение контроль-группой — только людям и журналам из её ManagerScope", () => {
  // Должности.
  const byPosition = scope({ viewMode: "job_positions", viewJobPositionIds: ["pos-cook"] });
  assert.equal(decideTaskAssignment({ actor: controller, target: cook, journalCode: "hygiene", scope: byPosition }).ok, true);
  const waiter = { id: "waiter-1", jobPositionId: "pos-waiter", permissionPreset: null };
  const outside = decideTaskAssignment({ actor: controller, target: waiter, journalCode: "hygiene", scope: byPosition });
  assert.equal(!outside.ok && outside.code, "TARGET_OUT_OF_SCOPE");
  // Конкретные люди.
  const byUsers = scope({ viewMode: "specific_users", viewUserIds: ["waiter-1"] });
  assert.equal(decideTaskAssignment({ actor: controller, target: waiter, journalCode: "hygiene", scope: byUsers }).ok, true);
  assert.equal(decideTaskAssignment({ actor: controller, target: cook, journalCode: "hygiene", scope: byUsers }).ok, false);
  // «Никого».
  assert.equal(decideTaskAssignment({ actor: controller, target: cook, journalCode: "hygiene", scope: scope({ viewMode: "none" }) }).ok, false);
  // Журналы.
  const journals = scope({ assignableJournalCodes: ["hygiene"] });
  assert.equal(decideTaskAssignment({ actor: controller, target: cook, journalCode: "hygiene", scope: journals }).ok, true);
  const otherJournal = decideTaskAssignment({ actor: controller, target: cook, journalCode: "health_check", scope: journals });
  assert.equal(!otherJournal.ok && otherJournal.code, "JOURNAL_OUT_OF_SCOPE");
  // Строки иерархии нет — как везде в кабинете: видит всех.
  assert.equal(decideTaskAssignment({ actor: controller, target: waiter, journalCode: "hygiene", scope: null }).ok, true);
});

test("маршрут назначения пользуется правилом и не требует admin.full", () => {
  const route = read("src/app/api/journal-task-claims/assign/route.ts");
  assert.match(route, /decideTaskAssignment\(/);
  assert.match(route, /getManagerScope\(/);
  assert.doesNotMatch(route, /hasCapability\(session\.user, "admin\.full"\)/);
});

test("иерархию контроль-группа не меняет (POST и DELETE /api/manager-scope)", () => {
  const route = read("src/app/api/manager-scope/route.ts");
  const guards = route.match(/controlGroupForbidden\(session\.user\)/g) ?? [];
  assert.equal(guards.length, 2);
  const getHandler = route.slice(route.indexOf("export async function GET"), route.indexOf("export async function POST"));
  assert.doesNotMatch(getHandler, /controlGroupForbidden/);
});

// --------------------------------------------------------- смена пресета

const boss = { id: "boss", role: "manager", permissionPreset: null };

test("смена пресета: себе нельзя снять «Администратора»", () => {
  const self = { id: "boss", role: "manager", permissionPreset: null };
  for (const preset of ["control_group", "head_chef", "cook"]) {
    const decision = decidePresetChange({ actor: boss, target: self, preset });
    assert.equal(!decision.ok && decision.code, "SELF_LOCKOUT", preset);
  }
  // «По должности» у управляющего — тот же администратор: можно.
  assert.equal(decidePresetChange({ actor: boss, target: self, preset: null }).ok, true);
  assert.equal(decidePresetChange({ actor: boss, target: self, preset: "admin" }).ok, true);
  // Заведующий с явным «Администратором» не может вернуться «по должности».
  const chefAdmin = { id: "chef", role: "head_chef", permissionPreset: "admin" };
  const back = decidePresetChange({ actor: chefAdmin, target: chefAdmin, preset: null });
  assert.equal(!back.ok && back.code, "SELF_LOCKOUT");
});

test("смена пресета: другому — можно, без admin.full — нельзя, мусор — 400", () => {
  const cookTarget = { id: "cook-1", role: "cook", permissionPreset: null };
  const ok = decidePresetChange({ actor: boss, target: cookTarget, preset: "control_group" });
  assert.deepEqual(ok, { ok: true, preset: "control_group", changed: true, effective: "control_group" });
  const same = decidePresetChange({ actor: boss, target: { ...cookTarget, permissionPreset: "control_group" }, preset: "control_group" });
  assert.equal(same.ok && same.changed, false);
  const notAdmin = decidePresetChange({ actor: { id: "cg", role: "manager", permissionPreset: "control_group" }, target: cookTarget, preset: "admin" });
  assert.equal(!notAdmin.ok && notAdmin.status, 403);
  const invalid = decidePresetChange({ actor: boss, target: cookTarget, preset: "superuser" });
  assert.equal(!invalid.ok && invalid.status, 400);
});

test("маршрут смены пресета сбрасывает кэш ACL", () => {
  const route = read("src/app/api/staff/[id]/preset/route.ts");
  assert.match(route, /invalidateJournalAcl\(id\)/);
  assert.match(route, /decidePresetChange\(/);
});

// --------------------------------------------------------- «Иерархия» кратко

test("описание иерархии участника контроль-группы", () => {
  const lookup = {
    positions: new Map([["pos-cook", "Повар"], ["pos-pastry", "Кондитер"]]),
    users: new Map([["u1", "Иванова А."], ["u2", "Петров П."]]),
    journals: new Map([["hygiene", "Гигиенический журнал"]]),
  };
  assert.equal(describeManagerScope(null, lookup).sees, "Видит всех (иерархия не настроена)");
  assert.equal(describeManagerScope(scope({ viewMode: "none" }), lookup).sees, "Никого не видит");
  const positions = describeManagerScope(scope({ viewMode: "job_positions", viewJobPositionIds: ["pos-cook", "gone"] }), lookup);
  assert.equal(positions.sees, "Видит должности: Повар");
  assert.deepEqual(positions.viewJobPositions, [{ id: "pos-cook", name: "Повар" }]);
  const users = describeManagerScope(scope({ viewMode: "specific_users", viewUserIds: ["u1", "u2"] }), lookup);
  assert.equal(users.sees, "Видит 2 сотрудников: Иванова А., Петров П.");
  assert.equal(users.assigns, "Назначает задачи по всем журналам");
  const journals = describeManagerScope(scope({ assignableJournalCodes: ["hygiene", "x"] }), lookup);
  assert.equal(journals.assigns, "Назначает задачи: Гигиенический журнал, x");
});

// ------------------------------------------------------------ меню

const noFacts = { checklists: false, settingsPermissions: false };
const sections = (actor: Parameters<typeof visibleNav>[0]) =>
  Object.fromEntries(visibleNav(actor, noFacts).map((section) => [section.key, section.tabs.map((tab) => tab.id)]));

test("меню контроль-группы с ролью руководителя: всё рабочее, без «Моей компании»", () => {
  const nav = sections({ role: "manager", permissionPreset: "control_group" });
  assert.equal(nav.company, undefined, "реквизиты и оформление — только admin.full");
  assert.deepEqual(nav.journals, ["today", "all", "verify", "setup"]);
  assert.ok(nav.staff?.includes("users"));
  assert.ok(nav.staff?.includes("team"));
  assert.deepEqual(nav.inspection, ["day", "portal"]);
});

test("меню контроль-группы с линейной ролью: журналы, проверка, команда и день проверки", () => {
  const nav = sections({ role: "cook", permissionPreset: "control_group" });
  assert.deepEqual(Object.keys(nav).sort(), ["inspection", "journals", "staff"]);
  assert.deepEqual(nav.journals, ["control", "all", "verify"]);
  assert.deepEqual(nav.staff, ["team"]);
  assert.deepEqual(nav.inspection, ["day"]);
  // Повар без пресета журналов как журналов не видит.
  const plainCook = sections({ role: "cook", permissionPreset: null });
  assert.equal(plainCook.staff, undefined);
  assert.deepEqual(plainCook.journals, undefined);
});
