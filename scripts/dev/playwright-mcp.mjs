#!/usr/bin/env node
/**
 * Playwright MCP for Claude Code (the repo's .mcp.json; spec cloud-testing-2026-11-21, AC2): Claude
 * opens the site and clicks through it itself, without throwaway scripts.
 *
 * Cloud sessions do not install plugins from the repo's .claude/settings.json, but they do start the
 * repo's .mcp.json servers without asking — so this is how the Playwright plugin reaches every cloud
 * session. On a developer machine Claude Code asks once whether to enable it.
 *
 * - The @playwright/mcp version is pinned (no @latest): bump VERSION on purpose.
 * - Cloud container (Linux as root or without a display): the preinstalled browser (CHROME_PATH or
 *   /opt/pw-browsers/chromium), headless, through the session's HTTPS proxy; --no-sandbox only as
 *   root, where Chrome refuses to start with its sandbox.
 * - Developer machine: Playwright's default (installed Google Chrome), with a window.
 * - Isolated profile (no logins kept between sessions); screenshots and files in .playwright-mcp/.
 *
 * Extra arguments are passed through: node scripts/dev/playwright-mcp.mjs --device "iPhone 15"
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

const VERSION = "0.0.84";

const args = ["-y", `@playwright/mcp@${VERSION}`, "--isolated", "--output-dir", ".playwright-mcp"];
const isRoot = typeof process.getuid === "function" && process.getuid() === 0;
const container = process.platform === "linux" && (isRoot || !process.env.DISPLAY);
if (container) {
  args.push("--headless");
  const browser = [process.env.PLAYWRIGHT_MCP_EXECUTABLE, process.env.CHROME_PATH, "/opt/pw-browsers/chromium"].find(
    (candidate) => candidate && existsSync(candidate),
  );
  if (browser) args.push("--executable-path", browser);
  if (isRoot) args.push("--no-sandbox");
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  if (proxy) args.push("--proxy-server", proxy, "--proxy-bypass", "localhost,127.0.0.1,::1");
}
args.push(...process.argv.slice(2));

const windows = process.platform === "win32";
const child = spawn(windows ? "npx.cmd" : "npx", args, { stdio: "inherit", shell: windows });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
