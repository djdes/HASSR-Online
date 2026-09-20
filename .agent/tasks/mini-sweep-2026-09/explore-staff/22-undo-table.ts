import { openTelegramSession, db } from "../tg-session";
import { shot } from "./lib";
const T = async (p: any) => ((await p.evaluate(`document.body.innerText`)) as string).replace(/\s+/g, " ");
(async () => {
  const s = await openTelegramSession({ role: "cookA", width: 360, height: 640, theme: "light" });
  const p = s.page;
  p.on("request", (r) => { if (r.method() !== "GET" && !r.url().includes("_next") && !r.url().includes("_log")) console.log(">>", r.method(), r.url().replace(s.base, "").slice(0, 80), (r.postData() || "").slice(0, 140)); });
  await p.goto(s.base + "/journals/hygiene/documents/cmu3xjc390004ks9mroi7qi9i", { waitUntil: "load", timeout: 300000 });
  await p.waitForTimeout(10000);
  const row = p.locator(`[data-day-row]`).filter({ hasText: "Иван Повар" }).first();
  // set to "В" (выходной) to have a change
  await row.getByRole("button").first().click();
  await p.waitForTimeout(2000);
  await p.getByText("Выходной / отгул", { exact: true }).click().catch(() => console.log("no В option"));
  await p.waitForTimeout(5000);
  console.log("ROW:", (await row.innerText()).replace(/\s+/g, " "));
  const undoBtn = p.locator(`button[aria-label="Отменить последнее изменение"]`);
  const redoBtn = p.locator(`button[aria-label="Повторить отменённое изменение"]`);
  console.log("undo disabled?", await undoBtn.isDisabled(), "redo disabled?", await redoBtn.isDisabled());
  await shot(p, "undo-state");
  if (!(await undoBtn.isDisabled())) {
    await undoBtn.click(); await p.waitForTimeout(5000);
    console.log("ROW after undo:", (await row.innerText()).replace(/\s+/g, " "));
    console.log("DB after undo", JSON.stringify(await db.journalDocumentEntry.findMany({ where: { documentId: "cmu3xjc390004ks9mroi7qi9i", employeeId: "cmu2stncc0008wk9m2yu67ip7", date: new Date("2026-09-20T00:00:00.000Z") }, select: { data: true } })));
    console.log("redo disabled now?", await redoBtn.isDisabled());
    if (!(await redoBtn.isDisabled())) { await redoBtn.click(); await p.waitForTimeout(5000); console.log("ROW after redo:", (await row.innerText()).replace(/\s+/g, " ")); }
  }
  // Таблица tab
  await p.evaluate(`window.scrollTo(0,300)`); await p.waitForTimeout(600);
  await p.getByRole("button", { name: "Таблица" }).click().catch((e) => console.log("tab err", String(e).slice(0, 100)));
  await p.waitForTimeout(4000);
  await shot(p, "table-tab");
  const sc = await p.evaluate(`(()=>{const els=[...document.querySelectorAll('*')].filter(e=>e.scrollWidth>e.clientWidth+8);return els.slice(0,5).map(e=>({cls:(e.className+'').slice(0,60),sw:e.scrollWidth,cw:e.clientWidth,sl:e.scrollLeft}))})()`);
  console.log("SCROLLABLE", JSON.stringify(sc));
  console.log("ERRORS", JSON.stringify(s.errors));
  await s.close();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 700)); process.exit(1); });
