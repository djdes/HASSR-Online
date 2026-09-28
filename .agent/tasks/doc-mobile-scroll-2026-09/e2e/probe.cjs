// Разовая проба: один документ — замер + снимок.
// node D:/wt-build/tmp-docscroll/e2e/probe.cjs climate_control [phone|desktop] [cards|table]
const path = require("node:path");
const fs = require("node:fs");
const { OUT, PHONE, DESKTOP, launch, readCreds, newContext, quietPage, gotoHydrated } = require("./lib.cjs");
const { measurePage } = require("./measure-lib.cjs");

(async () => {
  const code = process.argv[2] || "climate_control";
  const kind = process.argv[3] || "phone";
  const view = process.argv[4] || "";
  const tag = `${code}-${kind}${view ? `-${view}` : ""}`;
  const creds = readCreds();
  const doc = creds.documents.find((d) => d.code === code);
  const browser = await launch();
  const results = { pageErrors: [] };
  try {
    const ctx = await newContext(browser, kind === "phone" ? PHONE : DESKTOP);
    const page = await quietPage(ctx, results);
    if (view) {
      await page.addInitScript(
        ([c, v]) => {
          try {
            localStorage.setItem(`journal-mobile-view:${c}`, v);
          } catch {}
        },
        [code, view],
      );
    }
    await gotoHydrated(page, `/journals/${code}/documents/${doc.id}`, "main h1");
    await page.waitForTimeout(4000);
    const m = await measurePage(page);
    console.log(JSON.stringify(m, null, 2));
    const dir = path.join(OUT, "probe");
    fs.mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: path.join(dir, `${tag}.png`) });
    await page.screenshot({ path: path.join(dir, `${tag}-full.png`), fullPage: true });
    console.log("errors", results.pageErrors);
  } finally {
    await browser.close();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
