import { openTelegramSession, db } from "../tg-session";
import { shot, sleep } from "./lib";
import { releaseActive, claimScope } from "./claimlib";
const FIELDS = `(()=>{const vis=(e)=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0;};
 return {
  fields:[...document.querySelectorAll('input,textarea,select')].filter(vis).map(e=>({t:e.tagName,type:e.type,ph:e.placeholder||'',lbl:(e.closest('label')?.innerText||e.parentElement?.innerText||'').replace(/\s+/g,' ').slice(0,60)})),
  steps:[...document.querySelectorAll('button')].filter(vis).map(b=>b.innerText.replace(/\s+/g,' ').slice(0,50)),
  txt:document.body.innerText.replace(/\s+/g,' ')
 };})()`;
const CODES = ["hygiene","climate_control","finished_product","incoming_control","fryer_oil","disinfectant_usage","accident_journal","complaint_register","ppe_issuance","uv_lamp_runtime","equipment_maintenance","general_cleaning","product_writeoff","audit_plan","training_plan","glass_items_list","traceability_test","pest_control","intensive_cooling","metal_impurity","perishable_rejection","breakdown_history","glass_control","sanitary_day_control","equipment_calibration","equipment_cleaning","audit_protocol","audit_report","sanitation_day_control"];
(async () => {
  const s = await openTelegramSession({ role: "cookA", width: 360, height: 640, theme: "light" });
  const p = s.page;
  await p.goto(s.base + "/mini/today", { timeout: 300000 }); await sleep(p, 4000);
  for (const code of CODES) {
    await releaseActive(p);
    let cid: string | undefined;
    try {
      const c = await claimScope(p, code, "%%нет%%");
      cid = c.res.j?.claim?.id;
      if (!cid) { console.log(`\n### ${code}: не взялось`, JSON.stringify(c.res).slice(0,200)); continue; }
    } catch (e) { console.log(`\n### ${code}: ${String(e).slice(0,120)}`); continue; }
    await p.goto(s.base + "/mini/claim/" + cid, { timeout: 300000 }); await sleep(p, 2500);
    const d: any = await p.evaluate(FIELDS);
    console.log(`\n### ${code} claim=${cid}`);
    console.log("  поля:", JSON.stringify(d.fields));
    console.log("  текст:", d.txt.slice(0, 700));
    await shot(p, "05-" + code);
  }
  await releaseActive(p);
  console.log("\nERRORS", JSON.stringify(s.errors.slice(0,20)));
  await s.close();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 2000)); process.exit(1); });
