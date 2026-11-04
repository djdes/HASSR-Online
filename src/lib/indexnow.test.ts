import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import type net from "node:net";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import {
  chunkIndexNowUrls,
  extractSitemapUrls,
  INDEXNOW_ENDPOINTS,
  INDEXNOW_KEY,
  isIndexNowAcceptedStatus,
  submitSitemapToIndexNow,
} from "@/lib/indexnow";

describe("IndexNow protocol helpers and CLI", () => {
  let server: http.Server;
  let baseUrl = "";
  let receivedPosts: Array<{ path: string; body: Record<string, unknown> }> = [];
  let serveValidKey = true;
  let endpointStatus: Record<string, number> = {};

  before(async () => {
    server = http.createServer((req, res) => {
      if (req.method === "GET" && req.url === `/${INDEXNOW_KEY}.txt`) {
        if (!serveValidKey) {
          res.statusCode = 404;
          res.end("missing");
          return;
        }
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end(INDEXNOW_KEY);
        return;
      }

      if (req.method === "GET" && req.url === "/sitemap.xml") {
        res.setHeader("Content-Type", "application/xml; charset=utf-8");
        res.end(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${baseUrl}/</loc></url>
  <url><loc>${baseUrl}/sanpin-2-3-2-4-4282-26</loc></url>
  <url><loc>${baseUrl}/zhurnal-generalnyh-uborok</loc></url>
  <url><loc>${baseUrl}/sanpin-2-3-2-4-4282-26</loc></url>
  <url><loc>https://evil.example.com/phishing</loc></url>
</urlset>`);
        return;
      }

      if (req.method === "POST" && (req.url === "/yandex" || req.url === "/bing")) {
        const chunks: Buffer[] = [];
        req.on("data", (c: Buffer) => chunks.push(c));
        req.on("end", () => {
          const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
          receivedPosts.push({ path: req.url ?? "", body: parsed });
          res.statusCode = endpointStatus[req.url ?? ""] ?? 200;
          res.end("OK");
        });
        return;
      }

      res.statusCode = 404;
      res.end("not found");
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as net.AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("keeps public key file, TS constant, and CLI script key strictly in sync", () => {
    assert.match(INDEXNOW_KEY, /^[0-9a-f]{32}$/);
    const publicKeyPath = path.resolve(process.cwd(), `public/${INDEXNOW_KEY}.txt`);
    assert.equal(fs.readFileSync(publicKeyPath, "utf8").trim(), INDEXNOW_KEY);

    const cliScript = fs.readFileSync(path.resolve(process.cwd(), "scripts/submit-indexnow.mjs"), "utf8");
    assert.ok(cliScript.includes(`export const INDEXNOW_KEY = "${INDEXNOW_KEY}"`));
    assert.deepEqual([...INDEXNOW_ENDPOINTS], [
      "https://yandex.com/indexnow",
      "https://api.indexnow.org/indexnow",
    ]);
  });

  it("extracts unique same-origin URLs from XML and decodes entities", () => {
    const xml = `
      <urlset>
        <url><loc>https://wesetup.ru/</loc></url>
        <url><loc>https://wesetup.ru/blog?a=1&amp;b=2</loc></url>
        <url><loc>https://wesetup.ru/</loc></url>
        <url><loc>https://other.ru/page</loc></url>
      </urlset>
    `;
    assert.deepEqual(extractSitemapUrls(xml, "https://wesetup.ru"), [
      "https://wesetup.ru/",
      "https://wesetup.ru/blog?a=1&b=2",
    ]);
  });

  it("chunks URLs within IndexNow 10,000-URL limit and recognizes 200/202", () => {
    assert.deepEqual(chunkIndexNowUrls(["a", "b", "c", "d", "e"], 2), [["a", "b"], ["c", "d"], ["e"]]);
    assert.equal(isIndexNowAcceptedStatus(200), true);
    assert.equal(isIndexNowAcceptedStatus(202), true);
    assert.equal(isIndexNowAcceptedStatus(403), false);
    assert.equal(isIndexNowAcceptedStatus(429), false);
  });

  it("verifies key file and submits deduplicated sitemap URLs via TS helper", async () => {
    receivedPosts = [];
    serveValidKey = true;
    endpointStatus = { "/yandex": 200, "/bing": 202 };

    const summary = await submitSitemapToIndexNow({
      baseUrl,
      endpoints: [`${baseUrl}/yandex`, `${baseUrl}/bing`],
    });

    assert.equal(summary.urlCount, 3);
    assert.equal(summary.results.length, 2);
    assert.ok(summary.results.every((r) => r.accepted));
    assert.equal(receivedPosts.length, 2);
    assert.deepEqual(receivedPosts[0].body, {
      host: new URL(baseUrl).host,
      key: INDEXNOW_KEY,
      keyLocation: `${baseUrl}/${INDEXNOW_KEY}.txt`,
      urlList: [
        `${baseUrl}/`,
        `${baseUrl}/sanpin-2-3-2-4-4282-26`,
        `${baseUrl}/zhurnal-generalnyh-uborok`,
      ],
    });
  });

  it("executes standalone scripts/submit-indexnow.mjs end-to-end", async () => {
    receivedPosts = [];
    serveValidKey = true;
    endpointStatus = { "/yandex": 202, "/bing": 200 };

    const childEnv: NodeJS.ProcessEnv = { ...process.env, INDEXNOW_TIMEOUT_MS: "5000" };
    for (const k of Object.keys(childEnv)) {
      if (/^(https?|all|no)_proxy$/i.test(k)) delete childEnv[k];
    }
    childEnv.NO_PROXY = "*";

    const res = await new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
      execFile(
        process.execPath,
        [
          path.resolve(process.cwd(), "scripts/submit-indexnow.mjs"),
          "--base-url",
          baseUrl,
          "--endpoints",
          `${baseUrl}/yandex,${baseUrl}/bing`,
          "--strict",
        ],
        { env: childEnv, encoding: "utf8", timeout: 15_000 },
        (err, stdout, stderr) =>
          resolve({ code: err ? (typeof err.code === "number" ? err.code : 1) : 0, stdout, stderr }),
      );
    });

    assert.equal(res.code, 0, res.stdout + res.stderr);
    assert.match(res.stdout, /submitting 3 URLs/);
    assert.equal(receivedPosts.length, 2);
  });

  it("exits 0 with --non-fatal when key file is not yet reachable", async () => {
    serveValidKey = false;
    try {
      const childEnv: NodeJS.ProcessEnv = { ...process.env, INDEXNOW_TIMEOUT_MS: "2000" };
      for (const k of Object.keys(childEnv)) {
        if (/^(https?|all|no)_proxy$/i.test(k)) delete childEnv[k];
      }
      childEnv.NO_PROXY = "*";

      const res = await new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
        execFile(
          process.execPath,
          [
            path.resolve(process.cwd(), "scripts/submit-indexnow.mjs"),
            "--base-url",
            baseUrl,
            "--endpoints",
            `${baseUrl}/yandex`,
            "--non-fatal",
          ],
          { env: childEnv, encoding: "utf8", timeout: 15_000 },
          (err, stdout, stderr) =>
            resolve({ code: err ? (typeof err.code === "number" ? err.code : 1) : 0, stdout, stderr }),
        );
      });

      assert.equal(res.code, 0, res.stdout + res.stderr);
      assert.match(res.stderr, /non-fatal warning/);
    } finally {
      serveValidKey = true;
    }
  });
});
