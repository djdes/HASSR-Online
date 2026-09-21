import { openTelegramSession, db } from "../tg-session";
import { shot, sleep } from "./lib";
import { releaseActive, claimScope } from "./claimlib";
import fs from "node:fs";
const TXT = "document.body.innerText";
const SHOT = "C:/Users/Yaroslav/AppData/Local/Temp/18/claude/d--www-Wesetup-ru/aa63a183-7b19-487e-8461-b751f0f1c337/scratchpad/explore2-staff/";
(async () => {
  // подготовим файлы
  const gif = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");
  fs.writeFileSync(SHOT + "t.gif", gif);
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
  fs.writeFileSync(SHOT + "t.png", png);
  const big = Buffer.alloc(6 * 1024 * 1024);
  for (let i = 0; i < big.length; i++) big[i] = (Math.random() * 255) | 0;
  Buffer.from("\xff\xd8\xff\xe0", "binary").copy(big, 0);
  fs.writeFileSync(SHOT + "big.jpg", big);

  const s = await openTelegramSession({ role: "cleanerA", width: 360, height: 640, theme: "light" });
  const p = s.page;
  await p.goto(s.base + "/mini/today", { timeout: 300000 }); await sleep(p, 5000);
  const my: any = await p.evaluate(`fetch('/api/journal-task-claims/my',{cache:'no-store'}).then(r=>r.json())`);
  console.log("активная уборщицы:", JSON.stringify(my?.claim ?? null).slice(0,300));
  let cid = my?.claim?.id;
  if (!cid || my.claim.journalCode !== "cleaning") {
    await releaseActive(p);
    const c = await claimScope(p, "cleaning", "");
    cid = c.res.j?.claim?.id; console.log("взяли", JSON.stringify(c.res).slice(0,200));
  }
  await p.goto(s.base + "/mini/claim/" + cid, { timeout: 300000 }); await sleep(p, 5000);
  await shot(p, "08-cleaning-full", true);
  console.log("=== текст ===\n" + ((await p.evaluate(TXT)) as string).slice(0, 1600));
  const btn = () => p.evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>/Заверш|Нужно фото/.test(b.innerText));return b?{t:b.innerText.trim(),dis:b.disabled}:null;})()`);
  console.log("кнопка:", JSON.stringify(await btn()));
  const fileInput = p.locator('input[type=file]');
  console.log("файловых полей:", await fileInput.count());
  // GIF
  await fileInput.first().setInputFiles(SHOT + "t.gif"); await sleep(p, 3000);
  console.log("после GIF:", ((await p.evaluate(TXT)) as string).replace(/\n+/g, " | ").slice(0, 900));
  await shot(p, "08-gif-error");
  // big jpg
  await fileInput.first().setInputFiles(SHOT + "big.jpg"); await sleep(p, 6000);
  console.log("после 6МБ:", ((await p.evaluate(TXT)) as string).replace(/\n+/g, " | ").slice(0, 900));
  await shot(p, "08-big-error");
  // png ok
  await fileInput.first().setInputFiles(SHOT + "t.png"); await sleep(p, 4000);
  console.log("после PNG:", ((await p.evaluate(TXT)) as string).replace(/\n+/g, " | ").slice(0, 700));
  console.log("кнопка после фото:", JSON.stringify(await btn()));
  await shot(p, "08-photo-ok");
  console.log("ERRORS", JSON.stringify(s.errors));
  await s.close();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 2000)); process.exit(1); });
