// Scratch helpers for exploratory testing (not part of the product).
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { readFileSync, mkdirSync } from "node:fs";

export const BASE = "http://localhost:3000";
export const OUT = ".agent/tasks/crm-lifecycle-2026-11/opus";
export const SINK = "/tmp/claude-0/-home-user-HASSR-Online/b7e63547-81c4-5a0e-8991-9a89cf8800cd/scratchpad/lc-sink.log";
mkdirSync(OUT, { recursive: true });

export const sql = (query) =>
  execFileSync("psql", ["-h", "127.0.0.1", "-p", "55432", "-U", "postgres", "wesetup", "-At", "-c", query], { encoding: "utf8" }).trim();
export const sinkLines = () => readFileSync(SINK, "utf8").trim().split("\n");

export const USERS = {
  alexey: ["alexey@wesetup.ru", "LocalUser-2026!"],
  maria: ["sales@wesetup.local.test", "LocalUser-2026!"],
  owner: ["owner@wesetup.local.test", "LocalRoot-2026!"],
};

let browser;
export async function getBrowser() {
  browser ??= await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  return browser;
}
export const errors = [];
export const consoleErrors = [];

export async function login(who, viewport = { width: 1600, height: 1000 }) {
  const [email, password] = USERS[who];
  const b = await getBrowser();
  const context = await b.newContext({ viewport, locale: "ru-RU" });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(`${who} ${page.url()} :: ${error.message.slice(0, 300)}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(`${who} ${page.url()} :: ${msg.text().slice(0, 300)}`);
  });
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.fill('input[placeholder="name@company.com"]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 90_000 });
  const api = async (method, path, body) => {
    const response = await context.request.fetch(`${BASE}${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      data: body === undefined ? undefined : JSON.stringify(body),
      failOnStatusCode: false,
      maxRedirects: 0,
    });
    let data = null;
    const text = await response.text();
    try {
      data = JSON.parse(text);
    } catch {
      data = text.slice(0, 120);
    }
    return { status: response.status(), data };
  };
  return { context, page, api };
}

export async function close() {
  await browser?.close();
}
