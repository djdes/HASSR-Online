// Быстрый взгляд: node probe.cjs <email> <url> <width> <name>
const path = require("node:path");
const { BASE, OUT, launch, login, quietPage, readCreds } = require("./lib.cjs");

(async () => {
  const [email, url, width, name] = process.argv.slice(2);
  const creds = readCreds();
  const browser = await launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: Number(width || 1280), height: 900 }, locale: "ru-RU" });
    const r = await login(ctx, email, creds.password);
    console.log("login", JSON.stringify(r));
    const page = await quietPage(ctx, "probe", { pageErrors: [] });
    page.on("framenavigated", (f) => { if (f === page.mainFrame()) console.log("nav", f.url()); });
    page.on("console", (m) => { if (m.type() === "error") console.log("console.error", m.text().slice(0, 200)); });
    await page.goto(`${BASE}${url}`, { waitUntil: "domcontentloaded", timeout: 240000 });
    for (let i = 0; i < 12; i += 1) {
      await page.waitForTimeout(5000);
      const n = await page.locator('[data-testid="billing-announcement"]').count();
      console.log(`t+${(i + 1) * 5}s announcement=${n} url=${page.url()}`);
    }
    await page.screenshot({ path: path.join(OUT, "shots", `probe-${name || "x"}.png`) });
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
