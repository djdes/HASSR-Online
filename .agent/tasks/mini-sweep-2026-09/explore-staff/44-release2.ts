import { openTelegramSession, db, state } from "../tg-session";
import { shot } from "./lib";
const T = async (p: any) => ((await p.evaluate(`document.body.innerText`)) as string).replace(/\s+/g, " ");
(async () => {
  const c = await db.journalTaskClaim.findFirst({ where: { userId: state.users.cookA.id, status: "active" } });
  const s = await openTelegramSession({ role: "cookA", width: 360, height: 640, theme: "light" });
  const p = s.page;
  p.on("response", async (r) => { if (r.request().method() !== "GET" && r.url().includes("/api/")) console.log("<<", r.status(), r.url().replace(s.base, "").slice(0, 60), (await r.text().catch(() => "")).slice(0, 120)); });
  await p.goto(s.base + "/mini/claim/" + c!.id, { waitUntil: "load", timeout: 300000 });
  await p.waitForTimeout(8000);
  await p.evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>/Вернуть задачу/.test(b.innerText)); b&&b.scrollIntoView({block:'center'})})()`);
  await p.waitForTimeout(500);
  await p.getByRole("button", { name: /Вернуть задачу/ }).first().click();
  await p.waitForTimeout(2500);
  const btns = await p.evaluate(`[...document.querySelectorAll('button')].map((b,i)=>i+':'+(b.innerText||'').replace(/\s+/g,' ').trim().slice(0,30)).filter(t=>t.length>2)`);
  console.log("BUTTONS", JSON.stringify(btns));
  await p.evaluate(`(()=>{const bs=[...document.querySelectorAll('button')].filter(b=>/^Вернуть задачу$/.test((b.innerText||'').trim())); bs[bs.length-1].click()})()`);
  for (let i = 0; i < 8; i++) { await p.waitForTimeout(2000); if (p.url().includes("/mini/today")) break; }
  await p.waitForTimeout(3000);
  console.log("url", p.url().replace(s.base, ""));
  console.log("TXT", (await T(p)).slice(0, 250));
  await shot(p, "release-done2");
  console.log("DB", JSON.stringify(await db.journalTaskClaim.findMany({ where: { userId: state.users.cookA.id }, select: { status: true, releasedAt: true } })));
  console.log("ERRORS", JSON.stringify(s.errors));
  await s.close();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 700)); process.exit(1); });
