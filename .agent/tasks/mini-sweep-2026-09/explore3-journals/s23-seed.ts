import { openTelegramSession, out, db, state } from "./lib";
(async () => {
  const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640 });
  await s.page.goto(s.base + "/journals", { timeout: 300000, waitUntil: "domcontentloaded" });
  await s.page.waitForTimeout(3000);
  for (const code of ["hygiene", "health_check"]) {
    const r = await s.page.evaluate(`fetch('/api/journal-documents',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({templateCode:'${code}',force:true,title:'ZZ5 seedtest ${code}',dateFrom:'2027-08-01',dateTo:'2027-08-15'})}).then(function(r){return r.text()}).then(function(t){return t.slice(0,150)})`);
    console.log(code, "create ->", r);
  }
  await s.page.waitForTimeout(3000);
  for (const code of ["hygiene", "health_check"]) {
    const doc = await db.journalDocument.findFirst({ where: { organizationId: state.orgA, title: "ZZ5 seedtest " + code }, select: { id: true, createdAt: true, autoFill: true } });
    if (!doc) { console.log(code, "not created"); continue; }
    const e = await db.journalDocumentEntry.findMany({ where: { documentId: doc.id }, select: { date: true, data: true } });
    const kinds: any = {}; for (const x of e) { const k = JSON.stringify(x.data); kinds[k] = (kinds[k] || 0) + 1; }
    console.log(code, doc.id, "autoFill=" + doc.autoFill, "entries=" + e.length, JSON.stringify(kinds).slice(0, 400));
    const dates = [...new Set(e.map(x => x.date.toISOString().slice(0, 10)))].sort();
    console.log("   dates:", dates.join(" "));
  }
  await s.close();
})();
