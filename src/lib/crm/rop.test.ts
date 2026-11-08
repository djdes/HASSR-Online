import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { PLATFORM_SECTION_KEYS, canAccessPlatformPath, platformGateFor, platformHomeHref } from "@/lib/platform-access";
import { inPlatformAudience } from "@/lib/platform-admin";

const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");

describe("CRM: роль РОП и доступ к разделу", () => {
  it("аудитория «sales» — администраторы и РОП; РОП не попадает в поддержку и служебные", () => {
    const admin = { isRoot: false, platformSections: [...PLATFORM_SECTION_KEYS] };
    const owner = { isRoot: true, platformSections: [] };
    const rop = { isRoot: false, platformSections: ["clients", "sales"], platformSalesHead: true };
    const seller = { isRoot: false, platformSections: ["clients", "sales"], platformSalesHead: false };
    assert.equal(inPlatformAudience(admin, "sales"), true);
    assert.equal(inPlatformAudience(owner, "sales"), true);
    assert.equal(inPlatformAudience(rop, "sales"), true);
    assert.equal(inPlatformAudience(seller, "sales"), false);
    assert.equal(inPlatformAudience(rop, "admins"), false);
    assert.equal(inPlatformAudience(rop, "support"), false);
  });

  it("CRM — свой раздел «CRM»; почта, фильтры и ящики — только охват «все»; ящики меняет владелец", () => {
    const crm = { superadmin: false, sections: ["crm"] as const };
    for (const path of ["/root/crm", "/root/crm/contacts", "/root/crm/contacts/abc", "/root/crm/mail", "/api/root/crm/sync", "/api/root/crm/contacts/abc/messages"]) {
      assert.equal(platformGateFor(path), "crm", path);
      assert.equal(canAccessPlatformPath(crm, path, "POST"), true, path);
    }
    assert.equal(canAccessPlatformPath(crm, "/api/root/crm/mailboxes", "GET"), true);
    for (const method of ["POST", "PUT", "DELETE"]) {
      assert.equal(canAccessPlatformPath(crm, "/api/root/crm/mailboxes", method), false, method);
      assert.equal(canAccessPlatformPath(crm, "/api/root/crm/mailboxes/mb1/test", method), false, method);
      assert.equal(canAccessPlatformPath({ superadmin: true, sections: [] }, "/api/root/crm/mailboxes/mb1", method), true, method);
    }
    assert.equal(canAccessPlatformPath({ superadmin: false, sections: ["sales"] }, "/root/crm"), false, "КП и рассылки без CRM");
    assert.equal(canAccessPlatformPath({ superadmin: false, sections: ["support"] }, "/root/crm"), false);
    assert.equal(platformHomeHref(crm), "/root/crm");
    const manager = { superadmin: false, sections: ["crm", "clients", "sales"] as const, scope: "own" as const };
    for (const path of ["/root/crm/mail", "/api/root/crm/filtered/x", "/api/root/crm/rules", "/api/root/crm/mailboxes", "/root/health", "/root/funnel", "/api/root/organizations/o1/manager"]) {
      assert.equal(canAccessPlatformPath(manager, path, path.endsWith("manager") ? "PUT" : "GET"), false, `менеджеру закрыто: ${path}`);
    }
    for (const path of ["/root/crm", "/root/crm/contacts", "/root", "/root/organizations/o1", "/root/proposals"]) {
      assert.equal(canAccessPlatformPath(manager, path), true, `менеджеру открыто: ${path}`);
    }
  });

  it("РОП: alexey@wesetup.ru и «БФС» с Telegram — однократный сид в деплое после выдачи админа", () => {
    const seed = read("prisma/seed-crm-rop-2026-11.ts");
    assert.match(seed, /const ROP_EMAIL = "alexey@wesetup\.ru";/);
    assert.match(seed, /onceKey: "once:crm-rop:alexey:v1"/);
    assert.match(seed, /onceKey: "once:crm-rop:bfs:v1"/);
    assert.match(seed, /const BFS_NAMES = \["БФС", "BFS"\];/);
    assert.match(seed, /const BFS_INN = "5018215599";/, "ИНН ООО «БФС» — как в оферте");
    assert.match(read("src/app/oferta/page.tsx"), /ИНН 5018215599/);
    assert.match(seed, /legalProfileJson: \{ path: \["nameShort"\], string_contains: name \}/);
    assert.match(seed, /telegramChatId: \{ not: null \}/);
    assert.match(seed, /role: \{ in: \["owner", "manager"\] \}/);
    assert.match(seed, /users\.length > target\.max/, "неоднозначное совпадение — ничего не выдаём");
    assert.match(seed, /maskEmail\(user\.email\)/, "репозиторий публичный — в логе только маска почты");
    assert.match(seed, /setPlatformSections\(\{ user: owner \}, user\.id, sections, \{ salesHead: true, waitForNotice: true \}\)/);
    const deploy = read(".github/workflows/deploy.yml");
    const admin = deploy.indexOf("prisma/seed-platform-admin-2026-11.ts");
    const rop = deploy.indexOf("prisma/seed-crm-rop-2026-11.ts");
    assert.ok(admin > 0 && rop > admin, "РОП — после роли администратора");
  });

  it("крон CRM ставит деплой: идемпотентно, после проверки сборки, не роняя выкатку", () => {
    const deploy = read(".github/workflows/deploy.yml");
    const install = deploy.indexOf("bash scripts/install-crm-cron.sh");
    assert.ok(install > deploy.indexOf("scripts/post-deploy-check.sh"), "после проверки новой сборки");
    assert.ok(install < deploy.indexOf('echo "=== Deploy complete ==="'));
    assert.match(deploy, /bash scripts\/install-crm-cron\.sh 2>&1 \| tail -3 \|\| echo "\[warn\]/);
    const installer = read("scripts/install-crm-cron.sh");
    assert.match(installer, /MARK="# wesetup-crm-cron"/);
    assert.match(installer, /2-59\/5 \* \* \* \* \/bin\/bash \$APP_DIR\/scripts\/cron-crm\.sh/);
    assert.match(installer, /grep -vE "wesetup-crm-cron\|\/api\/cron\/crm/, "ручную строку заменяет, а не дублирует");
    const runner = read("scripts/cron-crm.sh");
    assert.match(runner, /Authorization: Bearer \$CRON_SECRET/);
    assert.match(runner, /\/api\/cron\/crm/);
    assert.match(read("src/app/api/cron/crm/route.ts"), /status: result\.ok \? 200 : 500/);
  });

  it("владелец платформы может включить РОП и должность себе: разделы и роль не трогаются", () => {
    const team = read("src/lib/platform-team.server.ts");
    assert.match(team, /if \(target\.isRoot\) \{[\s\S]*?if \(options\.roleId\) throw new TeamError[\s\S]*?if \(options\.salesHead === undefined && title === undefined\) throw new TeamError/);
    assert.ok(team.indexOf("if (target.isRoot) {") < team.indexOf('throw new TeamError("Свой доступ менять нельзя")'), "себе — только РОП и должность");
    assert.match(read("src/app/root/team/owner-settings-dialog.tsx"), /body: JSON\.stringify\(\{ sections: \[\], salesHead, title: title\.trim\(\) \|\| null \}\)/);
  });

  it("РОП требует раздел «CRM»; роль задаёт разделы и РОП; снятие доступа снимает роль и РОП", () => {
    const team = read("src/lib/platform-team.server.ts");
    assert.match(team, /const sections = role \? normalizePlatformSections\(role\.sections\) : normalizePlatformSections\(requested\);/);
    assert.match(team, /const salesHead = sections\.length \? \(role \? role\.salesHead : \(options\.salesHead \?\? target\.platformSalesHead\)\) : false;/);
    assert.match(team, /if \(salesHead && !sections\.includes\("crm"\)\) throw new TeamError/);
    assert.match(team, /platformRoleId: sections\.length \? \(role\?\.id \?\? null\) : null,/);
    assert.match(read("src/app/api/root/team/[userId]/route.ts"), /salesHead: z\.boolean\(\)\.optional\(\)/);
  });

  it("заявки идут аудитории «sales»", () => {
    for (const path of [
      "src/app/api/demo-request/route.ts",
      "src/lib/services/requests.ts",
      "src/lib/invoices/service.ts",
      "src/lib/partners/service.ts",
      "src/app/api/auth/register/confirm/route.ts",
      "src/app/api/auth/instant-register/route.ts",
      "src/app/api/profile/complete/route.ts",
    ]) {
      assert.match(read(path), /audience: "sales"/, path);
    }
  });
});
