/**
 * Server-side GoGetLinks client leveraging api-anything and native Windows-1251 encoding.
 *
 * Implements:
 * - Temporary home directory initialization under os.tmpdir()/wesetup-api-anything
 * - Spec synchronization from config/api-anything/sites/gogetlinks.json + poisoned tier-state cleanup
 * - In-process serialized request queue with rate limiting (minIntervalMs: 1200)
 * - Optional proxy support via undici ProxyAgent(GGL_PROXY_URL)
 * - Session restoration and encrypted persistence with GglAccount.sessionEnc
 * - Single-retry auto-relogin on auth failure via POST https://gogetlinks.net/user/signIn
 * - Strict campaign isolation guard (isWesetup === true and siteUrl === wesetup.ru) for all writes
 * - Windows-1251 form re-encoding for non-XHR form-encoded write requests
 * - Byte-preserving neutralization of passive layout reCAPTCHA SDK tags on HTTP 200 HTML pages
 * - Empty-tab cross-redirect handling on /reviews/* tabs
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { call, type StoredCookie } from "api-anything";
import { ProxyAgent, fetch as undiciFetch, type RequestInit as UndiciRequestInit } from "undici";
import { db } from "@/lib/db";
import { decryptSecret, encryptSecret } from "@/lib/integration-crypto";
import { encodeWin1251Form, isWesetupDomain, parseRubAmount } from "@/lib/seo/gogetlinks-codec";

interface GglPrismaClientLike {
  gglAccount: {
    findFirst: () => Promise<{
      id: string;
      email?: string | null;
      passwordEnc?: string | null;
      sessionEnc?: string | null;
    } | null>;
    update: (args: {
      where: { id: string };
      data: { sessionEnc: string; status: string; lastError: string | null };
    }) => Promise<unknown>;
  };
  gglCampaign: {
    findFirst: (args: { where: Record<string, unknown> }) => Promise<{ isWesetup?: boolean } | null>;
  };
}

function resolveClient(prismaClient?: unknown): GglPrismaClientLike {
  return (prismaClient ?? db) as unknown as GglPrismaClientLike;
}

export interface GglWalletBalance {
  balanceRub: number;
  availableRub: number;
  blockedRub: number;
}

export class GglIsolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GglIsolationError";
  }
}

export class GglAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GglAuthError";
  }
}

export class GglCallError extends Error {
  public readonly gglClass?: string;
  constructor(message: string, gglClass?: string) {
    super(message);
    this.name = "GglCallError";
    this.gglClass = gglClass;
  }
}

const DEFAULT_WESETUP_CAMPAIGN_BRIEF =
  "Платформа электронных журналов ХАССП и производственного контроля СанПиН для общепита, пекарен, пищевых производств, школ и отелей — wesetup.ru. Органично впишите ссылку в тематический материал об общепите, пищевой безопасности, ресторанном бизнесе, автоматизации кухни или проверках Роспотребнадзора.";

const REVIEW_TAB_SLUG_MAP: Record<string, string> = {
  in_progress: "propocal",
  on_check: "index",
  needs_replacement: "rejected",
  paid: "paid",
};

const REAL_INTERSTITIAL_RE =
  /Prove your humanity|<title[^>]*>[^<]*(prove your humanity|human verification|just a moment|attention required|are you a (human|robot)|verify you are (a )?human|robot check)/i;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

const EMPTY_REVIEWS_HTML =
  '<!doctype html><html><head><meta charset="utf-8"></head><body><div id="table_content"><table><tbody><tr><td class="text-center">Пусто</td></tr></tbody></table></div></body></html>';

// Ensure API_ANYTHING_HOME has a default while always respecting dynamic overrides
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

function sanitizeGglTierState(specUpdated: boolean): void {
  const statePath = join(getApiAnythingHome(), "state.json");
  if (!existsSync(statePath)) return;
  try {
    const parsed = JSON.parse(readFileSync(statePath, "utf8")) as {
      tier?: Record<string, number>;
      stale?: Record<string, unknown>;
      cool?: Record<string, unknown>;
      healedAt?: Record<string, number>;
    };
    let changed = false;

    // Wesetup runs GoGetLinks strictly at maxTier: 1 on the server; any remembered tier > 1 is a poison pill
    if (parsed.tier && typeof parsed.tier === "object") {
      for (const [k, v] of Object.entries(parsed.tier)) {
        if (k.startsWith("gogetlinks/") && typeof v === "number" && v > 1) {
          delete parsed.tier[k];
          changed = true;
        }
      }
    }

    if (specUpdated) {
      if (parsed.stale && typeof parsed.stale === "object") {
        for (const k of Object.keys(parsed.stale)) {
          if (k.startsWith("gogetlinks/")) {
            delete parsed.stale[k];
            changed = true;
          }
        }
      }
      if (parsed.cool && typeof parsed.cool === "object" && "gogetlinks" in parsed.cool) {
        delete parsed.cool.gogetlinks;
        changed = true;
      }
    }

    if (changed) {
      writeFileSync(statePath, JSON.stringify(parsed, null, 1), { mode: 0o600 });
    }
  } catch {
    // Ignore corrupt hint file
  }
}

export function initApiAnythingHome(): void {
  const homeDir = getApiAnythingHome();
  const sitesDir = join(homeDir, "sites");
  const sessionsDir = join(homeDir, "sessions");
  mkdirSync(sitesDir, { recursive: true, mode: 0o700 });
  mkdirSync(sessionsDir, { recursive: true, mode: 0o700 });

  // 1. Write config.json
  const configPath = join(homeDir, "config.json");
  if (!existsSync(configPath)) {
    writeFileSync(
      configPath,
      JSON.stringify({ share: false, sharePrompted: true }, null, 2),
      { mode: 0o600 },
    );
  }

  // 2. Sync config/api-anything/sites/gogetlinks.json -> <home>/sites/gogetlinks.json
  const sourceSpecPath = join(process.cwd(), "config", "api-anything", "sites", "gogetlinks.json");
  const destSpecPath = join(sitesDir, "gogetlinks.json");
  let specUpdated = false;
  if (existsSync(sourceSpecPath)) {
    try {
      const raw = readFileSync(sourceSpecPath, "utf8");
      const current = existsSync(destSpecPath) ? readFileSync(destSpecPath, "utf8") : "";
      if (raw !== current) {
        writeFileSync(destSpecPath, raw, { mode: 0o600 });
        specUpdated = true;
      }
    } catch (err) {
      console.warn("[ggl-client] Warning: failed to sync gogetlinks.json to home:", err);
    }
  }

  sanitizeGglTierState(specUpdated);
}

function getFetchImpl(): typeof fetch | undefined {
  const proxyUrl = process.env.GGL_PROXY_URL;
  if (!proxyUrl) return undefined;

  try {
    const agent = new ProxyAgent(proxyUrl);
    return ((url: string | URL, init?: UndiciRequestInit) =>
      undiciFetch(url, { ...init, dispatcher: agent })) as unknown as typeof fetch;
  } catch (err) {
    console.warn("[ggl-client] Failed to configure proxy agent:", err);
    return undefined;
  }
}

function asciiLower(byte: number): number {
  return byte >= 0x41 && byte <= 0x5a ? byte | 0x20 : byte;
}

function replaceAsciiCaseInsensitiveInPlace(
  buf: Uint8Array,
  needleLowerAscii: string,
  replacementAscii: string,
): boolean {
  if (needleLowerAscii.length !== replacementAscii.length) {
    throw new Error("Byte-preserving ASCII replacement requires matching lengths");
  }
  const len = needleLowerAscii.length;
  let mutated = false;
  for (let i = 0; i <= buf.length - len; i++) {
    let matched = true;
    for (let j = 0; j < len; j++) {
      if (asciiLower(buf[i + j]) !== needleLowerAscii.charCodeAt(j)) {
        matched = false;
        break;
      }
    }
    if (matched) {
      for (let j = 0; j < len; j++) {
        buf[i + j] = replacementAscii.charCodeAt(j);
      }
      mutated = true;
      i += len - 1;
    }
  }
  return mutated;
}

function resolveInputUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function extractReviewTabSlug(pathname: string): string | null {
  const match = /^\/reviews\/([a-z_]+)(?:\/|$)/i.exec(pathname);
  return match ? match[1].toLowerCase() : null;
}

function withResponseUrl(response: Response, url: string): Response {
  if (!url) return response;
  try {
    Object.defineProperty(response, "url", { value: url, configurable: true });
  } catch {
    // Ignore if environment seals Response.url
  }
  return response;
}

function buildEmptyReviewsResponse(sourceRes: Response, requestedUrl: string): Response {
  const headers = new Headers();
  headers.set("content-type", "text/html; charset=utf-8");
  const setCookies =
    typeof sourceRes.headers.getSetCookie === "function"
      ? sourceRes.headers.getSetCookie()
      : [];
  for (const cookie of setCookies) {
    headers.append("set-cookie", cookie);
  }
  if (setCookies.length === 0) {
    const singleCookie = sourceRes.headers.get("set-cookie");
    if (singleCookie) headers.set("set-cookie", singleCookie);
  }
  return withResponseUrl(new Response(EMPTY_REVIEWS_HTML, { status: 200, headers }), requestedUrl);
}

/**
 * Wraps a fetch implementation for GoGetLinks:
 * 1. Encodes non-XHR application/x-www-form-urlencoded POST requests in single-byte windows-1251.
 * 2. Converts GoGetLinks empty-tab cross-redirects on /reviews/<tab> (e.g. /reviews/index -> /reviews/request)
 *    into a clean empty HTML table so zero-item tabs never misclassify another tab's rows.
 * 3. Neutralizes passive layout reCAPTCHA SDK markers in-place on HTTP 200 HTML pages (<64KB pages like
 *    /messages and empty /reviews/paid/in_comp_id/*) without touching real interstitial challenges or
 *    windows-1251 Cyrillic bytes.
 */
export function createGglFetch(baseFetch: typeof fetch = fetch): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const reqUrl = resolveInputUrl(input);
    const method = (init?.method || (typeof input === "object" && "method" in input ? input.method : "GET") || "GET").toUpperCase();

    let modifiedInit = init;
    if (init && method === "POST") {
      const headers = new Headers(init.headers);
      const contentType = headers.get("content-type") || "";
      const isAjax = headers.get("x-requested-with") === "XMLHttpRequest";

      if (
        contentType.includes("application/x-www-form-urlencoded") &&
        typeof init.body === "string" &&
        !isAjax
      ) {
        const params = new URLSearchParams(init.body);
        const fields: Record<string, string> = {};
        for (const [key, val] of params.entries()) {
          fields[key] = val;
        }
        const win1251Body = encodeWin1251Form(fields);
        modifiedInit = {
          ...init,
          body: win1251Body,
        };
      }
    }

    const res = await baseFetch(input, modifiedInit);

    // Handle /reviews/<tab> cross-tab redirect when a review tab has 0 rows
    if (method === "GET") {
      let requestedReviewSlug: string | null = null;
      try {
        requestedReviewSlug = extractReviewTabSlug(new URL(reqUrl).pathname);
      } catch {
        requestedReviewSlug = null;
      }

      if (requestedReviewSlug) {
        const location = res.headers.get("location");
        if (REDIRECT_STATUSES.has(res.status) && location) {
          try {
            const targetSlug = extractReviewTabSlug(new URL(location, reqUrl).pathname);
            if (targetSlug && targetSlug !== requestedReviewSlug) {
              await res.body?.cancel().catch(() => {});
              return buildEmptyReviewsResponse(res, reqUrl);
            }
          } catch {
            // Let api-anything handle malformed or non-review redirects
          }
        } else if (res.status === 200 && res.url) {
          try {
            const finalSlug = extractReviewTabSlug(new URL(res.url).pathname);
            if (finalSlug && finalSlug !== requestedReviewSlug) {
              await res.body?.cancel().catch(() => {});
              return buildEmptyReviewsResponse(res, reqUrl);
            }
          } catch {
            // Ignore URL parse issues
          }
        }
      }
    }

    // Neutralize passive layout reCAPTCHA SDK script/div on normal HTTP 200 HTML pages
    if (res.status === 200) {
      const ct = (res.headers.get("content-type") || "").toLowerCase();
      if (ct.includes("html") || ct === "") {
        const rawBuf = new Uint8Array(await res.arrayBuffer());
        const preview = new TextDecoder("latin1").decode(rawBuf.subarray(0, 32_768));
        const looksLikeHtml = ct.includes("html") || /^\s*<(!doctype|html)/i.test(preview);

        if (looksLikeHtml && !REAL_INTERSTITIAL_RE.test(preview)) {
          const m1 = replaceAsciiCaseInsensitiveInPlace(
            rawBuf,
            "google.com/recaptcha",
            "google.com/rc_widget",
          );
          const m2 = replaceAsciiCaseInsensitiveInPlace(rawBuf, "g-recaptcha", "g_rc_widget");
          const m3 = replaceAsciiCaseInsensitiveInPlace(rawBuf, "hcaptcha.com", "hc_widget.io");
          void m1;
          void m2;
          void m3;
        }

        const headers = new Headers(res.headers);
        headers.delete("content-encoding");
        headers.delete("content-length");
        return withResponseUrl(
          new Response(rawBuf, {
            status: res.status,
            statusText: res.statusText,
            headers,
          }),
          res.url || reqUrl,
        );
      }
    }

    return res;
  };
}

// In-process serialized promise queue with minIntervalMs
let queuePromise: Promise<unknown> = Promise.resolve();
let lastCallTime = 0;
const MIN_INTERVAL_MS = 1200;

async function enqueueGgl<T>(fn: () => Promise<T>): Promise<T> {
  const nextCall = queuePromise.then(async () => {
    const now = Date.now();
    const elapsed = now - lastCallTime;
    if (elapsed < MIN_INTERVAL_MS) {
      await new Promise((r) => setTimeout(r, MIN_INTERVAL_MS - elapsed));
    }
    try {
      return await fn();
    } finally {
      lastCallTime = Date.now();
    }
  });

  queuePromise = nextCall.catch(() => {});
  return nextCall;
}

function parseSetCookies(setCookieHeaders: string[] | string | undefined): StoredCookie[] {
  if (!setCookieHeaders) return [];
  const rawItems = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];
  const rawList = rawItems.flatMap((item) => item.split(/,(?=\s*[a-zA-Z0-9_.-]+=)/));
  const cookies: StoredCookie[] = [];

  for (const str of rawList) {
    const parts = str.split(";").map((p) => p.trim());
    if (parts.length === 0) continue;
    const [nameVal, ...attrs] = parts;
    const eqIdx = nameVal.indexOf("=");
    if (eqIdx === -1) continue;
    const name = nameVal.slice(0, eqIdx).trim();
    const value = nameVal.slice(eqIdx + 1).trim();

    let domain = "gogetlinks.net";
    let path = "/";
    let expires = Math.floor(Date.now() / 1000) + 365 * 86400;
    let httpOnly = false;
    let secure = true;
    let sameSite: "Strict" | "Lax" | "None" | undefined = undefined;

    for (const attr of attrs) {
      const lower = attr.toLowerCase();
      if (lower.startsWith("domain=")) {
        domain = attr.slice(7).trim().replace(/^\./, "");
      } else if (lower.startsWith("path=")) {
        path = attr.slice(5).trim();
      } else if (lower.startsWith("expires=")) {
        const d = Date.parse(attr.slice(8).trim());
        if (!isNaN(d)) expires = Math.floor(d / 1000);
      } else if (lower === "httponly") {
        httpOnly = true;
      } else if (lower === "secure") {
        secure = true;
      } else if (lower.startsWith("samesite=")) {
        const s = attr.slice(9).trim().toLowerCase();
        if (s === "strict") sameSite = "Strict";
        else if (s === "lax") sameSite = "Lax";
        else if (s === "none") sameSite = "None";
      }
    }

    cookies.push({ name, value, domain, path, expires, httpOnly, secure, sameSite });
  }

  return cookies;
}

export function saveLocalSession(cookies: StoredCookie[]): void {
  initApiAnythingHome();
  const sessionsDir = join(getApiAnythingHome(), "sessions");
  const file = join(sessionsDir, "gogetlinks.json");
  const data = {
    cookies,
    values: {},
    updatedAt: new Date().toISOString(),
  };
  writeFileSync(file, JSON.stringify(data, null, 2), { mode: 0o600 });
}

export function loadLocalSession(): StoredCookie[] {
  initApiAnythingHome();
  const file = join(getApiAnythingHome(), "sessions", "gogetlinks.json");
  if (!existsSync(file)) return [];
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    return parsed.cookies || [];
  } catch {
    return [];
  }
}

function buildCookieHeader(cookies: StoredCookie[]): string {
  return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
}

async function syncSessionFromDb(prismaClient?: unknown): Promise<void> {
  initApiAnythingHome();
  try {
    const client = resolveClient(prismaClient);
    const account = await client.gglAccount.findFirst();
    if (!account || !account.sessionEnc) return;

    const decrypted = decryptSecret(account.sessionEnc);
    const parsed = JSON.parse(decrypted);
    const cookies = Array.isArray(parsed) ? parsed : parsed.cookies || [];
    if (cookies.length > 0) {
      saveLocalSession(cookies);
    }
  } catch (err) {
    console.warn("[ggl-client] Warning: could not restore session from DB:", err);
  }
}

async function persistSessionToDb(cookies: StoredCookie[], prismaClient?: unknown): Promise<void> {
  try {
    const client = resolveClient(prismaClient);
    const account = await client.gglAccount.findFirst();
    if (!account) return;

    const sessionObj = { cookies, values: {}, updatedAt: new Date().toISOString() };
    const encrypted = encryptSecret(JSON.stringify(sessionObj));
    await client.gglAccount.update({
      where: { id: account.id },
      data: {
        sessionEnc: encrypted,
        status: "active",
        lastError: null,
      },
    });
  } catch (err) {
    console.warn("[ggl-client] Warning: could not persist session to DB:", err);
  }
}

async function attemptRelogin(opts?: { prismaClient?: unknown; fetchImpl?: typeof fetch }): Promise<boolean> {
  try {
    const client = resolveClient(opts?.prismaClient);
    const account = await client.gglAccount.findFirst();
    if (!account || !account.email || !account.passwordEnc) return false;

    const password = decryptSecret(account.passwordEnc);
    // skipBalance: true prevents re-entering callGglRead and deadlock
    // persistToDb: true ensures DB is updated with fresh cookies immediately
    const { cookies } = await verifyAndLoginGgl(account.email, password, {
      prismaClient: client,
      fetchImpl: opts?.fetchImpl,
      skipBalance: true,
      persistToDb: true,
    });
    return cookies.length > 0;
  } catch (err) {
    console.error("[ggl-client] Auto-relogin attempt failed:", err);
    return false;
  }
}

/**
 * Verifies credentials by logging in directly to GoGetLinks via POST /user/signIn.
 * Returns the fresh session cookies and initial wallet balance.
 */
export async function verifyAndLoginGgl(
  email: string,
  password: string,
  opts?: {
    prismaClient?: unknown;
    fetchImpl?: typeof fetch;
    skipBalance?: boolean;
    persistToDb?: boolean;
  },
): Promise<{ cookies: StoredCookie[]; balance: GglWalletBalance }> {
  initApiAnythingHome();

  const baseFetch = opts?.fetchImpl || getFetchImpl() || fetch;
  const wrappedFetch = createGglFetch(baseFetch);
  const formBody = new URLSearchParams({
    e_mail: email,
    password: password,
    remember: "on",
    is_ajax: "true",
  }).toString();

  const res = await baseFetch("https://gogetlinks.net/user/signIn", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-requested-with": "XMLHttpRequest",
      accept: "application/json, text/javascript, */*; q=0.01",
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36",
    },
    body: formBody,
  });

  const rawSetCookie =
    typeof res.headers.getSetCookie === "function"
      ? res.headers.getSetCookie()
      : res.headers.get("set-cookie");

  const cookies = parseSetCookies(rawSetCookie || undefined);
  const bodyText = await res.text();

  let jsonBody: Record<string, unknown> | null = null;
  try {
    jsonBody = JSON.parse(bodyText);
  } catch {}

  const hasAuthCookies = cookies.some((c) => c.name === "hash" || c.name === "PHPSESSID");
  if (!res.ok || (jsonBody && jsonBody.status === "error") || !hasAuthCookies) {
    const errorMsg =
      (jsonBody?.message as string) ||
      (jsonBody?.error as string) ||
      `Auth failed with HTTP ${res.status}`;
    throw new GglAuthError(`GoGetLinks login failed: ${errorMsg}`);
  }

  // 1. Save local session immediately
  saveLocalSession(cookies);

  // 2. Persist fresh cookies to DB immediately
  if (opts?.persistToDb !== false) {
    await persistSessionToDb(cookies, opts?.prismaClient);
  }

  // 3. Fetch balance directly without going through enqueueGgl / DB sync
  let balance: GglWalletBalance = { balanceRub: 0, availableRub: 0, blockedRub: 0 };
  if (!opts?.skipBalance) {
    try {
      const result = await call("gogetlinks", "getAccountBalance", undefined, {
        maxTier: 1,
        minIntervalMs: 0,
        fetchImpl: wrappedFetch,
      });
      if (result.ok && result.data) {
        const row = (
          Array.isArray(result.data) ? result.data[0] : result.data
        ) as Record<string, unknown> | undefined;
        balance = {
          balanceRub: parseRubAmount(row?.balance != null ? String(row.balance) : null),
          availableRub: parseRubAmount(row?.available != null ? String(row.available) : null),
          blockedRub: parseRubAmount(row?.blocked != null ? String(row.blocked) : null),
        };
      }
    } catch (err) {
      console.warn("[ggl-client] Warning: unable to read initial balance:", err);
    }
  }

  return { cookies, balance };
}

/** Only the two observed data retrieval POSTs; this path cannot accept or purchase a placement. */
export async function readGglWebmasterSource(
  input: { kind: "applications"; campaignId: number; page: number } | { kind: "site"; siteId: number },
  opts?: { prismaClient?: unknown; fetchImpl?: typeof fetch; skipDbSync?: boolean; allowRelogin?: boolean },
): Promise<string> {
  const ids = input.kind === "applications" ? [input.campaignId, input.page] : [input.siteId];
  if (ids.some(id => !Number.isSafeInteger(id) || id <= 0)) throw new GglCallError("Некорректный идентификатор GoGetLinks", "input");
  initApiAnythingHome();
  if (!opts?.skipDbSync) await syncSessionFromDb(opts?.prismaClient);
  return enqueueGgl(async () => {
    const sourceFetch = createGglFetch(opts?.fetchImpl || getFetchImpl() || fetch);
    const url = input.kind === "applications" ? "https://gogetlinks.net/reviews/table" : "https://gogetlinks.net/viewSiteInfo";
    const body = input.kind === "applications"
      ? new URLSearchParams({ action: "request", in_comp_id: String(input.campaignId), page_num: String(input.page), order: "0", in_site_name: "", searchBeginDate: "", searchEndDate: "" })
      : new URLSearchParams({ siteId: String(input.siteId), type: "1", isGoogle: "false", quick_filter: "false", hiddenPrice: "false", toBlackList: "false" });
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await sourceFetch(url, {
        method: "POST", redirect: "manual", signal: AbortSignal.timeout(20_000),
        headers: { cookie: buildCookieHeader(loadLocalSession()), "content-type": "application/x-www-form-urlencoded; charset=UTF-8", "x-requested-with": "XMLHttpRequest", referer: "https://gogetlinks.net/reviews/request" },
        body: body.toString(),
      });
      const contentType = response.headers.get("content-type") ?? "";
      const bytes = new Uint8Array(await response.arrayBuffer());
      const raw = /json/i.test(contentType) && !/charset=/i.test(contentType)
        ? new TextDecoder("utf-8").decode(bytes)
        : decodeModalResponseBuffer(bytes, contentType);
      const expired = response.status === 401 || REDIRECT_STATUSES.has(response.status) || /<form[^>]*(?:signIn|login)|name=["']password["']/i.test(raw);
      if (expired) {
        if (!attempt && opts?.allowRelogin !== false && await attemptRelogin({ prismaClient: opts?.prismaClient, fetchImpl: opts?.fetchImpl })) continue;
        throw new GglAuthError("Сессия GoGetLinks истекла. Переподключите кабинет");
      }
      if (response.status === 429) throw new GglCallError("GoGetLinks ограничил частоту запросов. Повторите позже", "rate");
      if (!response.ok || REAL_INTERSTITIAL_RE.test(raw)) throw new GglCallError("GoGetLinks не предоставил данные заявок", "blocked");
      if (input.kind === "site") return raw;
      let parsed: { success?: boolean; data?: unknown };
      try { parsed = JSON.parse(raw); } catch { throw new GglCallError("GoGetLinks вернул неверный формат таблицы заявок", "changed"); }
      if (parsed.success !== true || typeof parsed.data !== "string") throw new GglCallError("GoGetLinks не вернул таблицу входящих заявок", "changed");
      return parsed.data;
    }
    throw new GglAuthError("Не удалось восстановить сессию GoGetLinks");
  });
}

function normalizeReadArgs(
  opName: string,
  args?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (opName === "listReviewsByTab" && args && typeof args.tab === "string") {
    const mappedTab = REVIEW_TAB_SLUG_MAP[args.tab] ?? args.tab;
    if (mappedTab !== args.tab) {
      return { ...args, tab: mappedTab };
    }
  }
  return args;
}

/**
 * Execute a read operation against GoGetLinks via api-anything (Tier 1 plain HTTP).
 * Auto-relogins once if session has expired.
 */
export async function callGglRead<T = unknown>(
  opName: string,
  args?: Record<string, unknown>,
  opts?: {
    prismaClient?: unknown;
    fetchImpl?: typeof fetch;
    skipDbSync?: boolean;
    allowRelogin?: boolean;
  },
): Promise<T> {
  initApiAnythingHome();
  if (opts?.skipDbSync !== true) {
    await syncSessionFromDb(opts?.prismaClient);
  }

  return enqueueGgl(async () => {
    const baseFetch = opts?.fetchImpl || getFetchImpl() || fetch;
    const fetchImpl = createGglFetch(baseFetch);
    const normalizedArgs = normalizeReadArgs(opName, args);

    let result = await call("gogetlinks", opName, normalizedArgs, {
      maxTier: 1,
      minIntervalMs: MIN_INTERVAL_MS,
      fetchImpl,
    });

    // If auth failed and relogin is allowed, attempt auto-relogin once
    const allowRelogin = opts?.allowRelogin !== false;
    if (allowRelogin && (result.class === "auth" || (!result.ok && result.reason?.includes("login")))) {
      const relogged = await attemptRelogin({ prismaClient: opts?.prismaClient, fetchImpl: opts?.fetchImpl });
      if (relogged) {
        result = await call("gogetlinks", opName, normalizedArgs, {
          maxTier: 1,
          minIntervalMs: MIN_INTERVAL_MS,
          fetchImpl,
        });
      }
    }

    if (!result.ok) {
      throw new GglCallError(
        result.reason || `GoGetLinks read operation "${opName}" failed (${result.class})`,
        result.class,
      );
    }

    // Persist refreshed cookies if any
    if (opts?.skipDbSync !== true) {
      const localCookies = loadLocalSession();
      if (localCookies.length > 0) {
        await persistSessionToDb(localCookies, opts?.prismaClient);
      }
    }

    if (opName === "getAccountBalance") {
      const row = (
        Array.isArray(result.data) ? result.data[0] : result.data
      ) as Record<string, unknown> | undefined;
      const balance: GglWalletBalance = {
        balanceRub: parseRubAmount(row?.balance != null ? String(row.balance) : null),
        availableRub: parseRubAmount(row?.available != null ? String(row.available) : null),
        blockedRub: parseRubAmount(row?.blocked != null ? String(row.blocked) : null),
      };
      return balance as T;
    }

    return result.data as T;
  });
}

/**
 * Asserts that a campaign exists and belongs strictly to wesetup.ru.
 * Throws GglIsolationError if not.
 */
export function assertCampaignIsolation(
  campaign: { isWesetup?: boolean } | null | undefined,
  campaignLabel: string,
): void {
  if (!campaign || campaign.isWesetup !== true) {
    throw new GglIsolationError(
      `Write rejected by isolation guard: campaign "${campaignLabel}" does not belong to wesetup.ru`,
    );
  }
}

function stripModalStopWords(text: string, stopWords: string[]): string {
  let out = text;
  for (const word of stopWords) {
    const trimmed = word.trim();
    if (!trimmed) continue;
    const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(escaped, "gi"), "");
  }
  return out.replace(/\s{2,}/g, " ").trim();
}

function decodeModalResponseBuffer(buf: Uint8Array, contentType: string): string {
  const charsetMatch = /charset=["']?([\w.:-]+)/i.exec(contentType);
  const charset = charsetMatch?.[1] || "windows-1251";
  try {
    return new TextDecoder(charset).decode(buf);
  } catch {
    return new TextDecoder("utf-8").decode(buf);
  }
}

/**
 * Executes GoGetLinks' native 5-step campaign creation modal workflow:
 * 1) GET /campaign -> extract session token, stopWords, default price brackets
 * 2) POST /campaign/checkUrl
 * 3) POST /unchors/change/token/<token>/type/save
 * 4) POST /campaign/exist/type/find_exists
 * 5) POST /campaign/save (strictly omitting set_prices_to_all so other campaigns are untouched)
 *
 * Returns `null` if the endpoint did not return real GoGetLinks modal HTML (e.g. unit test mocks),
 * allowing `callGglWrite` to fall back to the `api-anything` `createOrUpdateCampaign` template.
 */
async function tryExecuteModalCampaignCreate(
  args: Record<string, unknown>,
  fetchImpl: typeof fetch,
): Promise<{ status: "applied"; data: Record<string, unknown> } | null> {
  const cookies = loadLocalSession();
  const cookieHeader = buildCookieHeader(cookies);
  const commonXhrHeaders: Record<string, string> = {
    "x-requested-with": "XMLHttpRequest",
    referer: "https://gogetlinks.net/campaigns",
    "user-agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36",
    ...(cookieHeader ? { cookie: cookieHeader } : {}),
  };

  const modalRes = await fetchImpl("https://gogetlinks.net/campaign", {
    method: "GET",
    headers: {
      ...commonXhrHeaders,
      accept: "text/html, */*; q=0.01",
    },
  });

  if (modalRes.status === 401 || modalRes.status === 403) {
    throw new GglAuthError("GoGetLinks session expired before opening campaign modal");
  }

  const modalBytes = new Uint8Array(await modalRes.arrayBuffer());
  const modalHtml = decodeModalResponseBuffer(
    modalBytes,
    modalRes.headers.get("content-type") || "",
  );
  const tokenMatch = /name=["']token["'][^>]*value=["']([a-f0-9]+)["']/i.exec(modalHtml);
  if (!tokenMatch) {
    return null;
  }

  const token = tokenMatch[1];

  let stopWords: string[] = [];
  const stopWordsMatch = /var\s+stopWords\s*=\s*(\[[\s\S]*?\]);/i.exec(modalHtml);
  if (stopWordsMatch) {
    try {
      const parsed = JSON.parse(stopWordsMatch[1]);
      if (Array.isArray(parsed)) {
        stopWords = parsed.filter((w): w is string => typeof w === "string");
      }
    } catch {
      // Ignore malformed stopWords script snippet
    }
  }

  const rawTitle = String(
    args.name ?? args.title ?? "WeSetup электронные журналы ХАССП",
  )
    .replace(/[—–]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  const compName = stripModalStopWords(rawTitle, stopWords).slice(0, 50) || "WeSetup ХАССП";

  const initialUrl = "https://wesetup.ru";
  const initialAnchor =
    stripModalStopWords(
      String(args.anchor ?? args.initialAnchor ?? "электронные журналы ХАССП"),
      stopWords,
    ).slice(0, 200) || "электронные журналы ХАССП";
  const taskDescription = stripModalStopWords(
    String(args.task ?? args.description ?? DEFAULT_WESETUP_CAMPAIGN_BRIEF),
    stopWords,
  ).slice(0, 800);

  const postHeaders: Record<string, string> = {
    ...commonXhrHeaders,
    "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
    accept: "application/json, text/javascript, */*; q=0.01",
    origin: "https://gogetlinks.net",
  };

  // Step 2: Validate URL
  const checkRes = await fetchImpl("https://gogetlinks.net/campaign/checkUrl", {
    method: "POST",
    headers: postHeaders,
    body: new URLSearchParams({ URL: initialUrl }).toString(),
  });
  const checkText = await checkRes.text();
  try {
    const checkJson = JSON.parse(checkText) as { error?: string };
    if (checkJson.error) {
      throw new GglCallError(`GoGetLinks checkUrl error: ${checkJson.error}`, "input");
    }
  } catch (err) {
    if (err instanceof GglCallError) throw err;
  }

  // Step 3: Register initial URL + anchor in modal token state
  const anchorRes = await fetchImpl(
    `https://gogetlinks.net/unchors/change/token/${encodeURIComponent(token)}/type/save`,
    {
      method: "POST",
      headers: postHeaders,
      body: new URLSearchParams({ URL: initialUrl, text: initialAnchor }).toString(),
    },
  );
  const anchorText = await anchorRes.text();
  try {
    const anchorJson = JSON.parse(anchorText) as { error?: string };
    if (anchorJson.error) {
      throw new GglCallError(`GoGetLinks anchor error: ${anchorJson.error}`, "input");
    }
  } catch (err) {
    if (err instanceof GglCallError) throw err;
  }

  // Step 4: Trigger find_exists check
  await fetchImpl("https://gogetlinks.net/campaign/exist/type/find_exists", {
    method: "POST",
    headers: postHeaders,
    body: new URLSearchParams({ url: initialUrl, token }).toString(),
  }).catch(() => {});

  // Extract default price brackets from modal HTML (falling back to GoGetLinks defaults)
  const extractPrices = (prefix: "link" | "post" | "paper"): Record<string, string> => {
    const defaults: Record<string, string> = {
      "1": "240",
      "2": "340",
      "3": "450",
      "4": "560",
      "5": "680",
      "6": "1160",
    };
    const re = new RegExp(`name=["']${prefix}\\[(\\d+)\\]["'][^>]*value=["'](\\d+)["']`, "gi");
    let m: RegExpExecArray | null;
    while ((m = re.exec(modalHtml)) !== null) {
      defaults[m[1]] = m[2];
    }
    return defaults;
  };

  const linkPrices = extractPrices("link");
  const postPrices = extractPrices("post");
  const paperPrices = extractPrices("paper");

  const saveForm = new URLSearchParams();
  saveForm.set("comp_id", "");
  saveForm.set("token", token);
  saveForm.set("comp_name", compName);
  saveForm.set("URL_add", "");
  saveForm.set("text_add", "");
  saveForm.set("variation_unchor", "yes");
  saveForm.set("task", taskDescription);
  saveForm.set("task_main", "");
  saveForm.set("task_alt", "");
  saveForm.set("url_mask", "wesetup.ru");
  saveForm.append("types[]", "1");
  saveForm.append("types[]", "2");
  saveForm.append("types[]", "3");
  for (const tier of ["1", "2", "3", "4", "5", "6"]) {
    saveForm.set(`link[${tier}]`, linkPrices[tier]);
    saveForm.set(`post[${tier}]`, postPrices[tier]);
    saveForm.set(`paper[${tier}]`, paperPrices[tier]);
  }
  // Never include set_prices_to_all so existing campaigns are never touched
  saveForm.set("allow_nofollow", "0");
  saveForm.set("only_allow_ti_zero", "0");
  saveForm.set("only_in_yandex", "1");
  saveForm.set("only_in_google", "0");
  saveForm.set("is_subdomains", "1");
  saveForm.set("allow_forums", "0");
  saveForm.set("allow_profiles", "0");
  saveForm.set("insurance", "2");

  // Step 5: Save campaign
  const saveRes = await fetchImpl("https://gogetlinks.net/campaign/save", {
    method: "POST",
    headers: postHeaders,
    body: saveForm.toString(),
  });
  const saveText = await saveRes.text();
  let saveJson: Record<string, unknown> = {};
  try {
    saveJson = JSON.parse(saveText) as Record<string, unknown>;
  } catch {
    throw new GglCallError(
      `GoGetLinks campaign/save returned non-JSON response (HTTP ${saveRes.status})`,
      "drift",
    );
  }

  if (typeof saveJson.error === "string" && saveJson.error.trim() !== "") {
    throw new GglCallError(`GoGetLinks campaign/save error: ${saveJson.error}`, "input");
  }

  return { status: "applied", data: saveJson };
}

/**
 * Execute a write operation against GoGetLinks via api-anything.
 * Strict isolation guard: throws GglIsolationError before touching network if campaignId or siteUrl
 * does not belong to wesetup.ru.
 */
export async function callGglWrite<T = unknown>(input: {
  opName: string;
  args: Record<string, unknown>;
  idempotencyKey: string;
  campaignIdForGuard?: string;
  prismaClient?: unknown;
  fetchImpl?: typeof fetch;
}): Promise<{ status: "applied" | "accepted" | "may_have_applied"; data: T }> {
  // 1. ISOLATION GUARD: Must be verified BEFORE touching network
  // A. Check siteUrl for campaign creation or update
  if (
    input.opName === "createOrUpdateCampaign" ||
    input.args?.siteUrl !== undefined ||
    input.args?.URL !== undefined
  ) {
    const targetSiteUrl = String(input.args?.siteUrl ?? input.args?.URL ?? "");
    if (!isWesetupDomain(targetSiteUrl)) {
      throw new GglIsolationError(
        `Write rejected by isolation guard: target siteUrl "${targetSiteUrl}" is not wesetup.ru`,
      );
    }
  }

  // B. Check campaignId isolation if present in campaignIdForGuard, args.campaignId, or args.comp_id
  const candidateCampaignId =
    input.campaignIdForGuard ??
    (input.args?.campaignId as string | number | undefined) ??
    (input.args?.comp_id as string | number | undefined);

  if (
    candidateCampaignId !== undefined &&
    candidateCampaignId !== null &&
    String(candidateCampaignId).trim() !== ""
  ) {
    const compIdStr = String(candidateCampaignId).trim();
    const gglCompId = Number(compIdStr);
    let campaign: { isWesetup?: boolean } | null = null;
    try {
      const client = resolveClient(input.prismaClient);
      campaign = await client.gglCampaign.findFirst({
        where: {
          OR: [
            { id: compIdStr },
            ...(Number.isFinite(gglCompId) && gglCompId > 0 ? [{ gglCampaignId: gglCompId }] : []),
          ],
        },
      });
    } catch (err: unknown) {
      if (err instanceof GglIsolationError) throw err;
      const errMsg = err instanceof Error ? err.message : String(err);
      throw new GglIsolationError(
        `Write rejected by isolation guard: unable to verify campaign "${compIdStr}": ${errMsg}`,
      );
    }

    assertCampaignIsolation(campaign, compIdStr);
  }

  initApiAnythingHome();
  await syncSessionFromDb(input.prismaClient);

  return enqueueGgl(async () => {
    const baseFetch = input.fetchImpl || getFetchImpl() || fetch;
    const fetchImpl = createGglFetch(baseFetch);

    // Real GoGetLinks campaign creation requires the 5-step modal token + anchor flow
    if (input.opName === "createOrUpdateCampaign" && !candidateCampaignId) {
      try {
        const modalCreated = await tryExecuteModalCampaignCreate(input.args, fetchImpl);
        if (modalCreated) {
          return { status: modalCreated.status, data: modalCreated.data as T };
        }
      } catch (err) {
        if (err instanceof GglAuthError) {
          const relogged = await attemptRelogin({
            prismaClient: input.prismaClient,
            fetchImpl: input.fetchImpl,
          });
          if (relogged) {
            const retried = await tryExecuteModalCampaignCreate(input.args, fetchImpl);
            if (retried) {
              return { status: retried.status, data: retried.data as T };
            }
          }
        }
        throw err;
      }
    }

    let result = await call("gogetlinks", input.opName, input.args, {
      allowWrites: true,
      idempotencyKey: input.idempotencyKey,
      maxTier: 1,
      minIntervalMs: MIN_INTERVAL_MS,
      fetchImpl,
    });

    // If auth failed, attempt auto-relogin once
    if (result.class === "auth" || (!result.ok && result.reason?.includes("login"))) {
      const relogged = await attemptRelogin({
        prismaClient: input.prismaClient,
        fetchImpl: input.fetchImpl,
      });
      if (relogged) {
        result = await call("gogetlinks", input.opName, input.args, {
          allowWrites: true,
          again: true,
          idempotencyKey: input.idempotencyKey,
          maxTier: 1,
          minIntervalMs: MIN_INTERVAL_MS,
          fetchImpl,
        });
      }
    }

    if (!result.ok) {
      throw new GglCallError(
        result.reason || `GoGetLinks write operation "${input.opName}" failed (${result.class})`,
        result.class,
      );
    }

    const localCookies = loadLocalSession();
    if (localCookies.length > 0) {
      await persistSessionToDb(localCookies, input.prismaClient);
    }

    let status: "applied" | "accepted" | "may_have_applied" = "may_have_applied";
    if (result.write === "applied") {
      status = "applied";
    } else if (result.write === "accepted" || result.ok) {
      status = "accepted";
    }

    return {
      status,
      data: result.data as T,
    };
  });
}

/**
 * Permanently selects a `wesetup.ru` campaign as the active overall campaign inside GoGetLinks'
 * personal cabinet (`POST /campaigns/setOverallCampaignId`), guarded by campaign isolation.
 */
export async function pinGglOverallCampaign(
  gglCampaignId: number,
  opts?: {
    prismaClient?: unknown;
    fetchImpl?: typeof fetch;
    idempotencyKey?: string;
  },
): Promise<void> {
  if (!Number.isFinite(gglCampaignId) || gglCampaignId <= 0) return;
  await callGglWrite({
    opName: "setOverallCampaign",
    args: { campaignId: String(gglCampaignId) },
    campaignIdForGuard: String(gglCampaignId),
    idempotencyKey:
      opts?.idempotencyKey ?? `pin-overall-${gglCampaignId}-${Math.floor(Date.now() / 10_000)}`,
    prismaClient: opts?.prismaClient,
    fetchImpl: opts?.fetchImpl,
  });
}
