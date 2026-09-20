/**
 * Recursive redaction of sensitive ключей из произвольного JSON-blob'а
 * перед отдачей в клиент через `/settings/audit` (и любой другой
 * audit-feed). Защита defense-in-depth: даже admin не должен видеть
 * сырой password-hash или Telegram initData в JSON.stringify(details)
 * UI-render'е.
 *
 * Список ключей case-insensitive — ловит и snake_case, и camelCase
 * варианты, плюс смешанные `apiKey`/`api_key`.
 */

const REDACT_KEYS = new Set([
  "password",
  "passwordhash",
  "password_hash",
  "newhash",
  "oldhash",
  "token",
  "secret",
  "apikey",
  "api_key",
  "accesstoken",
  "access_token",
  "refreshtoken",
  "refresh_token",
  "webhooksecret",
  "webhook_secret",
  "initdata",
  "init_data",
]);

export function redactSensitiveDetails(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.map((v) => redactSensitiveDetails(v));
  }
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (REDACT_KEYS.has(k.toLowerCase())) {
      out[k] = "[REDACTED]";
    } else {
      out[k] = redactSensitiveDetails(v);
    }
  }
  return out;
}
