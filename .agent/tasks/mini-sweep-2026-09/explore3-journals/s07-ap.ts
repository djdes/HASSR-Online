import { openTelegramSession, SHOT } from "./lib";
(async () => {
  const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640 });
  for (let i = 0; i < 2; i++) {
    await s.page.goto(s.base + "/journals/audit_protocol", { timeout: 300000, waitUntil: "domcontentloaded" });
    await s.page.waitForTimeout(3500);
    const before = s.page.url();
    const btn = s.page.locator('button:has-text("Создать документ"), a:has-text("Создать документ")').first();
    const tag = await btn.evaluate("e => e.tagName + ' href=' + (e.getAttribute('href')||'') + ' disabled=' + e.disabled");
    console.log("attempt", i, "button:", tag);
    await btn.click();
    await s.page.waitForTimeout(3500);
    console.log("  url:", s.page.url(), "dialog:", await s.page.evaluate(`!!document.querySelector('[role="dialog"]')`));
    console.log("  body:", await s.page.evaluate(`document.body.innerText.slice(0,300).replace(/\n/g,' | ')`));
    await s.page.screenshot({ path: SHOT + `/ap-click-${i}.png` });
  }
  console.log("errors", s.errors);
  await s.close();
})();
