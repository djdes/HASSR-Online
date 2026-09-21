import { openTelegramSession } from "../tg-session";
import { shot, sleep } from "./lib";
const T = `document.body.innerText`;
(async () => {
  const s = await openTelegramSession({ role: "managerA", width: 390, height: 844, theme: "light" });
  const p = s.page;
  await p.goto(s.base + "/reports", { timeout: 300000 }); await sleep(p, 11000);
  await p.evaluate(String.raw`(()=>{const b=[...document.querySelectorAll('button')].find(b=>/Выберите журнал/.test(b.innerText));b.scrollIntoView({block:'center'});b.click();})()`);
  await sleep(p, 1800);
  await p.evaluate(String.raw`(()=>{const o=[...document.querySelectorAll('[role=option]')].find(e=>/Гигиенический журнал/.test(e.innerText));o&&o.click();})()`);
  await sleep(p, 1500);
  const dates = p.locator("input[type=date]");
  const n = await dates.count();
  console.log("полей дат на странице:", n);
  await dates.nth(n - 2).fill("2026-09-01");
  await dates.nth(n - 1).fill("2026-09-21");
  await sleep(p, 1000);
  await shot(p, "39-form-filled");
  for (const name of ["PDF", "Excel"]) {
    const dl = p.waitForEvent("download", { timeout: 120000 }).catch(() => null);
    await p.evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.innerText.trim()==='Скачать ${name}');b.scrollIntoView({block:'center'});b.click();})()`);
    const d = await dl;
    console.log(name, "→", d ? d.suggestedFilename() : "НЕТ ФАЙЛА");
    await sleep(p, 3000);
    await shot(p, "39-after-" + name);
    const t = ((await p.evaluate(T)) as string);
    const i = t.indexOf("Сформировать отчёт");
    console.log("   блок формы:", t.slice(i, i + 300).replace(/\n+/g, " | "));
  }
  console.log("ERRORS", JSON.stringify(s.errors.slice(0,10)));
  await s.close();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 1500)); process.exit(1); });
