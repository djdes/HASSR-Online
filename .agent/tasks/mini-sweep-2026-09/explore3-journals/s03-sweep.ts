import { openTelegramSession, SHOT, out } from "./lib";
import { CODES } from "./codes";
(async () => {
  const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640 });
  const res: any[] = [];
  for (const code of CODES) {
    const r: any = { code };
    try {
      await s.page.goto(s.base + "/journals/" + code, { timeout: 300000, waitUntil: "domcontentloaded" });
      await s.page.waitForTimeout(2500);
      const info: any = await s.page.evaluate(`(function(){
        var t = document.body.innerText;
        var over = [];
        document.querySelectorAll('*').forEach(function(e){
          var b = e.getBoundingClientRect();
          if (b.width>0 && b.right > 361.5 && b.left < 360 && e.children.length===0) over.push((e.tagName)+':'+(e.textContent||'').trim().slice(0,30)+'|r='+Math.round(b.right));
        });
        return { h1: (document.querySelector('h1')||{textContent:''}).textContent.trim(),
          docW: document.documentElement.scrollWidth,
          btns: Array.from(document.querySelectorAll('button,a')).map(function(e){return (e.textContent||'').trim().slice(0,40)}).filter(Boolean).slice(0,40),
          text: t.slice(0, 1800), over: over.slice(0,8) };
      })()`);
      r.info = info;
      await s.page.screenshot({ path: SHOT + "/j-" + code + ".png", fullPage: true });
    } catch (e) { r.err = String(e).slice(0, 200); }
    res.push(r);
    console.log(code, r.err ? "ERR " + r.err : "w=" + r.info.docW + " over=" + r.info.over.length);
  }
  out("sweep-journals.json", res);
  out("sweep-errors.json", s.errors);
  console.log("errors:", s.errors.length);
  await s.close();
})();
