import { openTelegramSession } from "../tg-session";
import { shot, sleep } from "./lib";
const T = `document.body.innerText`;
(async () => {
  const s = await openTelegramSession({ role: "headA", width: 390, height: 844, theme: "light" });
  const p = s.page;
  for (const u of ["/team", "/mercury", "/settings/permissions", "/settings/journals"]) {
    await p.goto(s.base + u, { timeout: 300000 }).catch(()=>null); await sleep(p, 7000);
    console.log(`\n=== ${u} → ${p.url().replace(s.base,"")} ===\n` + ((await p.evaluate(T).catch(()=>"?")) as string).slice(0, 1200));
    await shot(p, "20" + u.replace(/\//g, "-"), true);
  }
  // может ли заведующая реально менять права / набор журналов?
  const r1 = await p.evaluate(`fetch('/api/settings/permissions',{method:'GET'}).then(async r=>r.status+' '+(await r.text()).slice(0,120)).catch(e=>'err '+e)`);
  console.log("\nGET /api/settings/permissions:", r1);
  const r2 = await p.evaluate(`fetch('/api/settings/journals',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({disabledCodes:[]})}).then(async r=>r.status+' '+(await r.text()).slice(0,200)).catch(e=>'err '+e)`);
  console.log("POST /api/settings/journals:", r2);
  console.log("ERRORS", JSON.stringify(s.errors.slice(0,10)));
  await s.close();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 1500)); process.exit(1); });
