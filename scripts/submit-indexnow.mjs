#!/usr/bin/env node
/**
 * Standalone zero-dependency IndexNow submission CLI.
 * Runs cleanly in GitHub Actions `deploy` job (where only `scripts/` is checked out)
 * as well as locally via `npm run seo:indexnow`.
 *
 * Flags / env:
 *   --base-url <url>     Origin to read key + sitemap from (default: INDEXNOW_BASE_URL or https://wesetup.ru)
 *   --endpoints <csv>    Comma-separated IndexNow POST endpoints (default: INDEXNOW_ENDPOINTS or Yandex + IndexNow.org)
 *   --key <key>          Override key (default: INDEXNOW_KEY)
 *   --non-fatal          Log warnings and exit 0 on network/upstream errors (for CI post-deploy step)
 *   --strict             Require every endpoint to return 200/202 (exit 1 otherwise)
 */

export const INDEXNOW_KEY = "4f8b92c17e3a4d60a5c8192eb7304d1f";

export const DEFAULT_ENDPOINTS = [
  "https://yandex.com/indexnow",
  "https://api.indexnow.org/indexnow",
];

function decodeXmlEntities(raw) {
  return raw
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

export function extractSitemapUrls(xml, expectedOrigin = "https://wesetup.ru") {
  const origin = expectedOrigin.replace(/\/+$/, "");
  const targetUrl = new URL(origin);
  const seen = new Set();
  const locRegex = /<loc>\s*([^<\s]+)\s*<\/loc>/gi;
  let match;
  while ((match = locRegex.exec(xml)) !== null) {
    const decoded = decodeXmlEntities(match[1].trim());
    try {
      const parsed = new URL(decoded);
      if (parsed.protocol === targetUrl.protocol && parsed.host === targetUrl.host) {
        seen.add(parsed.toString());
      }
    } catch {
      // ignore malformed URL
    }
  }
  return [...seen];
}

function parseArgs(argv) {
  const opts = {
    baseUrl: process.env.INDEXNOW_BASE_URL || "https://wesetup.ru",
    key: process.env.INDEXNOW_KEY || INDEXNOW_KEY,
    endpoints: process.env.INDEXNOW_ENDPOINTS
      ? process.env.INDEXNOW_ENDPOINTS.split(",").map((s) => s.trim()).filter(Boolean)
      : DEFAULT_ENDPOINTS,
    nonFatal: false,
    strict: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--base-url" && argv[i + 1]) {
      opts.baseUrl = argv[++i];
    } else if (arg === "--endpoints" && argv[i + 1]) {
      opts.endpoints = argv[++i].split(",").map((s) => s.trim()).filter(Boolean);
    } else if (arg === "--key" && argv[i + 1]) {
      opts.key = argv[++i];
    } else if (arg === "--non-fatal") {
      opts.nonFatal = true;
    } else if (arg === "--strict") {
      opts.strict = true;
    }
  }
  return opts;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runCli() {
  const opts = parseArgs(process.argv.slice(2));
  const baseUrl = opts.baseUrl.replace(/\/+$/, "");
  const host = new URL(baseUrl).host;
  const keyLocation = `${baseUrl}/${opts.key}.txt`;
  const timeoutMs = Number(process.env.INDEXNOW_TIMEOUT_MS || 20_000);

  let keyVerified = false;
  let lastKeyErr = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(keyLocation, {
        headers: { "Cache-Control": "no-cache" },
        signal: AbortSignal.timeout(timeoutMs),
      });
      const body = (await res.text()).trim();
      if (res.status === 200 && body === opts.key) {
        keyVerified = true;
        break;
      }
      lastKeyErr = `HTTP ${res.status} (${JSON.stringify(body.slice(0, 48))})`;
    } catch (err) {
      lastKeyErr = err instanceof Error ? err.message : String(err);
    }
    if (attempt < 3) await sleep(2000);
  }

  if (!keyVerified) {
    throw new Error(`[indexnow] key file check failed for ${keyLocation}: ${lastKeyErr}`);
  }

  const sitemapUrl = `${baseUrl}/sitemap.xml`;
  const sitemapRes = await fetch(sitemapUrl, {
    headers: { "Cache-Control": "no-cache" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (sitemapRes.status !== 200) {
    throw new Error(`[indexnow] sitemap fetch failed (${sitemapUrl}): HTTP ${sitemapRes.status}`);
  }
  const urls = extractSitemapUrls(await sitemapRes.text(), baseUrl);
  if (urls.length === 0) {
    throw new Error(`[indexnow] 0 URLs extracted from ${sitemapUrl}`);
  }

  console.log(`[indexnow] verified key at ${keyLocation}; submitting ${urls.length} URLs for ${host}`);

  let acceptedCount = 0;
  let failedCount = 0;

  for (const endpoint of opts.endpoints) {
    for (let offset = 0; offset < urls.length; offset += 10_000) {
      const urlList = urls.slice(offset, offset + 10_000);
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json; charset=utf-8" },
          body: JSON.stringify({
            host,
            key: opts.key,
            keyLocation,
            urlList,
          }),
          signal: AbortSignal.timeout(timeoutMs),
        });
        const respText = (await res.text()).trim().slice(0, 200);
        const accepted = res.status === 200 || res.status === 202;
        if (accepted) {
          acceptedCount++;
          console.log(`[indexnow] OK ${endpoint} -> HTTP ${res.status} (${urlList.length} URLs)`);
        } else {
          failedCount++;
          console.warn(`[indexnow] WARN ${endpoint} -> HTTP ${res.status}: ${respText}`);
        }
      } catch (err) {
        failedCount++;
        console.warn(
          `[indexnow] WARN ${endpoint} -> network error: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  if (opts.strict && failedCount > 0) {
    throw new Error(`[indexnow] strict mode: ${failedCount} endpoint submission(s) did not return 200/202`);
  }
  if (acceptedCount === 0) {
    throw new Error("[indexnow] no IndexNow endpoint accepted the submission");
  }
}

const isMain =
  typeof process !== "undefined" &&
  process.argv[1] &&
  import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop());

if (isMain) {
  const nonFatal = process.argv.includes("--non-fatal");
  runCli().catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    if (nonFatal) {
      console.warn(`[indexnow] non-fatal warning: ${msg}`);
      process.exit(0);
    }
    console.error(msg);
    process.exit(1);
  });
}
