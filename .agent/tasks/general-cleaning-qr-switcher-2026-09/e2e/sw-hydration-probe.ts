// Разведка: полный текст предупреждений гидрации и вид выключенного журнала.
// Запуск: BASE=http://localhost:3027 npx tsx .agent/tasks/general-cleaning-qr-switcher-2026-09/e2e/sw-hydration-probe.ts
import fs from "node:fs";
import path from "node:path";
import { chromium, type BrowserContext } from "playwright";

const BASE = process.env.BASE ?? "http://localhost:3020";
const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const SHOTS = path.join(HERE, "..", "shots");
const state = JSON.parse(fs.readFileSync(path.join(HERE, "sw-state.json"), "utf8"));

async function login(context: BrowserContext, email: string) {
  const page = await context.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "load", timeout: 600_000 });
  await page.fill("#email", email);
  await page.fill("#password", state.password);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 600_000 });
  await page.close();
}

async function main() {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const out: Record<string, string[]> = {};
  try {
    for (const [tag, options, mini] of [
      ["desktop", { viewport: { width: 1440, height: 900 } }, false],
      ["mini", { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }, true],
    ] as const) {
      const context = await browser.newContext(options);
      await login(context, state.users.manager.email);
      if (mini) await context.addCookies([{ name: "ws-shell", value: "mini", url: BASE }]);
      for (const url of ["/journals/hygiene", "/journals/fryer_oil"]) {
        const page = await context.newPage();
        const messages: string[] = [];
        page.on("console", (m) => {
          if (m.type() === "error" && /hydrat/i.test(m.text())) messages.push(m.text());
        });
        await page.goto(`${BASE}${url}`, { waitUntil: "load", timeout: 600_000 });
        await page.waitForTimeout(4000);
        out[`${tag} ${url}`] = messages;
        const hasNav = await page.locator('nav[aria-label="Хлебные крошки"]').count();
        console.log(`${tag} ${url}: hydration=${messages.length} nav=${hasNav} url=${page.url()}`);
        await page.screenshot({ path: path.join(SHOTS, `sw-probe-${tag}-${url.split("/").pop()}.png`) });
        await page.close();
      }
      await context.close();
    }
  } finally {
    await browser.close();
  }
  fs.writeFileSync(path.join(HERE, "sw-hydration-probe.json"), JSON.stringify(out, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
