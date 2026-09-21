import { openTelegramSession, SHOT, out, db, state } from "./lib";
import { CODES } from "./codes";
(async () => {
  const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640 });
  const res: any = {};
  for (const code of CODES) {
    const r: any = { code };
    try {
      const before = await db.journalDocument.findMany({ where: { organizationId: state.orgA, template: { code } }, select: { id: true } });
      await s.page.goto(s.base + "/journals/" + code, { timeout: 300000, waitUntil: "domcontentloaded" });
      await s.page.waitForTimeout(3000);
      await s.page.locator('button:has-text("Создать документ"), a:has-text("Создать документ")').first().click({ timeout: 20000 });
      await s.page.waitForSelector('[role="dialog"]', { timeout: 30000 });
      await s.page.waitForTimeout(1500);
      // fill title = first text input in dialog
      const ti = s.page.locator('[role="dialog"] input[type="text"], [role="dialog"] input:not([type])').first();
      if (await ti.count()) { await ti.fill("ZZ5 " + code); }
      r.dlgText = await s.page.evaluate(`document.querySelector('[role="dialog"]').innerText.slice(0,900)`);
      const create = s.page.locator('[role="dialog"] button:has-text("Создать")').last();
      await create.scrollIntoViewIfNeeded().catch(() => null);
      await create.click({ timeout: 20000 });
      await s.page.waitForTimeout(4000);
      r.afterUrl = s.page.url();
      r.dialogStillOpen = await s.page.evaluate(`!!document.querySelector('[role="dialog"]')`);
      const after = await db.journalDocument.findMany({ where: { organizationId: state.orgA, template: { code } }, select: { id: true, title: true, dateFrom: true, dateTo: true, responsibleUserId: true, responsibleTitle: true, status: true, config: true, createdAt: true } });
      const fresh = after.filter((a) => !before.some((b) => b.id === a.id));
      r.created = fresh.map((f) => ({ id: f.id, title: f.title, from: f.dateFrom?.toISOString(), to: f.dateTo?.toISOString(), resp: f.responsibleUserId, respTitle: f.responsibleTitle, cfgKeys: f.config ? Object.keys(f.config as any) : null }));
      r.body = await s.page.evaluate(`document.body.innerText.slice(0,400)`);
      console.log(code, "created", r.created.length, r.created[0] ? r.created[0].title + " | " + r.created[0].from + " .. " + r.created[0].to : "", "dlgOpen=" + r.dialogStillOpen, "url=" + r.afterUrl.replace(s.base, ""));
    } catch (e) { r.err = String(e).slice(0, 250); console.log(code, "ERR", r.err.replace(/\n/g, " ").slice(0, 160)); }
    res[code] = r;
  }
  out("created.json", res);
  out("created-errors.json", s.errors);
  await s.close();
})();
