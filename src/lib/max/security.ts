import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const MAX_LINK_TTL_MS = 10 * 60_000;
export const MAX_HANDOFF_TTL_MS = 2 * 60_000;
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

export function verifyMaxInitData(raw: string, token: string, now = Math.floor(Date.now()/1000)): { ok: true; userId: string } | { ok: false } {
  if (!token || !raw || raw.length > 16_384) return {ok:false};
  try {
    const params = new URLSearchParams(raw);
    const keys=[...params.keys()];
    if (new Set(keys).size !== keys.length) return {ok:false};
    const hash=params.get("hash") ?? "";
    if (!/^[a-f0-9]{64}$/.test(hash)) return {ok:false};
    const stamp=params.get("auth_date") ?? "";
    if (!/^\d+$/.test(stamp)) return {ok:false};
    const date=Number(stamp);
    if (!Number.isSafeInteger(date) || now-date>300 || date-now>30) return {ok:false};
    params.delete("hash");
    const data=[...params.entries()].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>`${k}=${v}`).join("\n");
    const secret=createHmac("sha256","WebAppData").update(token).digest();
    const expected=createHmac("sha256",secret).update(data).digest();
    if (!timingSafeEqual(expected,Buffer.from(hash,"hex"))) return {ok:false};
    const user=JSON.parse(params.get("user") ?? "null");
    const userId=maxId(user?.id);
    return userId ? {ok:true,userId} : {ok:false};
  } catch { return {ok:false}; }
}

export function safeMaxReturnPath(value: unknown): string {
  const fallback="/journals";
  if (typeof value!=="string" || value.length>2048 || !value.startsWith("/") || /[\\\r\n\x00-\x1f]/.test(value)) return fallback;
  try {
    const decoded=decodeURIComponent(value);
    if (decoded.startsWith("//") || /[\\\r\n\x00-\x1f]/.test(decoded)) return fallback;
    const url=new URL(value,"https://wesetup.invalid");
    if (url.origin!=="https://wesetup.invalid") return fallback;
    if (!/^\/(journals|journal-fill|equipment-fill|room-fill|dashboard|settings|root|control-board|team|verifications|mini\/today|max\/(journals|open))(\/|$)/.test(url.pathname)) return fallback;
    return url.pathname+url.search;
  } catch { return fallback; }
}
