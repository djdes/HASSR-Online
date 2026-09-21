import { openTelegramSession, db, state } from "../tg-session";
import { shot, sleep } from "./lib";
const T = `document.body.innerText`;
(async () => {
  const s = await openTelegramSession({ role: "managerA", width: 390, height: 844, theme: "light" });
  const p = s.page;
  await p.goto(s.base + "/reports", { timeout: 300000 }); await sleep(p, 10000);
  await shot(p, "37-reports", true);
  console.log("=== /reports ===\n" + ((await p.evaluate(T)) as string).slice(0, 1800));
  const btns = await p.evaluate(String.raw`(()=>[...document.querySelectorAll('button,a[href],select,input')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0}).map(e=>({tag:e.tagName,t:(e.innerText||e.value||'').replace(/\s+/g,' ').trim().slice(0,40),h:e.getAttribute('href'),ty:e.type})).slice(0,40))()`);
  console.log("контролы:", JSON.stringify(btns));
  // скачивание PDF/Excel
  for (const name of ["PDF", "Excel"]) {
    const dl = p.waitForEvent("download", { timeout: 60000 }).catch(() => null);
    const r = await p.evaluate(String.raw`(()=>{const b=[...document.querySelectorAll('button,a')].find(b=>new RegExp('` + name + String.raw`','i').test(b.innerText));return b?(b.click(),'клик: '+b.innerText.replace(/\s+/g,' ').trim()):'нет кнопки';})()`);
    console.log(name, "→", r);
    const d = await dl;
    console.log("  скачалось:", d ? d.suggestedFilename() : "НЕТ ФАЙЛА");
    await sleep(p, 3000);
    console.log("  экран:", ((await p.evaluate(T)) as string).replace(/\n+/g," | ").slice(0, 250));
  }
  // поделиться по email
  const sh = await p.evaluate(String.raw`(()=>{const b=[...document.querySelectorAll('button')].find(b=>/Поделиться по email/.test(b.innerText));return b?(b.click(),'клик'):'нет кнопки';})()`);
  console.log("Поделиться по email:", sh); await sleep(p, 2500);
  await shot(p, "37-share-email");
  console.log("окно:", ((await p.evaluate(T)) as string).replace(/\n+/g," | ").slice(0, 600));
  // по сотруднику
  await p.goto(s.base + "/reports/by-user/" + state.users.cookA.id, { timeout: 300000 }).catch(()=>null); await sleep(p, 9000);
  await shot(p, "37-by-user", true);
  console.log("=== /reports/by-user ===\n" + ((await p.evaluate(T).catch(()=>"?")) as string).slice(0, 1200));
  console.log("ERRORS", JSON.stringify(s.errors.slice(0,10)));
  await s.close();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 1500)); process.exit(1); });
