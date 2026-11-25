// Подставная очередь ProjectsFlow для стенда: принимает задание, сразу «выполняет» его.
// Последнее задание пишет в last-job.txt — сценарий проверяет, что ушло в очередь.
import http from "node:http";
import fs from "node:fs";
const OUT = process.argv[2] ?? ".";
const jobs = new Map();
let seq = 0;
http.createServer((req, res) => {
  const auth = req.headers.authorization;
  if (auth !== "Bearer mock-token") { res.writeHead(401); return res.end(); }
  if (req.method === "POST" && req.url === "/agent/ai-prompt-jobs") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const job = JSON.parse(body);
      const id = `job${++seq}`;
      fs.writeFileSync(`${OUT}/last-job.txt`, job.text);
      const title = /Раздел: (.+)/.exec(job.text)?.[1] ?? "Раздел";
      const fail = /FAILJOB/.test(job.text);
      jobs.set(id, fail ? { status: "failed", error: "mock_failed" } : {
        status: "succeeded",
        improvedText: "```text\n## " + title + "\n\n**1. Общие положения**\n\nЧерновик подготовлен по данным кабинета.\n* Пункт списка\n```",
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ jobId: id }));
    });
    return;
  }
  const m = /^\/agent\/ai-prompt-jobs\/([^/?]+)/.exec(req.url ?? "");
  if (req.method === "GET" && m) {
    const job = jobs.get(m[1]);
    if (!job) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ jobId: m[1], ...job }));
  }
  res.writeHead(404); res.end();
}).listen(4010, "127.0.0.1", () => console.log("mock PF on 4010"));
