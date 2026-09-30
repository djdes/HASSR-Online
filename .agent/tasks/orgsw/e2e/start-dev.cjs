// Dev-сервер задачи orgsw: next dev --webpack -p 3196 из d:/wt/orgsw (строчная d: — иначе часть маршрутов 404),
// NEXT_DIST_DIR=.next-e2e, фиктивный тестовый магазин Робокассы (боевые ключи не используются).
// Лог — d:/wt/tmp-orgsw/dev-server.log, pid — d:/wt/tmp-orgsw/dev-server.pid.
// Запуск: node .agent/tasks/orgsw/e2e/start-dev.cjs
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const WT = "d:/wt/orgsw";
const OUT = "d:/wt/tmp-orgsw";
fs.mkdirSync(OUT, { recursive: true });
process.chdir(WT);

const log = fs.openSync(path.join(OUT, "dev-server.log"), "a");
const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--webpack", "-p", "3196"], {
  cwd: WT,
  detached: true,
  stdio: ["ignore", log, log],
  env: {
    ...process.env,
    NEXT_DIST_DIR: ".next-e2e",
    NEXT_TELEMETRY_DISABLED: "1",
    ROBOKASSA_IS_TEST: "1",
    ROBOKASSA_MERCHANT_LOGIN: "orgsw-fake-shop",
    ROBOKASSA_TEST_PASSWORD1: "orgsw-fake-pass-1",
    ROBOKASSA_TEST_PASSWORD2: "orgsw-fake-pass-2",
    ROBOKASSA_PASSWORD1: "",
    ROBOKASSA_PASSWORD2: "",
    ROBOKASSA_SEND_RECEIPT: "",
  },
});
child.unref();
fs.writeFileSync(path.join(OUT, "dev-server.pid"), String(child.pid));
console.log(`dev-server pid=${child.pid} → ${path.join(OUT, "dev-server.log")}`);
