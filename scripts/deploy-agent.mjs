#!/usr/bin/env node
/**
 * Агент выката на сервере (задача deploy-pull-agent-2026-11-21,
 * docs/deploy-agent.md). Крон раз в 5 минут (scripts/deploy-agent.sh).
 *
 * Обычный выкат идёт из GitHub Actions по SSH. Из зарубежных дата-центров
 * сервер принимает соединения через раз, и выкат падал ещё до сервера —
 * прод оставался на старой сборке, пока его не перезапускали руками. В
 * обратную сторону (сервер → GitHub) связь быстрая и стабильная, поэтому
 * сервер сам проверяет, дошёл ли до него master, и если выкат из GitHub не
 * дошёл — выкатывает тот же коммит сам, теми же шагами из deploy.yml.
 *
 * Чистые функции (`decide`, `classifyJobs`, `extractStepScript`,
 * `renderStepScript`) и `runDeploy` с подменяемым запуском команд —
 * для тестов (src/lib/deploy-agent.test.ts).
 */

import { spawn } from "node:child_process";
import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REPO = "djdes/HASSR-Online";
export const WORKFLOW_FILE = ".github/workflows/deploy.yml";
export const DEPLOY_STEPS = [
  { name: "Deploy step 1/3", timeoutMs: 20 * 60_000 },
  { name: "Deploy step 2/3", timeoutMs: 20 * 60_000 },
  { name: "Deploy step 3/3", timeoutMs: 15 * 60_000 },
];
/** После неуспешного выката в GitHub ждём, пока он точно закончит работу. */
export const SETTLE_MS = 2 * 60_000;
/** Выката в GitHub нет вовсе (не сработал push) — столько ждём, потом выкатываем. */
export const GRACE_MS = 20 * 60_000;
export const MAX_ATTEMPTS = 2;
/** Замок старше — от упавшего выката (как в scripts/deploy-lock.sh). */
export const LOCK_STALE_MS = 45 * 60_000;
const KEEP_RUN_LOGS = 10;

export function sameSha(a, b) {
  if (!a || !b) return false;
  const left = String(a).trim().toLowerCase();
  const right = String(b).trim().toLowerCase();
  if (left.length < 7 || right.length < 7) return false;
  return left.startsWith(right) || right.startsWith(left);
}

/**
 * Чем кончился выкат коммита в GitHub, по его job'ам:
 * `deployed` — job deploy прошёл; `step3` — упал шаг 3/3 (схема, проверка
 * сборки, откат — повторять самим нельзя); `steps12` — упал шаг 1/3 или 2/3
 * (обрыв SSH посреди шага или сборка — повторить безопасно: живой сайт эти
 * шаги не трогают); `connectivity` — упала выгрузка или ожидание SSH, deploy
 * не дошёл до шагов; `unknown` — не разобрать.
 */
export function classifyJobs(jobs) {
  if (!Array.isArray(jobs) || jobs.length === 0) return "unknown";
  const byName = (name) => jobs.find((job) => job?.name === name);
  const deploy = byName("deploy");
  const upload = byName("Upload tarball");
  if (deploy?.conclusion === "success") return "deployed";
  if (upload && upload.conclusion && upload.conclusion !== "success" && upload.conclusion !== "skipped") return "connectivity";
  if (deploy && deploy.conclusion === "failure") {
    const failed = (deploy.steps ?? []).find((step) => step?.conclusion === "failure");
    const name = String(failed?.name ?? "");
    if (name.startsWith("Deploy step 3/3")) return "step3";
    if (name.startsWith("Deploy step 1/3") || name.startsWith("Deploy step 2/3")) return "steps12";
    return "connectivity";
  }
  if (deploy && (deploy.conclusion === "cancelled" || deploy.conclusion === "timed_out" || deploy.conclusion === "skipped")) return "connectivity";
  if (!deploy && upload?.conclusion === "success") return "unknown";
  return "unknown";
}

/**
 * Что делать на этом заходе.
 *
 * @param {{
 *   now: number,
 *   master: string | null,
 *   serving: string | null,
 *   compare: string | null,
 *   run: null | "unknown" | { status: string, updatedAt: number, failure: string },
 *   state: null | { sha: string, firstSeen: number, attempts: number, notified?: string[] },
 * }} input
 */
export function decide(input) {
  const { now, master, serving, compare, run } = input;
  if (!master) return { action: "wait", reason: "master_unknown", state: input.state ?? null };
  if (!serving) return { action: "wait", reason: "serving_unknown", state: input.state ?? null };
  if (sameSha(serving, master)) return { action: "idle", reason: "up_to_date", state: null };

  const state =
    input.state && input.state.sha === master
      ? { ...input.state, notified: [...(input.state.notified ?? [])] }
      : { sha: master, firstSeen: now, attempts: 0, notified: [] };
  const once = (key) => {
    if (state.notified.includes(key)) return undefined;
    state.notified.push(key);
    return key;
  };

  if (run === "unknown") return { action: "wait", reason: "github_unknown", state };
  if (run && run.status !== "completed") return { action: "wait", reason: "github_running", state };
  if (compare !== "ahead") {
    if (compare === "behind" || compare === "diverged") {
      return { action: "skip", reason: `compare_${compare}`, state, notify: once(`compare_${compare}`) };
    }
    return { action: "wait", reason: `compare_${compare ?? "unknown"}`, state };
  }
  if (run) {
    if (run.failure === "deployed") return { action: "skip", reason: "github_deployed_but_differs", state, notify: once("deployed_but_differs") };
    if (run.failure === "step3") return { action: "skip", reason: "github_failed_step3", state, notify: once("failed_step3") };
    if (run.failure === "unknown") return { action: "wait", reason: "github_jobs_unknown", state };
    if (now - run.updatedAt < SETTLE_MS) return { action: "wait", reason: "settling", state };
  } else if (now - state.firstSeen < GRACE_MS) {
    return { action: "wait", reason: "grace", state };
  }
  if (state.attempts >= MAX_ATTEMPTS) return { action: "give-up", reason: "attempts_exhausted", state, notify: once("give_up") };
  return {
    action: "deploy",
    reason: run ? `github_failed_${run.failure}` : "github_missing",
    state: { ...state, attempts: state.attempts + 1, lastAttempt: now },
  };
}

/**
 * Скрипт шага из deploy.yml (`script: |` под `- name: <шаг>`) — без отступа
 * YAML. Нет шага или скрипта — ошибка: значит, deploy.yml поменяли, и агент
 * не должен угадывать.
 */
export function extractStepScript(workflowText, stepPrefix) {
  const lines = String(workflowText).split("\n");
  const start = lines.findIndex((line) => line.trim().startsWith(`- name: ${stepPrefix}`));
  if (start < 0) throw new Error(`deploy.yml: нет шага «${stepPrefix}»`);
  const stepIndent = lines[start].indexOf("-");
  let scriptLine = -1;
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim().startsWith("- name:") && line.indexOf("-") <= stepIndent) break;
    if (/^\s*script:\s*\|\s*$/.test(line)) {
      scriptLine = index;
      break;
    }
  }
  if (scriptLine < 0) throw new Error(`deploy.yml: у шага «${stepPrefix}» нет script: |`);
  const keyIndent = lines[scriptLine].indexOf("script:");
  const body = [];
  for (let index = scriptLine + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() && line.search(/\S/) <= keyIndent) break;
    body.push(line);
  }
  while (body.length && !body[body.length - 1].trim()) body.pop();
  const indent = Math.min(...body.filter((line) => line.trim()).map((line) => line.search(/\S/)));
  if (!Number.isFinite(indent)) throw new Error(`deploy.yml: у шага «${stepPrefix}» пустой скрипт`);
  return `${body.map((line) => line.slice(indent)).join("\n")}\n`;
}

/** Подставить то, что подставил бы GitHub; любое другое `${{ … }}` — отказ. */
export function renderStepScript(script, { appDir, sha }) {
  if (!/^\/[A-Za-z0-9_./-]+$/.test(appDir)) throw new Error(`каталог приложения не похож на путь: ${appDir}`);
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(`не SHA коммита: ${sha}`);
  const rendered = script
    .replaceAll("${{ env.APP_DIR }}", appDir)
    .replaceAll("${{ github.sha }}", sha)
    .replaceAll("${{ github.repository }}", REPO);
  const unknown = rendered.match(/\$\{\{[^}]*\}\}/);
  if (unknown) throw new Error(`deploy.yml: неизвестное выражение ${unknown[0]} — агент такой шаг не выкатывает`);
  return rendered;
}

/** Замок выката — тот же каталог, что у scripts/deploy-lock.sh. */
export function acquireLock(lockDir, owner, now = Date.now()) {
  mkdirSync(path.dirname(lockDir), { recursive: true });
  try {
    mkdirSync(lockDir);
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const age = now - statSync(lockDir).mtimeMs;
    if (age <= LOCK_STALE_MS) return false;
    rmSync(lockDir, { recursive: true, force: true });
    mkdirSync(lockDir);
  }
  writeFileSync(path.join(lockDir, "owner"), `${owner}\n`);
  return true;
}

export function touchLock(lockDir) {
  const now = new Date();
  try {
    utimesSync(lockDir, now, now);
  } catch {
    /* замка нет — шаги возьмут свой */
  }
}

export function lockHeld(lockDir, now = Date.now()) {
  try {
    return now - statSync(lockDir).mtimeMs <= LOCK_STALE_MS;
  } catch {
    return false;
  }
}

/** mv: каталог агента и приложение могут лежать на разных дисках. */
function moveFile(from, to) {
  try {
    renameSync(from, to);
  } catch (error) {
    if (error?.code !== "EXDEV") throw error;
    copyFileSync(from, to);
    rmSync(from, { force: true });
  }
}

/**
 * @typedef {{ cwd?: string, env?: NodeJS.ProcessEnv, timeoutMs?: number, logFile?: string }} ExecOptions
 * @typedef {(command: string, args: string[], options?: ExecOptions) => Promise<{ code: number }>} Exec
 */

/**
 * Запуск команды с выводом в журнал выката; код возврата, без исключений.
 * @param {string} command
 * @param {string[]} args
 * @param {ExecOptions} [options]
 * @returns {Promise<{ code: number }>}
 */
export function runCommand(command, args, { cwd, env, timeoutMs = 10 * 60_000, logFile } = {}) {
  return new Promise((resolve) => {
    const fd = logFile ? openSync(logFile, "a") : "ignore";
    const child = spawn(command, args, { cwd, env, stdio: ["ignore", fd, fd] });
    const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    const done = (code) => {
      clearTimeout(timer);
      if (typeof fd === "number") closeSync(fd);
      resolve({ code });
    };
    child.on("error", () => done(127));
    child.on("close", (code) => done(code ?? 1));
  });
}

/**
 * Выкатить коммит самому: код с codeload.github.com, deploy.tar скриптом
 * коммита, затем шаги 1/3–3/3 из deploy.yml коммита. Замок держим всё
 * время и освежаем перед каждым шагом; первый упавший шаг — стоп.
 */
/**
 * @param {{ sha: string, appDir: string, stateDir: string, lockDir: string, exec?: Exec, logFile?: string, now?: number }} options
 * @returns {Promise<{ ok: boolean, step?: string, reason?: string }>}
 */
export async function runDeploy({ sha, appDir, stateDir, lockDir, exec = runCommand, logFile, now = Date.now() }) {
  if (!acquireLock(lockDir, `agent ${sha}`, now)) return { ok: false, step: "lock", reason: "locked" };
  const work = path.join(stateDir, "work");
  const src = path.join(work, "src");
  const env = { ...process.env, GITHUB_SHA: sha, WESETUP_DEPLOY_LOCKED: "1" };
  try {
    rmSync(work, { recursive: true, force: true });
    mkdirSync(src, { recursive: true });
    const archive = path.join(work, "code.tar.gz");
    const download = await exec(
      "curl",
      ["-fsS", "--retry", "1", "--retry-delay", "5", "--connect-timeout", "20", "--speed-limit", "102400", "--speed-time", "45", "--max-time", "330", "-o", archive, `https://codeload.github.com/${REPO}/tar.gz/${sha}`],
      { cwd: work, env, logFile },
    );
    if (download.code !== 0) return { ok: false, step: "download" };
    if ((await exec("tar", ["xzf", archive, "-C", src, "--strip-components=1"], { cwd: work, env, logFile })).code !== 0) return { ok: false, step: "download" };
    rmSync(archive, { force: true });
    writeFileSync(path.join(src, ".build-time"), `${new Date(now).toISOString().replace(/\.\d{3}Z$/, "Z")}\n`);
    const tarball = path.join(work, "deploy.tar");
    if ((await exec("bash", [path.join(src, "scripts/deploy-tarball.sh"), src, tarball], { cwd: work, env, logFile })).code !== 0) return { ok: false, step: "tarball" };
    moveFile(tarball, path.join(appDir, "deploy.tar"));

    const workflow = readFileSync(path.join(src, WORKFLOW_FILE), "utf8");
    const scripts = DEPLOY_STEPS.map((step, index) => {
      const file = path.join(work, `step-${index + 1}.sh`);
      writeFileSync(file, renderStepScript(extractStepScript(workflow, step.name), { appDir, sha }));
      return { ...step, file };
    });
    for (const step of scripts) {
      touchLock(lockDir);
      const result = await exec("bash", [step.file], { cwd: appDir, env, timeoutMs: step.timeoutMs, logFile });
      if (result.code !== 0) return { ok: false, step: step.name };
    }
    return { ok: true };
  } catch (error) {
    if (logFile) {
      try {
        writeFileSync(logFile, `\n[deploy-agent] ${error?.stack ?? error}\n`, { flag: "a" });
      } catch {
        /* журнал недоступен */
      }
    }
    return { ok: false, step: "prepare", reason: String(error?.message ?? error) };
  } finally {
    rmSync(lockDir, { recursive: true, force: true });
    rmSync(work, { recursive: true, force: true });
  }
}

function short(sha) {
  return String(sha ?? "").slice(0, 7) || "?";
}

/**
 * @param {string} key
 * @param {{ sha?: string | null, serving?: string | null, compare?: string | null, step?: string, logFile?: string, reason?: string }} details
 */
export function noticeText(key, { sha, serving, compare, step, logFile, reason }) {
  switch (key) {
    case "start":
      return `🚚 Сервер сам выкатывает ${short(sha)}: выкат из GitHub не дошёл (${reason}).`;
    case "success":
      return `✅ Сервер сам выкатил ${short(sha)} — сайт на новой сборке.`;
    case "failure":
      return `❌ Сервер не смог выкатить ${short(sha)}: остановился на «${step}». Журнал: ${logFile}.`;
    case "compare_behind":
    case "compare_diverged":
      return `⚠️ Сервер не выкатывает ${short(sha)}: master не впереди сборки сайта ${short(serving)} (${compare}). Нужен человек.`;
    case "deployed_but_differs":
      return `⚠️ GitHub выкатил ${short(sha)}, но сайт на ${short(serving)}. Сервер сам не трогает — ручной откат? Проверьте.`;
    case "failed_step3":
      return `⚠️ Выкат ${short(sha)} в GitHub упал на шаге 3/3 (схема, проверка сборки или откат). Сервер сам не повторяет — нужен разбор.`;
    case "give_up":
      return `⛔ Сервер дважды не смог выкатить ${short(sha)} и больше не пробует. Журналы: ~/.wesetup-deploy-agent/runs.`;
    default:
      return `ℹ️ Агент выката: ${key} (${short(sha)}).`;
  }
}

export function readDotEnv(file) {
  const result = {};
  let text = "";
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return result;
  }
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    result[match[1]] = value;
  }
  return result;
}

/**
 * Telegram администратору платформы; без токена или чата — молча ничего.
 * @param {string} text
 * @param {Record<string, string | undefined>} envValues
 * @param {Exec} [exec]
 */
export async function notify(text, envValues, exec = runCommand) {
  const token = envValues.TELEGRAM_BOT_TOKEN;
  const chat = String(envValues.DEPLOY_ALERT_TELEGRAM_CHAT_ID || envValues.PLATFORM_ADMIN_TELEGRAM_CHAT_ID || "")
    .split(/[\s,;]+/)
    .find(Boolean);
  if (!token || !chat) return false;
  const args = ["-sS", "--max-time", "20", "-o", "/dev/null"];
  if (envValues.TELEGRAM_FORCE_IP) args.push("--resolve", `api.telegram.org:443:${envValues.TELEGRAM_FORCE_IP}`);
  args.push("-X", "POST", `https://api.telegram.org/bot${token}/sendMessage`, "--data-urlencode", `chat_id=${chat}`, "--data-urlencode", `text=${text}`);
  const result = await exec("curl", args, { env: process.env, timeoutMs: 30_000 });
  return result.code === 0;
}

async function getJson(url, fetchImpl) {
  const response = await fetchImpl(url, { headers: { Accept: "application/vnd.github+json", "User-Agent": "wesetup-deploy-agent" }, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return response.json();
}

export async function fetchMasterSha(fetchImpl = fetch) {
  const response = await fetchImpl(`https://api.github.com/repos/${REPO}/commits/master`, {
    headers: { Accept: "application/vnd.github.sha", "User-Agent": "wesetup-deploy-agent" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) return null;
  const sha = (await response.text()).trim();
  return /^[0-9a-f]{40}$/.test(sha) ? sha : null;
}

export async function fetchServingSha(fetchImpl = fetch, appUrl = "http://127.0.0.1:3002") {
  try {
    const response = await fetchImpl(`${appUrl}/api/build-info`, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return null;
    const info = await response.json();
    const id = String(info?.fullBuildId || info?.buildId || "").trim().toLowerCase();
    return /^[0-9a-f]{7,40}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

export async function fetchCompare(base, head, fetchImpl = fetch) {
  try {
    const data = await getJson(`https://api.github.com/repos/${REPO}/compare/${base}...${head}`, fetchImpl);
    return ["ahead", "behind", "identical", "diverged"].includes(data?.status) ? data.status : null;
  } catch {
    return null;
  }
}

/** Последний выкат коммита в GitHub: null — не было, "unknown" — GitHub не ответил. */
export async function fetchDeployRun(sha, fetchImpl = fetch) {
  try {
    const data = await getJson(`https://api.github.com/repos/${REPO}/actions/workflows/deploy.yml/runs?head_sha=${sha}&per_page=10`, fetchImpl);
    const runs = (data?.workflow_runs ?? []).slice().sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
    const run = runs[0];
    if (!run) return null;
    const updatedAt = Date.parse(run.updated_at) || Date.now();
    if (run.status !== "completed") return { status: run.status, updatedAt, failure: "running" };
    const jobs = await getJson(`https://api.github.com/repos/${REPO}/actions/runs/${run.id}/jobs?per_page=50`, fetchImpl);
    return { status: "completed", updatedAt, failure: classifyJobs(jobs?.jobs) };
  } catch {
    return "unknown";
  }
}

function readState(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function pruneRunLogs(dir) {
  try {
    const files = readdirSync(dir).filter((name) => name.endsWith(".log")).sort();
    for (const name of files.slice(0, Math.max(0, files.length - KEEP_RUN_LOGS))) rmSync(path.join(dir, name), { force: true });
  } catch {
    /* нет каталога */
  }
}

export async function main({ fetchImpl = fetch, now = Date.now() } = {}) {
  const appDir = process.env.APP_DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const home = homedir();
  const stateDir = process.env.WESETUP_DEPLOY_AGENT_DIR || path.join(home, ".wesetup-deploy-agent");
  const lockDir = process.env.WESETUP_DEPLOY_LOCK_DIR || path.join(home, ".wesetup-deploy.lock.d");
  if (existsSync(path.join(home, ".wesetup-deploy-agent-off")) || process.env.DEPLOY_AGENT === "off") return { action: "idle", reason: "disabled" };
  if (lockHeld(lockDir, now)) return { action: "wait", reason: "locked" };
  mkdirSync(stateDir, { recursive: true });
  const stateFile = path.join(stateDir, "state.json");

  const [master, serving] = await Promise.all([fetchMasterSha(fetchImpl).catch(() => null), fetchServingSha(fetchImpl)]);
  let compare = null;
  let run = null;
  if (master && serving && !sameSha(master, serving)) {
    [compare, run] = await Promise.all([fetchCompare(serving, master, fetchImpl), fetchDeployRun(master, fetchImpl)]);
  }
  const previous = readState(stateFile);
  const decision = decide({ now, master, serving, compare, run, state: previous });
  if (decision.state) writeFileSync(stateFile, `${JSON.stringify({ ...decision.state, lastReason: decision.reason })}\n`);
  else rmSync(stateFile, { force: true });
  const stamp = new Date(now).toISOString();
  // В журнал крона — только смена решения: «ждём» каждые 5 минут не нужно.
  const changed = decision.reason !== previous?.lastReason || decision.state?.sha !== previous?.sha;
  if (decision.action !== "idle" && (changed || decision.action === "deploy")) {
    console.log(`${stamp} [deploy-agent] ${decision.action}: ${decision.reason} (master ${short(master)}, сайт ${short(serving)})`);
  }

  const envValues = { ...readDotEnv(path.join(appDir, ".env")), ...process.env };
  if (decision.notify) await notify(noticeText(decision.notify, { sha: master, serving, compare }), envValues).catch(() => false);
  if (decision.action !== "deploy") return decision;

  const runsDir = path.join(stateDir, "runs");
  mkdirSync(runsDir, { recursive: true });
  const logFile = path.join(runsDir, `${stamp.replace(/[:.]/g, "-")}-${short(master)}.log`);
  await notify(noticeText("start", { sha: master, reason: decision.reason }), envValues).catch(() => false);
  const result = await runDeploy({ sha: master, appDir, stateDir, lockDir, logFile, now });
  console.log(`${new Date().toISOString()} [deploy-agent] ${result.ok ? "выкатил" : `не смог (${result.step})`} ${short(master)} — журнал ${logFile}`);
  await notify(noticeText(result.ok ? "success" : "failure", { sha: master, step: result.step, logFile }), envValues).catch(() => false);
  pruneRunLogs(runsDir);
  return { ...decision, result };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(
    () => process.exit(0),
    (error) => {
      console.error(`${new Date().toISOString()} [deploy-agent] сбой: ${error?.stack ?? error}`);
      process.exit(1);
    },
  );
}
