import { openTelegramSession, db } from "../tg-session";
import { shot, go, probe } from "./lib";
(async () => {
const s = await openTelegramSession({ role: "cookB", width: 360, height: 640 });
const p = s.page;
await go(p, s.base + "/mini/today", 4000);
await p.waitForFunction(`!/Загружаем/.test(document.body.innerText)`, { timeout: 120000 }).catch(()=>null);
await p.waitForTimeout(2000);
const api: any = await p.evaluate(`fetch('/api/mini/today',{cache:'no-store'}).then(r=>r.json())`);
console.log("cookB org today", api.dateKey, "groups", (api.groups||[]).length);
console.log("ERR?", JSON.stringify(api).slice(0,200));
await s.close();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 2000)); process.exit(1); });
