import { openTelegramSession, BASE } from "../tg-session";
async function main() {
  const s = await openTelegramSession({ role: "managerA", width: 360, height: 640 });
  const p = s.page;
  await p.goto(BASE + "/settings/users", { waitUntil: "domcontentloaded", timeout: 300000 });
  await p.waitForTimeout(7000);
  await p.evaluate(`(function(){var b=[].slice.call(document.querySelectorAll("button")).find(function(x){return x.innerText.indexOf("Пригласить по QR")>=0}); b.click();})()`);
  await p.waitForTimeout(3000);
  console.log(await p.evaluate(`(function(){
    var d = document.querySelector("[role=dialog]");
    var out = [];
    var n = d;
    while (n && n !== document.documentElement) {
      var cs = getComputedStyle(n);
      out.push(n.tagName + "#" + (n.id||"-") + "." + String(n.className).slice(0,40) +
        " pos=" + cs.position + " transform=" + cs.transform.slice(0,20) + " filter=" + cs.filter.slice(0,20) +
        " backdrop=" + (cs.backdropFilter||"none").slice(0,20) + " contain=" + cs.contain + " willChange=" + cs.willChange);
      n = n.parentElement;
    }
    return out;
  })()`));
  await s.close();
}
main().catch(e=>{console.error(e);process.exit(1)});
