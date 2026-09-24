import { readFileSync } from "node:fs";
import path from "node:path";
import { chromium, type Browser, type BrowserContext } from "playwright-core";

export const BASE = process.env.E2E_BASE ?? "http://localhost:3037";
export const TASK_DIR = ".agent/tasks/rpn-hygiene-orders-2026-09";
export const SHOTS = path.join(TASK_DIR, "shots");
export const RAW = path.join(TASK_DIR, "raw");

export type Fixture = {
  password: string;
  pin: string;
  todayKey: string;
  orgA: string;
  orgB: string;
  managerA: string;
  managerB: string;
  cookEmail: string;
  ivan: string;
  petr: string;
  olga: string;
  hygieneDoc: string;
  finishedDoc: string;
  inspectorToken: string;
  inspectorTokenB: string;
};

export function fixture(): Fixture {
  return JSON.parse(readFileSync(path.join(RAW, "fixture.json"), "utf8")) as Fixture;
}

export async function launch(): Promise<Browser> {
  const exe = path.join(process.env.LOCALAPPDATA ?? "", "ms-playwright", "chromium-1232", "chrome-win64", "chrome.exe");
  return chromium.launch({ executablePath: exe, headless: true, args: ["--use-gl=swiftshader", "--no-sandbox"] });
}

export async function login(browser: Browser, email: string, password: string, viewport = { width: 1440, height: 900 }): Promise<BrowserContext> {
  const context = await browser.newContext({ viewport, locale: "ru-RU", baseURL: BASE });
  // Dev-сервер компилирует страницу при первом заходе — до пары минут.
  context.setDefaultNavigationTimeout(300_000);
  context.setDefaultTimeout(120_000);
  const csrf = (await (await context.request.get("/api/auth/csrf")).json()) as { csrfToken: string };
  const res = await context.request.post("/api/auth/callback/credentials", {
    form: { csrfToken: csrf.csrfToken, email, password, json: "true", callbackUrl: `${BASE}/dashboard` },
    maxRedirects: 0,
  });
  if (res.status() >= 400) throw new Error(`login failed ${email}: ${res.status()}`);
  const session = (await (await context.request.get("/api/auth/session")).json()) as { user?: { email?: string } };
  if (session?.user?.email !== email) throw new Error(`no session for ${email}: ${JSON.stringify(session)}`);
  // Гайд журнала открывается сам при первом визите — отмечаем его просмотренным.
  for (const key of ["fill-guide:hygiene", "fill-guide:finished_product"]) {
    await context.request.post("/api/me/notices", { data: { key } });
  }
  return context;
}

export const results: Array<{ id: string; ok: boolean; detail: string }> = [];
export function check(id: string, ok: boolean, detail: string) {
  results.push({ id, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${id} — ${detail}`);
}
