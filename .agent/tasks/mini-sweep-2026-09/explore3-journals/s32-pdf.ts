import { openTelegramSession, SHOT } from "./lib";
import fs from "node:fs";
const ZZ = JSON.parse(fs.readFileSync(SHOT + "/zz5.json", "utf8"));
(async () => {
  const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640 });
  await s.page.goto(s.base + "/journals", { timeout: 300000, waitUntil: "domcontentloaded" });
  await s.page.waitForTimeout(3000);
  for (const code of ["complaint_register", "cold_equipment_control", "cleaning_ventilation_checklist", "pest_control"]) {
    const id = ZZ[code][0].id;
    const r: any = await s.page.evaluate(`(async function(){
      var t0=Date.now();
      var r=await fetch('/api/journal-documents/${id}/pdf');
      var ct=r.headers.get('content-type'); var buf=await r.arrayBuffer();
      var b=new Uint8Array(buf); var bin=''; for(var i=0;i<b.length;i++) bin+=String.fromCharCode(b[i]);
      return {status:r.status, ct:ct, len:b.length, ms:Date.now()-t0, b64: btoa(bin)};
    })()`);
    if (r.status === 200 && r.b64) fs.writeFileSync(SHOT + "/pdf-" + code + ".pdf", Buffer.from(r.b64, "base64"));
    console.log(code, r.status, r.ct, "bytes=" + r.len, r.ms + "ms");
  }
  await s.close();
})();
