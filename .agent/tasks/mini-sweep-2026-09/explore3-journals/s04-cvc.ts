import { openTelegramSession, SHOT, out } from "./lib";
(async () => {
  const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640 });
  // header zoom
  await s.page.goto(s.base + "/journals", { timeout: 300000, waitUntil: "domcontentloaded" });
  await s.page.waitForTimeout(3000);
  await s.page.screenshot({ path: SHOT + "/hdr.png", clip: { x: 0, y: 0, width: 360, height: 70 } });
  const hdr = await s.page.evaluate(`(function(){
    var els=[]; document.querySelectorAll('header *').forEach(function(e){ var b=e.getBoundingClientRect(); if(b.height>0) els.push({tag:e.tagName,cls:(e.className&&e.className.baseVal!==undefined?e.className.baseVal:e.className||'').toString().slice(0,60),txt:(e.textContent||'').trim().slice(0,30),x:Math.round(b.x),y:Math.round(b.y),w:Math.round(b.width),h:Math.round(b.height)}); }); return els.slice(0,25);
  })()`);
  console.log("HEADER", JSON.stringify(hdr, null, 1));
  // cvc journal - wait long
  for (const t of [3000, 8000, 15000]) {
    await s.page.goto(s.base + "/journals/cleaning_ventilation_checklist", { timeout: 300000, waitUntil: "domcontentloaded" });
    await s.page.waitForTimeout(t);
    const txt = await s.page.evaluate(`document.body.innerText.slice(0,900)`);
    console.log("--- wait", t, "->", JSON.stringify(txt));
  }
  await s.page.screenshot({ path: SHOT + "/j-cvc-after.png", fullPage: true });
  console.log("errors", s.errors);
  await s.close();
})();
