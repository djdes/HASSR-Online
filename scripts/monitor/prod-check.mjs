#!/usr/bin/env node
/**
 * Prod check from the cloud (GitHub Actions, .github/workflows/prod-monitor.yml) — nothing runs on
 * the production server. Every 15 minutes: /api/health (ok, database, version), the landing page,
 * the login page, robots.txt and sitemap.xml by their content, and that production is not more than
 * an hour behind master.
 *
 * From data centres abroad the TLS handshake to the server fails roughly every other time (seen
 * from GitHub and from cloud sessions), so:
 *   - every check is retried several times;
 *   - a network failure while other checks got through is noise, not an outage; only "nothing got
 *     through at all" or a real bad answer (status, content, health, stale deploy) fails the run;
 *   - Telegram hears about it from the second failed run in a row, once, and once more on recovery.
 * State between runs lives in a small JSON file (the workflow keeps it in the Actions cache). The
 * script never exits non-zero because of the site: a red run would mail GitHub notices every 15
 * minutes during an outage; the job summary and Telegram carry the result.
 *
 *   node scripts/monitor/prod-check.mjs                 # check, update state, alert if needed
 *   MONITOR_NO_ALERT=1 node scripts/monitor/prod-check.mjs   # check only, print the result
 *
 * Env: MONITOR_BASE_URL (https://wesetup.ru), MASTER_SHA, MASTER_COMMITTED_AT (ISO), STATE_FILE
 * (.prod-monitor/state.json), TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, RUN_URL, GITHUB_STEP_SUMMARY.
 */
import { mkdir, readFile, writeFile, appendFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * @typedef {{ id: string, path: string, health?: boolean, contains?: string }} Check
 * @typedef {{ kind: string, detail: string, buildSha?: string }} Verdict
 * @typedef {{ id: string, path: string, kind: string, detail: string, attempts: number }} CheckResult
 * @typedef {{ status: string, reason: string, failures: CheckResult[], noise: CheckResult[] }} Summary
 * @typedef {{ consecutiveFailures: number, incident: boolean, firstFailureAt: string | null, lastStatus: string | null }} MonitorState
 * @typedef {(url: URL | string, init?: any) => Promise<Response>} FetchLike
 * @typedef {{ masterSha?: string | null, masterCommittedAt?: string | null, now?: Date, maxLagMinutes?: number }} HealthContext
 */

/** @type {Check[]} */
export const CHECKS = [
  { id: "health", path: "/api/health", health: true },
  { id: "home", path: "/", contains: "WeSetup</title>" },
  { id: "login", path: "/login", contains: 'type="password"' },
  { id: "robots", path: "/robots.txt", contains: "Sitemap:" },
  { id: "sitemap", path: "/sitemap.xml", contains: "<urlset" },
];

export const DEFAULTS = {
  attempts: 6,
  timeoutMs: 20_000,
  delaysMs: [3_000, 5_000, 10_000, 15_000, 20_000],
  maxLagMinutes: 60,
  failuresToAlert: 2,
};

/** Kinds that mean the server answered and the answer is wrong (as opposed to "no answer"). */
const DEFINITIVE = new Set(["http", "content", "health", "stale"]);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Health body → verdict. `masterSha`/`masterCommittedAt` describe master's head; production may lag
 * behind it while a deploy is running, but not for more than `maxLagMinutes`.
 * @param {unknown} body
 * @param {HealthContext} [context]
 * @returns {Verdict}
 */
export function evaluateHealth(body, { masterSha, masterCommittedAt, now = new Date(), maxLagMinutes = DEFAULTS.maxLagMinutes } = {}) {
  let json;
  try {
    json = typeof body === "string" ? JSON.parse(body) : body;
  } catch {
    return { kind: "content", detail: "ответ не JSON" };
  }
  if (!json || json.ok !== true || json.db !== "ok") {
    return { kind: "health", detail: `ok=${json?.ok} db=${json?.db ?? "?"}` };
  }
  const buildSha = String(json.buildSha || "unknown");
  if (masterSha && buildSha !== "unknown" && !String(masterSha).startsWith(buildSha) && !buildSha.startsWith(String(masterSha))) {
    const committed = masterCommittedAt ? new Date(masterCommittedAt) : null;
    const lagMinutes = committed && !Number.isNaN(committed.getTime()) ? Math.floor((now.getTime() - committed.getTime()) / 60_000) : null;
    if (lagMinutes !== null && lagMinutes > maxLagMinutes) {
      return { kind: "stale", detail: `на проде ${buildSha.slice(0, 7)}, в master ${String(masterSha).slice(0, 7)} уже ${lagMinutes} мин`, buildSha };
    }
    return { kind: "ok", detail: `версия ${buildSha.slice(0, 7)}, выкатка ${String(masterSha).slice(0, 7)} идёт`, buildSha };
  }
  return { kind: "ok", detail: `версия ${buildSha.slice(0, 7)}`, buildSha };
}

/**
 * One HTTP attempt → { kind: ok|network|http|content|health|stale, detail }.
 * @param {Check} check
 * @param {{ baseUrl: string | URL, fetchImpl?: FetchLike, timeoutMs?: number, health?: HealthContext }} options
 * @returns {Promise<Verdict>}
 */
export async function attemptCheck(check, { baseUrl, fetchImpl = fetch, timeoutMs = DEFAULTS.timeoutMs, health = {} }) {
  let response;
  let body;
  try {
    response = await fetchImpl(new URL(check.path, baseUrl), {
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "user-agent": "wesetup-prod-monitor (GitHub Actions)", "cache-control": "no-cache" },
    });
    body = await response.text();
  } catch (error) {
    const cause = error?.cause?.code || error?.cause?.message || error?.name || "error";
    return { kind: "network", detail: `нет ответа (${cause})` };
  }
  if (check.health) {
    if (response.status !== 200 && response.status !== 503) return { kind: "http", detail: `ответ ${response.status}` };
    return evaluateHealth(body, health);
  }
  if (response.status !== 200) return { kind: "http", detail: `ответ ${response.status}` };
  if (check.contains && !body.includes(check.contains)) return { kind: "content", detail: `нет «${check.contains}» в ответе` };
  return { kind: "ok", detail: `${response.status}, ${Math.round(body.length / 1024)} КБ` };
}

/**
 * Retries until an ok. Final verdict: ok if any attempt was ok; otherwise the server's own answer
 * (http/content/health/stale) beats "no answer", so a 502 is reported as a 502 even when some other
 * attempts timed out.
 * @param {Check} check
 * @param {{ baseUrl: string | URL, fetchImpl?: FetchLike, timeoutMs?: number, health?: HealthContext, attempts?: number, delaysMs?: number[], sleep?: (ms: number) => Promise<unknown> }} options
 * @returns {Promise<CheckResult>}
 */
export async function runCheck(check, options = {}) {
  const attempts = options.attempts ?? DEFAULTS.attempts;
  const delays = options.delaysMs ?? DEFAULTS.delaysMs;
  const wait = options.sleep ?? sleep;
  const seen = [];
  for (let i = 0; i < attempts; i += 1) {
    const result = await attemptCheck(check, options);
    seen.push(result);
    if (result.kind === "ok") return { id: check.id, path: check.path, ...result, attempts: i + 1 };
    if (i < attempts - 1) await wait(delays[Math.min(i, delays.length - 1)] ?? 0);
  }
  const answered = [...seen].reverse().find((r) => DEFINITIVE.has(r.kind));
  return { id: check.id, path: check.path, ...(answered ?? seen[seen.length - 1]), attempts };
}

/**
 * Run verdict: fail on any real bad answer, or when not a single check got through.
 * @param {CheckResult[]} results
 * @returns {Summary}
 */
export function summarize(results) {
  const failures = results.filter((r) => DEFINITIVE.has(r.kind));
  const network = results.filter((r) => r.kind === "network");
  if (failures.length > 0) return { status: "fail", reason: "answer", failures, noise: network };
  if (results.length > 0 && network.length === results.length) {
    return { status: "fail", reason: "unreachable", failures: network, noise: [] };
  }
  return { status: "ok", reason: network.length ? "noise" : "clean", failures: [], noise: network };
}

/** @type {MonitorState} */
export const EMPTY_STATE = { consecutiveFailures: 0, incident: false, firstFailureAt: null, lastStatus: null };

/**
 * State machine: alert on the N-th failed run in a row (once), and on the first ok after an alert.
 * @param {Partial<MonitorState> | null | undefined} prev
 * @param {{ status: string }} summary
 * @param {Date} [now]
 * @param {number} [failuresToAlert]
 * @returns {{ state: MonitorState, alert: "down" | "up" | null, downSince?: string | null }}
 */
export function nextState(prev, summary, now = new Date(), failuresToAlert = DEFAULTS.failuresToAlert) {
  const state = { ...EMPTY_STATE, ...(prev || {}) };
  if (summary.status === "fail") {
    const consecutiveFailures = state.consecutiveFailures + 1;
    const firstFailureAt = state.consecutiveFailures === 0 || !state.firstFailureAt ? now.toISOString() : state.firstFailureAt;
    const raise = !state.incident && consecutiveFailures >= failuresToAlert;
    return {
      state: { consecutiveFailures, incident: state.incident || raise, firstFailureAt, lastStatus: "fail" },
      alert: raise ? "down" : null,
    };
  }
  const recovered = state.incident;
  return {
    state: { ...EMPTY_STATE, lastStatus: "ok" },
    alert: recovered ? "up" : null,
    downSince: recovered ? state.firstFailureAt : null,
  };
}

function moscowTime(iso) {
  if (!iso) return "?";
  return new Date(iso).toLocaleTimeString("ru-RU", { timeZone: "Europe/Moscow", hour: "2-digit", minute: "2-digit" });
}

function plural(n, one, few, many) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

/**
 * @param {"down" | "up"} kind
 * @param {{ summary: Summary, state: MonitorState, downSince?: string | null, baseUrl: string, runUrl?: string, now?: Date }} context
 */
export function formatAlert(kind, { summary, state, downSince, baseUrl, runUrl, now = new Date() }) {
  const host = new URL(baseUrl).host;
  if (kind === "up") {
    const minutes = downSince ? Math.max(1, Math.round((now.getTime() - new Date(downSince).getTime()) / 60_000)) : null;
    return [`✅ ${host} снова в порядке`, minutes ? `Сбой длился около ${minutes} мин.` : null, runUrl ? `Запуск: ${runUrl}` : null]
      .filter(Boolean)
      .join("\n");
  }
  const lines = summary.failures.map((f) => `— ${f.path}: ${f.detail}`);
  const streak = `${state.consecutiveFailures} ${plural(state.consecutiveFailures, "проверка", "проверки", "проверок")} подряд, с ${moscowTime(state.firstFailureAt)} МСК`;
  const head = summary.reason === "unreachable" ? `🔴 ${host} не отвечает из-за рубежа (${streak})` : `🔴 ${host}: сбой (${streak})`;
  const hint =
    summary.reason === "unreachable"
      ? "Ни одна страница не ответила за 6 попыток. Если из России сайт открывается — это связь с зарубежьем, не сайт."
      : null;
  return [head, ...lines, hint, runUrl ? `Запуск: ${runUrl}` : null].filter(Boolean).join("\n");
}

/**
 * @param {{ token?: string, chatId?: string, text: string, fetchImpl?: (url: string, init: any) => Promise<Response>, wait?: (ms: number) => Promise<unknown> }} options
 */
export async function sendTelegram({ token, chatId, text, fetchImpl = fetch, wait = sleep }) {
  if (!token || !chatId) return { sent: false, reason: "no token/chat" };
  for (let i = 0; i < 3; i += 1) {
    try {
      const response = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
        signal: AbortSignal.timeout(20_000),
      });
      if (response.ok) return { sent: true };
    } catch {
      /* retry */
    }
    await wait(3_000);
  }
  return { sent: false, reason: "telegram error" };
}

function summaryMarkdown(results, summary, decision) {
  const icon = { ok: "✅", network: "⚪", http: "❌", content: "❌", health: "❌", stale: "❌" };
  const rows = results.map((r) => `| ${icon[r.kind] ?? "?"} | \`${r.path}\` | ${r.detail} | ${r.attempts} |`);
  return [
    `### Прод: ${summary.status === "ok" ? "в порядке" : "сбой"} (${summary.reason})`,
    "",
    "| | Страница | Результат | Попыток |",
    "|---|---|---|---|",
    ...rows,
    "",
    `Подряд упавших запусков: ${decision.state.consecutiveFailures}; тревога: ${decision.alert ?? "нет"}.`,
    "⚪ — нет ответа при живых остальных проверках: связь из-за рубежа, не считается сбоем.",
    "",
  ].join("\n");
}

async function readState(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return { ...EMPTY_STATE };
  }
}

async function main() {
  const env = process.env;
  const baseUrl = env.MONITOR_BASE_URL || "https://wesetup.ru";
  const stateFile = env.STATE_FILE || ".prod-monitor/state.json";
  const now = new Date();
  const health = { masterSha: env.MASTER_SHA || null, masterCommittedAt: env.MASTER_COMMITTED_AT || null, now };

  const results = await Promise.all(CHECKS.map((check) => runCheck(check, { baseUrl, health })));
  const summary = summarize(results);
  const decision = nextState(await readState(stateFile), summary, new Date());

  for (const r of results) console.log(`${r.kind.padEnd(8)} ${r.path.padEnd(14)} ${r.detail} (попыток: ${r.attempts})`);
  console.log(`run: ${summary.status} (${summary.reason}); consecutive failures: ${decision.state.consecutiveFailures}; alert: ${decision.alert ?? "none"}`);

  if (env.MONITOR_NO_ALERT === "1") return;

  await mkdir(path.dirname(stateFile), { recursive: true });
  await writeFile(stateFile, `${JSON.stringify({ ...decision.state, checkedAt: now.toISOString() }, null, 2)}\n`);

  if (decision.alert) {
    const text = formatAlert(decision.alert, { summary, state: decision.state, downSince: decision.downSince, baseUrl, runUrl: env.RUN_URL, now });
    const sent = await sendTelegram({ token: env.TELEGRAM_BOT_TOKEN, chatId: env.TELEGRAM_CHAT_ID, text });
    console.log(`telegram: ${sent.sent ? "sent" : `not sent (${sent.reason})`}\n${text}`);
  }
  if (env.GITHUB_STEP_SUMMARY) await appendFile(env.GITHUB_STEP_SUMMARY, summaryMarkdown(results, summary, decision));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((error) => {
    // A bug in the monitor itself is worth a red run.
    console.error(error);
    process.exitCode = 1;
  });
}
