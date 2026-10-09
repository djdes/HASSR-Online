import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { connect, type Socket } from "node:net";
import { promisify } from "node:util";
import test from "node:test";

const run = promisify(execFile);
const token = "123456789:test_token_for_local_server";
const code = `
  globalThis.prisma = { $queryRaw: async () => [{ ok: 1 }], $disconnect: async () => {}, telegramLog: { create: async () => ({ id: "test-log" }), update: async () => ({}) } };
  const routeModule = await import('./src/app/api/healthz/route.ts');
  const { GET } = routeModule.default ?? routeModule;
  const response = await GET();
  const data = await response.json();
  let outboundSent;
  if (process.env.CHECK_OUTBOUND === "1") {
    const outboundModule = await import('./src/lib/telegram.ts');
    const { sendTelegramMessage } = outboundModule.default ?? outboundModule;
    outboundSent = await sendTelegramMessage("111", "test #chat_thread1");
  }
  console.log(JSON.stringify({ status: response.status, telegram: data.checks.telegram, outboundSent }));


`;

async function checkHealth(reply: "success" | "failure" | "timeout", useProxy = false) {
  const paths: string[] = [];
  const server = createServer((request, response) => {
    paths.push(request.url ?? "");
    if (reply === "timeout") return;
    response.setHeader("content-type", "application/json");
    response.statusCode = reply === "success" ? 200 : 503;
    response.end(JSON.stringify(reply === "success"
      ? { ok: true, result: { id: 1, is_bot: true, first_name: "Test", username: "wesetupbot" } }
      : { ok: false, error_code: 503, description: "temporary outage" }));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  let proxyUrl = "";
  const tunnels: string[] = [];
  const sockets = new Set<Socket>();
  const proxy = createServer();
  if (useProxy) {
    proxy.on("connect", (request, socket, head) => {
      assert.equal(request.url, `127.0.0.1:${address.port}`);
      assert.equal(request.headers["proxy-authorization"], `Basic ${Buffer.from("testuser:testpass").toString("base64")}`);
      tunnels.push(request.url!);
      const upstream = connect(address.port, "127.0.0.1", () => {
        socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head.length) upstream.write(head);
        socket.pipe(upstream); upstream.pipe(socket);
      });
      sockets.add(upstream);
      sockets.add(socket as Socket);
      socket.on("error", () => upstream.destroy());
      upstream.on("error", () => socket.destroy());
    });
    await new Promise<void>(resolve => proxy.listen(0, "127.0.0.1", resolve));
    const proxyAddress = proxy.address();
    assert.ok(proxyAddress && typeof proxyAddress === "object");
    proxyUrl = `http://testuser:testpass@127.0.0.1:${proxyAddress.port}`;
  }
  try {
    const { stdout } = await run(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code], {
      cwd: process.cwd(),
      timeout: 15000,
      env: {
        ...process.env,
        TELEGRAM_BOT_TOKEN: token,
        TELEGRAM_API_ROOT: `http://127.0.0.1:${address.port}`,
        TELEGRAM_FORCE_IP: "203.0.113.1",
        // Never connect this check to a real database, even if local env changes.
        DATABASE_URL: "postgresql://unused:unused@127.0.0.1:1/unused",
        DATABASE_URL_DIRECT: "postgresql://unused:unused@127.0.0.1:1/unused",
        TELEGRAM_PROXY_URL: proxyUrl,
        CHECK_OUTBOUND: useProxy ? "1" : "0",
      },
    });
    const result = JSON.parse(stdout.trim().split("\n").at(-1)!) as {
      status: number; outboundSent?: boolean; telegram: { ok: boolean; detail?: string; error?: string; ms: number };
    };
    assert.deepEqual(paths, useProxy ? [`/bot${token}/getMe`, `/bot${token}/sendMessage`] : [`/bot${token}/getMe`]);
    if (useProxy) { assert.ok(tunnels.length >= 1); assert.equal(result.outboundSent, true); }
    assert.ok(!stdout.includes(token));
    return result;
  } finally {
    for (const socket of sockets) socket.destroy();
    if (useProxy) await new Promise<void>(resolve => proxy.close(() => resolve()));
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}

test("healthz checks the configured relay instead of blocked Telegram addresses", async () => {
  const result = await checkHealth("success");
  assert.equal(result.status, 200);
  assert.equal(result.telegram.ok, true);
  assert.equal(result.telegram.detail, "@wesetupbot");
});

test("healthz reports relay failures without exposing the bot token", async () => {
  const result = await checkHealth("failure");
  assert.equal(result.status, 503);
  assert.equal(result.telegram.ok, false);
  assert.equal(result.telegram.error, "telegram unreachable");
});

test("healthz cancels an unreachable relay within its timeout", async () => {
  const result = await checkHealth("timeout");
  assert.equal(result.status, 503);
  assert.equal(result.telegram.ok, false);
  assert.ok(result.telegram.ms < 7000);
});

test("both Telegram clients use the private authenticated proxy despite a forced IP", async () => {
  const result = await checkHealth("success", true);
  assert.equal(result.telegram.ok, true);
  assert.equal(result.outboundSent, true);
});
