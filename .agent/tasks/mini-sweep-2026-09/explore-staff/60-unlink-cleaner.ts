import { openTelegramSession, db, state } from "../tg-session";
import { shot } from "./lib";
const T = async (p: any) => ((await p.evaluate(`document.body.innerText`)) as string).replace(/\s+/g, " ");
(async () => {
  const s = await openTelegramSession({ role: "cleanerA", width: 390, height: 844, theme: "light" });
  const p = s.page;
  p.on("response", async (r) => { if (r.request().method() !== "GET" && r.url().includes("/api/")) console.log("<<", r.status(), r.url().replace(s.base, "").slice(0, 60), (await r.text().catch(() => "")).slice(0, 150)); });
  await p.goto(s.base + "/mini/me", { waitUntil: "load", timeout: 300000 });
  await p.waitForTimeout(6000);
  await p.getByText("Отвязать Telegram").click();
  await p.waitForTimeout(2500);
  const input = p.locator("input").last();
  await input.fill("ОТВЯЗАТЬ");
  await p.waitForTimeout(800);
  await shot(p, "cleaner-unlink-typed");
  await p.evaluate(`(()=>{const b=[...document.querySelectorAll('button')].filter(b=>/^Отвязать$/.test((b.innerText||'').trim())); b[b.length-1].click()})()`);
  for (let i = 0; i < 8; i++) { await p.waitForTimeout(2500); console.log(i, p.url().replace(s.base, ""), "|", (await T(p)).slice(0, 160)); }
  await shot(p, "cleaner-after-unlink");
  console.log("DB telegramChatId:", (await db.user.findUnique({ where: { id: state.users.cleanerA.id }, select: { telegramChatId: true } }))?.telegramChatId);
  // try to use the app after unlink
  await p.goto(s.base + "/mini/today", { waitUntil: "load", timeout: 300000 });
  await p.waitForTimeout(8000);
  console.log("after unlink /mini/today:", p.url().replace(s.base, ""), "|", (await T(p)).slice(0, 250));
  await shot(p, "cleaner-after-unlink-today");
  console.log("ERRORS", JSON.stringify(s.errors));
  await s.close();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 700)); process.exit(1); });
