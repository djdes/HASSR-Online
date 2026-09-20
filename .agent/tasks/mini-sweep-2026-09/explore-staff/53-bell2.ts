import { openTelegramSession, db, state } from "../tg-session";
import { shot } from "./lib";
const T = async (p: any) => ((await p.evaluate(`document.body.innerText`)) as string).replace(/\s+/g, " ");
(async () => {
  const s = await openTelegramSession({ role: "cookA", width: 360, height: 640, theme: "light" });
  const p = s.page;
  await p.goto(s.base + "/mini/today", { waitUntil: "load", timeout: 300000 });
  await p.waitForTimeout(9000);
  await p.locator(`header button[aria-label="Уведомления"]`).click();
  await p.waitForTimeout(4000);
  console.log("panel open?", (await T(p)).includes("Нет новых уведомлений") || (await T(p)).includes("Уведомления"));
  await shot(p, "bell-open");
  // navigate via bottom nav
  await p.locator('a[data-nav-href="/mini/sections"]').click();
  await p.waitForTimeout(5000);
  console.log("after nav url", p.url().replace(s.base, ""), "| still open?", (await T(p)).includes("Прочитанные"));
  await shot(p, "bell-after-nav");
  await p.locator('a[data-nav-href="/mini/me"]').click();
  await p.waitForTimeout(5000);
  console.log("after nav2 | still open?", (await T(p)).includes("Прочитанные"));
  await shot(p, "bell-after-nav2");
  // telegram back
  await s.pressTelegramBack(); await p.waitForTimeout(3000);
  console.log("after tg back url", p.url().replace(s.base, ""), "| still open?", (await T(p)).includes("Прочитанные"));
  await shot(p, "bell-after-back");
  console.log("ERRORS", JSON.stringify(s.errors));
  await s.close();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 600)); process.exit(1); });
