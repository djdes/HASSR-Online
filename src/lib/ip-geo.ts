/**
 * Страна, город и часовой пояс клиента по IP — для уведомлений продажам и
 * карточки клиента в /root (спека blank-download-extras-2026-11).
 *
 * Источник по порядку:
 *   1. заголовки прокси (`cf-ipcountry`, `x-geoip-country`, `x-country-code`)
 *      — если nginx/CDN их ставит, внешний запрос не нужен;
 *   2. HTTPS-запрос к `IP_GEO_URL` (по умолчанию https://ipwho.is), таймаут
 *      1,5 с, ответ кешируется в памяти на сутки.
 * Приватные и служебные адреса не спрашиваем. Любая ошибка — `null`:
 * гео — украшение уведомления, оно никогда не ломает основное действие.
 * Как и сам IP из `X-Forwarded-For`, годится для аналитики, не для доступа.
 */

export type IpGeo = {
  /** ISO 3166-1 alpha-2, заглавными: `RU`. */
  countryCode: string;
  city: string | null;
  /** IANA-пояс, если источник его знает. */
  timeZone: string | null;
};

/** Флаг страны эмодзи из двух букв кода: `RU` → 🇷🇺. */
export function countryFlag(code: string | null | undefined): string {
  const clean = (code ?? "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(clean)) return "🌐";
  return String.fromCodePoint(...[...clean].map((char) => 0x1f1e6 + char.charCodeAt(0) - 65));
}

/** Название страны на языке интерфейса (`RU` → «Россия»). */
export function countryName(code: string | null | undefined, locale = "ru"): string | null {
  const clean = (code ?? "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(clean)) return null;
  try {
    return new Intl.DisplayNames([locale], { type: "region" }).of(clean) ?? clean;
  } catch {
    return clean;
  }
}

/** Действующий IANA-пояс или `null` (мусор из браузера, `undefined`, пустое). */
export function normalizeTimeZone(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const zone = raw.trim();
  if (!zone || zone.length > 64 || !/^[A-Za-z0-9_+\-/]+$/.test(zone)) return null;
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: zone }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

/** Смещение пояса в момент `at`: `UTC+3`, `UTC+5:30`, `UTC`. */
export function utcOffsetLabel(timeZone: string, at: Date = new Date()): string {
  try {
    const part = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "shortOffset" })
      .formatToParts(at)
      .find((item) => item.type === "timeZoneName")?.value;
    if (!part) return "UTC";
    return part.replace(/^GMT/, "UTC").replace(/^UTC[+-]0$/, "UTC");
  } catch {
    return "UTC";
  }
}

/** Местное время `HH:MM` в поясе клиента. */
export function localTimeLabel(timeZone: string, at: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat("ru-RU", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).format(at);
  } catch {
    return at.toISOString().slice(11, 16);
  }
}

/** Город и страна, заданные самой организацией (настройки, регистрация). */
export type ClientPlace = { countryCode?: string | null; city?: string | null; timeZone?: string | null };

/**
 * Строка для Telegram: «🇷🇺 Россия, Барнаул · 09:29» (спека
 * tg-client-location-2026-11 — коротко, без «местное время» и смещения).
 * Пояс — из браузера, иначе по IP, иначе пояс организации (`fallback`).
 * Место — по IP, иначе город/страна организации. Без места строка
 * «🕒 16:32 (UTC+5)»: смещение подсказывает, где человек. Ничего не известно — `null`.
 */
export function clientLocationLine(params: {
  geo: IpGeo | null;
  timeZone?: string | null;
  fallback?: ClientPlace | null;
  at?: Date;
}): string | null {
  const fallback = params.fallback ?? null;
  const zone =
    normalizeTimeZone(params.timeZone) ?? normalizeTimeZone(params.geo?.timeZone) ?? normalizeTimeZone(fallback?.timeZone);
  const geoPlace = params.geo
    ? { countryCode: params.geo.countryCode, city: params.geo.city }
    : fallback && (fallback.countryCode || fallback.city)
      ? { countryCode: fallback.countryCode ?? null, city: fallback.city ?? null }
      : null;
  const place = geoPlace ? [countryName(geoPlace.countryCode), geoPlace.city?.trim() || null].filter(Boolean).join(", ") : "";
  if (!place) {
    return zone ? `🕒 ${localTimeLabel(zone, params.at)} (${utcOffsetLabel(zone, params.at)})` : null;
  }
  const flag = geoPlace?.countryCode ? countryFlag(geoPlace.countryCode) : "📍";
  return `${flag} ${[place, zone ? localTimeLabel(zone, params.at) : ""].filter(Boolean).join(" · ")}`;
}

/** Адрес, о котором внешний сервис ничего не скажет: локальные, частные, служебные. */
export function isPublicIp(ip: string | null | undefined): boolean {
  const value = (ip ?? "").trim().replace(/^::ffff:/i, "");
  if (!value || value === "unknown") return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(value)) {
    const [a, b] = value.split(".").map(Number);
    if (a === 10 || a === 127 || a === 0 || a >= 224) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    // Документационные сети (TEST-NET-1/2/3) — их пишут в тестах и примерах.
    const prefix = value.split(".").slice(0, 3).join(".");
    if (prefix === "192.0.2" || prefix === "198.51.100" || prefix === "203.0.113") return false;
    return true;
  }
  if (value.includes(":")) {
    const lower = value.toLowerCase();
    if (lower === "::1" || lower === "::" || lower.startsWith("fe80") || lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("2001:db8")) return false;
    return /^[0-9a-f:]+$/.test(lower);
  }
  return false;
}

/** Страна из заголовков прокси/CDN, если они есть. */
export function geoFromHeaders(headers: Headers | null | undefined): IpGeo | null {
  if (!headers) return null;
  for (const name of ["cf-ipcountry", "x-geoip-country", "x-country-code"]) {
    const value = headers.get(name)?.trim().toUpperCase();
    if (value && /^[A-Z]{2}$/.test(value) && value !== "XX" && value !== "T1") {
      return { countryCode: value, city: null, timeZone: null };
    }
  }
  return null;
}

/** Ответ ipwho.is (и совместимых) → `IpGeo`. Чистая функция — для тестов. */
export function parseIpGeoResponse(body: unknown): IpGeo | null {
  if (!body || typeof body !== "object") return null;
  const value = body as Record<string, unknown>;
  if (value.success === false) return null;
  const rawCode = value.country_code ?? value.countryCode;
  const countryCode = typeof rawCode === "string" ? rawCode.trim().toUpperCase() : "";
  if (!/^[A-Z]{2}$/.test(countryCode)) return null;
  const rawCity = typeof value.city === "string" ? value.city.trim().slice(0, 80) : "";
  const tz = value.timezone;
  const timeZone = normalizeTimeZone(
    tz && typeof tz === "object" ? (tz as Record<string, unknown>).id : typeof tz === "string" ? tz : null,
  );
  return { countryCode, city: rawCity || null, timeZone };
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX = 2000;
const cache = new Map<string, { geo: IpGeo | null; at: number }>();

function geoEndpoint(ip: string): string {
  const base = (process.env.IP_GEO_URL || "https://ipwho.is").replace(/\/+$/, "");
  // Города — по-русски: строка уходит продажам в Telegram.
  return `${base}/${encodeURIComponent(ip)}?lang=ru`;
}

/**
 * Страна/город/пояс по IP. Сначала заголовки прокси (если передали), потом
 * кеш, потом внешний запрос. `IP_GEO_URL=off` выключает внешние запросы.
 */
export async function lookupIpGeo(
  ip: string | null | undefined,
  options: { headers?: Headers | null; fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<IpGeo | null> {
  const fromHeaders = geoFromHeaders(options.headers);
  const clean = (ip ?? "").trim();
  if (!isPublicIp(clean)) return fromHeaders;
  const cached = cache.get(clean);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.geo ?? fromHeaders;
  if ((process.env.IP_GEO_URL ?? "").trim().toLowerCase() === "off") return fromHeaders;

  let geo: IpGeo | null = null;
  try {
    const response = await (options.fetchImpl ?? fetch)(geoEndpoint(clean), {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(options.timeoutMs ?? 1500),
    });
    if (response.ok) geo = parseIpGeoResponse(await response.json().catch(() => null));
  } catch (error) {
    console.warn("[ip-geo] lookup failed", error instanceof Error ? error.message : error);
    return fromHeaders;
  }
  if (cache.size >= CACHE_MAX) cache.clear();
  cache.set(clean, { geo, at: Date.now() });
  if (!geo) return fromHeaders;
  // Заголовок прокси точнее по стране, внешний сервис добавляет город и пояс.
  return fromHeaders && fromHeaders.countryCode !== geo.countryCode ? { ...geo, countryCode: fromHeaders.countryCode } : geo;
}
