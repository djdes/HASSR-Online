import { openTelegramSession, db, state } from "../tg-session";
import { shot, sleep } from "./lib";
const T = `document.body.innerText`;
const OLD = "cmuaapdgk008occ9mzpzb7syc";
(async () => {
  const rows = await db.journalTaskClaim.findMany({ where: { organizationId: "e2e-org-a", userId: state.users.cleanerA.id, status: "active" }, select: { id: true, dateKey: true, scopeLabel: true } });
  console.log("активных задач у уборщицы:", rows.length, JSON.stringify(rows));
  const s = await openTelegramSession({ role: "cleanerA", width: 390, height: 844, theme: "light" });
  const p = s.page;
  await p.goto(s.base + "/mini/claim/" + OLD, { timeout: 300000 }); await sleep(p, 8000);
  console.log("=== экран вчерашней задачи ===\n" + ((await p.evaluate(T)) as string).slice(0, 500));
  await shot(p, "43-orphan-claim");
  const my: any = await p.evaluate(`fetch('/api/journal-task-claims/my',{cache:'no-store'}).then(r=>r.json())`);
  console.log("/my отдаёт:", JSON.stringify(my?.claim ? { id: my.claim.id, dateKey: my.claim.dateKey } : null));
  console.log("ERRORS", JSON.stringify(s.errors.slice(0,8)));
  await s.close();
  // прибираю за собой: сегодняшний claim уборщицы возвращаю
  const mine = await db.journalTaskClaim.findFirst({ where: { organizationId: "e2e-org-a", userId: state.users.cleanerA.id, status: "active", dateKey: new Date("2026-09-21T00:00:00.000Z") } });
  if (mine) { await db.journalTaskClaim.delete({ where: { id: mine.id } }); console.log("удалил созданный мной сегодняшний claim уборщицы"); }
  await db.$disconnect();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 1500)); process.exit(1); });
