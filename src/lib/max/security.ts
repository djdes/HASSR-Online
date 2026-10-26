import { createHash, randomBytes } from "node:crypto";

export const MAX_LINK_TTL_MS = 10 * 60_000;
export const maxToken = () => randomBytes(32).toString("base64url");
export const hashMaxToken = (token: string) => createHash("sha256").update(token).digest("hex");

export function maxId(value: unknown, chat = false): string | null {
  if (typeof value === "number" && !Number.isSafeInteger(value)) return null;
  if (typeof value !== "number" && typeof value !== "string") return null;
  const id=String(value);
  if (!(chat ? /^-?[1-9]\d{0,18}$/ : /^[1-9]\d{0,18}$/).test(id)) return null;
  try { if (BigInt(id) > BigInt("9223372036854775807") || BigInt(id) < BigInt("-9223372036854775808")) return null; } catch { return null; }
  return id;
}

export function safeMaxReturnPath(value: unknown): string {
  const fallback="/journals";
  if (typeof value!=="string" || value.length>2048 || !value.startsWith("/") || /[\\\r\n\x00-\x1f]/.test(value)) return fallback;
  try {
    const decoded=decodeURIComponent(value);
    if (decoded.startsWith("//") || /[\\\r\n\x00-\x1f]/.test(decoded)) return fallback;
    const url=new URL(value,"https://wesetup.invalid");
    if (url.origin!=="https://wesetup.invalid") return fallback;
    if (!/^\/(journals|journal-fill|equipment-fill|room-fill|dashboard|settings|root|control-board|team|verifications|mini\/today)(\/|$)/.test(url.pathname)) return fallback;
    return url.pathname+url.search;
  } catch { return fallback; }
}
