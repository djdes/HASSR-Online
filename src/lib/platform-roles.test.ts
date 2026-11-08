import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { PLATFORM_SECTION_KEYS, canAccessPlatformPath, isPlatformAdministrator, scopedTargetOf } from "@/lib/platform-access";
import { BUILTIN_ROLES, roleKeyFrom, signaturePosition, validateRoleShape } from "@/lib/platform-roles";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

describe("Роли панели платформы", () => {
  it("встроенные роли: администратор и директор — все разделы, РОП и директор — РОП, менеджер — «свои»", () => {
    const byKey = Object.fromEntries(BUILTIN_ROLES.map((role) => [role.key, role]));
    assert.deepEqual([...byKey.admin.sections], [...PLATFORM_SECTION_KEYS]);
    assert.deepEqual([...byKey.commercial_director.sections], [...PLATFORM_SECTION_KEYS]);
    assert.equal(byKey.commercial_director.salesHead, true);
    assert.equal(byKey.commercial_director.signatureTitle, "Коммерческий директор");
    assert.equal(byKey.sales_head.salesHead, true);
    assert.equal(byKey.sales_head.scope, "all");
    assert.equal(byKey.sales_manager.scope, "own");
    assert.equal(byKey.sales_manager.salesHead, false);
    for (const role of BUILTIN_ROLES) {
      assert.equal(validateRoleShape(role), null, role.key);
      assert.ok(role.sections.every((key) => (PLATFORM_SECTION_KEYS as readonly string[]).includes(key)), role.key);
    }
    assert.equal(new Set(BUILTIN_ROLES.map((role) => role.key)).size, BUILTIN_ROLES.length, "ключи уникальны");
  });

  it("с новым разделом CRM администратор (все разделы) остаётся администратором", () => {
    assert.equal(isPlatformAdministrator({ isRoot: false, platformSections: [...PLATFORM_SECTION_KEYS] }), true);
    assert.equal(isPlatformAdministrator({ isRoot: false, platformSections: PLATFORM_SECTION_KEYS.filter((key) => key !== "crm") }), false, "без CRM — миграция сида добавит");
    assert.match(read("prisma/seed-platform-roles-2026-11.ts"), /platformSections: \{ has: "sales" \}, NOT: \{ platformSections: \{ has: "crm" \} \}/);
  });

  it("форма роли: хотя бы один раздел, РОП — только с CRM", () => {
    assert.equal(validateRoleShape({ sections: [], salesHead: false }), "Отметьте хотя бы один раздел");
    assert.match(validateRoleShape({ sections: ["clients"], salesHead: true }) ?? "", /CRM/);
    assert.equal(validateRoleShape({ sections: ["crm"], salesHead: true }), null);
    assert.equal(validateRoleShape({ sections: ["unknown"], salesHead: false }), "Отметьте хотя бы один раздел");
  });

  it("ключ новой роли: латиница из названия или role_", () => {
    assert.match(roleKeyFrom("Account manager", 1000), /^account_manager_rs$/);
    assert.match(roleKeyFrom("Менеджер", 1000), /^role_rs$/);
  });

  it("должность в подписи: личная → «Моя почта» → роль → кабинет", () => {
    const role = { title: "Менеджер по продажам", signatureTitle: "Менеджер по работе с клиентами" };
    assert.equal(signaturePosition({ platformTitle: "Коммерческий директор", mailboxPosition: "Менеджер", role, positionTitle: "Повар" }), "Коммерческий директор");
    assert.equal(signaturePosition({ platformTitle: "  ", mailboxPosition: "Ведущий менеджер", role, positionTitle: "Повар" }), "Ведущий менеджер");
    assert.equal(signaturePosition({ mailboxPosition: null, role, positionTitle: "Повар" }), "Менеджер по работе с клиентами");
    assert.equal(signaturePosition({ role: { title: "РОП", signatureTitle: null }, positionTitle: "Повар" }), "РОП");
    assert.equal(signaturePosition({ role: null, positionTitle: "Шеф" }), "Шеф");
    assert.equal(signaturePosition({}), null);
  });

  it("охват «свои»: какие адреса — конкретный клиент или лид", () => {
    assert.deepEqual(scopedTargetOf("/root/organizations/o1"), { kind: "organization", id: "o1" });
    assert.deepEqual(scopedTargetOf("/api/root/organizations/o1/invoices"), { kind: "organization", id: "o1" });
    assert.deepEqual(scopedTargetOf("/root/crm/contacts/c9"), { kind: "contact", id: "c9" });
    assert.deepEqual(scopedTargetOf("/api/root/crm/contacts/c9/messages"), { kind: "contact", id: "c9" });
    assert.equal(scopedTargetOf("/root/crm/contacts"), null);
    assert.equal(scopedTargetOf("/root"), null);
    assert.equal(scopedTargetOf("/organizations/o1"), null, "вне панели — не наше");
  });

  it("проверка охвата встроена в requireRoot и закрывает чужое 404", () => {
    const helpers = read("src/lib/auth-helpers.ts");
    assert.match(helpers, /const target = viewer\.scope === "own" \? scopedTargetOf\(path\) : null;\n\s+if \(target && !\(await isTargetInOwnScope\(session\.user\.id, target\)\)\) notFound\(\);/);
    const server = read("src/lib/platform-access.server.ts");
    assert.match(server, /return org\?\.accountManagerId === userId;/);
    assert.match(server, /contact!\.ownerId === null \|\| contact!\.ownerId === userId/);
  });

  it("охват «все» (РОП, директор) и «свой набор» — ограничений нет", () => {
    const head = { superadmin: false, sections: ["crm", "clients"] as const, scope: "all" as const };
    assert.equal(canAccessPlatformPath(head, "/root/crm/mail"), true);
    assert.equal(canAccessPlatformPath(head, "/api/root/organizations/o1/manager", "PUT"), true);
    assert.equal(canAccessPlatformPath({ superadmin: false, sections: ["crm"] }, "/root/crm/mail"), true, "без роли — охват «все»");
  });

  it("менеджер в CRM: только себя ответственным, стоп-лист — нельзя; лид чужого — к РОП", () => {
    const actions = read("src/lib/crm/actions.server.ts");
    assert.match(actions, /if \(patch\.ownerId !== undefined && patch\.ownerId !== null && patch\.ownerId !== actor\.id\)/);
    assert.match(actions, /if \(patch\.blockSender\) throw new CrmActionError/);
    assert.match(actions, /Этот клиент уже закреплён за другим менеджером/);
    const queries = read("src/lib/crm/queries.server.ts");
    assert.match(queries, /return scope\?\.own \? \{ OR: \[\{ ownerId: scope\.userId \}, \{ ownerId: null \}\] \} : \{\};/);
  });

  it("закрепление клиента: лиды организации переходят новому менеджеру, новый контакт клиента — сразу его", () => {
    const manager = read("src/lib/account-manager.server.ts");
    assert.match(manager, /where: \{ organizationId, OR: \[\{ ownerId: null \}, \.\.\.\(previous && previous !== managerId \? \[\{ ownerId: previous \}\] : \[\]\)\] \}/);
    assert.match(read("src/lib/crm/ingest.server.ts"), /ownerId: accountManagerId,/);
    assert.match(read("src/app/root/page.tsx"), /viewer\.scope === "own"/);
  });

  it("alexey@wesetup.ru — коммерческий директор однократным сидом в деплое", () => {
    const seed = read("prisma/seed-platform-roles-2026-11.ts");
    assert.match(seed, /const COMMERCIAL_DIRECTOR_EMAIL = "alexey@wesetup\.ru";/);
    assert.match(seed, /const COMMERCIAL_DIRECTOR_TITLE = "Коммерческий директор";/);
    assert.match(seed, /once\("once:platform-roles:alexey-cd:v1"/);
    const deploy = read(".github/workflows/deploy.yml");
    assert.ok(deploy.indexOf("prisma/seed-platform-roles-2026-11.ts") > deploy.indexOf("prisma/seed-crm-rop-2026-11.ts"));
  });
});
