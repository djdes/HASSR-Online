import { openTelegramSession, db, state } from "../tg-session";
import { shot, sleep } from "./lib";
const T = `document.body.innerText`;
(async () => {
  const s = await openTelegramSession({ role: "cookA", width: 390, height: 844, theme: "light" });
  const p = s.page;
  await p.goto(s.base + "/mini/today", { timeout: 300000 }); await sleep(p, 7000);
  console.log("=== Сегодня при больничном ===\n" + ((await p.evaluate(T)) as string).slice(0, 900));
  await shot(p, "25-cook-sick-today");
  await p.goto(s.base + "/mini/me", { timeout: 300000 }); await sleep(p, 7000);
  console.log("=== Профиль ===\n" + ((await p.evaluate(T)) as string).slice(0, 1200));
  await shot(p, "25-cook-me", true);
  console.log("ERRORS", JSON.stringify(s.errors.slice(0,8)));
  await s.close();
  // вернуть как было — удалить смену
  await db.workShift.deleteMany({ where: { userId: state.users.cookA.id, date: new Date("2026-09-21T00:00:00.000Z") } });
  console.log("смена повара удалена (вернул как было)");
  await db.$disconnect();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 1500)); process.exit(1); });
