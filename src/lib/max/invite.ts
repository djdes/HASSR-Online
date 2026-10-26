import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ORG_ROSTER_WHERE } from "@/lib/journal-roster";
import { maxConfig } from "./config";
import { hashMaxToken } from "./security";
import { MaxError } from "./service";

/**
 * Личная ссылка-приглашение в бота: руководитель выдаёт её сотруднику из
 * бота, сотрудник нажимает — и его MAX сразу привязан, без сайта и пароля.
 * В базе только SHA-256, ссылка одноразовая и живёт 7 дней; новая
 * отменяет прежнюю. Ничего не перепривязывается молча: занятый MAX или
 * сотрудник с другим MAX — отказ.
 */
export const MAX_INVITE_TTL_DAYS = 7;
const INVITE_RE = /^inv_[A-Za-z0-9_-]{32}$/;

export const newMaxInviteToken = () => "inv_" + randomBytes(24).toString("base64url");

/** Код приглашения из `/start`, команды или сообщения; null — не приглашение. */
export function parseMaxInvitePayload(text: string): string | null {
  const value = text.trim().replace(/^\/start\s+/, "");
  return INVITE_RE.test(value) ? value : null;
}

export function maxInviteUrl(username: string, token: string): string {
  return `https://max.ru/${encodeURIComponent(username)}?start=${encodeURIComponent(token)}`;
}

export async function issueMaxInvite(params: { organizationId: string; employeeId: string; createdByUserId: string; now?: Date }) {
  const cfg = maxConfig();
  if (!cfg.configured) throw new MaxError("Бот MAX ещё не настроен на сервере.", 503);
  const employee = await db.user.findFirst({
    where: { id: params.employeeId, organizationId: params.organizationId, ...ORG_ROSTER_WHERE },
    select: { id: true, name: true, maxIdentity: { select: { id: true } } },
  });
  if (!employee) throw new MaxError("Сотрудник не найден или в архиве.", 404);
  if (employee.maxIdentity) throw new MaxError(`${employee.name} уже подключён(а) к MAX.`, 409);
  const token = newMaxInviteToken();
  const now = params.now ?? new Date();
  const expiresAt = new Date(now.getTime() + MAX_INVITE_TTL_DAYS * 86400_000);
  await db.$transaction([
    db.maxInvite.deleteMany({ where: { userId: employee.id, usedAt: null } }),
    db.maxInvite.create({ data: { tokenHash: hashMaxToken(token), userId: employee.id, organizationId: params.organizationId, createdByUserId: params.createdByUserId, expiresAt } }),
  ]);
  return { token, url: maxInviteUrl(cfg.username, token), expiresAt, employeeName: employee.name };
}

export async function claimMaxInvite(token: string, claim: { maxUserId: string; chatId: string; displayName: string }) {
  if (!INVITE_RE.test(token)) throw new MaxError("Ссылка-приглашение недействительна. Попросите руководителя прислать новую.");
  const invite = await db.maxInvite.findUnique({ where: { tokenHash: hashMaxToken(token) } });
  if (!invite || invite.usedAt || invite.expiresAt <= new Date()) {
    throw new MaxError("Ссылка-приглашение уже использована или истекла. Попросите руководителя прислать новую.", 410);
  }
  const user = await db.user.findFirst({ where: { id: invite.userId, organizationId: invite.organizationId, ...ORG_ROSTER_WHERE }, select: { id: true, name: true } });
  if (!user) throw new MaxError("Аккаунт сотрудника недоступен. Обратитесь к руководителю.", 403);
  const [byMax, byUser] = await Promise.all([
    db.maxIdentity.findUnique({ where: { maxUserId: claim.maxUserId }, select: { userId: true } }),
    db.maxIdentity.findUnique({ where: { userId: user.id }, select: { maxUserId: true } }),
  ]);
  if (byMax && byMax.userId !== user.id) throw new MaxError("Этот MAX уже подключён к другому сотруднику. Приглашение предназначено не вам — сообщите руководителю.", 409);
  if (byUser && byUser.maxUserId !== claim.maxUserId) throw new MaxError(`К аккаунту «${user.name}» уже подключён другой MAX. Попросите руководителя отключить прежний.`, 409);
  try {
    const identity = await db.$transaction(async (tx) => {
      const consumed = await tx.maxInvite.updateMany({ where: { id: invite.id, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } });
      if (consumed.count !== 1) throw new MaxError("Ссылка-приглашение уже использована. Попросите руководителя прислать новую.", 410);
      return tx.maxIdentity.upsert({
        where: { userId: user.id },
        create: { userId: user.id, maxUserId: claim.maxUserId, privateChatId: claim.chatId, displayName: claim.displayName.slice(0, 180), activeOrganizationId: invite.organizationId },
        update: { privateChatId: claim.chatId, displayName: claim.displayName.slice(0, 180) },
      });
    });
    return { identityId: identity.id, user, createdByUserId: invite.createdByUserId, alreadyLinked: Boolean(byUser) };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new MaxError("Этот MAX уже подключён к другому сотруднику.", 409);
    throw error;
  }
}
