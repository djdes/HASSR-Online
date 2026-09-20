import { openTelegramSession, db, state } from "../tg-session";
import { shot } from "./lib";
const T = async (p: any) => ((await p.evaluate(`document.body.innerText`)) as string).replace(/\s+/g, " ");
(async () => {
  await db.journalTaskClaim.deleteMany({ where: { userId: state.users.cookA.id } });
  const s = await openTelegramSession({ role: "cookA", width: 360, height: 640, theme: "light" });
  const p = s.page;
  p.on("response", async (r) => { if (r.request().method() !== "GET" && r.url().includes("/api/")) console.log("<<", r.status(), r.url().replace(s.base, "").slice(0, 55), (await r.text().catch(() => "")).slice(0, 120)); });
  await p.goto(s.base + "/mini/today", { waitUntil: "load", timeout: 300000 });
  await p.waitForTimeout(9000);
  // bell
  await p.locator(`header button[aria-label="Уведомления"]`).click();
  await p.waitForTimeout(3500);
  console.log("BELL", (await T(p)).slice(-300));
  await shot(p, "bell-sheet");
  await p.keyboard.press("Escape"); await p.waitForTimeout(1500);
  // claim + skip
  await p.getByRole("button", { name: "Взять" }).first().click();
  await p.waitForTimeout(9000);
  console.log("url", p.url().replace(s.base, ""));
  await p.evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>/Сегодня не требуется/.test(b.innerText)); b&&b.scrollIntoView({block:'center'})})()`);
  await p.waitForTimeout(500);
  await p.getByRole("button", { name: /Сегодня не требуется/ }).first().click();
  await p.waitForTimeout(3000);
  console.log("SKIP DIALOG", (await T(p)).slice(-400));
  await shot(p, "skip-dialog");
  await shot(p, "skip-dialog-full", true);
  console.log("ERRORS", JSON.stringify(s.errors));
  await s.close();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 700)); process.exit(1); });
