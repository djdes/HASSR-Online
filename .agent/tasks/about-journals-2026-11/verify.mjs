import assert from "node:assert/strict";
import { chromium } from "playwright";

const site = "https://wesetup.ru";
const baseURL = process.env.ABOUT_VERIFY_URL ?? "http://127.0.0.1:3157";
const variants = [
  { lang: "ru", prefix: "", label: "О нас", heading: /СанПиН и ХАССП/ },
  { lang: "en", prefix: "/en", label: "About us", heading: /digital HACCP logs/ },
  { lang: "uz", prefix: "/uz", label: "Biz haqimizda", heading: /elektron HACCP jurnallari/ },
];
const alternates = {
  ru: site + "/about",
  en: site + "/en/about",
  uz: site + "/uz/about",
  "x-default": site + "/about",
};
const journalCodes = ["hygiene", "cold_equipment_control", "cleaning", "finished_product"];
const browser = await chromium.launch({ executablePath: process.env.ABOUT_CHROME_PATH });
const titles = new Set();
const descriptions = new Set();

try {
  const page = await browser.newPage({
    baseURL,
    javaScriptEnabled: false,
    userAgent: "Twitterbot/1.0",
    viewport: { width: 390, height: 844 },
  });
  page.setDefaultTimeout(20_000);
  for (const { lang, prefix, label, heading } of variants) {
    const path = prefix + "/about";
    const canonical = site + path;
    const response = await page.goto(path + "?utm_source=verification", { timeout: 120_000 });
    assert.equal(response.status(), 200);
    assert.equal(response.request().redirectedFrom(), null);
    assert.ok(!/noindex/i.test(response.headers()["x-robots-tag"] ?? ""));
    assert.equal(await page.locator("html").getAttribute("lang"), lang);
    assert.equal(await page.locator("main h1").count(), 1);
    assert.match(await page.locator("main h1").innerText(), heading);
    assert.equal(await page.locator("main h2").count(), 4);
    assert.equal(await page.locator('head link[rel="canonical"]').getAttribute("href"), canonical);
    assert.equal(await page.locator('head link[rel="canonical"]').count(), 1);
    assert.equal(await page.locator('head meta[property="og:url"]').getAttribute("content"), canonical);
    assert.match(await page.locator('head meta[property="og:image"]').getAttribute("content"), /\/og\/image\?/);
    assert.equal(await page.locator('head meta[name="twitter:card"]').getAttribute("content"), "summary_large_image");
    assert.ok(!/noindex/i.test(await page.locator('head meta[name="robots"]').getAttribute("content")));
    const title = await page.title();
    const description = await page.locator('head meta[name="description"]').getAttribute("content");
    assert.match(title, /WeSetup$/);
    assert.ok(description.length > 80);
    titles.add(title);
    descriptions.add(description);
    for (const [key, href] of Object.entries(alternates)) {
      assert.equal(await page.locator(`head link[rel="alternate"][hreflang="${key}"]`).getAttribute("href"), href);
    }

    const data = (await page.locator('script[type="application/ld+json"]').allTextContents()).map(JSON.parse);
    const about = data.find((entry) => entry["@type"] === "AboutPage");
    const breadcrumbs = data.find((entry) => entry["@type"] === "BreadcrumbList");
    assert.equal(about.url, canonical);
    assert.equal(about.inLanguage, lang);
    assert.equal(about.mainEntity["@id"], site + "/#org");
    assert.equal(await page.locator(`main a[href="mailto:${about.mainEntity.email}"]`).count(), 1);
    assert.equal(await page.locator(`main a[href="tel:${about.mainEntity.telephone}"]`).count(), 1);
    assert.equal(breadcrumbs.itemListElement[1].item, site + prefix + "/journals-info");
    assert.equal(breadcrumbs.itemListElement[2].name, label);
    assert.equal(await page.locator(`main a[href="${prefix}/register"]`).count(), 1);
    assert.equal(await page.locator(`main a[href="${prefix}/features"]`).count(), 1);
    for (const code of journalCodes) {
      assert.equal(await page.locator(`main a[href="${prefix}/journals-info/${code}"]`).count(), 1);
    }
    const screenshot = page.locator("main img");
    assert.ok(await screenshot.getAttribute("alt"));
    await screenshot.evaluate((img) => img.decode());
    assert.ok(await screenshot.evaluate((img) => img.naturalWidth > 0));
    const overflow = await page.locator("main").evaluate((main) => main.scrollWidth > main.clientWidth);
    assert.equal(overflow, false);
    if (lang === "ru") {
      await page.screenshot({ path: ".agent/tasks/about-journals-2026-11/raw/mobile.png", fullPage: true, timeout: 20_000 });
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.screenshot({ path: ".agent/tasks/about-journals-2026-11/raw/desktop.png", fullPage: true, timeout: 20_000 });
      await page.setViewportSize({ width: 390, height: 844 });
    }
    const catalog = await page.goto(prefix + "/journals-info", { timeout: 120_000 });
    assert.equal(catalog.status(), 200);
    assert.equal(await page.locator(`section a[href="${path}"]`).first().innerText(), label);
    assert.equal(await page.locator(`footer a[href="${path}"]`).innerText(), label);
    console.log(JSON.stringify({ path, status: response.status(), language: lang, title, description, canonical, alternates,
      structuredData: data, screenshot: "loaded", mobileMainOverflow: overflow, catalogAndFooterLinks: "present" }));
  }
  assert.equal(titles.size, variants.length);
  assert.equal(descriptions.size, variants.length);

  const sitemap = await page.request.get("/sitemap.xml", { timeout: 120_000 });
  assert.equal(sitemap.status(), 200);
  const xml = await sitemap.text();
  for (const { prefix } of variants) {
    const loc = `<loc>${site}${prefix}/about</loc>`;
    assert.equal(xml.split(loc).length, 2);
    const entry = xml.slice(xml.lastIndexOf("<url>", xml.indexOf(loc)), xml.indexOf("</url>", xml.indexOf(loc)));
    for (const [key, href] of Object.entries(alternates)) {
      assert.match(entry, new RegExp(`hreflang="${key}"\\s+href="${href}"`));
    }
    console.log(entry.trim() + "\n</url>");
  }
  const robots = await page.request.get("/robots.txt");
  assert.equal(robots.status(), 200);
  assert.match(await robots.text(), /^Sitemap: https:\/\/wesetup\.ru\/sitemap\.xml$/m);
  console.log("PASS: server-rendered content, localization, navigation, metadata, imagery, sitemap and robots");
} finally {
  await browser.close();
}
