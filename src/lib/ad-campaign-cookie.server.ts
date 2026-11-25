import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { AD_CAMPAIGN_ID, AD_CAMPAIGN_MAX_AGE, readAdAttribution, type AdAttribution } from "./ad-campaign";

type CampaignTouch = AdAttribution & { at: number };
function secret() { return process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET; }
function sign(payload: string, key: string) {
  return createHmac("sha256", key).update(`ad-campaign-v1:${payload}`).digest("base64url");
}

export function issueAdTouch(now = Date.now(), key = secret()): string | null {
  if (!key) return null;
  const payload = Buffer.from(JSON.stringify({ id: AD_CAMPAIGN_ID, visitorId: randomUUID(), at: now })).toString("base64url");
  return `${payload}.${sign(payload, key)}`;
}

export function readAdTouch(token: string | null | undefined, now = Date.now(), key = secret()): CampaignTouch | null {
  if (!key || !token || token.length > 512) return null;
  try {
    const [payload, signature, extra] = token.split(".");
    if (!payload || !signature || extra !== undefined) return null;
    const expected = Buffer.from(sign(payload, key));
    const actual = Buffer.from(signature);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
    const raw = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    const attribution = readAdAttribution(raw);
    if (!attribution || !Number.isSafeInteger(raw.at) || raw.at > now || now - raw.at >= AD_CAMPAIGN_MAX_AGE * 1000) return null;
    return { ...attribution, at: raw.at };
  } catch { return null; }
}
