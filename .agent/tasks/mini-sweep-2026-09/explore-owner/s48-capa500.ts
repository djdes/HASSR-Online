import { openTelegramSession } from "../tg-session";
import { shot, probe } from "./lib";
async function main() {
const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640, theme: "light" });
const p = s.page;
p.on("response", async r => { if (/\/capa/.test(r.url())) console.log("RES " + r.status() + " " + r.request().method() + " " + r.url().replace(s.base,"")); });
for (let i=0;i<3;i++) {
  await p.goto(s.base + "/capa/new", { waitUntil: "load", timeout: 300000 }).catch(e=>console.log("goto err"));
  await p.waitForTimeout(8000);
  const pr: any = await probe(p);
  console.log("iter " + i + " url=" + pr.url + " head=" + JSON.stringify(pr.heads[0]) + " len=" + pr.bodyText.length);
  await p.goto(s.base + "/capa", { waitUntil: "load", timeout: 300000 });
  await p.waitForTimeout(5000);
}
console.log("ERRORS", s.errors);
await s.close();
}
main().then(()=>process.exit(0), e=>{console.error(e); process.exit(1);});
