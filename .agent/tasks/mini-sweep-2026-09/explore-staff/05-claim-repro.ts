import { openTelegramSession, db, state } from "../tg-session";
(async () => {
  const uid = state.users.cookA.id;
  const del = await db.journalTaskClaim.deleteMany({ where: { userId: uid } });
  console.log("cleared claims:", del.count);
  const s = await openTelegramSession({ role: "cookA", width: 360, height: 640, theme: "light" });
  const p = s.page;
  p.on("request", (r) => { if (r.url().includes("/api/")) console.log(">>", r.method(), r.url().replace(s.base, "")); });
  p.on("response", async (r) => { if (r.url().includes("/api/journal-task-claims")) console.log("<<", r.status(), r.url().replace(s.base, ""), (await r.text().catch(() => "")).slice(0, 200)); });
  await p.waitForTimeout(9000);
  const btn = p.getByRole("button", { name: "Взять" }).first();
  await btn.scrollIntoViewIfNeeded();
  console.log("clicking...");
  await btn.click();
  for (let i = 0; i < 6; i++) { await p.waitForTimeout(2000); console.log(i, "url=", p.url(), "| busy?", await p.getByRole("button", { name: "Взять" }).count()); }
  console.log("BODY", (await p.evaluate(`document.body.innerText`) as string).replace(/[ \t\n\r]+/g, " ").slice(0, 400));
  console.log("ERRORS", JSON.stringify(s.errors));
  const claims = await db.journalTaskClaim.findMany({ where: { userId: uid }, select: { id: true, journalCode: true, scopeKey: true, status: true } });
  console.log("DB CLAIMS", JSON.stringify(claims));
  await s.close();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 800)); process.exit(1); });
