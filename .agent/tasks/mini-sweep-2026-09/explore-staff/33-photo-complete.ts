import { openTelegramSession, db, state } from "../tg-session";
import { shot, SHOT } from "./lib";
import fs from "node:fs";
const T = async (p: any) => ((await p.evaluate(`document.body.innerText`)) as string).replace(/\s+/g, " ");
(async () => {
  const c = await db.journalTaskClaim.findFirst({ where: { userId: state.users.cleanerA.id, status: "active" } });
  console.log("claim", c?.id, "dateKey", c?.dateKey);
  const s = await openTelegramSession({ role: "cleanerA", width: 390, height: 844, theme: "light" });
  const p = s.page;
  p.on("response", async (r) => { if (r.request().method() !== "GET" && r.url().includes("/api/")) console.log("<<", r.status(), r.url().replace(s.base, "").slice(0, 60), (await r.text().catch(() => "")).slice(0, 250)); });
  await p.goto(s.base + "/mini/claim/" + c!.id, { waitUntil: "load", timeout: 300000 });
  await p.waitForTimeout(8000);
  for (let i = 0; i < 12; i++) { await p.evaluate(`document.querySelectorAll('input[type=checkbox]')[${i}]?.scrollIntoView({block:'center'})`); await p.waitForTimeout(150); await p.locator("input[type=checkbox]").nth(i).click({ force: true, timeout: 8000 }).catch(() => {}); }
  const png = SHOT + "tiny.png";
  if (!fs.existsSync(png)) fs.writeFileSync(png, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));
  await p.locator("input[type=file]").first().setInputFiles(png);
  await p.waitForTimeout(6000);
  console.log("after upload TAIL", (await T(p)).slice(-380));
  await shot(p, "cleaner-photo-attached");
  console.log("SUBMIT:", await p.evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>/Завершить|Нужно фото/.test(b.innerText));return b? b.innerText.replace(/\s+/g,' ')+' | disabled='+b.disabled:'none'})()`));
  await p.evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>/Завершить/.test(b.innerText)); b&&b.scrollIntoView({block:'center'})})()`);
  await p.waitForTimeout(500);
  await p.getByRole("button", { name: /Завершить/ }).last().click({ timeout: 10000 }).catch((e) => console.log("submit err", String(e).slice(0, 80)));
  for (let i = 0; i < 8; i++) { await p.waitForTimeout(2000); console.log(i * 2 + "s", p.url().replace(s.base, "")); if (p.url().includes("/mini/today")) break; }
  await p.waitForTimeout(3000);
  await shot(p, "cleaner-after-complete");
  console.log("FINAL", (await T(p)).slice(0, 400));
  console.log("DB", JSON.stringify(await db.journalTaskClaim.findUnique({ where: { id: c!.id }, select: { status: true, completedAt: true, entryId: true } })));
  console.log("ERRORS", JSON.stringify(s.errors));
  await s.close();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 700)); process.exit(1); });
