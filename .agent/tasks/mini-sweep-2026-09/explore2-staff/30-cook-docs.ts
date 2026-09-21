import { openTelegramSession, db } from "../tg-session";
import { shot, sleep } from "./lib";
const T = `document.body.innerText`;
(async () => {
  const docs = await db.journalDocument.findMany({ where: { organizationId: "e2e-org-a", status: "active" }, include: { template: { select: { code: true, name: true } } }, orderBy: { createdAt: "desc" } });
  console.log("документов:", docs.length);
  const s = await openTelegramSession({ role: "cookA", width: 360, height: 640, theme: "light" });
  const p = s.page;
  const bad: string[] = [];
  for (const d of docs) {
    const url = `/journals/${d.template.code}/documents/${d.id}`;
    await p.goto(s.base + url, { timeout: 300000 }).catch(()=>null); await sleep(p, 5500);
    const txt = ((await p.evaluate(T).catch(()=>"?")) as string);
    const hasAuto = /Автоматически заполнять журнал/.test(txt);
    const hasSet = /Настройки журнала/.test(txt);
    const denied = /не открыт|Нет доступа|Страница не найдена|доступно руководителю/i.test(txt);
    console.log(`${d.template.code.padEnd(26)} ${denied ? "ЗАКРЫТ" : "открыт"} авто=${hasAuto} настройки=${hasSet} | ${d.title.slice(0,40)}`);
    if (hasAuto || hasSet) { bad.push(d.template.code + " " + d.id); await shot(p, "30-bad-" + d.template.code); }
  }
  console.log("\nЖУРНАЛЫ С ЗАПРЕЩЁННЫМИ КНОПКАМИ:", JSON.stringify(bad));
  console.log("ERRORS", JSON.stringify(s.errors.slice(0,10)));
  await s.close();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 1500)); process.exit(1); });
