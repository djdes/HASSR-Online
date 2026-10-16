import crypto from "node:crypto";

/**
 * Персональные ключи ИИ-ассистентов и API (/settings/api).
 *
 * Формат `wsk_` + 43 символа base64url (32 случайных байта). В базе живёт
 * только sha256 — полный ключ показывается один раз при создании.
 * Префикс `wsk_` отличает ключ от старого общего ключа организации
 * (64 hex-символа, `Organization.externalApiToken`).
 */

export const API_KEY_PREFIX = "wsk_";
export const API_KEY_ACCESS_VALUES = ["write", "read"] as const;
export type ApiKeyAccess = (typeof API_KEY_ACCESS_VALUES)[number];
export const MAX_ACTIVE_KEYS_PER_ORG = 20;

const API_KEY_PATTERN = /^wsk_[A-Za-z0-9_-]{43}$/;
const LEGACY_ORG_TOKEN_PATTERN = /^[0-9a-f]{64}$/;

export function hashApiKey(secret: string): string {
  return crypto.createHash("sha256").update(secret).digest("hex");
}

export function generateApiKey(): { secret: string; tokenHash: string; displayPrefix: string } {
  const secret = `${API_KEY_PREFIX}${crypto.randomBytes(32).toString("base64url")}`;
  return { secret, tokenHash: hashApiKey(secret), displayPrefix: secret.slice(0, 12) };
}

export function looksLikeApiKey(value: string): boolean {
  return API_KEY_PATTERN.test(value);
}

export function looksLikeLegacyOrgToken(value: string): boolean {
  return LEGACY_ORG_TOKEN_PATTERN.test(value);
}

export function isApiKeyAccess(value: unknown): value is ApiKeyAccess {
  return value === "read" || value === "write";
}
