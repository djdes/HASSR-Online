/**
 * Server-side GoGetLinks client leveraging api-anything and native Windows-1251 encoding.
 *
 * Implements:
 * - Temporary home directory initialization under os.tmpdir()/wesetup-api-anything
 * - Spec synchronization from config/api-anything/sites/gogetlinks.json
 * - In-process serialized request queue with rate limiting (minIntervalMs: 1200)
 * - Optional proxy support via undici ProxyAgent(GGL_PROXY_URL)
 * - Session restoration and encrypted persistence with GglAccount.sessionEnc
 * - Single-retry auto-relogin on auth failure via POST https://gogetlinks.net/user/signIn
 * - Strict campaign isolation guard (isWesetup === true) for all writes
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { call, type StoredCookie } from "api-anything";
import { db } from "@/lib/db";
import { decryptSecret, encryptSecret } from "@/lib/integration-crypto";
import { parseRubAmount } from "@/lib/seo/gogetlinks-codec";

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

// Ensure API_ANYTHING_HOME is set
const API_ANYTHING_HOME = process.env.API_ANYTHING_HOME || join(tmpdir(), "wesetup-api-anything");
process.env.API_ANYTHING_HOME = API_ANYTHING_HOME;

let initialized = false;

export function initApiAnythingHome(): void {
  if (initialized) return;

  const sitesDir = join(API_ANYTHING_HOME, "sites");
  const sessionsDir = join(API_ANYTHING_HOME, "sessions");
  mkdirSync(sitesDir, { recursive: true, mode: 0o700 });
  mkdirSync(sessionsDir, { recursive: true, mode: 0o700 });

  // 1. Write config.json
  const configPath = join(API_ANYTHING_HOME, "config.json");
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
  if (existsSync(sourceSpecPath)) {
    try {
      const raw = readFileSync(sourceSpecPath, "utf8");
      writeFileSync(destSpecPath, raw, { mode: 0o600 });
    } catch (err) {
      console.warn("[ggl-client] Warning: failed to sync gogetlinks.json to home:", err);
    }
  }

  initialized = true;
}

function getFetchImpl(): typeof fetch | undefined {
  const proxyUrl = process.env.GGL_PROXY_URL;
  if (!proxyUrl) return undefined;

  try {
    // Dynamic require so undici isn't forced if not needed
    const { ProxyAgent, fetch: undiciFetch } = require("undici");
    const agent = new ProxyAgent(proxyUrl);
    return ((url: any, init: any) =>
      undiciFetch(url, { ...init, dispatcher: agent })) as unknown as typeof fetch;
  } catch (err) {
    console.warn("[ggl-client] Failed to configure proxy agent:", err);
    return undefined;
  }
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
  const rawList = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];
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

function saveLocalSession(cookies: StoredCookie[]): void {
  initApiAnythingHome();
  const sessionsDir = join(API_ANYTHING_HOME, "sessions");
  const file = join(sessionsDir, "gogetlinks.json");
  const data = {
    cookies,
    values: {},
    updatedAt: new Date().toISOString(),
  };
  writeFileSync(file, JSON.stringify(data, null, 2), { mode: 0o600 });
}

function loadLocalSession(): StoredCookie[] {
  initApiAnythingHome();
  const file = join(API_ANYTHING_HOME, "sessions", "gogetlinks.json");
  if (!existsSync(file)) return [];
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    return parsed.cookies || [];
  } catch {
    return [];
  }
}

async function syncSessionFromDb(): Promise<void> {
  initApiAnythingHome();
  try {
    const account = await db.gglAccount.findFirst();
    if (!account || !account.sessionEnc) return;

    const decrypted = decryptSecret(account.sessionEnc);
    const parsed = JSON.parse(decrypted);
    const cookies = Array.isArray(parsed) ? parsed : parsed.cookies || [];
    saveLocalSession(cookies);
  } catch (err) {
    console.warn("[ggl-client] Warning: could not restore session from DB:", err);
  }
}

async function persistSessionToDb(cookies: StoredCookie[]): Promise<void> {
  try {
    const account = await db.gglAccount.findFirst();
    if (!account) return;

    const sessionObj = { cookies, values: {}, updatedAt: new Date().toISOString() };
    const encrypted = encryptSecret(JSON.stringify(sessionObj));
    await db.gglAccount.update({
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

async function attemptRelogin(): Promise<boolean> {
  try {
    const account = await db.gglAccount.findFirst();
    if (!account || !account.email || !account.passwordEnc) return false;

    const password = decryptSecret(account.passwordEnc);
    const { cookies } = await verifyAndLoginGgl(account.email, password);
    await persistSessionToDb(cookies);
    return true;
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
): Promise<{ cookies: StoredCookie[]; balance: GglWalletBalance }> {
  initApiAnythingHome();

  const fetchImpl = getFetchImpl() || fetch;
  const formBody = new URLSearchParams({
    e_mail: email,
    password: password,
    remember: "on",
    is_ajax: "true",
  }).toString();

  const res = await fetchImpl("https://gogetlinks.net/user/signIn", {
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

  saveLocalSession(cookies);

  // Attempt to fetch current balance
  let balance: GglWalletBalance = { balanceRub: 0, availableRub: 0, blockedRub: 0 };
  try {
    balance = await callGglRead<GglWalletBalance>("getAccountBalance");
  } catch (err) {
    console.warn("[ggl-client] Warning: unable to read initial balance:", err);
  }

  return { cookies, balance };
}

/**
 * Execute a read operation against GoGetLinks via api-anything (Tier 1 plain HTTP).
 * Auto-relogins once if session has expired.
 */
export async function callGglRead<T = unknown>(
  opName: string,
  args?: Record<string, unknown>,
): Promise<T> {
  initApiAnythingHome();
  await syncSessionFromDb();

  return enqueueGgl(async () => {
    const fetchImpl = getFetchImpl();

    let result = await call("gogetlinks", opName, args, {
      maxTier: 1,
      minIntervalMs: MIN_INTERVAL_MS,
      fetchImpl,
    });

    // If auth failed, attempt auto-relogin once
    if (result.class === "auth" || (!result.ok && result.reason?.includes("login"))) {
      const relogged = await attemptRelogin();
      if (relogged) {
        result = await call("gogetlinks", opName, args, {
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
    const localCookies = loadLocalSession();
    if (localCookies.length > 0) {
      await persistSessionToDb(localCookies);
    }

    // Format balance if getAccountBalance
    if (opName === "getAccountBalance") {
      const row = Array.isArray(result.data) ? result.data[0] : (result.data as any) || {};
      const balance: GglWalletBalance = {
        balanceRub: parseRubAmount(row?.balance),
        availableRub: parseRubAmount(row?.available),
        blockedRub: parseRubAmount(row?.blocked),
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

/**
 * Execute a write operation against GoGetLinks via api-anything.
 * Strict isolation guard: throws GglIsolationError before touching network if campaignIdForGuard
 * does not belong to wesetup.ru.
 */
export async function callGglWrite<T = unknown>(input: {
  opName: string;
  args: Record<string, unknown>;
  idempotencyKey: string;
  campaignIdForGuard?: string;
  prismaClient?: any;
}): Promise<{ status: "applied" | "accepted" | "may_have_applied"; data: T }> {
  // 1. ISOLATION GUARD: Must be verified BEFORE touching network
  if (input.campaignIdForGuard) {
    let campaign: { isWesetup?: boolean } | null = null;
    try {
      const gglCompId = Number(input.campaignIdForGuard);
      const client = input.prismaClient || db;
      campaign = await client.gglCampaign.findFirst({
        where: {
          OR: [
            { id: input.campaignIdForGuard },
            ...(Number.isFinite(gglCompId) && gglCompId > 0 ? [{ gglCampaignId: gglCompId }] : []),
          ],
        },
      });
    } catch (err: any) {
      if (err instanceof GglIsolationError) throw err;
      throw new GglIsolationError(
        `Write rejected by isolation guard: unable to verify campaign "${input.campaignIdForGuard}": ${err?.message || String(err)}`,
      );
    }

    assertCampaignIsolation(campaign, input.campaignIdForGuard);
  }

  initApiAnythingHome();
  await syncSessionFromDb();

  return enqueueGgl(async () => {
    const fetchImpl = getFetchImpl();

    let result = await call("gogetlinks", input.opName, input.args, {
      allowWrites: true,
      idempotencyKey: input.idempotencyKey,
      maxTier: 1,
      minIntervalMs: MIN_INTERVAL_MS,
      fetchImpl,
    });

    // If auth failed, attempt auto-relogin once
    if (result.class === "auth" || (!result.ok && result.reason?.includes("login"))) {
      const relogged = await attemptRelogin();
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
      await persistSessionToDb(localCookies);
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
