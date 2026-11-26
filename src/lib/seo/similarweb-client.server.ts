/**
 * Server-side Similarweb client leveraging api-anything (`config/api-anything/sites/similarweb.json`).
 *
 * Implements:
 * - Spec synchronization from `config/api-anything/sites/similarweb.json` to `<API_ANYTHING_HOME>/sites/similarweb.json`
 * - Poisoned tier-state cleanup (`state.json`) so server calls stay at Tier 1 unless browser tier is explicitly requested
 * - Encrypted session cookie & API key persistence under `<API_ANYTHING_HOME>/similarweb-credentials.enc`
 *   plus live `<API_ANYTHING_HOME>/sessions/similarweb.json` for `api-anything`'s `call("similarweb", ...)`
 * - Optional proxy support via `undici` `ProxyAgent(SIMILARWEB_PROXY_URL || GGL_PROXY_URL)`
 * - Serialized rate-limited execution queue (`minIntervalMs: 1000`)
 * - Graceful CloudFront 403 / AWS WAF 202 / Auth 401 classification into `SimilarwebCallError` and `SimilarwebAuthError`
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { call, parseSite, type StoredCookie } from "api-anything";
import { ProxyAgent, fetch as undiciFetch, type RequestInit as UndiciRequestInit } from "undici";
import {
  decryptSecret,
  encryptSecret,
  isIntegrationCryptoConfigured,
} from "@/lib/integration-crypto";
import type { ParsedSimilarwebSnapshot } from "@/lib/seo/gogetlinks-article-ai.server";
import {
  type CandidateSitePage,
  normalizeDomainName,
} from "@/lib/seo/gogetlinks-planner";
import {
  buildCompetitorSnapshotFromSerpAndSite,
  parseSimilarwebApiPayload,
  parseSimilarwebCookieInput,
  type SimilarwebConnectionStatus,
} from "@/lib/seo/similarweb-client";
import {
  getCompetitorPositionsFromTopvisor,
  isTopvisorConfigured,
} from "@/lib/topvisor";

export class SimilarwebAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SimilarwebAuthError";
  }
}

export class SimilarwebCallError extends Error {
  public readonly swClass?: string;
  constructor(message: string, swClass?: string) {
    super(message);
    this.name = "SimilarwebCallError";
    this.swClass = swClass;
  }
}

interface StoredSimilarwebConfig {
  cookies: StoredCookie[];
  apiKey?: string | null;
  updatedAt: string;
  lastSyncedAt?: string | null;
  lastError?: string | null;
}

const DEFAULT_API_ANYTHING_HOME = join(tmpdir(), "wesetup-api-anything");
if (!process.env.API_ANYTHING_HOME) {
  process.env.API_ANYTHING_HOME = DEFAULT_API_ANYTHING_HOME;
}

function getApiAnythingHome(): string {
  if (!process.env.API_ANYTHING_HOME) {
    process.env.API_ANYTHING_HOME = DEFAULT_API_ANYTHING_HOME;
  }
  return process.env.API_ANYTHING_HOME;
}

function getEncryptedConfigPath(): string {
  return join(getApiAnythingHome(), "similarweb-credentials.enc");
}

function getSessionFilePath(): string {
  return join(getApiAnythingHome(), "sessions", "similarweb.json");
}

function sanitizeSimilarwebTierState(specUpdated: boolean): void {
  const statePath = join(getApiAnythingHome(), "state.json");
  if (!existsSync(statePath)) return;
  try {
    const parsed = JSON.parse(readFileSync(statePath, "utf8")) as {
      tier?: Record<string, number>;
      stale?: Record<string, unknown>;
      cool?: Record<string, unknown>;
    };
    let changed = false;

    if (parsed.tier && typeof parsed.tier === "object") {
      for (const [k, v] of Object.entries(parsed.tier)) {
        if (k.startsWith("similarweb/") && typeof v === "number" && v > 1) {
          delete parsed.tier[k];
          changed = true;
        }
      }
    }

    if (specUpdated) {
      if (parsed.stale && typeof parsed.stale === "object") {
        for (const k of Object.keys(parsed.stale)) {
          if (k.startsWith("similarweb/")) {
            delete parsed.stale[k];
            changed = true;
          }
        }
      }
      if (parsed.cool && typeof parsed.cool === "object" && "similarweb" in parsed.cool) {
        delete parsed.cool.similarweb;
        changed = true;
      }
    }

    if (changed) {
      writeFileSync(statePath, JSON.stringify(parsed, null, 1), { mode: 0o600 });
    }
  } catch {
    // Ignore corrupt state hint file
  }
}

/**
 * Ensures `<API_ANYTHING_HOME>/sites/similarweb.json` is up to date with
 * `config/api-anything/sites/similarweb.json`.
 */
export function initSimilarwebApiAnythingHome(): {
  operations: string[];
} {
  const homeDir = getApiAnythingHome();
  const sitesDir = join(homeDir, "sites");
  const sessionsDir = join(homeDir, "sessions");
  mkdirSync(sitesDir, { recursive: true, mode: 0o700 });
  mkdirSync(sessionsDir, { recursive: true, mode: 0o700 });

  const configPath = join(homeDir, "config.json");
  if (!existsSync(configPath)) {
    writeFileSync(
      configPath,
      JSON.stringify({ share: false, sharePrompted: true }, null, 2),
      { mode: 0o600 },
    );
  }

  const sourceSpecPath = join(
    process.cwd(),
    "config",
    "api-anything",
    "sites",
    "similarweb.json",
  );
  const destSpecPath = join(sitesDir, "similarweb.json");
  let specUpdated = false;
  let operations: string[] = [
    "getDomainOverview",
    "getWebsiteAnalysis",
    "getProSearchKeywords",
  ];

  if (existsSync(sourceSpecPath)) {
    try {
      const raw = readFileSync(sourceSpecPath, "utf8");
      const validated = parseSite(JSON.parse(raw));
      operations = validated.operations.map((op) => op.name);
      const current = existsSync(destSpecPath)
        ? readFileSync(destSpecPath, "utf8")
        : "";
      if (raw !== current) {
        writeFileSync(destSpecPath, raw, { mode: 0o600 });
        specUpdated = true;
      }
    } catch (err) {
      console.warn(
        "[similarweb-client] Warning: failed to sync similarweb.json to home:",
        err,
      );
    }
  }

  sanitizeSimilarwebTierState(specUpdated);
  return { operations };
}

function writeApiAnythingSessionFile(cookies: StoredCookie[]): void {
  const file = getSessionFilePath();
  if (cookies.length === 0) {
    if (existsSync(file)) {
      try {
        rmSync(file, { force: true });
      } catch {}
    }
    return;
  }
  const payload = {
    cookies,
    values: {},
    updatedAt: new Date().toISOString(),
  };
  writeFileSync(file, JSON.stringify(payload, null, 2), { mode: 0o600 });
}

export function loadSimilarwebLocalSession(): StoredCookie[] {
  initSimilarwebApiAnythingHome();
  const encPath = getEncryptedConfigPath();
  if (existsSync(encPath) && isIntegrationCryptoConfigured()) {
    try {
      const decrypted = decryptSecret(readFileSync(encPath, "utf8").trim());
      const parsed = JSON.parse(decrypted) as StoredSimilarwebConfig;
      if (Array.isArray(parsed.cookies) && parsed.cookies.length > 0) {
        writeApiAnythingSessionFile(parsed.cookies);
        return parsed.cookies;
      }
    } catch {
      // Fall back to raw session file
    }
  }

  const envCookie = process.env.SIMILARWEB_COOKIE?.trim();
  if (envCookie) {
    const parsed = parseSimilarwebCookieInput(envCookie);
    if (parsed.length > 0) {
      writeApiAnythingSessionFile(parsed);
      return parsed;
    }
  }

  const sessionFile = getSessionFilePath();
  if (!existsSync(sessionFile)) return [];
  try {
    const parsed = JSON.parse(readFileSync(sessionFile, "utf8")) as {
      cookies?: StoredCookie[];
    };
    return Array.isArray(parsed.cookies) ? parsed.cookies : [];
  } catch {
    return [];
  }
}

function readStoredConfig(): StoredSimilarwebConfig | null {
  initSimilarwebApiAnythingHome();
  const encPath = getEncryptedConfigPath();
  if (existsSync(encPath)) {
    try {
      const raw = readFileSync(encPath, "utf8").trim();
      const jsonText = isIntegrationCryptoConfigured() ? decryptSecret(raw) : raw;
      return JSON.parse(jsonText) as StoredSimilarwebConfig;
    } catch {
      return null;
    }
  }
  return null;
}

function writeStoredConfig(cfg: StoredSimilarwebConfig): void {
  initSimilarwebApiAnythingHome();
  const encPath = getEncryptedConfigPath();
  const serialized = JSON.stringify(cfg);
  const blob = isIntegrationCryptoConfigured()
    ? encryptSecret(serialized)
    : serialized;
  writeFileSync(encPath, blob, { mode: 0o600 });
  writeApiAnythingSessionFile(cfg.cookies);
}

/**
 * Saves or clears Similarweb session cookies (`Cookie:` header or JSON array) and optional API key.
 */
export function saveSimilarwebConnection(input: {
  cookieInput?: string | null;
  cookies?: StoredCookie[];
  apiKey?: string | null;
  clear?: boolean;
}): SimilarwebConnectionStatus {
  initSimilarwebApiAnythingHome();
  if (input.clear) {
    const encPath = getEncryptedConfigPath();
    if (existsSync(encPath)) {
      try {
        rmSync(encPath, { force: true });
      } catch {}
    }
    writeApiAnythingSessionFile([]);
    return getSimilarwebConnectionStatus();
  }

  const existing = readStoredConfig();
  let cookies = existing?.cookies ?? loadSimilarwebLocalSession();

  if (Array.isArray(input.cookies)) {
    cookies = input.cookies;
  } else if (typeof input.cookieInput === "string") {
    const trimmed = input.cookieInput.trim();
    if (trimmed) {
      const parsed = parseSimilarwebCookieInput(trimmed);
      if (parsed.length === 0) {
        throw new SimilarwebCallError(
          "Не удалось разобрать куки Similarweb. Вставьте заголовок Cookie (name=value; ...) или JSON-массив кук из браузера.",
          "input",
        );
      }
      cookies = parsed;
    }
  }

  const apiKey =
    input.apiKey !== undefined
      ? input.apiKey?.trim() || null
      : existing?.apiKey ?? null;

  const updated: StoredSimilarwebConfig = {
    cookies,
    apiKey,
    updatedAt: new Date().toISOString(),
    lastSyncedAt: existing?.lastSyncedAt ?? null,
    lastError: null,
  };
  writeStoredConfig(updated);
  return getSimilarwebConnectionStatus();
}

export function recordSimilarwebSyncOutcome(outcome: {
  ok: boolean;
  error?: string | null;
}): void {
  const existing = readStoredConfig();
  const cookies = existing?.cookies ?? loadSimilarwebLocalSession();
  const cfg: StoredSimilarwebConfig = {
    cookies,
    apiKey: existing?.apiKey ?? null,
    updatedAt: existing?.updatedAt ?? new Date().toISOString(),
    lastSyncedAt: outcome.ok
      ? new Date().toISOString()
      : existing?.lastSyncedAt ?? null,
    lastError: outcome.ok ? null : outcome.error ?? null,
  };
  try {
    writeStoredConfig(cfg);
  } catch {
    // Non-fatal in read-only environments
  }
}

export function getSimilarwebConnectionStatus(): SimilarwebConnectionStatus {
  const { operations } = initSimilarwebApiAnythingHome();
  const stored = readStoredConfig();
  const cookies = stored?.cookies?.length
    ? stored.cookies
    : loadSimilarwebLocalSession();
  const apiKey =
    stored?.apiKey || process.env.SIMILARWEB_API_KEY?.trim() || null;

  return {
    configured: cookies.length > 0 || Boolean(apiKey),
    hasCookies: cookies.length > 0,
    hasApiKey: Boolean(apiKey),
    cookieCount: cookies.length,
    cookieNames: cookies.map((c) => c.name).slice(0, 12),
    updatedAt: stored?.updatedAt ?? null,
    lastSyncedAt: stored?.lastSyncedAt ?? null,
    lastError: stored?.lastError ?? null,
    operations,
  };
}

function getFetchImpl(): typeof fetch | undefined {
  const proxyUrl =
    process.env.SIMILARWEB_PROXY_URL?.trim() ||
    process.env.GGL_PROXY_URL?.trim();
  if (!proxyUrl) return undefined;

  try {
    const agent = new ProxyAgent(proxyUrl);
    return ((url: string | URL, init?: UndiciRequestInit) =>
      undiciFetch(url, { ...init, dispatcher: agent })) as unknown as typeof fetch;
  } catch (err) {
    console.warn("[similarweb-client] Failed to configure proxy agent:", err);
    return undefined;
  }
}

/**
 * Wraps fetch to detect AWS WAF 202 / CloudFront 403 anti-bot challenges and attach
 * optional `api_key` query parameter if `SIMILARWEB_API_KEY` or stored `apiKey` is present.
 */
export function createSimilarwebFetch(
  baseFetch: typeof fetch = fetch,
  opts?: { apiKey?: string | null },
): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    let targetInput = input;
    const apiKey =
      opts?.apiKey ??
      readStoredConfig()?.apiKey ??
      process.env.SIMILARWEB_API_KEY?.trim() ??
      null;

    if (apiKey) {
      const rawUrl =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      try {
        const parsed = new URL(rawUrl);
        if (
          parsed.hostname.endsWith("similarweb.com") &&
          !parsed.searchParams.has("api_key")
        ) {
          parsed.searchParams.set("api_key", apiKey);
          targetInput = parsed.toString();
        }
      } catch {
        // Keep original input
      }
    }

    const res = await baseFetch(targetInput, init);

    // AWS WAF returns HTTP 202 Accepted with an empty/challenge HTML body when aws-waf-token cookie is missing
    if (res.status === 202) {
      const text = await res.text().catch(() => "");
      if (
        /awsWafCookieDomainList|gokuProps| challenge/i.test(text) ||
        text.length < 4096
      ) {
        return new Response(
          "<html><head><title>Verify you are human - AWS WAF Challenge</title></head><body>Prove your humanity</body></html>",
          {
            status: 403,
            statusText: "Forbidden (AWS WAF Challenge)",
            headers: { "content-type": "text/html; charset=utf-8" },
          },
        );
      }
    }

    return res;
  };
}

// Serialized request queue with minIntervalMs
let swQueuePromise: Promise<unknown> = Promise.resolve();
let swLastCallTime = 0;
const SW_MIN_INTERVAL_MS = 1000;

async function enqueueSimilarweb<T>(
  fn: () => Promise<T>,
  minIntervalMs = SW_MIN_INTERVAL_MS,
): Promise<T> {
  const nextCall = swQueuePromise.then(async () => {
    const now = Date.now();
    const elapsed = now - swLastCallTime;
    if (elapsed < minIntervalMs) {
      await new Promise((r) => setTimeout(r, minIntervalMs - elapsed));
    }
    try {
      return await fn();
    } finally {
      swLastCallTime = Date.now();
    }
  });

  swQueuePromise = nextCall.catch(() => {});
  return nextCall;
}

/**
 * Executes a read operation declared in `config/api-anything/sites/similarweb.json`
 * via `api-anything`'s `call("similarweb", opName, args)`.
 */
export async function callSimilarwebRead<T = unknown>(
  opName: "getDomainOverview" | "getWebsiteAnalysis" | "getProSearchKeywords",
  args: Record<string, string | number | boolean>,
  opts?: {
    fetchImpl?: typeof fetch;
    minIntervalMs?: number;
    maxTier?: 1 | 2 | 3;
  },
): Promise<T> {
  initSimilarwebApiAnythingHome();
  loadSimilarwebLocalSession();

  return enqueueSimilarweb(async () => {
    const baseFetch = opts?.fetchImpl || getFetchImpl() || fetch;
    const wrappedFetch = createSimilarwebFetch(baseFetch);

    const res = await call("similarweb", opName, args, {
      maxTier: opts?.maxTier ?? 1,
      minIntervalMs: 0,
      fetchImpl: wrappedFetch,
    });

    if (res.ok) {
      return res.data as T;
    }

    const errClass = res.class;
    const errMsg = res.reason || `Similarweb ${opName} failed`;

    if (errClass === "auth") {
      throw new SimilarwebAuthError(
        "Сессия Similarweb не авторизована или истекла. Откройте «Настроить сессию Similarweb (api-anything)» и вставьте свежие куки из браузера.",
      );
    }

    if (errClass === "blocked") {
      throw new SimilarwebCallError(
        "Similarweb отклонил прямой запрос защитой CloudFront / AWS WAF (HTTP 403). Вставьте сессионные куки браузера (включая aws-waf-token / sw_Session) в блоке «Настроить сессию Similarweb (api-anything)» или загрузите скриншот через ИИ-OCR.",
        "blocked",
      );
    }

    if (errClass === "rate") {
      throw new SimilarwebCallError(
        "Similarweb временно ограничил частоту запросов (HTTP 429). Повторите попытку через минуту.",
        "rate",
      );
    }

    throw new SimilarwebCallError(
      `Ошибка запроса Similarweb (${opName}): ${errMsg}`,
      errClass,
    );
  }, opts?.minIntervalMs ?? SW_MIN_INTERVAL_MS);
}

async function crawlCompetitorSitePhrases(
  domain: string,
  fetchFn: typeof fetch,
): Promise<string[]> {
  const phrases: string[] = [];
  try {
    const res = await fetchFn(`https://${domain}/`, {
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
        accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(7000),
    });
    if (res.ok) {
      const html = await res.text();
      const matches = html.matchAll(/<(?:h1|h2|h3|title)\b[^>]*>([\s\S]*?)<\/(?:h1|h2|h3|title)>/gi);
      for (const m of matches) {
        const clean = m[1]
          .replace(/<[^>]+>/g, " ")
          .replace(/&[a-z#0-9]+;/gi, " ")
          .replace(/\s+/g, " ")
          .trim();
        if (
          clean.length >= 8 &&
          clean.length <= 110 &&
          /хассп|haccp|санпин|журнал|общепит|контрол|температур|бракераж|уборк|гигиен|чек-лист|аудит|пищев/i.test(
            clean,
          )
        ) {
          phrases.push(clean.toLowerCase());
        }
      }
    }
  } catch {
    // Ignore site fetch errors (e.g. Cloudflare on competitor site)
  }
  return [...new Set(phrases)].slice(0, 12);
}

/**
 * Fetches and normalizes a domain's traffic and search keyword clusters from Similarweb
 * using `api-anything` (`getDomainOverview`, falling back to `getWebsiteAnalysis`, and
 * enriching with `getProSearchKeywords` when authenticated).
 *
 * When CloudFront / AWS WAF blocks direct server requests to Similarweb (`blocked` / `auth`),
 * automatically falls back to live Topvisor SERP competitor positions (`getCompetitorPositionsFromTopvisor`
 * which registers the competitor in Topvisor and reads all 198+ tracked queries) + public site headings,
 * unless `allowSerpFallback === false`.
 */
export async function fetchSimilarwebSnapshotViaApiAnything(
  domainInput: string,
  opts?: {
    fetchImpl?: typeof fetch;
    minIntervalMs?: number;
    candidatePages?: readonly CandidateSitePage[];
    fallbackDate?: Date;
    allowSerpFallback?: boolean;
  },
): Promise<ParsedSimilarwebSnapshot> {
  const cleanDomain = normalizeDomainName(domainInput);
  if (!cleanDomain || !cleanDomain.includes(".")) {
    throw new SimilarwebCallError(
      "Укажите корректный домен сайта (например, haccp-online.ru)",
      "input",
    );
  }

  let overviewData: unknown = null;
  let primaryError: Error | null = null;

  try {
    overviewData = await callSimilarwebRead(
      "getDomainOverview",
      { domain: cleanDomain },
      {
        fetchImpl: opts?.fetchImpl,
        minIntervalMs: opts?.minIntervalMs,
      },
    );
  } catch (err) {
    primaryError = err instanceof Error ? err : new Error(String(err));
  }

  // Fallback to embedded state on www.similarweb.com/website/{domain}/ if data.similarweb.com failed
  if (!overviewData) {
    try {
      overviewData = await callSimilarwebRead(
        "getWebsiteAnalysis",
        { domain: cleanDomain },
        {
          fetchImpl: opts?.fetchImpl,
          minIntervalMs: opts?.minIntervalMs ?? 0,
        },
      );
    } catch (fallbackErr) {
      const errToThrow =
        primaryError ??
        (fallbackErr instanceof Error
          ? fallbackErr
          : new Error(String(fallbackErr)));

      // Automated SERP + Site fallback when Similarweb CloudFront blocks the datacenter IP
      const useFallback =
        opts?.allowSerpFallback !== false && !opts?.fetchImpl;
      if (useFallback) {
        try {
          const tvData = isTopvisorConfigured()
            ? await getCompetitorPositionsFromTopvisor(cleanDomain).catch(
                () => null,
              )
            : null;
          const sitePhrases =
            !tvData || tvData.rankedRows.length === 0
              ? await crawlCompetitorSitePhrases(
                  cleanDomain,
                  getFetchImpl() || fetch,
                )
              : [];

          const autoSnapshot = buildCompetitorSnapshotFromSerpAndSite({
            domain: cleanDomain,
            latestDate: tvData?.latestDate ?? null,
            totalKeywords: tvData?.totalKeywords ?? 0,
            rankedRows: tvData?.rankedRows ?? [],
            sitemapPhrases: sitePhrases,
            candidatePages: opts?.candidatePages,
          });
          recordSimilarwebSyncOutcome({
            ok: true,
            error: null,
          });
          return autoSnapshot;
        } catch {
          // If fallback also failed, throw original error
        }
      }

      recordSimilarwebSyncOutcome({
        ok: false,
        error: errToThrow.message,
      });
      throw errToThrow;
    }
  }

  // Best-effort enrichment from Similarweb Pro search keywords table if session cookies exist
  let proKeywordsData: unknown = undefined;
  const cookies = loadSimilarwebLocalSession();
  const hasProCookies = cookies.some((c) =>
    ["sw_Session", "sw_token", ".SGTOKEN", "sg_token"].includes(c.name),
  );
  if (hasProCookies) {
    try {
      proKeywordsData = await callSimilarwebRead(
        "getProSearchKeywords",
        { domain: cleanDomain },
        {
          fetchImpl: opts?.fetchImpl,
          minIntervalMs: opts?.minIntervalMs ?? 0,
        },
      );
    } catch {
      // Optional enrichment: keep overview keywords if Pro widget isn't accessible
    }
  }

  const snapshot = parseSimilarwebApiPayload(
    cleanDomain,
    overviewData,
    proKeywordsData,
    {
      candidatePages: opts?.candidatePages,
      fallbackDate: opts?.fallbackDate,
    },
  );

  recordSimilarwebSyncOutcome({ ok: true, error: null });
  return snapshot;
}
