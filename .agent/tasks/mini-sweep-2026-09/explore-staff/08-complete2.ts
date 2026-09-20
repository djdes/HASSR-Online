import { openTelegramSession, db, state } from "../tg-session";
import { shot } from "./lib";
const txt = async (p: any) => ((await p.evaluate(`document.body.innerText`)) as string).replace(/[ \t\n\r]+/g, " ");
(async () => {
  const uid = state.users.cookA.id;
  await db.journalTaskClaim.deleteMany({ where: { userId: uid } });
  const s = await openTelegramSession({ role: "cookA", width: 360, height: 640, theme: "light" });
  const p = s.page;
  p.on("response", async (r) => { const u = r.url().replace(s.base, ""); if (u.includes("journal-task-claims")) console.log("<<", r.status(), r.request().method(), u.slice(0, 70), (await r.text().catch(() => "")).slice(0, 180)); });
  await p.goto(s.base + "/mini/today", { waitUntil: "load", timeout: 300000 });
  await p.waitForTimeout(9000);
  await p.getByRole("button", { name: "Взять" }).first().click();
  await p.waitForTimeout(9000);
  console.log("on claim:", p.url());
  console.log("TXT", (await txt(p)).slice(0, 500));
  await p.getByText("Все сотрудники в норме").click().catch(() => console.log("no checkbox"));
  await p.waitForTimeout(600);
  const t0 = Date.now();
  await p.getByRole("button", { name: /Завершить/ }).click();
  for (let i = 0; i < 12; i++) {
    await p.waitForTimeout(2000);
    const u = p.url();
    console.log(Math.round((Date.now() - t0) / 1000) + "s", u.replace(s.base, ""));
    if (u.includes("/mini/today")) break;
  }
  await p.waitForTimeout(3000);
  await shot(p, "cookA-back-today-after-complete");
  console.log("FINAL", (await txt(p)).slice(0, 400));
  console.log("ERRORS", JSON.stringify(s.errors));
  await s.close();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 800)); process.exit(1); });
