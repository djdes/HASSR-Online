import crypto from "node:crypto";

/**
 * Короткоживущие ссылки на фото для воркера распознавания.
 *
 * Фото лежит во временной папке сервера под случайным именем
 * (`<32 hex>-jpg|png|webp` — без точки: nginx не примет ссылку за
 * статический файл). Воркер получает ссылку
 * `/api/ai/vision-image/<id>?exp=<мс>&sig=<HMAC>` — отдать файл можно
 * только по действующей подписи и до срока (15 минут). Подпись — HMAC-SHA256
 * серверного секрета (`VISION_IMAGE_SECRET`, иначе `NEXTAUTH_SECRET`) с
 * отдельной областью `vision-image:v1`, чтобы её нельзя было подменить
 * подписью другого назначения.
 */

export const VISION_IMAGE_TTL_MS = 15 * 60 * 1000;
export const VISION_IMAGE_ROUTE = "/api/ai/vision-image";

const ID_RE = /^[a-f0-9]{32}-(?:jpg|png|webp)$/;
const SIG_RE = /^[A-Za-z0-9_-]{43}$/;

export function isVisionImageId(id: unknown): id is string {
  return typeof id === "string" && ID_RE.test(id);
}

function visionSecret(override?: string): string {
  const raw = override ?? process.env.VISION_IMAGE_SECRET ?? process.env.NEXTAUTH_SECRET ?? "";
  if (raw.length < 16) throw new Error("VISION_IMAGE_SECRET / NEXTAUTH_SECRET не настроен (или слишком короткий)");
  return raw;
}

export function signVisionImage(id: string, exp: number, secret?: string): string {
  return crypto.createHmac("sha256", visionSecret(secret)).update(`vision-image:v1:${id}:${exp}`).digest("base64url");
}

export type VisionLinkVerdict = { ok: true } | { ok: false; reason: "bad_id" | "bad_exp" | "bad_sig" | "expired" };

/**
 * Проверка ссылки: формат id → срок числом → подпись (за постоянное время)
 * → не истёк ли срок. Истёкшая ссылка с верной подписью — «expired»
 * (сервер отвечает 410), всё остальное — отказ без подробностей.
 */
export function verifyVisionImageLink(args: {
  id: unknown;
  exp: unknown;
  sig: unknown;
  now?: number;
  secret?: string;
}): VisionLinkVerdict {
  if (!isVisionImageId(args.id)) return { ok: false, reason: "bad_id" };
  const expText = typeof args.exp === "string" ? args.exp : typeof args.exp === "number" ? String(args.exp) : "";
  if (!/^\d{10,16}$/.test(expText)) return { ok: false, reason: "bad_exp" };
  const exp = Number(expText);
  const sig = typeof args.sig === "string" ? args.sig : "";
  if (!SIG_RE.test(sig)) return { ok: false, reason: "bad_sig" };
  const expected = Buffer.from(signVisionImage(args.id, exp, args.secret));
  const given = Buffer.from(sig);
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    return { ok: false, reason: "bad_sig" };
  }
  if ((args.now ?? Date.now()) > exp) return { ok: false, reason: "expired" };
  return { ok: true };
}

/** Абсолютная ссылка для воркера. */
export function buildVisionImageUrl(baseUrl: string, id: string, exp: number, sig: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  return `${base}${VISION_IMAGE_ROUTE}/${id}?exp=${exp}&sig=${sig}`;
}

/** Ссылка с подписью и сроком «сейчас + 15 минут». */
export function signedVisionImageUrl(baseUrl: string, id: string, now = Date.now(), secret?: string): string {
  const exp = now + VISION_IMAGE_TTL_MS;
  return buildVisionImageUrl(baseUrl, id, exp, signVisionImage(id, exp, secret));
}
