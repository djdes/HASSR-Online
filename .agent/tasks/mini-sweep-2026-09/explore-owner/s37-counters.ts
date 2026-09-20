import { openTelegramSession } from "../tg-session";
import { shot, probe } from "./lib";
async function main() {
const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640, theme: "light" });
const p = s.page;
const grab = async (u: string, re: RegExp, wait=10000) => {
  await p.goto(s.base + u, { waitUntil: "load", timeout: 300000 });
  await p.waitForTimeout(wait);
  const pr: any = await probe(p);
  const m = pr.bodyText.match(re);
  return { url: u, matched: m ? m.slice(0,4) : null, head: pr.heads[0] };
};
console.log(JSON.stringify(await grab("/dashboard", /Обязательные журналы\s*(\S+)/)));
console.log(JSON.stringify(await grab("/journals", /Заполнено сегодня\s*(\S+)/)));
console.log(JSON.stringify(await grab("/journals-progress", /(\d+ журналов ждут)/)));
console.log(JSON.stringify(await grab("/control-board", /Прогресс дня: ([^\n]*)/)));
// dashboard detail
await p.goto(s.base + "/dashboard", { waitUntil: "load", timeout: 300000 }); await p.waitForTimeout(10000);
const pr: any = await probe(p);
console.log("dashboard first 40 lines:\n" + pr.bodyText.split("\n").slice(0,45).join("\n"));
await shot(p, "cnt-dashboard");
console.log("ERRORS", s.errors);
await s.close();
}
main().then(()=>process.exit(0), e=>{console.error(e); process.exit(1);});
