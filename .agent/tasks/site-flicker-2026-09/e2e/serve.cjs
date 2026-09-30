// Запуск сервера рабочей копии из пути со строчной `d:` (иначе часть маршрутов — 404).
//   node serve.cjs start   — production (`next start`, сборка в .next-prod)
//   node serve.cjs dev     — `next dev --webpack` (сборка в .next-e2e)
//   node serve.cjs build   — `next build --webpack` в .next-prod (ждёт окончания)
// Лог — d:/wt/tmp-flicker/server-<mode>.log, PID — d:/wt/tmp-flicker/server-<mode>.pid.
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const mode = process.argv[2] || "start";
const CWD = "d:/wt/flicker";
const TMP = "d:/wt/tmp-flicker";
const PORT = "3197";
fs.mkdirSync(TMP, { recursive: true });
process.chdir(CWD);

const nextBin = path.join(CWD, "node_modules/next/dist/bin/next");
const env = { ...process.env, NEXT_TELEMETRY_DISABLED: "1" };
let args;
if (mode === "dev") {
  env.NEXT_DIST_DIR = ".next-e2e";
  args = [nextBin, "dev", "--webpack", "-p", PORT];
} else if (mode === "build") {
  env.NEXT_DIST_DIR = ".next-prod";
  env.NODE_OPTIONS = "--max-old-space-size=8192";
  args = [nextBin, "build", "--webpack"];
} else {
  env.NEXT_DIST_DIR = ".next-prod";
  env.NODE_ENV = "production";
  args = [nextBin, "start", "-p", PORT];
}

const log = fs.openSync(path.join(TMP, `server-${mode}.log`), "w");
const child = spawn(process.execPath, args, {
  cwd: CWD,
  env,
  stdio: ["ignore", log, log],
  detached: mode !== "build",
  windowsHide: true,
});
fs.writeFileSync(path.join(TMP, `server-${mode}.pid`), String(child.pid));
if (mode === "build") {
  child.on("exit", (code) => {
    console.log(`build exit=${code}`);
    process.exit(code ?? 1);
  });
} else {
  child.unref();
  console.log(`${mode} pid=${child.pid} log=${path.join(TMP, `server-${mode}.log`)}`);
}
