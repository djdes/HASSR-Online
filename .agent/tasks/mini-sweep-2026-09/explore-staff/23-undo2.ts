import { openTelegramSession, db } from "../tg-session";
import { shot } from "./lib";
const DOC = "cmu3xjc390004ks9mroi7qi9i", U = "cmu2stncc0008wk9m2yu67ip7", D = new Date("2026-09-20T00:00:00.000Z");
const cell = async () => JSON.stringify((await db.journalDocumentEntry.findFirst({ where: { documentId: DOC, employeeId: U, date: D }, select: { data: true } }))?.data);
(async () => {
  await db.journalDocumentEntry.updateMany({ where: { documentId: DOC, employeeId: U, date: D }, data: { data: { _autoSeeded: true } } });
  const s = await openTelegramSession({ role: "cookA", width: 360, height: 640, theme: "light" });
  const p = s.page;
  p.on("request", (r) => { if (r.method() !== "GET" && !r.url().includes("_next") && !r.url().includes("_log")) console.log(">>", r.method(), r.url().replace(s.base, "").slice(0, 70), (r.postData() || "").slice(0, 130)); });
  await p.goto(s.base + "/journals/hygiene/documents/" + DOC, { waitUntil: "load", timeout: 300000 });
  await p.waitForTimeout(10000);
  const row = p.locator(`[data-day-row]`).filter({ hasText: "Иван Повар" }).first();
  await row.getByRole("button", { name: /Заполнить/ }).first().click();
  await p.waitForTimeout(2000);
  await p.getByText("Здоров", { exact: true }).click();
  await p.waitForTimeout(6000);
  console.log("ROW", (await row.innerText()).replace(/\s+/g, " "), "| DB", await cell());
  const undoBtn = p.locator(`button[aria-label="Отменить последнее изменение"]`);
  const redoBtn = p.locator(`button[aria-label="Повторить отменённое изменение"]`);
  console.log("undo disabled?", await undoBtn.isDisabled(), "redo disabled?", await redoBtn.isDisabled());
  await shot(p, "undo-after-real-save");
  if (!(await undoBtn.isDisabled())) {
    await undoBtn.click(); await p.waitForTimeout(6000);
    console.log("after undo ROW", (await row.innerText()).replace(/\s+/g, " "), "| DB", await cell());
    console.log("redo disabled?", await redoBtn.isDisabled());
    if (!(await redoBtn.isDisabled())) { await redoBtn.click(); await p.waitForTimeout(6000); console.log("after redo ROW", (await row.innerText()).replace(/\s+/g, " "), "| DB", await cell()); }
  }
  console.log("ERRORS", JSON.stringify(s.errors));
  await s.close();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 700)); process.exit(1); });
