import { openTelegramSession, db, state } from "../tg-session";
import { shot, sleep, DUMP } from "./lib";
(async () => {
  const s = await openTelegramSession({ role: "cookA", width: 360, height: 640, theme: "light" });
  const p = s.page;
  const uid = state.users.cookA.id;
  await p.goto(s.base + "/mini/today", { timeout: 300000 });
  await sleep(p, 5000);
  // 1. Отпустить текущую задачу через API
  const my: any = await p.evaluate(`fetch('/api/journal-task-claims/my',{cache:'no-store'}).then(r=>r.json())`);
  console.log("MY ACTIVE", JSON.stringify(my));
  if (my?.claim?.id) {
    const r = await p.evaluate(`fetch('/api/journal-task-claims/${my.claim.id}',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'release'})}).then(r=>r.status)`);
    console.log("release status", r);
  }
  await p.reload({ timeout: 300000 }); await sleep(p, 4000);
  // 2. Взять холодильник
  const card = p.locator("li,div").filter({ hasText: "Холодильник QR E2E — Утро" });
  const btn = p.getByRole("button", { name: "Взять" }).nth(4);
  // найдём кнопку рядом с нужным текстом
  const idx = await p.evaluate(`(()=>{const bs=[...document.querySelectorAll('button')].filter(b=>b.innerText.trim()==='Взять');
    const i=bs.findIndex(b=>{let n=b.parentElement;for(let k=0;k<5&&n;k++,n=n.parentElement){if(n.innerText.includes('Холодильник QR E2E — Утро'))return true;}return false;});return i;})()`);
  console.log("btn index", idx);
  await p.getByRole("button", { name: "Взять" }).nth(idx as number).click();
  await sleep(p, 5000);
  console.log("URL", p.url());
  await shot(p, "02-cold-claim-top");
  const d: any = await p.evaluate(DUMP);
  console.log("BODY\n", d.body);
  console.log("CONTROLS", JSON.stringify(d.btns, null, 1));
  await shot(p, "02-cold-claim-full", true);
  // 3. Нажать Завершить без единой отметки
  const fin = p.getByRole("button", { name: /Завершить/ }).first();
  await fin.click();
  await sleep(p, 3000);
  console.log("AFTER EMPTY SUBMIT body:", (await p.evaluate(`document.body.innerText`) as string).replace(/\s+/g," ").slice(0,600));
  await shot(p, "02-cold-empty-submit");
  console.log("ERRORS", JSON.stringify(s.errors));
  await s.close();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 2000)); process.exit(1); });
