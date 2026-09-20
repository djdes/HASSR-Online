import { openTelegramSession, db, state } from "../tg-session";
import { shot } from "./lib";
const T = async (p: any) => ((await p.evaluate(`document.body.innerText`)) as string).replace(/\s+/g, " ");
(async () => {
  const c = await db.journalTaskClaim.findFirst({ where: { userId: state.users.cleanerA.id, status: "active" } });
  const s = await openTelegramSession({ role: "cleanerA", width: 390, height: 844, theme: "light" });
  const p = s.page;
  p.on("response", async (r) => { if (r.request().method() !== "GET" && r.url().includes("/api/")) console.log("<<", r.status(), r.url().replace(s.base, "").slice(0, 60), (await r.text().catch(() => "")).slice(0, 200)); });
  await p.goto(s.base + "/mini/claim/" + c!.id, { waitUntil: "load", timeout: 300000 });
  await p.waitForTimeout(8000);
  const n = await p.locator("input[type=checkbox]").count();
  for (let i = 0; i < n; i++) {
    const cb = p.locator("input[type=checkbox]").nth(i);
    await cb.scrollIntoViewIfNeeded().catch(() => {});
    await p.waitForTimeout(150);
    await cb.check({ force: true }).catch((e) => console.log("cb", i, "err", String(e).slice(0, 60)));
    if (!p.url().includes("/mini/claim/")) { console.log("!! navigated away at", i, p.url()); break; }
  }
  await p.waitForTimeout(1500);
  console.log("url", p.url());
  console.log("checked:", await p.locator("input[type=checkbox]:checked").count(), "of", n);
  const label = await p.evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>/Завершить|Нужно фото/.test(b.innerText));return b? b.innerText.replace(/\s+/g,' ')+' | disabled='+b.disabled : 'none'})()`);
  console.log("SUBMIT:", label);
  await shot(p, "cleaner-checked-all2");
  await shot(p, "cleaner-checked-all2-full", true);
  console.log("photo btn count", await p.getByRole("button", { name: /Снять фото|фото/i }).count());
  console.log("TAIL", (await T(p)).slice(-400));
  console.log("ERRORS", JSON.stringify(s.errors));
  await s.close();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 700)); process.exit(1); });
