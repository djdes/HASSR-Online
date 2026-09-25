import { z } from "zod";

import { advisoryLockKey, withAdvisoryTryLock } from "@/lib/advisory-lock";
import { recordAuditLog, type AuditLogInput } from "@/lib/audit-log";
import { db } from "@/lib/db";
import { isEmailDeliveryConfigured } from "@/lib/email";
import { checkEmail } from "@/lib/email-validation";
import { domainAcceptsMail } from "@/lib/mail-domain";
import {
  NPS_RECOMMEND_AUDIT_ACTION,
  NPS_RECOMMEND_AUDIT_ENTITY,
  NPS_RECOMMEND_MESSAGE_MAX_LENGTH,
  NPS_RECOMMEND_PER_USER_PER_DAY,
} from "@/lib/nps";
import { isTechnicalEmail } from "@/lib/technical-email";

import { REFERRAL_INVITE_REPEAT_HOURS, REFERRAL_INVITES_PER_DAY } from "./constants";
import { sendReferralInviteEmail, type ReferralInviteEmailParams } from "./emails";
import { ensureReferralCode } from "./referral";

/**
 * Пригласить коллегу письмом — одна реализация на два входа:
 *  • «Баланс и бонусы» (`POST /api/balance/referrals`, source = "balance");
 *  • опрос «Посоветуете WeSetup коллегам?» после оценки 4–5
 *    (`POST /api/nps/recommend`, source = "nps").
 *
 * Общее ядро: адрес не зарегистрирован в WeSetup, домен принимает почту
 * (MX), не больше 20 приглашений в сутки на организацию, на один адрес —
 * не чаще раза в сутки, ссылка всегда реферальная (`ensureReferralCode`),
 * одно письмо (`sendReferralInviteEmail`, Reply-To — пригласивший), запись
 * `ReferralInvite` — приглашение видно в «Баланс и бонусы» со статусом.
 *
 * Лимиты здесь не про удобство: без них эндпоинт — открытый релей,
 * с которого можно слать что угодно на любые адреса. Проверка лимитов,
 * отправка и запись идут под advisory-замком организации — иначе пачка
 * параллельных запросов прошла бы проверку до первой записи.
 *
 * Добавки опроса (source = "nps"): текст до 1000 символов (в форме
 * баланса — 500), своя почта — и логин, и контактная, запрет почты
 * сотрудников своей организации, не больше 5 рекомендаций в сутки на
 * человека, строка AuditLog `nps.recommend` без текста письма. Поведение
 * «Баланс и бонусы» — прежнее, сообщения об ошибках те же.
 *
 * База и почта — через `deps`: маршруты берут `inviteColleagueDeps()`,
 * тесты подставляют свои.
 */

export type InviteSource = "balance" | "nps";
export type InviteField = "email" | "message";
/** sent — принято SMTP; logged — почта не настроена (dev), письмо целиком в логе сервера. */
export type InviteDelivery = "sent" | "logged";

export type InviteColleagueInput = {
  source: InviteSource;
  organizationId: string;
  /** Кто приглашает — пользователь из сессии. */
  actor: { id: string; name?: string | null; email?: string | null };
  email: unknown;
  message: unknown;
  /** Только для source = "nps": ответ опроса — для AuditLog. */
  nps?: { responseId: string; score: number };
};

export type InviteColleagueFailure = {
  ok: false;
  status: 400 | 409 | 429 | 502;
  body: { error: string; field?: InviteField };
};
export type InviteColleagueResult = { ok: true; delivery: InviteDelivery; code: string } | InviteColleagueFailure;

export type NpsRecommendAuditDetails = {
  /** Кому ушло письмо. Текст письма не храним. */
  colleagueEmail: string;
  npsScore: number;
  delivery: InviteDelivery;
};

export type InviteSender = { name: string | null; email: string | null; contactEmail: string | null };

export type InviteColleagueDeps = {
  appUrl: string;
  now(): Date;
  loadSender(userId: string): Promise<InviteSender | null>;
  loadOrganizationName(organizationId: string): Promise<string | null>;
  ensureReferralCode(organizationId: string): Promise<string>;
  isRegisteredEmail(email: string): Promise<boolean>;
  /** Адрес — логин или контактная почта сотрудника (или участника) этой организации. */
  isOrganizationStaffEmail(organizationId: string, email: string): Promise<boolean>;
  domainAcceptsMail(domain: string): Promise<boolean>;
  withOrganizationLock<T>(organizationId: string, fn: () => Promise<T>): Promise<{ acquired: true; value: T } | { acquired: false }>;
  countOrganizationInvitesSince(organizationId: string, since: Date): Promise<number>;
  lastInviteAt(organizationId: string, email: string): Promise<Date | null>;
  countNpsRecommendationsSince(userId: string, since: Date): Promise<number>;
  sendInvite(params: ReferralInviteEmailParams): Promise<InviteDelivery | "failed">;
  /** ReferralInvite: создать или освежить (createdAt, кто пригласил). */
  saveInvite(input: { organizationId: string; email: string; invitedByUserId: string }): Promise<void>;
  recordNpsAudit(entry: { organizationId: string; responseId: string; details: NpsRecommendAuditDetails }): Promise<void>;
};

const HOUR_MS = 60 * 60 * 1000;
/** Как в форме «Баланс и бонусы» (поле режет ввод до 500). */
const BALANCE_MESSAGE_MAX_LENGTH = 500;

/** Проверка тела формы «Баланс и бонусы» — та же, что была в маршруте. */
const balanceSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  message: z.string().trim().max(BALANCE_MESSAGE_MAX_LENGTH).optional(),
});
const strictEmail = z.string().email().max(200);

function fail(status: InviteColleagueFailure["status"], error: string, field?: InviteField): InviteColleagueFailure {
  return { ok: false, status, body: field ? { error, field } : { error } };
}

type Parsed = { ok: true; email: string; message: string } | InviteColleagueFailure;

function parseBalance(email: unknown, message: unknown): Parsed {
  const parsed = balanceSchema.safeParse({ email, message });
  // Ответ — как был: одна ошибка на всё тело, без поля.
  if (!parsed.success) return fail(400, "Укажите корректный адрес электронной почты");
  return { ok: true, email: parsed.data.email, message: parsed.data.message ?? "" };
}

function parseNps(rawEmail: unknown, rawMessage: unknown): Parsed {
  const email = typeof rawEmail === "string" ? rawEmail.trim().toLowerCase() : "";
  const check = checkEmail(email);
  if (check.status === "empty") return fail(400, "Укажите почту коллеги", "email");
  if (check.status === "invalid") return fail(400, check.message, "email");
  // «typo» (похоже на опечатку популярного домена) — только подсказка в
  // форме: у коллеги может быть редкий домен вроде mail.kz. Несуществующий
  // домен отсечёт MX. Строгая проверка — последним рубежом (запятые и
  // прочее, что почтовик понял бы как несколько адресов).
  if (!strictEmail.safeParse(email).success) return fail(400, "Проверьте адрес почты — в нём лишние символы", "email");
  if (rawMessage !== undefined && rawMessage !== null && typeof rawMessage !== "string") {
    return fail(400, "Сообщение должно быть текстом", "message");
  }
  const message = typeof rawMessage === "string" ? rawMessage.replace(/\r\n?/g, "\n").trim() : "";
  if (message.length > NPS_RECOMMEND_MESSAGE_MAX_LENGTH) {
    return fail(400, `Сообщение длиннее ${NPS_RECOMMEND_MESSAGE_MAX_LENGTH} символов — сократите его`, "message");
  }
  return { ok: true, email, message };
}

/** Реферальная ссылка из письма; почта получателя подставится в форму регистрации. */
export function referralInviteLink(appUrl: string, code: string, recipient: string): string {
  const base = appUrl.replace(/\/+$/, "");
  return `${base}/r/${encodeURIComponent(code)}?email=${encodeURIComponent(recipient)}`;
}

/**
 * Имя в письме. Пустое, совпадающее с названием организации (так
 * заполняет мгновенная регистрация) или похожее на почту — не пишем:
 * «Ваш коллега из «Кафе»» читается лучше, чем «Кафе из «Кафе»».
 */
export function senderDisplayName(name: string | null | undefined, organizationName: string | null | undefined): string | null {
  const value = (name ?? "").trim();
  if (!value || value.includes("@")) return null;
  if (value.toLowerCase() === (organizationName ?? "").trim().toLowerCase()) return null;
  return value;
}

/** Адрес для ответа: контактная почта, иначе логин; служебные адреса — нет. */
export function replyToAddress(sender: { email: string | null; contactEmail: string | null } | null): string | null {
  if (!sender) return null;
  for (const candidate of [sender.contactEmail, sender.email]) {
    const value = (candidate ?? "").trim().toLowerCase();
    if (!value || isTechnicalEmail(value)) continue;
    if (checkEmail(value).status === "invalid") continue;
    return value;
  }
  return null;
}

const normalized = (value: string | null | undefined) => (value ?? "").trim().toLowerCase();

export async function inviteColleague(input: InviteColleagueInput, deps: InviteColleagueDeps): Promise<InviteColleagueResult> {
  const nps = input.source === "nps";
  const parsed = nps ? parseNps(input.email, input.message) : parseBalance(input.email, input.message);
  if (!parsed.ok) return parsed;
  const { email, message } = parsed;
  const organizationId = input.organizationId;

  const sender = await deps.loadSender(input.actor.id);
  // Своя почта: в «Баланс и бонусы» — как раньше, логин из сессии; в опросе
  // ещё логин и контактная почта из базы.
  const own = [input.actor.email, ...(nps ? [sender?.email, sender?.contactEmail] : [])].map(normalized).filter(Boolean);
  if (own.includes(email)) {
    return fail(400, nps ? "Это ваша почта — укажите адрес коллеги" : "Это ваш собственный адрес", "email");
  }
  if (nps && (await deps.isOrganizationStaffEmail(organizationId, email))) {
    return fail(400, "Это почта сотрудника вашей организации — укажите коллегу из другого заведения", "email");
  }
  if (await deps.isRegisteredEmail(email)) {
    return fail(
      409,
      nps ? "Этот адрес уже зарегистрирован в WeSetup — приглашение не нужно" : "Этот адрес уже зарегистрирован в WeSetup — бонуса не будет",
      "email",
    );
  }
  if (!(await deps.domainAcceptsMail(email.split("@")[1] ?? ""))) {
    return fail(400, "Такого почтового домена не существует — проверьте адрес", "email");
  }

  const locked = await deps.withOrganizationLock(organizationId, async (): Promise<InviteColleagueResult> => {
    const now = deps.now();
    const since = new Date(now.getTime() - 24 * HOUR_MS);
    if (nps && (await deps.countNpsRecommendationsSince(input.actor.id, since)) >= NPS_RECOMMEND_PER_USER_PER_DAY) {
      return fail(429, `Не больше ${NPS_RECOMMEND_PER_USER_PER_DAY} рекомендаций в сутки — попробуйте завтра`);
    }
    if ((await deps.countOrganizationInvitesSince(organizationId, since)) >= REFERRAL_INVITES_PER_DAY) {
      return fail(429, `Не больше ${REFERRAL_INVITES_PER_DAY} приглашений в сутки. Попробуйте завтра`);
    }
    const last = await deps.lastInviteAt(organizationId, email);
    if (last && now.getTime() - last.getTime() < REFERRAL_INVITE_REPEAT_HOURS * HOUR_MS) {
      return fail(429, "На этот адрес уже отправляли приглашение сегодня", "email");
    }

    const [code, organizationName] = await Promise.all([deps.ensureReferralCode(organizationId), deps.loadOrganizationName(organizationId)]);
    const fromOrganizationName = organizationName ?? "Ваши коллеги";
    const delivery = await deps.sendInvite({
      to: email,
      fromUserName: senderDisplayName(sender?.name ?? input.actor.name, organizationName),
      fromOrganizationName,
      message: message || null,
      link: referralInviteLink(deps.appUrl, code, email),
      replyTo: replyToAddress(sender),
    });
    if (delivery === "failed") {
      return fail(502, nps ? "Письмо не ушло — попробуйте позже" : "Письмо не ушло. Попробуйте позже или отправьте ссылку сами");
    }
    // Запись — только после отправки: иначе повтор упрётся в антиспам,
    // хотя письма человек так и не получил.
    await deps.saveInvite({ organizationId, email, invitedByUserId: input.actor.id });
    if (nps && input.nps) {
      await deps.recordNpsAudit({
        organizationId,
        responseId: input.nps.responseId,
        details: { colleagueEmail: email, npsScore: input.nps.score, delivery },
      });
    }
    return { ok: true, delivery, code };
  });
  if (!locked.acquired) return fail(429, "Приглашение уже отправляется — подождите пару секунд");
  return locked.value;
}

/** Настоящие база, почта и аудит. `request` и `session` — для строки AuditLog (IP, имя). */
export function inviteColleagueDeps(context: { request?: Request; session?: AuditLogInput["session"] } = {}): InviteColleagueDeps {
  return {
    appUrl: process.env.NEXTAUTH_URL || "https://wesetup.ru",
    now: () => new Date(),
    loadSender: (userId) => db.user.findUnique({ where: { id: userId }, select: { name: true, email: true, contactEmail: true } }),
    loadOrganizationName: async (organizationId) =>
      (await db.organization.findUnique({ where: { id: organizationId }, select: { name: true } }))?.name ?? null,
    ensureReferralCode,
    isRegisteredEmail: async (email) => Boolean(await db.user.findUnique({ where: { email }, select: { id: true } })),
    isOrganizationStaffEmail: async (organizationId, email) =>
      (await db.user.count({
        where: {
          AND: [
            { OR: [{ email: { equals: email, mode: "insensitive" } }, { contactEmail: { equals: email, mode: "insensitive" } }] },
            { OR: [{ organizationId }, { organizationMemberships: { some: { organizationId } } }] },
          ],
        },
      })) > 0,
    domainAcceptsMail,
    withOrganizationLock: (organizationId, fn) =>
      withAdvisoryTryLock(advisoryLockKey("referral-invite", organizationId), fn, { attempts: 20, delayMs: 150, timeoutMs: 30_000 }),
    countOrganizationInvitesSince: (organizationId, since) => db.referralInvite.count({ where: { organizationId, createdAt: { gte: since } } }),
    lastInviteAt: async (organizationId, email) =>
      (
        await db.referralInvite.findUnique({
          where: { organizationId_email: { organizationId, email } },
          select: { createdAt: true },
        })
      )?.createdAt ?? null,
    countNpsRecommendationsSince: (userId, since) =>
      db.auditLog.count({
        where: { entity: NPS_RECOMMEND_AUDIT_ENTITY, action: NPS_RECOMMEND_AUDIT_ACTION, userId, createdAt: { gte: since } },
      }),
    sendInvite: async (params) => {
      const accepted = await sendReferralInviteEmail(params).catch((error) => {
        console.error("sendReferralInviteEmail failed", error);
        return false;
      });
      if (accepted) return "sent";
      return isEmailDeliveryConfigured() ? "failed" : "logged";
    },
    saveInvite: async ({ organizationId, email, invitedByUserId }) => {
      await db.referralInvite.upsert({
        where: { organizationId_email: { organizationId, email } },
        create: { organizationId, email, invitedByUserId },
        update: { createdAt: new Date(), invitedByUserId },
      });
    },
    recordNpsAudit: ({ organizationId, responseId, details }) =>
      recordAuditLog({
        request: context.request,
        session: context.session,
        organizationId,
        action: NPS_RECOMMEND_AUDIT_ACTION,
        entity: NPS_RECOMMEND_AUDIT_ENTITY,
        entityId: responseId,
        details,
      }),
  };
}
