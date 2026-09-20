import { openTelegramSession, db } from "../tg-session";
import { shot } from "./lib";
const T = async (p: any) => ((await p.evaluate(`document.body.innerText`)) as string).replace(/\s+/g, " ");
(async () => {
  const s = await openTelegramSession({ role: "cookA", width: 360, height: 640, theme: "light" });
  const p = s.page;
  p.on("request", (r) => { if (r.method() !== "GET" && !r.url().includes("_next") && !r.url().includes("_log")) console.log(">>", r.method(), r.url().replace(s.base, "").slice(0, 90), (r.postData() || "").slice(0, 200)); });
  p.on("response", async (r) => { if (r.request().method() !== "GET" && r.url().includes("/api/journal-documents")) console.log("<<", r.status(), (await r.text().catch(() => "")).slice(0, 200)); });
  await p.goto(s.base + "/journals/hygiene/documents/cmu3xjc390004ks9mroi7qi9i", { waitUntil: "load", timeout: 300000 });
  await p.waitForTimeout(10000);
  const row = p.locator(`[data-day-row]`).filter({ hasText: "Иван Повар" }).first();
  console.log("ROW TEXT:", (await row.innerText()).replace(/\s+/g, " "));
  const fill = row.getByRole("button", { name: /Заполнить/ }).first();
  console.log("fill visible", await fill.isVisible(), "box", JSON.stringify(await fill.boundingBox()));
  await fill.click();
  await p.waitForTimeout(2500);
  await shot(p, "step-menu-open");
  console.log("SHEET TEXT:", (await T(p)).slice(-320));
  const zd = p.getByText("Здоров", { exact: true });
  console.log("Здоров count", await zd.count());
  if (await zd.count()) { await zd.first().click(); }
  await p.waitForTimeout(7000);
  console.log("ROW AFTER:", (await row.innerText()).replace(/\s+/g, " "));
  await shot(p, "step-after-set");
  const rows = await db.journalDocumentEntry.findMany({ where: { documentId: "cmu3xjc390004ks9mroi7qi9i", employeeId: "cmu2stncc0008wk9m2yu67ip7", date: new Date("2026-09-20T00:00:00.000Z") }, select: { data: true, updatedAt: true } });
  console.log("DB", JSON.stringify(rows));
  // reload and see
  await p.reload({ waitUntil: "load", timeout: 300000 });
  await p.waitForTimeout(8000);
  const row2 = p.locator(`[data-day-row]`).filter({ hasText: "Иван Повар" }).first();
  console.log("ROW AFTER RELOAD:", (await row2.innerText()).replace(/\s+/g, " "));
  await shot(p, "step-after-reload");
  console.log("ERRORS", JSON.stringify(s.errors));
  await s.close();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 700)); process.exit(1); });
