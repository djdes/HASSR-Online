import { openTelegramSession, db } from "../tg-session";
import { shot, go, FIELDS } from "./lib";
(async () => {
  const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640, theme: "light" });
  const page = s.page;
  try {
    await go(page, s.base + "/settings/organization", 9000);
    const f = await page.evaluate(FIELDS);
    console.log("FIELDS", JSON.stringify((f as string[]).slice(0, 14), null, 1));
    const before = await db.organization.findUnique({ where: { id: "e2e-org-a" }, select: { name: true, shortName: true, timezone: true } }).catch(()=>null);
    console.log("ORG-BEFORE", JSON.stringify(before));
  } catch (e) { console.log("ERR", String(e).slice(0,300)); }
  await s.close();
})();
