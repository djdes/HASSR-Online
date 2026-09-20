import { openTelegramSession, db } from "../tg-session";
import { shot } from "./lib";
const T = async (p: any) => ((await p.evaluate(`document.body.innerText`)) as string).replace(/\s+/g, " ");
(async () => {
  const s = await openTelegramSession({ role: "cookA", width: 360, height: 640, theme: "light" });
  const p = s.page;
  p.on("response", async (r) => { const u = r.url().replace(s.base, ""); if (u.startsWith("/api/") && r.request().method() !== "GET") console.log("<<", r.status(), r.request().method(), u.slice(0, 70), (await r.text().catch(() => "")).slice(0, 200)); });
  await p.goto(s.base + "/journals/hygiene/documents/cmu3xjc390004ks9mroi7qi9i", { waitUntil: "load", timeout: 300000 });
  await p.waitForTimeout(9000);
  const row = p.locator(`[data-day-row]`).filter({ hasText: "Иван Повар" }).first();
  await row.getByRole("button", { name: /Заполнить/ }).first().click();
  await p.waitForTimeout(1500);
  await p.getByText("Здоров", { exact: true }).click();
  await p.waitForTimeout(3000);
  console.log("AFTER SET", (await T(p)).slice(180, 800));
  await shot(p, "cookA-after-set-healthy");
  // undo buttons in top bar
  const tb = await p.evaluate(`[...document.querySelectorAll('header button, [class*=top] button')].map(b=>({t:(b.innerText||'').trim().slice(0,20), a:b.getAttribute('aria-label')||b.getAttribute('title'), d:b.disabled}))`);
  console.log("TOPBAR", JSON.stringify(tb));
  console.log("ERRORS", JSON.stringify(s.errors));
  await s.close();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 700)); process.exit(1); });
