import { openTelegramSession, SHOT, out, db, state } from "./lib";
import fs from "node:fs";
const ZZ = JSON.parse(fs.readFileSync(SHOT + "/zz5.json", "utf8"));
(async () => {
  const s = await openTelegramSession({ role: "cookA", width: 360, height: 640 });
  const hy = ZZ["hygiene"][0].id, cold = ZZ["cold_equipment_control"][0].id;
  const mariaId = state.users.managerA.id, cookId = state.users.cookA.id;
  await s.page.goto(`${s.base}/journals/hygiene/documents/${hy}`, { timeout: 300000, waitUntil: "domcontentloaded" });
  await s.page.waitForTimeout(6000);
  const tries: any = {
    "чужая строка сегодня": { url: `/api/journal-documents/${hy}/entries`, m: "PUT", b: { employeeId: mariaId, date: "2026-09-21", data: { status: "healthy", temperatureAbove37: false } } },
    "своя строка прошлый день": { url: `/api/journal-documents/${hy}/entries`, m: "PUT", b: { employeeId: cookId, date: "2026-09-17", data: { status: "healthy", temperatureAbove37: false } } },
    "своя строка завтра": { url: `/api/journal-documents/${hy}/entries`, m: "PUT", b: { employeeId: cookId, date: "2026-09-22", data: { status: "healthy", temperatureAbove37: false } } },
    "своя строка сегодня": { url: `/api/journal-documents/${hy}/entries`, m: "PUT", b: { employeeId: cookId, date: "2026-09-21", data: { status: "healthy", temperatureAbove37: false } } },
    "холод прошлый день": { url: `/api/journal-documents/${cold}/entries`, m: "PUT", b: { employeeId: cookId, date: "2026-09-17", data: { temperatures: { "cold-equipment-6e2b43c7-4da6-460a-8386-2103674ea256": 99 } } } },
    "закрыть документ": { url: `/api/journal-documents/${hy}`, m: "PATCH", b: { status: "closed" } },
  };
  for (const k of Object.keys(tries)) {
    const t = tries[k];
    const r = await s.page.evaluate(`(async function(){var r=await fetch(${JSON.stringify(t.url)},{method:${JSON.stringify(t.m)},headers:{'Content-Type':'application/json'},body:${JSON.stringify(JSON.stringify(t.b))}}); return r.status+' '+(await r.text()).slice(0,200);})()`);
    console.log("###", k, "->", r);
  }
  await s.close();
})();
