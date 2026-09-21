import { openTelegramSession } from "../tg-session";
import { shot, sleep } from "./lib";
const LINKS = String.raw`(()=>[...document.querySelectorAll('a[href]')].filter(a=>{const r=a.getBoundingClientRect();return r.width>0;}).map(a=>({h:a.getAttribute('href'),t:(a.innerText||'').replace(/[\n\t]+/g,' ').trim().slice(0,40)})))()`;
const EXTRA = ["/settings/users","/settings/permissions","/settings/journals","/settings/schedule","/settings/audit","/settings/integrations/tasksflow","/settings/billing","/settings/organization","/settings/notifications","/settings/journal-responsibles","/reports","/team","/capa","/batches","/plans","/competencies","/losses","/changes"];
(async () => {
  const role = process.argv[2] || "headA";
  const s = await openTelegramSession({ role, width: 390, height: 844, theme: "light" });
  const p = s.page;
  console.log("ДОМ:", p.url());
  await p.goto(s.base + "/mini/sections", { timeout: 300000 }); await sleep(p, 6000);
  await shot(p, "19-sections-" + role, true);
  const links = (await p.evaluate(LINKS)) as any[];
  const secLinks = links.filter(l => !["/mini/today","/mini/sections","/mini/me","/dashboard","/journals","/control-board"].includes(l.h) || true);
  console.log("=== пункты «Разделы» (" + role + ") ===");
  for (const l of links) console.log("  ", l.h, "|", l.t);
  const targets = Array.from(new Set(links.map(l => l.h).filter((h: string) => h && h.startsWith("/") && !h.startsWith("/mini"))));
  console.log("\n=== проверяем, открывается ли каждый ===");
  for (const href of targets) {
    await p.goto(s.base + href, { timeout: 300000 }).catch(()=>null); await sleep(p, 4500);
    const t = ((await p.evaluate(`document.body.innerText`).catch(()=>"?")) as string).replace(/\n+/g, " | ").slice(0, 160);
    console.log(`  ${href} → ${p.url().replace(s.base,"")} :: ${t}`);
  }
  console.log("\n=== адреса, которых в списке НЕТ ===");
  for (const href of EXTRA) {
    if (targets.includes(href)) { console.log(`  ${href} — есть в списке, пропуск`); continue; }
    await p.goto(s.base + href, { timeout: 300000 }).catch(()=>null); await sleep(p, 4500);
    const t = ((await p.evaluate(`document.body.innerText`).catch(()=>"?")) as string).replace(/\n+/g, " | ").slice(0, 160);
    console.log(`  ${href} → ${p.url().replace(s.base,"")} :: ${t}`);
  }
  console.log("ERRORS", JSON.stringify(s.errors.slice(0,15)));
  await s.close();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 1500)); process.exit(1); });
