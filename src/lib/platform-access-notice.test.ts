import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { PLATFORM_SECTION_KEYS } from "@/lib/platform-access";
import {
  PLATFORM_PANEL_ENTRY,
  addedPlatformSections,
  buildPlatformAccessNotice,
  platformRoleTitle,
} from "@/lib/platform-access-notice";

test("оповещаем только о новых разделах: выдача и добавление — да, снятие и то же самое — нет", () => {
  assert.deepEqual(addedPlatformSections([], ["seo", "content"]), ["content", "seo"]);
  assert.deepEqual(addedPlatformSections(["content"], ["content", "seo"]), ["seo"]);
  assert.deepEqual(addedPlatformSections(["content", "seo"], ["content"]), []);
  assert.deepEqual(addedPlatformSections(["content"], []), []);
  assert.deepEqual(addedPlatformSections(["seo"], ["seo"]), []);
  // Мусор и неизвестные ключи не считаются разделами.
  assert.deepEqual(addedPlatformSections(null, ["nope", 7, "billing"]), ["billing"]);
});

test("роль: пресет по набору разделов, иначе «свой набор»", () => {
  assert.equal(platformRoleTitle(PLATFORM_SECTION_KEYS), "Администратор");
  assert.equal(platformRoleTitle(["content", "seo", "translations"]), "SEO и контент");
  assert.equal(platformRoleTitle(["seo"]), "Свой набор разделов");
});

test("письмо о выдаче администратора: роль, разделы, кто выдал, ссылка входа", () => {
  const notice = buildPlatformAccessNotice({
    name: "Алексей Петров",
    sections: PLATFORM_SECTION_KEYS,
    firstGrant: true,
    grantedBy: "Олег",
    loginEmail: "alexey@wesetup.ru",
    appUrl: "https://wesetup.ru/",
  });
  assert.equal(notice.subject, "Вам открыт доступ к панели WeSetup");
  assert.match(notice.html, /Здравствуйте, Алексей! Вам открыт доступ к панели платформы WeSetup\./);
  assert.match(notice.html, />Администратор<br>/);
  assert.match(notice.html, /Клиенты · Оплаты и тарифы/);
  assert.match(notice.html, /Выдал\(а\)<\/td><td[^>]*>Олег</);
  assert.ok(notice.html.includes(`href="https://wesetup.ru${PLATFORM_PANEL_ENTRY}"`));
  assert.match(notice.html, /под alexey@wesetup\.ru/);
  assert.match(notice.telegram, /^🔑 <b>Вам открыт доступ к панели платформы WeSetup\.<\/b>\nРоль: Администратор\n/);
  assert.ok(notice.telegram.endsWith(`Открыть: https://wesetup.ru${PLATFORM_PANEL_ENTRY}`));
});

test("добавленные разделы — другая тема; имя и выдавший экранируются", () => {
  const notice = buildPlatformAccessNotice({
    name: "<b>Ева</b>",
    sections: ["seo"],
    firstGrant: false,
    grantedBy: "<script>",
    loginEmail: null,
    appUrl: "https://wesetup.ru",
  });
  assert.equal(notice.subject, "Новые разделы панели WeSetup");
  assert.match(notice.html, /Вам открыты новые разделы панели платформы WeSetup\./);
  assert.match(notice.html, /Свой набор разделов/);
  assert.match(notice.html, /под своей учётной записью/);
  assert.ok(!notice.html.includes("<script>"));
  assert.ok(!notice.html.includes("<b>Ева"));
  assert.ok(notice.html.includes("&lt;b&gt;Ева&lt;/b&gt;"));
});

test("выдача в «Команде и доступах» отправляет оповещение, разовый сид — с ожиданием", () => {
  const team = readFileSync(new URL("./platform-team.server.ts", import.meta.url), "utf8");
  assert.match(team, /notifyPlatformAccessGranted\(\{ userId, before, after: sections, grantedBy: actor\.user\.name \?\? null \}\)/);
  const seed = readFileSync(new URL("../../prisma/seed-platform-admin-2026-11.ts", import.meta.url), "utf8");
  assert.match(seed, /const ADMIN_EMAIL = "alexey@wesetup\.ru";/);
  assert.match(seed, /setPlatformSections\(\{ user: owner \}, target\.id, \[\.\.\.PLATFORM_SECTION_KEYS\], \{ waitForNotice: true \}\)/);
  const deploy = readFileSync(new URL("../../.github/workflows/deploy.yml", import.meta.url), "utf8");
  assert.match(deploy, /npx tsx prisma\/seed-platform-admin-2026-11\.ts/);
});
