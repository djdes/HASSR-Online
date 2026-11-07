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

  it("CRM — раздел «Продажи»; ящики меняет только владелец; продажи начинают с CRM", () => {
    const sales = { superadmin: false, sections: ["sales"] as const };
    for (const path of ["/root/crm", "/root/crm/contacts", "/root/crm/contacts/abc", "/root/crm/mail", "/api/root/crm/sync", "/api/root/crm/contacts/abc/messages"]) {
      assert.equal(platformGateFor(path), "sales", path);
      assert.equal(canAccessPlatformPath(sales, path, "POST"), true, path);
    }
    assert.equal(canAccessPlatformPath(sales, "/api/root/crm/mailboxes", "GET"), true);
    for (const method of ["POST", "PUT", "DELETE"]) {
      assert.equal(canAccessPlatformPath(sales, "/api/root/crm/mailboxes", method), false, method);
      assert.equal(canAccessPlatformPath(sales, "/api/root/crm/mailboxes/mb1/test", method), false, method);
      assert.equal(canAccessPlatformPath({ superadmin: true, sections: [] }, "/api/root/crm/mailboxes/mb1", method), true, method);
    }
    assert.equal(canAccessPlatformPath({ superadmin: false, sections: ["support"] }, "/root/crm"), false);
    assert.equal(platformHomeHref(sales), "/root/crm");
  });

  it("назначение alexey@wesetup.ru РОП — однократный сид в деплое после выдачи админа", () => {
    const seed = read("prisma/seed-crm-rop-2026-11.ts");
    assert.match(seed, /const ROP_EMAIL = "alexey@wesetup\.ru";/);
    assert.match(seed, /const ONCE_KEY = "once:crm-rop:alexey:v1";/);
    assert.match(seed, /setPlatformSections\(\{ user: owner \}, target\.id, sections, \{ salesHead: true, waitForNotice: true \}\)/);
    const deploy = read(".github/workflows/deploy.yml");
    const admin = deploy.indexOf("prisma/seed-platform-admin-2026-11.ts");
    const rop = deploy.indexOf("prisma/seed-crm-rop-2026-11.ts");
    assert.ok(admin > 0 && rop > admin, "РОП — после роли администратора");
  });

  it("РОП требует раздел «Продажи», снятие доступа снимает РОП", () => {
    const team = read("src/lib/platform-team.server.ts");
    assert.match(team, /const salesHead = sections\.length \? \(options\.salesHead \?\? target\.platformSalesHead\) : false;/);
    assert.match(team, /if \(salesHead && !sections\.includes\("sales"\)\) throw new TeamError/);
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
