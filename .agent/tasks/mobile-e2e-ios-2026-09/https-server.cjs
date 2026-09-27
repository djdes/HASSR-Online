// Копия сайта для проверки приложения в CI: тот же `next start`, но по HTTPS.
// Зачем: в production-режиме сайт ставит куку входа `__Secure-…` с Secure, а
// WKWebView не сохраняет Secure-куки на http://localhost — вход «не срабатывал» бы
// из-за стенда, а не из-за приложения. Сертификат выпускает workflow
// (свой корневой сертификат добавляется в доверенные симулятора).
// Запуск из корня репозитория: NODE_ENV=production TLS_KEY=… TLS_CERT=… PORT=3000 node https-server.cjs
const https = require("node:https");
const fs = require("node:fs");
const path = require("node:path");
const next = require(path.join(process.cwd(), "node_modules/next"));

const port = Number(process.env.PORT || 3000);
const app = next({ dev: false, dir: process.cwd(), hostname: "localhost", port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  https
    .createServer({ key: fs.readFileSync(process.env.TLS_KEY), cert: fs.readFileSync(process.env.TLS_CERT) }, (req, res) => {
      const started = Date.now();
      res.on("finish", () => {
        if (res.statusCode >= 400 || process.env.LOG_ALL === "1") {
          console.log(`[req] ${req.method} ${req.url} -> ${res.statusCode} ${Date.now() - started}ms ua=${(req.headers["user-agent"] || "").slice(-40)}`);
        }
      });
      handle(req, res);
    })
    .listen(port, () => console.log(`> ready on https://localhost:${port}`));
});
