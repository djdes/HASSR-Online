// Сквозная проверка на production-сборке (next build + next start).
// Запуск: BASE=http://127.0.0.1:3003 CHROMIUM_PATH=/opt/pw-browsers/chromium node e2e.cjs
const { chromium } = require("playwright");

const BASE = process.env.BASE ?? "http://127.0.0.1:3003";
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

async function timed(path, headers = {}) {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(`${BASE}${path}`, { headers: { "x-real-ip": "198.51.100.90", "user-agent": "Mozilla/5.0 Chrome/130", ...headers }, signal: controller.signal, redirect: "manual" });
    const body = await response.text();
    return { status: response.status, type: response.headers.get("content-type") ?? "", body, ms: Date.now() - started };
  } catch {
    return { status: 0, type: "", body: "", ms: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

// Build IDs, nonces and timestamps differ between two renders; compare the rest.
const shape = (html) => html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/\s+/g, " ").length;

(async () => {
  for (const path of ["/login", "/pricing", "/", "/journals-info"]) {
    const page = { accept: "text/html,application/xhtml+xml,*/*;q=0.8", "sec-fetch-dest": "document" };
    const plain = await timed(path, page);
    for (const extra of [{ "next-router-prefetch": "1" }, { "next-router-prefetch": "1", "next-router-segment-prefetch": "/_tree" }, { "next-router-state-tree": "%5B%22%22%5D" }]) {
      const stray = await timed(path, { ...page, ...extra });
      const similar = Math.abs(shape(stray.body) - shape(plain.body)) <= Math.max(200, shape(plain.body) * 0.02);
      check(`${path} с ${Object.keys(extra).join(" + ")} — ответ, как без заголовка`, stray.status === plain.status && stray.ms < 2_000 && /text\/html/.test(stray.type) && similar, `${stray.status} за ${stray.ms} мс, HTML ${shape(stray.body)} против ${shape(plain.body)}`);
    }
  }

  // Real router requests are untouched: RSC navigation and RSC prefetch.
  const navigation = await timed("/pricing?_rsc=e2e1", { rsc: "1", "next-url": "/pricing", accept: "*/*" });
  check("RSC-переход отдаёт text/x-component", navigation.status === 200 && /text\/x-component/.test(navigation.type), `${navigation.status} ${navigation.type} за ${navigation.ms} мс`);
  const prefetch = await timed("/pricing?_rsc=e2e2", { rsc: "1", "next-router-prefetch": "1", accept: "*/*" });
  check("RSC-предзагрузка отдаёт text/x-component и не длиннее полного ответа", prefetch.status === 200 && /text\/x-component/.test(prefetch.type) && prefetch.body.length <= navigation.body.length, `${prefetch.status} ${prefetch.type}, ${prefetch.body.length} против ${navigation.body.length} байт`);

  // A browser: client-side navigation between pages still works.
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  try {
    const page = await browser.newPage({ extraHTTPHeaders: { "x-real-ip": "198.51.100.91" } });
    const rsc = [];
    page.on("response", (response) => {
      if (response.request().headers()["rsc"] === "1") rsc.push(response.status());
    });
    await page.goto(`${BASE}/`);
    await page.evaluate(() => (window.__noReload = true));
    const link = page.locator('a[href="/pricing"]').first();
    await link.scrollIntoViewIfNeeded();
    await page.waitForTimeout(1_500);
    await link.click();
    await page.waitForURL(`${BASE}/pricing`, { timeout: 15_000 });
    await page.waitForLoadState("networkidle").catch(() => undefined);
    const kept = await page.evaluate(() => window.__noReload === true);
    check("клиентский переход в браузере: без перезагрузки, RSC-запросы успешны", kept && rsc.length > 0 && rsc.every((status) => status === 200), `переход без перезагрузки: ${kept}, RSC-ответы: ${rsc.join(",")}`);
  } finally {
    await browser.close();
  }

  require("node:fs").writeFileSync(`${__dirname}/e2e.json`, JSON.stringify(results, null, 2));
  process.exitCode = results.every((result) => result.ok) ? 0 : 1;
})();
