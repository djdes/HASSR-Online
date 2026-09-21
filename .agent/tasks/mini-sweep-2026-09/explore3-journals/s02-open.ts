import { openTelegramSession, SHOT } from "./lib";
(async () => {
  const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640 });
  console.log("user", s.user.name, s.user.role, s.user.organizationId, "url:", s.page.url());
  await s.page.screenshot({ path: SHOT + "/01-home.png" });
  for (const u of ["/mini/journals", "/journals", "/journals/hygiene", "/mini/journals/hygiene"]) {
    try {
      await s.page.goto(s.base + u, { timeout: 300000, waitUntil: "domcontentloaded" });
      await s.page.waitForTimeout(4000);
      await s.page.waitForLoadState("domcontentloaded").catch(()=>null);
      const info = await s.page.evaluate(`(function(){
        return { url: location.pathname, h1: Array.from(document.querySelectorAll('h1,h2')).slice(0,4).map(function(e){return e.textContent.trim().slice(0,60)}), nav: !!document.querySelector('nav'), head: document.body.innerText.slice(0,500) };
      })()`);
      console.log("=== ", u, "->", JSON.stringify(info, null, 1));
      await s.page.screenshot({ path: SHOT + "/02" + u.replace(/\//g, "_") + ".png" });
    } catch (e) { console.log("ERR", u, String(e).slice(0, 150)); }
  }
  console.log("errors:", s.errors.slice(0, 20));
  await s.close();
})();
