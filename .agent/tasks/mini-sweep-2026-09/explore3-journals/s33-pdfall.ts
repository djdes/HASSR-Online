import { openTelegramSession, SHOT, out } from "./lib";
import fs from "node:fs";
const ZZ = JSON.parse(fs.readFileSync(SHOT + "/zz5.json", "utf8"));
(async () => {
  const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640 });
  await s.page.goto(s.base + "/journals", { timeout: 300000, waitUntil: "domcontentloaded" });
  await s.page.waitForTimeout(3000);
  const res: any = {};
  for (const code of Object.keys(ZZ)) {
    const id = ZZ[code][0].id;
    try {
      const r: any = await s.page.evaluate(`(async function(){
        var t0=Date.now(); var r=await fetch('/api/journal-documents/${id}/pdf');
        if(r.status!==200) return {status:r.status, txt:(await r.text()).slice(0,200), ms:Date.now()-t0};
        var b=new Uint8Array(await r.arrayBuffer()); var bin=''; for(var i=0;i<b.length;i++) bin+=String.fromCharCode(b[i]);
        return {status:200, ct:r.headers.get('content-type'), len:b.length, ms:Date.now()-t0, b64:btoa(bin)};
      })()`);
      if (r.status === 200) fs.writeFileSync(SHOT + "/pdf-" + code + ".pdf", Buffer.from(r.b64, "base64"));
      res[code] = { status: r.status, len: r.len, ms: r.ms, ct: r.ct, txt: r.txt };
      console.log(code, r.status, r.ct || "", "bytes=" + (r.len || 0), (r.ms || 0) + "ms", r.txt || "");
    } catch (e) { console.log(code, "ERR", String(e).slice(0, 120)); }
  }
  out("pdfs.json", res);
  await s.close();
})();
