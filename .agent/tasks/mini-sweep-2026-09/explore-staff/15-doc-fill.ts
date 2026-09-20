import { openTelegramSession } from "../tg-session";
import { shot } from "./lib";
const T = async (p: any) => ((await p.evaluate(`document.body.innerText`)) as string).replace(/\s+/g, " ");
(async () => {
  const s = await openTelegramSession({ role: "cookA", width: 360, height: 640, theme: "light" });
  const p = s.page;
  p.on("response", async (r) => { const u = r.url().replace(s.base, ""); if (u.startsWith("/api/") && r.request().method() !== "GET") console.log("<<", r.status(), r.request().method(), u.slice(0, 70), (await r.text().catch(() => "")).slice(0, 150)); });
  await p.goto(s.base + "/journals/hygiene/documents/cmu3xjc390004ks9mroi7qi9i", { waitUntil: "load", timeout: 300000 });
  await p.waitForTimeout(8000);
  // 1. foreign row button
  const foreign = p.getByRole("button", { name: "Заполнить" }).first();
  console.log("foreign disabled?", await foreign.isDisabled());
  await foreign.click({ force: true }).catch((e) => console.log("click err", String(e).slice(0, 80)));
  await p.waitForTimeout(2500);
  console.log("after foreign click url", p.url());
  console.log("after foreign click txt", (await T(p)).slice(0, 300));
  await shot(p, "cookA-doc-foreign-click");
  // 2. autofill toggle (manager control?)
  const toggle = p.locator("button[role=switch], input[type=checkbox]").first();
  console.log("toggle count", await p.locator("button[role=switch]").count());
  // 3. own row
  await p.getByRole("button", { name: /Заполнить: Иван Повар/ }).click();
  await p.waitForTimeout(3500);
  console.log("URL after own fill", p.url());
  console.log("TXT", (await T(p)).slice(0, 900));
  await shot(p, "cookA-doc-fill-sheet");
  await shot(p, "cookA-doc-fill-sheet-full", true);
  console.log("INPUTS", JSON.stringify(await p.evaluate(`[...document.querySelectorAll('input,textarea,select,button')].map(e=>{const r=e.getBoundingClientRect();if(r.width<1)return null;return {tag:e.tagName,t:(e.innerText||e.placeholder||e.type||'').replace(/\s+/g,' ').slice(0,40),fs:getComputedStyle(e).fontSize,y:Math.round(r.y),h:Math.round(r.height)}}).filter(Boolean)`), null, 1));
  console.log("ERRORS", JSON.stringify(s.errors));
  await s.close();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 700)); process.exit(1); });
