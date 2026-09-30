// Dev-сервер задачи bzhgp: next dev --webpack -p 3195 из d:/wt/bzhgp (строчная d:,
// иначе часть маршрутов отдаёт 404), кэш в .next-e2e, лог — вне проекта.
const { spawn } = require("node:child_process");
const fs = require("node:fs");

process.chdir("d:/wt/bzhgp");
const out = fs.openSync("d:/wt/tmp-bzhgp/dev.log", "a");
const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--webpack", "-p", "3195"], {
  cwd: "d:/wt/bzhgp",
  env: { ...process.env, NEXT_DIST_DIR: ".next-e2e", NEXT_TELEMETRY_DISABLED: "1" },
  detached: true,
  stdio: ["ignore", out, out],
  windowsHide: true,
});
fs.writeFileSync("d:/wt/tmp-bzhgp/dev.pid", String(child.pid));
child.unref();
console.log(`dev pid ${child.pid}`);
