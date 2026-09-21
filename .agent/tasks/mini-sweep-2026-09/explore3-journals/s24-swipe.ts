import { openTelegramSession, SHOT, db, state } from "./lib";
(async () => {
  const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640 });
  const doc = await db.journalDocument.findFirst({ where: { organizationId: state.orgA, title: "ZZ5 seedtest hygiene" }, select: { id: true } });
  const id = doc!.id;
  const cdp = await s.ctx.newCDPSession(s.page);
  const count = async () => {
    const e = await db.journalDocumentEntry.findMany({ where: { documentId: id }, select: { data: true } });
    const k: any = {}; for (const x of e) { const s2 = JSON.stringify(x.data); k[s2] = (k[s2] || 0) + 1; } return k;
  };
  console.log("before:", JSON.stringify(await count()));
  await s.page.goto(`${s.base}/journals/hygiene/documents/${id}`, { timeout: 300000, waitUntil: "domcontentloaded" });
  await s.page.waitForTimeout(6000);
  await s.page.screenshot({ path: SHOT + "/swipe-before.png" });
  const info = await s.page.evaluate(`document.body.innerText.slice(0,600)`);
  console.log("view:", String(info).replace(/\n/g, " | ").slice(0, 400));
  // find a row y
  const rowY = await s.page.evaluate(`(function(){var els=Array.from(document.querySelectorAll('div')).filter(function(e){return /Мария Руководитель|Иван Повар/.test(e.innerText||'') && e.getBoundingClientRect().height<120 && e.getBoundingClientRect().height>30;}); if(!els.length) return null; var b=els[els.length-1].getBoundingClientRect(); return Math.round(b.y+b.height/2);})()`);
  console.log("rowY:", rowY);
  const y = (rowY as number) || 420;
  for (let i = 0; i < 2; i++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 300, y }] });
    for (let x = 290; x >= 60; x -= 20) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y }] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await s.page.waitForTimeout(1200);
  }
  await s.page.screenshot({ path: SHOT + "/swipe-after.png" });
  await s.page.waitForTimeout(2500);
  console.log("after swipe:", JSON.stringify(await count()));
  console.log("body:", (await s.page.evaluate(`document.body.innerText.slice(0,500)`) as string).replace(/\n/g, " | "));
  await s.close();
})();
