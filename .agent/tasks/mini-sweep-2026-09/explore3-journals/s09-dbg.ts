import { openTelegramSession, SHOT } from "./lib";
(async () => {
  const s = await openTelegramSession({ role: "ownerA", width: 360, height: 640 });
  const net: any[] = [];
  s.page.on("request", (r) => { if (r.method() !== "GET" && !/_next/.test(r.url())) net.push({ m: r.method(), u: r.url().replace(s.base, ""), body: (r.postData() || "").slice(0, 400) }); });
  s.page.on("response", async (r) => { if (r.request().method() !== "GET" && !/_next/.test(r.url())) { let t = ""; try { t = (await r.text()).slice(0, 400); } catch {} net.push({ resp: r.status(), u: r.url().replace(s.base, ""), t }); } });
  for (const code of ["hygiene", "ppe_issuance"]) {
    net.length = 0;
    await s.page.goto(s.base + "/journals/" + code, { timeout: 300000, waitUntil: "domcontentloaded" });
    await s.page.waitForTimeout(3000);
    await s.page.locator('button:has-text("Создать документ"), a:has-text("Создать документ")').first().click({ timeout: 20000 });
    await s.page.waitForSelector('[role="dialog"]', { timeout: 30000 });
    await s.page.waitForTimeout(1500);
    const ti = s.page.locator('[role="dialog"] input[type="text"], [role="dialog"] input:not([type])').first();
    await ti.fill("ZZ5 " + code);
    await s.page.screenshot({ path: SHOT + `/dbg-${code}-before.png` });
    const create = s.page.locator('[role="dialog"] button:has-text("Создать")').last();
    console.log(code, "createBtn:", await create.evaluate("e=>e.outerHTML.slice(0,200)"));
    await create.click({ timeout: 20000 });
    await s.page.waitForTimeout(5000);
    await s.page.screenshot({ path: SHOT + `/dbg-${code}-after.png` });
    console.log(code, "dialog?", await s.page.evaluate(`!!document.querySelector('[role="dialog"]')`));
    console.log(code, "dlgText:", await s.page.evaluate(`document.querySelector('[role="dialog"]') ? document.querySelector('[role="dialog"]').innerText.slice(0,600) : document.body.innerText.slice(0,400)`));
    console.log(code, "NET:", JSON.stringify(net, null, 1).slice(0, 2500));
    console.log(code, "errors:", s.errors.slice(-5));
  }
  await s.close();
})();
