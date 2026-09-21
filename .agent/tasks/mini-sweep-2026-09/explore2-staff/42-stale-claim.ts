import { openTelegramSession, db, state } from "../tg-session";
import { shot, sleep } from "./lib";
const T = `document.body.innerText`;
(async () => {
  const s = await openTelegramSession({ role: "cleanerA", width: 390, height: 844, theme: "light" });
  const p = s.page;
  await p.goto(s.base + "/mini/today", { timeout: 300000 }); await sleep(p, 9000);
  await shot(p, "42-cleaner-today", true);
  console.log("=== Сегодня у уборщицы ===\n" + ((await p.evaluate(T)) as string).slice(0, 1200));
  const my: any = await p.evaluate(`fetch('/api/journal-task-claims/my',{cache:'no-store'}).then(r=>r.json())`);
  console.log("активная (какой даты):", JSON.stringify(my?.claim ? { id: my.claim.id, dateKey: my.claim.dateKey, label: my.claim.scopeLabel } : null));
  // пробуем взять сегодняшнюю задачу
  const today: any = await p.evaluate(`fetch('/api/mini/today',{cache:'no-store'}).then(r=>r.json())`);
  const g = today.groups.find((x: any) => x.code === "cleaning");
  const sc = g?.scopes?.find((x: any) => x.availability === "available");
  console.log("сегодняшняя уборка свободна:", JSON.stringify(sc?.scopeKey));
  if (sc) {
    const body = JSON.stringify({ journalCode: "cleaning", scopeKey: sc.scopeKey, scopeLabel: sc.scopeLabel, dateKey: today.dateKey });
    const r: any = await p.evaluate(`fetch('/api/journal-task-claims',{method:'POST',headers:{'Content-Type':'application/json'},body:${JSON.stringify(body)}}).then(async r=>({s:r.status,j:await r.json()}))`);
    console.log("попытка взять сегодняшнюю:", JSON.stringify(r).slice(0, 300));
  }
  console.log("ERRORS", JSON.stringify(s.errors.slice(0,8)));
  await s.close();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 1500)); process.exit(1); });
