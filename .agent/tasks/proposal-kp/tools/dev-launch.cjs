// Запуск next dev из пути со СТРОЧНОЙ буквой диска (d:/wt/kp): с «D:» dev-сервер
// отдаёт 404 на динамических маршрутах. Start-Process/cmd/bash нормализуют букву
// диска в заглавную, process.chdir — нет.
process.chdir("d:/wt/kp");
process.env.NEXT_DIST_DIR = ".next-e2e";
const bin = require("node:path").join(process.cwd(), "node_modules", "next", "dist", "bin", "next");
process.argv = [process.argv[0], bin, "dev", "--webpack", "-p", "3192"];
console.log("[launch] cwd=" + process.cwd() + " bin=" + bin);
require(bin);
