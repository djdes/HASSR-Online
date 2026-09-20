import { openTelegramSession, BASE } from "../tg-session";
const SHOTS = "C:/Users/Yaroslav/AppData/Local/Temp/18/claude/d--www-Wesetup-ru/aa63a183-7b19-487e-8461-b751f0f1c337/scratchpad/explore-mgmt";
const NAVST = `(function(){
  var want = ["/dashboard","/journals","/mini/sections","/mini/me","/control-board"];
  var items = [].slice.call(document.querySelectorAll("a")).filter(function(x){ return want.indexOf(x.getAttribute("href")) >= 0; });
  return { back: window.__tgHost.backVisible, url: location.pathname,
    nav: items.map(function(x){ var s = getComputedStyle(x); return x.getAttribute("href") + " | " + (x.getAttribute("aria-current")||"-") + " | " + s.color + " | " + s.backgroundColor; }) };
})()`;

async function main() {
  const role = process.argv[2] || "headA";
  const paths = process.argv.slice(3);
  const s = await openTelegramSession({ role, width: 390, height: 844 });
  const p = s.page;
  for (const path of paths) {
    await p.goto(BASE + path, { waitUntil: "domcontentloaded", timeout: 300000 });
    await p.waitForTimeout(4000);
    console.log(path, "=>", JSON.stringify(await p.evaluate(NAVST)));
  }
  // back с вложенной
  await p.goto(BASE + "/settings/users", { waitUntil: "domcontentloaded", timeout: 300000 });
  await p.waitForTimeout(3500);
  await p.goto(BASE + "/settings/equipment", { waitUntil: "domcontentloaded", timeout: 300000 });
  await p.waitForTimeout(3500);
  console.log("на /settings/equipment back=", await p.evaluate(`window.__tgHost.backVisible`));
  await s.pressTelegramBack();
  await p.waitForTimeout(3500);
  console.log("после back:", p.url().replace(BASE, ""));
  await s.pressTelegramBack();
  await p.waitForTimeout(3500);
  console.log("после back 2:", p.url().replace(BASE, ""));
  // reload
  await p.reload({ waitUntil: "domcontentloaded", timeout: 300000 });
  await p.waitForTimeout(4000);
  console.log("после reload:", p.url().replace(BASE, ""), JSON.stringify(await p.evaluate(NAVST)));
  console.log("ERRORS", JSON.stringify([...new Set(s.errors)], null, 1));
  await s.close();
}
main().catch(e => { console.error(e); process.exit(1); });
