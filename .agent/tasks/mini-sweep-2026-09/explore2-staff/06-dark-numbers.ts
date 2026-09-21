import { openTelegramSession, db } from "../tg-session";
import { shot, sleep } from "./lib";
import { releaseActive, claimScope } from "./claimlib";
const TXT = `document.body.innerText.replace(/[\n\t ]+/g,' ')`;
(async () => {
  const s = await openTelegramSession({ role: "cookA", width: 390, height: 844, theme: "dark" });
  const p = s.page;
  await p.goto(s.base + "/mini/today", { timeout: 300000 }); await sleep(p, 5000);
  await shot(p, "06-today-dark");
  await releaseActive(p);
  const c = await claimScope(p, "climate_control", "");
  const cid = c.res.j?.claim?.id;
  await p.goto(s.base + "/mini/claim/" + cid, { timeout: 300000 }); await sleep(p, 4000);
  await shot(p, "06-climate-dark");
  // ввод с запятой и буквами
  const inputs = p.locator("input[type=number]");
  await inputs.nth(0).click();
  await inputs.nth(0).type("3,5", { delay: 80 });
  await sleep(p, 600);
  console.log("после 3,5 → value=", JSON.stringify(await inputs.nth(0).inputValue()));
  await shot(p, "06-comma");
  await inputs.nth(0).fill("");
  await inputs.nth(0).type("abc", { delay: 80 });
  console.log("после abc → value=", JSON.stringify(await inputs.nth(0).inputValue()));
  await shot(p, "06-letters");
  // submit с буквами: ожидаем внятное сообщение
  await p.evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>/^Заверш/.test(b.innerText.trim()));b&&b.click();})()`);
  await sleep(p, 2500);
  console.log("после submit(буквы):", ((await p.evaluate(TXT)) as string).slice(0, 500));
  await shot(p, "06-letters-submit");
  // нормальные значения
  await inputs.nth(0).fill("22");
  await inputs.nth(1).fill("55");
  await sleep(p, 500);
  console.log("подсказки:", ((await p.evaluate(TXT)) as string).slice(0, 400));
  await shot(p, "06-ok-values");
  console.log("ERRORS", JSON.stringify(s.errors));
  await s.close();
})().catch((e) => { console.log("FATAL", String(e).slice(0, 2000)); process.exit(1); });
