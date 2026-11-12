import { db } from "@/lib/db";
import { renderEmailLayout, sendRawEmail } from "@/lib/email";
import { generateInviteToken, hashInviteToken } from "@/lib/invite-tokens";

/**
 * Вход по ссылке из письма. Токен — случайный, в базе только хеш, живёт
 * 15 минут и одноразовый; на человека действует один токен (новый
 * запрос гасит прежний). Ответ на запрос всегда «отправили», чтобы не
 * подсказывать, есть ли такая почта.
 */
export const MAGIC_LINK_TTL_MS = 15 * 60 * 1000;

export function magicLinkExpiresAt(now: Date = new Date()): Date {
  return new Date(now.getTime() + MAGIC_LINK_TTL_MS);
}

export function magicLinkUrl(raw: string): string {
  const base = (process.env.NEXTAUTH_URL || process.env.APP_URL || "https://wesetup.ru").replace(/\/+$/, "");
  return `${base}/api/auth/magic/${raw}`;
}

/**
 * Ссылка автовхода в письме о созданном кабинете (галка «Быстрая
 * регистрация» в окне скачивания шаблона): письмо читают не сразу, поэтому
 * она живёт столько же, сколько ссылка на шаблон, но так же одноразовая.
 */
export const SIGNUP_MAGIC_LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Новый токен входа для пользователя — прежний, если был, гаснет (на
 * человека действует один). Возвращает полную ссылку для письма.
 */
export async function createMagicLink(userId: string, ttlMs: number = MAGIC_LINK_TTL_MS): Promise<string> {
  const raw = generateInviteToken();
  const expiresAt = new Date(Date.now() + ttlMs);
  await db.magicLinkToken.upsert({
    where: { userId },
    create: { userId, tokenHash: hashInviteToken(raw), expiresAt },
    update: { tokenHash: hashInviteToken(raw), expiresAt, usedAt: null },
  });
  return magicLinkUrl(raw);
}

export async function issueMagicLink(email: string): Promise<{ sent: boolean }> {
  const user = await db.user.findUnique({ where: { email }, select: { id: true, isActive: true, name: true } });
  if (!user || !user.isActive) return { sent: false };
  const url = await createMagicLink(user.id);
  const html = renderEmailLayout(
    "Вход в WeSetup по ссылке",
    `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#3f3f46">Нажмите кнопку, чтобы войти в кабинет без пароля. Ссылка действует 15 минут и работает один раз.</p>
     <p style="margin:0 0 20px"><a href="${url}" style="display:inline-block;background:#5566f6;color:#fff;text-decoration:none;padding:12px 22px;border-radius:12px;font-size:15px;font-weight:600">Войти в WeSetup</a></p>
     <p style="margin:0;font-size:12px;line-height:1.6;color:#a1a1aa">Если вы не запрашивали вход — просто не открывайте ссылку. Ссылка: ${url}</p>`
  );
  const sent = await sendRawEmail(email, "Вход в WeSetup по ссылке", html);
  return { sent };
}

export type MagicLinkVerdict =
  | { ok: true; userId: string }
  | { ok: false; reason: "invalid" | "expired" | "used" };

export async function consumeMagicLink(raw: string, now: Date = new Date()): Promise<MagicLinkVerdict> {
  if (!raw || raw.length < 20 || raw.length > 200) return { ok: false, reason: "invalid" };
  const row = await db.magicLinkToken.findUnique({ where: { tokenHash: hashInviteToken(raw) } });
  if (!row) return { ok: false, reason: "invalid" };
  if (row.usedAt) return { ok: false, reason: "used" };
  if (row.expiresAt < now) return { ok: false, reason: "expired" };
  const consumed = await db.magicLinkToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: now } });
  if (consumed.count === 0) return { ok: false, reason: "used" };
  return { ok: true, userId: row.userId };
}
