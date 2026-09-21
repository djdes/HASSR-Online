import { openTelegramSession, db } from "../tg-session";
import { shot, sleep } from "./lib";
const T = `document.body.innerText`;
(async () => {
  const hyg = await db.journalDocument.findFirst({ where: { organizationId: "e2e-org-a", template: { code: "hygiene" }, status: "active" }, orderBy: { createdAt: "desc" } });
  const s = await openTelegramSession({ role: "managerA", width: 390, height: 844, theme: "light" });
  const p = s.page;
  await p.goto(s.base + `/journals/hygiene/documents/${hyg!.id}`, { timeout: 300000 }); await sleep(p, 12000);
  // управляющая заполняет строку ПОВАРА
  const r = await p.evaluate(String.raw`(()=>{const cards=[...document.querySelectorAll('div')].filter(e=>/Иван Повар/.test(e.innerText)&&e.innerText.length<200&&e.querySelector('button'));if(!cards.length)return 'нет карточки повара';const b=[...cards[cards.length-1].querySelectorAll('button')].find(b=>/Заполнить/.test(b.innerText));if(!b)return 'нет кнопки';b.scrollIntoView({block:'center'});b.click();return 'клик «'+b.innerText.trim()+'» в строке повара';})()`);
  console.log("управляющая по строке повара:", r); await sleep(p, 3000);
  await shot(p, "44-manager-fills-cook");
  console.log("лист:", ((await p.evaluate(T)) as string).replace(/\n+/g," | ").slice(-800));
  const mark = await p.evaluate(String.raw`(()=>{const b=[...document.querySelectorAll('button')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0}).map(e=>e.innerText.replace(/\s+/g,' ').trim());return b.slice(-20);})()`);
  console.log("кнопки листа:", JSON.stringify(mark));
  const pick = await p.evaluate(String.raw`(()=>{const b=[...document.querySelectorAll('button')].find(e=>/^Здоров|^Допущен|^Т$|^Г$/.test(e.innerText.trim()));return b?(b.click(),'выбрал: '+b.innerText.trim()):'нет отметки';})()`);
  console.log("отметка:", pick); await sleep(p, 4000);
  await shot(p, "44-after-mark");
  console.log("после отметки:", ((await p.evaluate(T)) as string).replace(/\n+/g," | ").slice(0, 400));
  // журнал действий
  await p.goto(s.base + "/settings/audit", { timeout: 300000 }); await sleep(p, 10000);
  await shot(p, "44-audit", true);
  console.log("=== журнал действий ===\n" + ((await p.evaluate(T)) as string).slice(0, 2200));
  console.log("ERRORS", JSON.stringify(s.errors.slice(0,8)));
  await s.close();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 1500)); process.exit(1); });
