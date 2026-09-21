import { openTelegramSession, db } from "../tg-session";
import { shot, sleep, DUMP } from "./lib";
(async () => {
  const s = await openTelegramSession({ role: "cookA", width: 360, height: 640, theme: "light" });
  const p = s.page;
  // сбросить активные claim'ы повара, чтобы стартовать чисто
  console.log("URL после входа", p.url());
  await p.goto(s.base + "/mini/today", { timeout: 300000 });
  await sleep(p, 6000);
  const api = await p.evaluate(`fetch('/api/mini/today',{cache:'no-store'}).then(r=>r.json())`);
  console.log("TODAY API", JSON.stringify(api, null, 1).slice(0, 6000));
  await shot(p, "01-cookA-today", true);
  const d: any = await p.evaluate(DUMP);
  console.log("BODY", d.body);
  console.log("ERRORS", JSON.stringify(s.errors));
  await s.close();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 2000)); process.exit(1); });
