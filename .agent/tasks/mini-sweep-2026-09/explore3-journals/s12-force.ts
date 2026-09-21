import { openTelegramSession, out, db, state } from "./lib";
const MISSING = ["cleaning_ventilation_checklist", "cleaning", "general_cleaning", "incoming_control", "disinfectant_usage", "incoming_raw_materials_control", "uv_lamp_runtime"];
(async () => {
  const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640 });
  await s.page.goto(s.base + "/journals", { timeout: 300000, waitUntil: "domcontentloaded" });
  await s.page.waitForTimeout(3000);
  for (const code of MISSING) {
    const r = await s.page.evaluate(`fetch('/api/journal-documents',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({templateCode:'${code}',force:true,title:'ZZ5 ${code}',dateFrom:'2027-05-01',dateTo:'2027-05-31'})}).then(function(r){return r.status+' '+r.text?'':''}).catch(function(e){return 'err '+e})`);
    await s.page.waitForTimeout(500);
    console.log(code, r);
  }
  const zz = await db.journalDocument.findMany({ where: { organizationId: state.orgA, title: { contains: "ZZ5" } }, select: { id: true, title: true, template: { select: { code: true } } } });
  console.log("total ZZ5:", zz.length);
  await s.close();
})();
