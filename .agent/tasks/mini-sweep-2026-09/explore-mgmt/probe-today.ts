import { openTelegramSession, BASE } from "../tg-session";
async function main() {
  const s = await openTelegramSession({ role: "cookA", width: 360, height: 640 });
  await s.page.goto(BASE + "/mini/today", { waitUntil: "domcontentloaded", timeout: 300000 });
  await s.page.waitForTimeout(4000);
  const r = await s.page.evaluate(`(function(){
    var out=[];
    document.querySelectorAll("*").forEach(function(el){
      if(el.children.length===0 && /infectant/.test(el.textContent||"")) out.push({tag:el.tagName, cls:String(el.className).slice(0,120), html:el.innerHTML.slice(0,300), text:el.textContent, inner:el.innerText, codes:[...el.textContent].map(function(c){return c.charCodeAt(0)}).join(",")});
    });
    return out;
  })()`);
  console.log(JSON.stringify(r, null, 1));
  await s.close();
}
main().catch(e=>{console.error(e);process.exit(1)});
