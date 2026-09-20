import { openTelegramSession, db, state } from "../tg-session";
import { shot } from "./lib";
const T = async (p: any) => ((await p.evaluate(`document.body.innerText`)) as string).replace(/\s+/g, " ");
(async () => {
  await db.journalTaskClaim.deleteMany({ where: { userId: state.users.cookA.id } });
  const s = await openTelegramSession({ role: "cookA", width: 360, height: 640, theme: "light" });
  const p = s.page;
  p.on("response", async (r) => { if (r.request().method() !== "GET" && r.url().includes("/api/")) console.log("<<", r.status(), r.url().replace(s.base, "").slice(0, 60), (await r.text().catch(() => "")).slice(0, 120)); });
  await p.goto(s.base + "/mini/today", { waitUntil: "load", timeout: 300000 });
  await p.waitForTimeout(9000);
  await p.getByRole("button", { name: "Взять" }).first().click();
  await p.waitForTimeout(9000);
  console.log("claim url", p.url().replace(s.base, ""));
  // Вернуть задачу
  await p.evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>/Вернуть задачу/.test(b.innerText)); b&&b.scrollIntoView({block:'center'})})()`);
  await p.waitForTimeout(600);
  await p.getByRole("button", { name: /Вернуть задачу/ }).click();
  await p.waitForTimeout(2500);
  console.log("CONFIRM", (await T(p)).slice(-420));
  await shot(p, "release-confirm");
  const yes = p.getByRole("button", { name: /^Вернуть$|Да/ }).first();
  console.log("yes count", await yes.count());
  if (await yes.count()) { await yes.click(); }
  for (let i = 0; i < 6; i++) { await p.waitForTimeout(2000); if (p.url().includes("/mini/today")) break; }
  await p.waitForTimeout(3000);
  console.log("after release url", p.url().replace(s.base, ""));
  console.log("TXT", (await T(p)).slice(0, 300));
  await shot(p, "release-done");
  console.log("DB claims", JSON.stringify(await db.journalTaskClaim.findMany({ where: { userId: state.users.cookA.id }, select: { status: true, releasedAt: true } })));
  console.log("ERRORS", JSON.stringify(s.errors));
  await s.close();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 700)); process.exit(1); });
