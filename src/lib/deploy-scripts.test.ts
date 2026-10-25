import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

/**
 * Скрипты деплоя (deploy.yml): ожидание SSH-порта, проверка сборки после
 * рестарта и откат. Сервер и pm2 — заглушки: сервер отдаёт версию из
 * файла `served-build` в каталоге приложения, «pm2 restart» копирует туда
 * `.build-sha` — как настоящий рестарт поднимает сборку, на которую
 * указывает каталог.
 */

const SCRIPTS = path.join(process.cwd(), "scripts");
const NEW_SHA = "bbbbbbb1111111111111111111111111111111111";
const OLD_SHA = "aaaaaaa2222222222222222222222222222222222";

let appDir = "";
let server: http.Server;
let base = "";
let loginStatus = 200;
// Ограничитель переходов на заглушке: без ключа прогрева — 429.
const WARM_KEY = "c0ffee".repeat(11);
let warmRequired = false;
let warmSeen: string[] = [];

// Асинхронно: заглушка сервера живёт в этом же процессе, и синхронный
// запуск заблокировал бы её ответы. Прокси окружения к 127.0.0.1 не нужны.
function run(script: string, args: string[], env: Record<string, string> = {}): Promise<{ status: number; stdout: string; stderr: string }> {
  const childEnv: NodeJS.ProcessEnv = { ...process.env, POST_DEPLOY_ATTEMPTS: "2", POST_DEPLOY_PAUSE: "0", ...env };
  for (const name of Object.keys(childEnv)) if (/^(https?|all|no)_proxy$/i.test(name)) delete childEnv[name];
  childEnv.NO_PROXY = "*";
  return new Promise((resolve) => {
    execFile("bash", [path.join(SCRIPTS, script), ...args], { cwd: appDir, encoding: "utf8", timeout: 30_000, env: childEnv }, (error, stdout, stderr) =>
      resolve({ status: error ? (typeof error.code === "number" ? error.code : 1) : 0, stdout, stderr }),
    );
  });
}

function writeBuild(dir: string, marker: string) {
  fs.mkdirSync(path.join(appDir, dir), { recursive: true });
  fs.writeFileSync(path.join(appDir, dir, "marker"), marker);
}

const readMarker = (dir: string) => fs.readFileSync(path.join(appDir, dir, "marker"), "utf8");

async function closedPort(): Promise<number> {
  const probe = net.createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const { port } = probe.address() as net.AddressInfo;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

before(async () => {
  appDir = fs.mkdtempSync(path.join(os.tmpdir(), "deploy-scripts-"));
  server = http.createServer((request, response) => {
    if (request.url === "/api/build-info") {
      const served = fs.readFileSync(path.join(appDir, "served-build"), "utf8").trim();
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ buildId: served.slice(0, 7), buildTime: "t", fullBuildId: served }));
      return;
    }
    const warm = request.headers["x-deploy-warm"];
    warmSeen.push(typeof warm === "string" ? warm : "");
    if (warmRequired && warm !== WARM_KEY) {
      response.statusCode = 429;
      response.end("wait");
      return;
    }
    response.statusCode = request.url === "/login" ? loginStatus : 200;
    response.end("ok");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as net.AddressInfo).port}`;
  // «pm2 restart»: поднимается сборка, на которую указывает .build-sha.
  fs.writeFileSync(path.join(appDir, "pm2-stub.sh"), 'echo "$@" >> pm2-calls.log\ncp .build-sha served-build\n');
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  fs.rmSync(appDir, { recursive: true, force: true });
});

describe("post-deploy-check.sh", () => {
  it("сайт отдаёт выкатанную версию и адреса отвечают — успех", async () => {
    fs.writeFileSync(path.join(appDir, "served-build"), NEW_SHA);
    const result = await run("post-deploy-check.sh", [base, NEW_SHA]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /сайт отдаёт bbbbbbb/);
  });

  it("на сайте другая версия — провал после всех попыток", async () => {
    fs.writeFileSync(path.join(appDir, "served-build"), OLD_SHA);
    const result = await run("post-deploy-check.sh", [base, NEW_SHA]);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /попытка 2\/2: сайт отдаёт «aaaaaaa», ждём bbbbbbb/);
  });

  it("версия верная, но страница входа отдаёт 500 — провал", async () => {
    fs.writeFileSync(path.join(appDir, "served-build"), NEW_SHA);
    loginStatus = 500;
    try {
      const result = await run("post-deploy-check.sh", [base, NEW_SHA]);
      assert.equal(result.status, 1);
      assert.match(result.stdout, /\/login=500/);
    } finally {
      loginStatus = 200;
    }
  });

  it("страница под лимитом запросов (429) — ждём, а если до конца только 429, сборка работает", async () => {
    fs.writeFileSync(path.join(appDir, "served-build"), NEW_SHA);
    loginStatus = 429;
    try {
      const result = await run("post-deploy-check.sh", [base, NEW_SHA]);
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.match(result.stdout, /под лимитом запросов \(429\): \/login — ждём/);
      assert.match(result.stdout, /отвечали 429 \(лимит запросов\) — сборка работает/);
    } finally {
      loginStatus = 200;
    }
  });

  it("лимит прошёл, а страница отдаёт 500 — провал", async () => {
    fs.writeFileSync(path.join(appDir, "served-build"), NEW_SHA);
    const statuses = [429, 500];
    loginStatus = 429;
    const timer = setInterval(() => (loginStatus = statuses[1]), 50);
    try {
      const result = await run("post-deploy-check.sh", [base, NEW_SHA], { POST_DEPLOY_ATTEMPTS: "3", POST_DEPLOY_PAUSE: "1" });
      assert.equal(result.status, 1, result.stdout);
      assert.match(result.stdout, /\/login=500/);
    } finally {
      clearInterval(timer);
      loginStatus = 200;
    }
  });

  it("общее время проверки ограничено, даже если попыток много", async () => {
    fs.writeFileSync(path.join(appDir, "served-build"), OLD_SHA);
    const started = Date.now();
    const result = await run("post-deploy-check.sh", [base, NEW_SHA], { POST_DEPLOY_ATTEMPTS: "100", POST_DEPLOY_PAUSE: "1", POST_DEPLOY_MAX_SECONDS: "2" });
    assert.equal(result.status, 1);
    assert.match(result.stdout, /вышло время проверки/);
    assert.ok(Date.now() - started < 10_000, `${Date.now() - started} ms`);
  });

  it("сайт не отвечает — провал, а не зависание", async () => {
    const result = await run("post-deploy-check.sh", ["http://127.0.0.1:9", NEW_SHA]);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /нет ответа/);
  });
});

describe("deploy-rollback.sh", () => {
  it("возвращает предыдущую сборку и .build-sha, перезапускает сайт и проверяет прежнюю версию", async () => {
    writeBuild(".next", "new");
    writeBuild(".next-previous", "old");
    fs.writeFileSync(path.join(appDir, ".build-sha"), NEW_SHA);
    fs.writeFileSync(path.join(appDir, "served-build"), "dead0000");
    fs.rmSync(path.join(appDir, "pm2-calls.log"), { force: true });

    // Как на проде: до переключения .build-sha уже новый, и /api/build-info отдаёт
    // прежнюю версию короткой (7 символов).
    const result = await run("deploy-rollback.sh", [base, OLD_SHA.slice(0, 7)], { PM2: `bash ${path.join(appDir, "pm2-stub.sh")}` });

    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(readMarker(".next"), "old");
    assert.equal(readMarker(".next-failed"), "new");
    assert.equal(fs.existsSync(path.join(appDir, ".next-previous")), false);
    assert.equal(fs.readFileSync(path.join(appDir, ".build-sha"), "utf8").trim(), OLD_SHA.slice(0, 7));
    assert.equal(fs.readFileSync(path.join(appDir, "pm2-calls.log"), "utf8").trim(), "restart haccp-online --update-env");
    assert.match(result.stdout, /прод снова на aaaaaaa/);
  });

  it("без .next-previous ничего не трогает и падает", async () => {
    fs.rmSync(path.join(appDir, ".next-previous"), { recursive: true, force: true });
    writeBuild(".next", "current");
    const result = await run("deploy-rollback.sh", [base, OLD_SHA], { PM2: "false" });
    assert.equal(result.status, 1);
    assert.equal(readMarker(".next"), "current");
    assert.match(result.stdout, /откатывать не на что/);
  });
});

describe("prewarm-routes.sh", () => {
  const port = () => String((server.address() as net.AddressInfo).port);

  it("с ключом деплоя каждый адрес идёт с заголовком прогрева и не упирается в лимит", async () => {
    warmRequired = true;
    warmSeen = [];
    try {
      const result = await run("prewarm-routes.sh", [], { PORT: port(), DEPLOY_WARM_TOKEN: WARM_KEY });
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.ok(warmSeen.length > 60, `${warmSeen.length} запросов`);
      assert.ok(warmSeen.every((key) => key === WARM_KEY));
      assert.doesNotMatch(result.stdout, /→ 429|ответили 429/);
      assert.match(result.stdout, /\/login → 200/);
      assert.ok(!(result.stdout + result.stderr).includes(WARM_KEY), "ключ не попадает в лог");
    } finally {
      warmRequired = false;
    }
  });

  it("без ключа запросы под общим лимитом — в логе видно, сколько адресов не прогрето", async () => {
    warmRequired = true;
    warmSeen = [];
    try {
      const result = await run("prewarm-routes.sh", [], { PORT: port(), DEPLOY_WARM_TOKEN: "" });
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.ok(warmSeen.every((key) => key === ""));
      assert.match(result.stdout, /DEPLOY_WARM_TOKEN не задан/);
      assert.match(result.stdout, new RegExp(`\\[prewarm\\] ${warmSeen.length} адресов ответили 429`));
    } finally {
      warmRequired = false;
    }
  });
});

describe("wait-for-port.sh", () => {
  it("порт отвечает — сразу успех", async () => {
    const { port } = server.address() as net.AddressInfo;
    const result = await run("wait-for-port.sh", ["127.0.0.1", String(port), "2", "0"]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /попытка 1\/2/);
  });

  it("порт не отвечает — ошибка с причиной после всех попыток", async () => {
    const result = await run("wait-for-port.sh", ["127.0.0.1", String(await closedPort()), "2", "0"]);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /SSH-порт сервера не отвечает/);
  });
});
