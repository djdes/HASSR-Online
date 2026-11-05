/**
 * Codec, normalizers and utilities for GoGetLinks HTTP responses and forms.
 *
 * GoGetLinks operates in windows-1251 encoding over HTTP.
 * This module provides clean encoding and decoding between UTF-8 and windows-1251
 * using Node's native TextDecoder and a 256-byte lookup map (zero iconv dependencies).
 */

export interface NormalizedGglCampaign {
  gglCampaignId: number;
  name: string;
  domain: string;
  siteUrl: string;
  isWesetup: boolean;
  state: "active" | "closed";
  spentRub: number;
  linksCount: number;
  requestsCount: number;
  qualityControl: string | null;
  statusNote: string | null;
}

export interface NormalizedGglReview {
  gglReviewId: number;
  donorDomain: string;
  publishedUrl?: string | null;
  targetUrl: string;
  anchor: string;
  priceRub: number;
  status: string;
  paidDate?: string | null;
  placementFormat?: string;
  dailyTraffic?: number;
  tfCf?: { tf: number; cf: number; label: string } | null;
}

// Build 256-entry windows-1251 -> Unicode & Unicode -> byte map using native TextDecoder
const win1251Decoder = new TextDecoder("windows-1251");
const unicodeToWin1251Map = new Map<string, number>();

for (let b = 0; b <= 255; b++) {
  const ch = win1251Decoder.decode(new Uint8Array([b]));
  if (ch && ch !== "\uFFFD") {
    unicodeToWin1251Map.set(ch, b);
  }
}

/**
 * Decode a Uint8Array containing windows-1251 bytes into a UTF-8 string.
 */
export function decodeWin1251(bytes: Uint8Array): string {
  return win1251Decoder.decode(bytes);
}

/**
 * Returns true iff domainOrUrl resolves to wesetup.ru (or www.wesetup.ru).
 * Isolates wesetup.ru from any other domains or subdomains.
 */
export function isWesetupDomain(domainOrUrl: string | null | undefined): boolean {
  if (!domainOrUrl) return false;
  let str = String(domainOrUrl).trim().toLowerCase();
  // Strip protocol
  str = str.replace(/^[a-z]+:\/\//, "");
  // Strip path, query, hash
  str = str.split(/[/?#]/)[0];
  // Strip port
  str = str.split(":")[0];
  // Strip leading www.
  str = str.replace(/^www\./, "");
  return str === "wesetup.ru";
}

/**
 * Encode a string value to windows-1251 URL percent-encoding.
 * Normalizes '₽' to 'руб.' before encoding.
 */
function encodeWin1251Value(val: string): string {
  const normalized = val.replaceAll("₽", "руб.");
  let result = "";

  for (const ch of normalized) {
    if (/[a-zA-Z0-9_.~-]/.test(ch)) {
      result += ch;
    } else if (ch === " ") {
      result += "+";
    } else {
      const byte = unicodeToWin1251Map.get(ch);
      if (byte !== undefined) {
        result += "%" + byte.toString(16).toUpperCase().padStart(2, "0");
      } else {
        // Fallback for unsupported characters: standard URI percent-encoding
        result += encodeURIComponent(ch);
      }
    }
  }

  return result;
}

/**
 * Encodes keys/values into application/x-www-form-urlencoded using
 * single-byte windows-1251 percent-encoding (%C0–%FF, Ё=%A8, ё=%B8, №=%B9, —=%97, «=%AB, »=%BB),
 * normalizing ₽ → "руб." before encoding.
 */
export function encodeWin1251Form(
  fields: Record<string, string | number | boolean | null | undefined>,
): string {
  const parts: string[] = [];

  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue;
    const encKey = encodeWin1251Value(key);
    const encVal = encodeWin1251Value(String(value));
    parts.push(`${encKey}=${encVal}`);
  }

  return parts.join("&");
}

/**
 * Parses ruble string amounts like "8 936.06 р.", "15 415 р.", "0", "116 Р" -> number.
 */
export function parseRubAmount(raw: string | null | undefined): number {
  if (!raw) return 0;
  // Replace non-breaking spaces and regular whitespace
  let clean = String(raw).replace(/[\s\u00A0\u202F]/g, "");
  // Replace comma with dot
  clean = clean.replace(",", ".");
  // Extract number pattern
  const match = clean.match(/-?\d+(?:\.\d+)?/);
  if (!match) return 0;
  const num = Number.parseFloat(match[0]);
  return Number.isFinite(num) ? num : 0;
}

/**
 * Parses TF/CF string like "14 / 22" or "18" cleanly into { tf, cf, label }.
 */
export function parseTfCf(raw: string | null | undefined): { tf: number; cf: number; label: string } | null {
  if (!raw) return null;
  const str = String(raw).trim();
  if (!str) return null;

  const match = str.match(/^(\d+)\s*(?:\/\s*(\d+))?$/);
  if (!match) return null;

  const tf = Number.parseInt(match[1], 10);
  const cf = match[2] !== undefined ? Number.parseInt(match[2], 10) : 0;
  return { tf, cf, label: str };
}

/**
 * Normalizes a campaign row extracted from GoGetLinks HTML table.
 * Extracts gglCampaignId from campaignId OR /campaign/index/id/(\d+) in campaignUrl.
 * Overrides state to "closed" if context.finalUrl includes "view_closed" or statusNote matches /закрыта|заблокирована/i.
 * Sets isWesetup = isWesetupDomain(domain).
 */
export function normalizeCampaignRow(
  raw: Record<string, unknown>,
  context: { requestedState: "active" | "closed"; finalUrl?: string },
): NormalizedGglCampaign | null {
  if (!raw || typeof raw !== "object") return null;

  // 1. Extract campaign ID
  let gglCampaignId: number | null = null;
  if (raw.campaignId !== undefined && raw.campaignId !== null && String(raw.campaignId).trim() !== "") {
    const parsed = Number.parseInt(String(raw.campaignId).trim(), 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      gglCampaignId = parsed;
    }
  }

  if (gglCampaignId === null && typeof raw.campaignUrl === "string") {
    const m = raw.campaignUrl.match(/\/campaign\/(?:index\/id\/)?(\d+)/i);
    if (m) {
      const parsed = Number.parseInt(m[1], 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        gglCampaignId = parsed;
      }
    }
  }

  if (gglCampaignId === null) return null;

  const domain = String(raw.domain || "").trim();
  const siteUrl = String(raw.siteUrl || "").trim();
  const name = String(raw.name || domain || "").trim();
  const statusNote = raw.statusNote ? String(raw.statusNote).trim() : null;
  const qualityControl = raw.qualityControl ? String(raw.qualityControl).trim() : null;
  const spentRub = parseRubAmount(raw.spent as string);
  const linksCount = Number.parseInt(String(raw.linksCount || "0").replace(/\D/g, ""), 10) || 0;
  const requestsCount = Number.parseInt(String(raw.requestsCount || "0").replace(/\D/g, ""), 10) || 0;

  // Determine state
  let state: "active" | "closed" = context.requestedState;
  if (
    context.finalUrl?.includes("view_closed") ||
    (statusNote !== null && /закрыта|заблокирована/i.test(statusNote))
  ) {
    state = "closed";
  }

  const isWesetup = isWesetupDomain(domain || siteUrl);

  return {
    gglCampaignId,
    name,
    domain,
    siteUrl,
    isWesetup,
    state,
    spentRub,
    linksCount,
    requestsCount,
    qualityControl,
    statusNote,
  };
}

/**
 * Normalizes a review/backlink row extracted from GoGetLinks HTML table.
 * Parses col_row_<id>, donor domain, metrics, price, paid date (DD.MM.YYYY), target URL, anchor.
 */
export function normalizeReviewRow(
  raw: Record<string, unknown>,
  defaultStatus = "paid",
): NormalizedGglReview | null {
  if (!raw || typeof raw !== "object") return null;

  // Extract review ID from rowId ("col_row_6046338") or id
  let gglReviewId: number | null = null;
  const rawId = String(raw.rowId || raw.reviewId || raw.id || "").trim();
  const matchId = rawId.match(/(?:col_row_)?(\d+)/);
  if (matchId) {
    const parsed = Number.parseInt(matchId[1], 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      gglReviewId = parsed;
    }
  }

  if (gglReviewId === null) return null;

  // Extract donor domain
  let donorDomain = "";
  if (typeof raw.publishedUrl === "string" && raw.publishedUrl.trim()) {
    try {
      const u = new URL(raw.publishedUrl.trim());
      donorDomain = u.hostname.replace(/^www\./i, "").toLowerCase();
    } catch {
      // not a full URL, fallback
    }
  }

  if (!donorDomain && typeof raw.siteCell === "string") {
    const m = raw.siteCell.match(/([a-z0-9а-яё.-]+\.[a-zа-яё]{2,})/i);
    if (m) {
      donorDomain = m[1].replace(/^www\./i, "").toLowerCase();
    }
  }

  const publishedUrl = raw.publishedUrl ? String(raw.publishedUrl).trim() : null;
  const targetUrl = String(raw.targetUrl || "").trim();
  const anchor = String(raw.anchor || "").trim();
  const priceRub = parseRubAmount(raw.price as string);
  const paidDate = raw.paidDate ? String(raw.paidDate).trim() : null;
  const status = defaultStatus;
  const placementFormat = typeof raw.placementFormat === "string" ? raw.placementFormat : "note";
  const dailyTraffic = Number.parseInt(String(raw.dailyTraffic || "0").replace(/\D/g, ""), 10) || 0;
  const tfCf = parseTfCf(raw.tfCf as string);

  return {
    gglReviewId,
    donorDomain,
    publishedUrl,
    targetUrl,
    anchor,
    priceRub,
    status,
    paidDate,
    placementFormat,
    dailyTraffic,
    tfCf,
  };
}
