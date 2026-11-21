import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import {
  DEPLOY_STEPS,
  GRACE_MS,
  MAX_ATTEMPTS,
  SETTLE_MS,
  acquireLock,
  classifyJobs,
  decide,
  extractStepScript,
  lockHeld,
  noticeText,
  notify,
  renderStepScript,
  runDeploy,
} from "../../scripts/deploy-agent.mjs";

/**
 * Агент выката на сервере (спека deploy-pull-agent-2026-11-21): сервер сам
 * выкатывает master, если выкат из GitHub до него не дошёл.
 */

const SCRIPTS = path.join(process.cwd(), "scripts");
const MASTER = "b".repeat(40);
const SERVING = "a".repeat(40);
const NOW = Date.parse("2026-11-21T12:00:00Z");
const WORKFLOW = fs.readFileSync(path.join(process.cwd(), ".github/workflows/deploy.yml"), "utf8");

let tmp = "";
before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "deploy-agent-"));
});
after(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const base = { now: NOW, master: MASTER, serving: SERVING, compare: "ahead", run: null, state: null } as const;
const failedRun = (failure: string, minutesAgo = 5) => ({ status: "completed", updatedAt: NOW - minutesAgo * 60_000, failure });

describe("decide", () => {
  it("сайт на master — ничего, состояние сбрасывается", () => {
    const result = decide({ ...base, serving: MASTER.slice(0, 7), state: { sha: MASTER, firstSeen: 0, attempts: 1 } });
    assert.equal(result.action, "idle");
    assert.equal(result.state, null);
  });

  it("нет сведений о master или о сайте — ждать", () => {
    assert.equal(decide({ ...base, master: null }).action, "wait");
    assert.equal(decide({ ...base, serving: null }).reason, "serving_unknown");
  });

  it("выкат в GitHub ещё идёт — ждать", () => {
    assert.equal(decide({ ...base, run: { status: "in_progress", updatedAt: NOW, failure: "running" } }).reason, "github_running");
    assert.equal(decide({ ...base, run: "unknown" }).reason, "github_unknown");
  });

  it("выкат в GitHub упал до шагов или на шагах 1–2: < 2 мин — ждать, потом выкатывать", () => {
    assert.equal(decide({ ...base, run: failedRun("connectivity", 1) }).reason, "settling");
    for (const failure of ["connectivity", "steps12"]) {
      const result = decide({ ...base, run: failedRun(failure, SETTLE_MS / 60_000 + 1) });
      assert.equal(result.action, "deploy", failure);
      assert.equal(result.reason, `github_failed_${failure}`);
      assert.equal(result.state?.attempts, 1);
    }
  });

  it("выката в GitHub нет: < 20 мин — ждать, потом выкатывать", () => {
    const fresh = decide({ ...base });
    assert.equal(fresh.reason, "grace");
    assert.equal(fresh.state?.firstSeen, NOW);
    const later = decide({ ...base, now: NOW + GRACE_MS + 1, state: fresh.state });
    assert.equal(later.action, "deploy");
    assert.equal(later.reason, "github_missing");
  });

  it("master не впереди сайта — не выкатывать, одно сообщение на коммит", () => {
    const behind = decide({ ...base, compare: "behind", run: failedRun("connectivity") });
    assert.equal(behind.action, "skip");
    assert.equal(behind.notify, "compare_behind");
    assert.equal(decide({ ...base, compare: "behind", run: failedRun("connectivity"), state: behind.state }).notify, undefined, "второй раз — молча");
    assert.equal(decide({ ...base, compare: "diverged", run: failedRun("connectivity") }).notify, "compare_diverged");
    assert.equal(decide({ ...base, compare: null, run: failedRun("connectivity") }).action, "wait", "GitHub не ответил — не выкатывать");
  });

  it("шаг 3/3 в GitHub упал или GitHub выкатил, а сайт другой — сам не трогает", () => {
    assert.equal(decide({ ...base, run: failedRun("step3") }).notify, "failed_step3");
    assert.equal(decide({ ...base, run: failedRun("deployed") }).notify, "deployed_but_differs");
    assert.equal(decide({ ...base, run: failedRun("unknown") }).action, "wait");
  });

  it("попытки кончились — стоп и одно сообщение", () => {
    const state = { sha: MASTER, firstSeen: NOW - GRACE_MS * 3, attempts: MAX_ATTEMPTS, notified: [] };
    const result = decide({ ...base, run: failedRun("connectivity"), state });
    assert.equal(result.action, "give-up");
    assert.equal(result.notify, "give_up");
    assert.equal(decide({ ...base, run: failedRun("connectivity"), state: result.state }).notify, undefined);
  });

  it("новый коммит в master — попытки с нуля", () => {
    const old = { sha: "c".repeat(40), firstSeen: 0, attempts: MAX_ATTEMPTS, notified: ["give_up"] };
    const result = decide({ ...base, run: failedRun("connectivity"), state: old });
    assert.equal(result.action, "deploy");
    assert.equal(result.state?.attempts, 1);
  });
});

describe("classifyJobs", () => {
  const job = (name: string, conclusion: string, failedStep?: string) => ({
    name,
    conclusion,
    steps: failedStep ? [{ name: "Set up job", conclusion: "success" }, { name: failedStep, conclusion: "failure" }] : [],
  });
  it("по job'ам выката в GitHub", () => {
    assert.equal(classifyJobs([job("Upload tarball", "failure", "Wait for SSH"), job("deploy", "skipped")]), "connectivity");
    assert.equal(classifyJobs([job("Upload tarball", "success"), job("deploy", "failure", "Wait for SSH")]), "connectivity");
    assert.equal(classifyJobs([job("Upload tarball", "success"), job("deploy", "failure", "Deploy step 2/3 — build + verify")]), "steps12");
    assert.equal(classifyJobs([job("Upload tarball", "success"), job("deploy", "failure", "Deploy step 3/3 — db push + seeds + pm2 restart + prewarm")]), "step3");
    assert.equal(classifyJobs([job("Type-check & Targeted tests", "failure"), job("Upload tarball", "success"), job("deploy", "success")]), "deployed");
    assert.equal(classifyJobs([]), "unknown");
  });
});

describe("шаги из deploy.yml", () => {
  it("извлекаются из настоящего deploy.yml: шаги 1/3–3/3 и скачивание коммита", () => {
    const markers = ["Incremental source sync", "NEXT_DIST_DIR=.next-build", "scripts/post-deploy-check.sh"];
    DEPLOY_STEPS.forEach((step, index) => {
      const script = extractStepScript(WORKFLOW, step.name);
      assert.match(script, /^set -eo pipefail\ncd \$\{\{ env\.APP_DIR \}\}\n/, step.name);
      assert.ok(script.includes(markers[index]), `${step.name}: ${markers[index]}`);
      assert.match(script, /deploy_lock_acquire "github: шаг \d\/3 \$GITHUB_SHA" 1500 \|\| exit 1/);
      const rendered = renderStepScript(script, { appDir: "/var/www/app", sha: MASTER });
      assert.doesNotMatch(rendered, /\$\{\{/);
      assert.ok(rendered.includes("cd /var/www/app\n") && rendered.includes(`export GITHUB_SHA="${MASTER}"`));
    });
    const download = extractStepScript(WORKFLOW, "Server downloads the commit from GitHub");
    assert.match(download, /deploy_lock_acquire "github: скачивание \$\{\{ github\.sha \}\}" 1500 \|\| exit 1/);
    assert.ok(download.indexOf("deploy_lock_acquire") > download.indexOf("trap 'rm -rf \"$WORK\"' EXIT"), "замок — после своего trap");
  });

  it("незнакомое выражение GitHub, чужой путь или не SHA — отказ", () => {
    assert.throws(() => renderStepScript("echo ${{ secrets.TOKEN }}\n", { appDir: "/var/www/app", sha: MASTER }), /неизвестное выражение/);
    assert.throws(() => renderStepScript("echo\n", { appDir: "/var/www/app; rm -rf /", sha: MASTER }), /не похож на путь/);
    assert.throws(() => renderStepScript("echo\n", { appDir: "/var/www/app", sha: "master" }), /не SHA/);
    assert.throws(() => extractStepScript(WORKFLOW, "Deploy step 4/3"), /нет шага/);
  });
});

describe("runDeploy — на заглушках, без сети и pm2", () => {
  function fakeSource(steps: string[]) {
    const yml = ["jobs:", "  deploy:", "    steps:"];
    steps.forEach((body, index) => {
      yml.push(`      - name: Deploy step ${index + 1}/3 — test`, "        with:", "          script: |", ...body.split("\n").map((line) => `            ${line}`));
    });
    return `${yml.join("\n")}\n`;
  }

  async function deployWith(steps: string[], name: string) {
    const root = path.join(tmp, name);
    const appDir = path.join(root, "app");
    const stateDir = path.join(root, "state");
    const lockDir = path.join(root, "lock.d");
    fs.mkdirSync(appDir, { recursive: true });
    const calls: string[] = [];
    let lockDuringSteps = false;
    const exec = async (command: string, args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {}) => {
      if (command === "curl") {
        calls.push("curl");
        return { code: 0 };
      }
      if (command === "tar") {
        calls.push("tar");
        const src = args[args.indexOf("-C") + 1];
        fs.mkdirSync(path.join(src, ".github/workflows"), { recursive: true });
        fs.writeFileSync(path.join(src, ".github/workflows/deploy.yml"), fakeSource(steps));
        return { code: 0 };
      }
      if (command === "bash" && args[0].endsWith("deploy-tarball.sh")) {
        calls.push("tarball");
        fs.writeFileSync(args[2], "tar");
        return { code: 0 };
      }
      // Шаги — настоящим bash: окружение и порядок как на сервере.
      calls.push(path.basename(args[0]));
      lockDuringSteps = lockDuringSteps || fs.existsSync(lockDir);
      return new Promise<{ code: number }>((resolve) => {
        const child = spawn("bash", args, { cwd: opts.cwd, env: opts.env, stdio: "ignore" });
        child.on("close", (code) => resolve({ code: code ?? 1 }));
      });
    };
    const result = await runDeploy({ sha: MASTER, appDir, stateDir, lockDir, exec, now: NOW });
    const trace = fs.existsSync(path.join(appDir, "trace")) ? fs.readFileSync(path.join(appDir, "trace"), "utf8").trim().split("\n") : [];
    return { result, calls, trace, appDir, lockDir, stateDir, lockDuringSteps };
  }

  const step = (n: number, extra = "") => `set -eo pipefail\ncd \${{ env.APP_DIR }}\nexport GITHUB_SHA="\${{ github.sha }}"\necho "step${n} $GITHUB_SHA $WESETUP_DEPLOY_LOCKED" >> trace${extra}`;

  it("скачать → deploy.tar → шаги 1–3 по порядку, с SHA и без своего замка; замок снят", async () => {
    const run = await deployWith([step(1), step(2), step(3)], "ok");
    assert.deepEqual(run.result, { ok: true });
    assert.deepEqual(run.calls, ["curl", "tar", "tarball", "step-1.sh", "step-2.sh", "step-3.sh"]);
    assert.deepEqual(run.trace, [`step1 ${MASTER} 1`, `step2 ${MASTER} 1`, `step3 ${MASTER} 1`]);
    assert.equal(fs.readFileSync(path.join(run.appDir, "deploy.tar"), "utf8"), "tar");
    assert.ok(run.lockDuringSteps, "замок держится во время шагов");
    assert.equal(fs.existsSync(run.lockDir), false, "замок снят");
    assert.equal(fs.existsSync(path.join(run.stateDir, "work")), false, "временный каталог убран");
  });

  it("упал шаг 2 — шаг 3 не запускается, замок снят", async () => {
    const run = await deployWith([step(1), step(2, "\nexit 3"), step(3)], "fail");
    assert.equal(run.result.ok, false);
    assert.equal(run.result.step, "Deploy step 2/3");
    assert.deepEqual(run.trace, [`step1 ${MASTER} 1`, `step2 ${MASTER} 1`]);
    assert.equal(fs.existsSync(run.lockDir), false);
  });

  it("замок занят свежим выкатом — не начинает; старый замок снимает", () => {
    const lockDir = path.join(tmp, "busy.d");
    fs.mkdirSync(lockDir);
    assert.equal(acquireLock(lockDir, "agent", Date.now()), false);
    assert.equal(lockHeld(lockDir), true);
    const old = new Date(Date.now() - 46 * 60_000);
    fs.utimesSync(lockDir, old, old);
    assert.equal(lockHeld(lockDir), false);
    assert.equal(acquireLock(lockDir, "agent", Date.now()), true);
    assert.equal(fs.readFileSync(path.join(lockDir, "owner"), "utf8"), "agent\n");
  });
});

describe("сообщения в Telegram", () => {
  it("тексты для владельца и отправка curl с TELEGRAM_FORCE_IP; без токена — ничего", async () => {
    assert.match(noticeText("start", { sha: MASTER, reason: "github_failed_connectivity" }), /^🚚 Сервер сам выкатывает bbbbbbb/);
    assert.match(noticeText("failure", { sha: MASTER, step: "Deploy step 2/3", logFile: "/x.log" }), /«Deploy step 2\/3»/);
    const calls: string[][] = [];
    const exec = async (_command: string, args: string[]) => {
      calls.push(args);
      return { code: 0 };
    };
    assert.equal(await notify("hi", { TELEGRAM_BOT_TOKEN: "T", PLATFORM_ADMIN_TELEGRAM_CHAT_ID: "111, 222", TELEGRAM_FORCE_IP: "203.0.113.1" }, exec), true);
    assert.ok(calls[0].includes("api.telegram.org:443:203.0.113.1"));
    assert.ok(calls[0].includes("chat_id=111"));
    assert.equal(await notify("hi", { PLATFORM_ADMIN_TELEGRAM_CHAT_ID: "111" }, exec), false);
    assert.equal(calls.length, 1);
  });
});

function bash(script: string, env: Record<string, string> = {}, timeout = 30_000): Promise<{ code: number; stdout: string }> {
  const childEnv: NodeJS.ProcessEnv = { ...process.env, ...env };
  return new Promise((resolve) => {
    execFile("bash", ["-c", script], { env: childEnv, encoding: "utf8", timeout }, (error, stdout) =>
      resolve({ code: error ? (typeof error.code === "number" ? error.code : 1) : 0, stdout }),
    );
  });
}

describe("deploy-lock.sh", () => {
  const lock = () => path.join(tmp, `lock-${Math.random().toString(36).slice(2)}.d`);
  const source = `. ${path.join(SCRIPTS, "deploy-lock.sh")}`;

  it("берёт и снимает при выходе; свой trap шага сохраняется", async () => {
    const dir = lock();
    const run = await bash(`${source}; trap 'echo prev-trap' EXIT; deploy_lock_acquire "test" 0 && cat "${dir}/owner"`, { WESETUP_DEPLOY_LOCK_DIR: dir });
    assert.equal(run.code, 0);
    assert.match(run.stdout, /^test\nprev-trap\n$/);
    assert.equal(fs.existsSync(dir), false, "снят при выходе");
  });

  it("занят — ждёт и отказывает; освободили — берёт; старый — снимает; WESETUP_DEPLOY_LOCKED=1 — без замка", async () => {
    const dir = lock();
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "owner"), "agent X\n");
    const busy = await bash(`${source}; deploy_lock_acquire "github" 2`, { WESETUP_DEPLOY_LOCK_DIR: dir, WESETUP_DEPLOY_LOCK_PAUSE: "1" });
    assert.equal(busy.code, 1);
    assert.match(busy.stdout, /идёт другой выкат: agent X[\s\S]*остановлено/);

    setTimeout(() => fs.rmSync(dir, { recursive: true, force: true }), 1200);
    const waited = await bash(`${source}; deploy_lock_acquire "github" 10 && echo got`, { WESETUP_DEPLOY_LOCK_DIR: dir, WESETUP_DEPLOY_LOCK_PAUSE: "1" });
    assert.equal(waited.code, 0);
    assert.match(waited.stdout, /got/);

    fs.mkdirSync(dir);
    const old = new Date(Date.now() - 50 * 60_000);
    fs.utimesSync(dir, old, old);
    const stale = await bash(`${source}; deploy_lock_acquire "github" 0 && echo got`, { WESETUP_DEPLOY_LOCK_DIR: dir });
    assert.match(stale.stdout, /старше 45 мин[\s\S]*got/);

    fs.mkdirSync(dir);
    const held = await bash(`${source}; deploy_lock_acquire "step" 0 && echo free`, { WESETUP_DEPLOY_LOCK_DIR: dir, WESETUP_DEPLOY_LOCKED: "1" });
    assert.match(held.stdout, /free/);
    assert.equal(fs.existsSync(dir), true, "чужой замок не тронут");
  });
});

describe("установка агента", () => {
  it("строка crontab ставится один раз, чужие строки целы, окружение деплоя снято", async () => {
    const bin = path.join(tmp, "bin");
    const store = path.join(tmp, "crontab.txt");
    fs.mkdirSync(bin, { recursive: true });
    fs.writeFileSync(store, "0 3 * * * /usr/bin/backup # чужая\n");
    fs.writeFileSync(path.join(bin, "crontab"), `#!/usr/bin/env bash\nif [ "$1" = "-l" ]; then cat "${store}"; else cat > "${store}"; fi\n`, { mode: 0o755 });
    const stateDir = path.join(tmp, "agent-state");
    const env = { PATH: `${bin}:${process.env.PATH}`, WESETUP_DEPLOY_AGENT_DIR: stateDir, LANG: "ru_RU.UTF-8" };
    const first = await bash(`bash ${path.join(SCRIPTS, "install-deploy-agent-cron.sh")}`, env);
    const second = await bash(`bash ${path.join(SCRIPTS, "install-deploy-agent-cron.sh")}`, env);
    assert.equal(first.code, 0, first.stdout);
    assert.match(second.stdout, /уже установлен/);
    const lines = fs.readFileSync(store, "utf8").trim().split("\n");
    assert.equal(lines.filter((line) => line.includes("# wesetup-deploy-agent")).length, 1);
    assert.ok(lines.includes("0 3 * * * /usr/bin/backup # чужая"));
    assert.match(lines.find((line) => line.includes("wesetup-deploy-agent")) ?? "", /^4-59\/5 \* \* \* \* \/bin\/bash \S+\/scripts\/deploy-agent\.sh >> \$HOME\/wesetup-deploy-agent\.log 2>&1 # wesetup-deploy-agent$/);
    const snapshot = fs.readFileSync(path.join(stateDir, "env"), "utf8");
    assert.match(snapshot, /^export PATH=/m);
    assert.match(snapshot, /^export LANG=ru_RU\.UTF-8$/m);
  });

  it("выкат ставит агента в шаге 3 после проверки новой сборки, не роняя выкатку", () => {
    const install = WORKFLOW.indexOf("bash scripts/install-deploy-agent-cron.sh");
    assert.ok(install > WORKFLOW.indexOf("bash scripts/post-deploy-check.sh"));
    assert.ok(install < WORKFLOW.indexOf('echo "=== Deploy complete ==="'));
    assert.match(WORKFLOW, /bash scripts\/install-deploy-agent-cron\.sh 2>&1 \| tail -3 \|\| echo "\[warn\]/);
    const wrapper = fs.readFileSync(path.join(SCRIPTS, "deploy-agent.sh"), "utf8");
    assert.match(wrapper, /\.wesetup-deploy-agent-off/);
    assert.match(wrapper, /exec node "\$APP_DIR\/scripts\/deploy-agent\.mjs"/);
  });
});
