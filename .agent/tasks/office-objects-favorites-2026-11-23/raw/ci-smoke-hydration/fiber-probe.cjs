// Fiber path probe: one throttled phone session (like the smoke), loads pages in a loop and, after each
// load, records hydration errors and the React fiber path from the header point button up to the root
// (component name, slot index, number of siblings). Comparing good and bad loads shows the level where
// the client tree differs. Usage: node fiber-probe.cjs data.json rounds rate path...
const { chromium, devices } = require("playwright");
const fs = require("node:fs");

const BASE = process.env.BASE || "http://localhost:3000";
const data = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const rounds = Number(process.argv[3] || 3);
const rate = Number(process.argv[4] || 6);
const paths = process.argv.slice(5);

(async () => {
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--headless=new", "--no-sandbox"] });
  const context = await browser.newContext({ ...devices["iPhone 13"], locale: "ru-RU" });
  const page = await context.newPage();
  page.setDefaultTimeout(180000);
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate });
  let errors = [];
  page.on("console", (m) => {
    if (m.type() === "error" && /hydrat/i.test(m.text())) errors.push(m.text());
  });
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.fill("#email", data.email);
  await page.fill("#password", data.password);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 180000 }), page.click('button[type="submit"]')]);
  const out = [];
  for (let round = 0; round < rounds; round += 1) {
    for (const path of paths) {
      errors = [];
      await page.goto(`${BASE}${path}`, { waitUntil: "load", timeout: 180000 });
      await page.waitForTimeout(4000);
      const fiberPath = await page.evaluate(() => {
        const el = document.querySelector('linearGradient[id^="max-lin-"]');
        if (!el) return null;
        const key = Object.keys(el).find((k) => k.startsWith("__reactFiber$"));
        let fiber = key ? el[key] : null;
        const rows = [];
        const nameOf = (f) => {
          const t = f.type;
          if (!t) return f.tag === 3 ? "#root" : `#tag${f.tag}`;
          if (typeof t === "string") return t;
          return t.displayName || t.name || (t.render && (t.render.displayName || t.render.name)) || (t._context ? "Ctx" : `#tag${f.tag}`);
        };
        while (fiber) {
          let siblings = 0;
          if (fiber.return) {
            for (let c = fiber.return.child; c; c = c.sibling) siblings += 1;
          }
          rows.push(`${nameOf(fiber)}[${fiber.index}/${siblings}]`);
          fiber = fiber.return;
        }
        const pk = Object.keys(el).find((k) => k.startsWith("__reactProps$"));
        return { id: el.getAttribute("id"), propsId: pk ? el[pk].id : null, rows: rows.reverse() };
      });
      out.push({ round, path, hydrationErrors: errors.length, fiberPath });
      console.log(JSON.stringify({ round, path, hydrationErrors: errors.length, id: fiberPath && fiberPath.id, propsId: fiberPath && fiberPath.propsId }));
    }
  }
  fs.writeFileSync(process.env.OUT || "fiber-probe.json", JSON.stringify(out, null, 1));
  await browser.close();
})().catch((error) => {
  console.error("PROBE FAILED", String(error).slice(0, 400));
  process.exit(1);
});
