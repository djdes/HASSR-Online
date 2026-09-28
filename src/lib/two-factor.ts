import { randomUUID } from "node:crypto";

import type { VerifiedUser } from "@/lib/credentials";
import { db } from "@/lib/db";
import {
  CHALLENGE_MESSAGES,
  CHALLENGE_TTL_MS,
  evaluateChallenge,
  generateLoginCode,
  hashLoginCode,
  LOGIN_CODE_DELIVERY_KIND,
} from "@/lib/login-challenge";

/**
 * Подтверждение входа кодом в Telegram.
 *
 * Пароль проверен → вместо сессии заводим челлендж и шлём код в чат
 * человека. Сессию выдаёт только `/api/auth/login/code` с верным кодом.
 * Челлендж одноразовый, живёт пять минут, пять попыток. Telegram-вход
 * из Mini App кодом не подтверждается — он и так через Telegram.
 */
export function twoFactorRequired(user: Pick<VerifiedUser, "twoFactorTelegram" | "telegramChatId">): boolean {
  return user.twoFactorTelegram === true && Boolean(user.telegramChatId);
}

export async function startTelegramChallenge(
  user: Pick<VerifiedUser, "id" | "telegramChatId" | "name">,
  context: { ip: string | null; userAgent: string | null; method: "password" | "phone" }
): Promise<{ challengeId: string } | { error: string }> {
  if (!user.telegramChatId) return { error: "Telegram не привязан" };
  // Старые незавершённые челленджи гасим: один действующий код на человека.
  await db.loginChallenge.updateMany({
    where: { userId: user.id, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  // id задаём сами: он соль для хеша, а хеш нужен уже в момент вставки.
  const id = randomUUID();
  const code = generateLoginCode();
  const created = await db.loginChallenge.create({
    data: {
      id,
      userId: user.id,
      codeHash: hashLoginCode(code, id),
      expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
      ip: context.ip,
      userAgent: context.userAgent?.slice(0, 500) ?? null,
      method: context.method,
    },
  });

  const { sendTelegramMessage } = await import("@/lib/telegram");
  const sent = await sendTelegramMessage(
    user.telegramChatId,
    [
      `🔐 Код для входа в WeSetup: <b>${code}</b>`,
      "Действует 5 минут. Если вы не входили — просто не вводите его и смените пароль.",
    ].join("\n"),
    { userId: user.id, delivery: { kind: LOGIN_CODE_DELIVERY_KIND } }
  ).catch(() => false);
  if (!sent) {
    await db.loginChallenge.update({ where: { id: created.id }, data: { consumedAt: new Date() } });
    return { error: "Не удалось отправить код в Telegram — попробуйте позже" };
  }
  return { challengeId: created.id };
}

export async function verifyTelegramChallenge(
  challengeId: string,
  code: string
): Promise<{ ok: true; user: VerifiedUser; method: "password" | "phone" } | { ok: false; error: string }> {
  const challenge = await db.loginChallenge.findUnique({ where: { id: challengeId } });
  if (!challenge) return { ok: false, error: "Код устарел — войдите заново" };
  const verdict = evaluateChallenge(challenge, { code, now: new Date() });
  if (verdict === "mismatch") {
    await db.loginChallenge.update({ where: { id: challenge.id }, data: { attempts: { increment: 1 } } });
    return { ok: false, error: CHALLENGE_MESSAGES.mismatch };
  }
  if (verdict !== "ok") return { ok: false, error: CHALLENGE_MESSAGES[verdict] };
  // Одноразовость: первый верный ответ гасит челлендж, второй — уже «использован».
  const consumed = await db.loginChallenge.updateMany({
    where: { id: challenge.id, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  if (consumed.count === 0) return { ok: false, error: CHALLENGE_MESSAGES.consumed };
  const user = await db.user.findUnique({ where: { id: challenge.userId }, include: { organization: true } });
  if (!user || !user.isActive) return { ok: false, error: "Аккаунт недоступен" };
  return { ok: true, user, method: challenge.method === "phone" ? "phone" : "password" };
}
