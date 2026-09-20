import { openTelegramSession, db } from "../tg-session";
import { shot } from "./lib";
const T = async (p: any) => ((await p.evaluate(`document.body.innerText`)) as string).replace(/\s+/g, " ");
(async () => {
  const s = await openTelegramSession({ role: "cookA", width: 360, height: 640, theme: "light" });
  const p = s.page;
  p.on("request", (r) => { if (r.method() !== "GET" && !r.url().includes("_next")) console.log(">>", r.method(), r.url().replace(s.base, "").slice(0, 90), (r.postData() || "").slice(0, 160)); });
  await p.goto(s.base + "/journals/hygiene/documents/cmu3xjc390004ks9mroi7qi9i", { waitUntil: "load", timeout: 300000 });
  await p.waitForTimeout(9000);
  const row = p.locator(`[data-day-row]`).filter({ hasText: "Иван Повар" }).first();
  await row.getByRole("button", { name: /Заполнить/ }).first().click();
  await p.waitForTimeout(1500);
  await p.getByText("Здоров", { exact: true }).click();
  await p.waitForTimeout(8000);
  console.log("cell now:", await row.innerText());
  console.log("toast/any:", (await T(p)).slice(-250));
  // queue?
  console.log("QUEUE", await p.evaluate(`(async()=>{try{const dbs=await indexedDB.databases();return JSON.stringify(dbs)}catch(e){return 'x'}})()`));
  await p.goto(s.base + "/mini/outbox", { waitUntil: "load", timeout: 300000 });
  await p.waitForTimeout(5000);
  console.log("OUTBOX", (await T(p)).slice(0, 400));
  await shot(p, "cookA-outbox-after-fill");
  const rows = await db.journalDocumentEntry.findMany({ where: { documentId: "cmu3xjc390004ks9mroi7qi9i", employeeId: "cmu2stncc0008wk9m2yu67ip7", date: new Date("2026-09-20T00:00:00.000Z") }, select: { data: true, updatedAt: true } });
  console.log("DB", JSON.stringify(rows));
  console.log("ERRORS", JSON.stringify(s.errors));
  await s.close();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 700)); process.exit(1); });
