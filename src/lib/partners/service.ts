import crypto from "node:crypto";

import { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { generateInviteToken, hashInviteToken, inviteExpiresAt, buildInviteUrl } from "@/lib/invite-tokens";
import { notifyPlatformAdmin } from "@/lib/platform-admin";
import { escapeTelegramHtml, notifyEmployee, notifyOrganization } from "@/lib/telegram";
import { getDbRoleValuesWithLegacy, MANAGEMENT_ROLES } from "@/lib/user-roles";

import { isPartnerAccessLevel, type PartnerAccessLevel } from "./access-guard";
import {
  NEUTRAL_SUPPORT_NAME,
  consultantLine,
  invalidateOrgBranding,
  invalidatePartnerBranding,
  isPartnerHiddenForOrg,
  toBrandView,
} from "./branding";
import {
  sendPartnerApplicationReceivedEmail,
  sendPartnerApprovedEmail,
  sendPartnerClientAttachedEmail,
  sendPartnerClientDetachedEmail,
  sendPartnerClientInviteEmail,
  sendConsultantAccessLevelChangedEmail,
  sendPartnerRejectedEmail,
  sendPartnerSuspendedEmail,
  sendPartnerTeamInviteEmail,
} from "./emails";
import { PartnerError } from "./errors";
import { ensurePartnerSchemaExtras } from "./schema-extras";
import {
  isValidInn,
  isValidPartnerCode,
  normalizePartnerCode,
  partnerCodeFromBytes,
  RESERVED_SLUGS,
  validateSlug,
  PARTNER_AGREEMENT_VERSION,
} from "./validation";

/**
 * Прикладной слой партнёрки: заявки, модерация, привязка и отвязка
 * клиентов, команда, приглашения, заметки. Всё, что меняет состояние,
 * живёт здесь — API-роуты только валидируют вход и зовут функции.
 */

export { PartnerError };

export const PARTNER_TYPES = ["consultant", "integrator", "equipment_service", "other"] as const;
export type PartnerType = (typeof PARTNER_TYPES)[number];
export const PARTNER_TYPE_LABELS: Record<PartnerType, string> = {
  consultant: "Консультант по СанПиН / ХАССП",
  integrator: "Интегратор",
  equipment_service: "Сервис оборудования",
  other: "Другое",
};

export const PARTNER_STATUSES = ["pending", "active", "rejected", "suspended"] as const;
export type PartnerStatus = (typeof PARTNER_STATUSES)[number];
export const PARTNER_STATUS_LABELS: Record<PartnerStatus, string> = {
  pending: "На рассмотрении",
  active: "Активен",
  rejected: "Отклонён",
  suspended: "Приостановлен",
};

export const PAYOUT_TYPES = ["ip", "self_employed", "company"] as const;
export type PayoutType = (typeof PAYOUT_TYPES)[number];
export const PAYOUT_TYPE_LABELS: Record<PayoutType, string> = {
  ip: "ИП",
  self_employed: "Самозанятый",
  company: "Юрлицо",
};

export type PayoutDetails = {
  fullName: string;
  inn: string;
  bank: string;
  bik: string;
  account: string;
  /** Только для юрлица / ИП. */
  kpp?: string;
  ogrn?: string;
};

const APP_URL = process.env.NEXTAUTH_URL || "https://wesetup.ru";

export function partnerPublicUrl(slug: string): string {
  return `${APP_URL.replace(/\/+$/, "")}/p/${slug}`;
}

// ---------------------------------------------------------------------------
// Membership
// ---------------------------------------------------------------------------

export type PartnerMembership = {
  partnerId: string;
  role: "owner" | "member";
  partner: {
    id: string;
    slug: string;
    code: string;
    status: PartnerStatus;
    companyName: string;
    brandName: string;
    /** «Не показывать клиентам информацию о консультанте». */
    hideFromClients: boolean;
    onboardingDoneAt: Date | null;
    contactEmail: string;
    applicantUserId: string;
    reviewComment: string | null;
    createdAt: Date;
  };
};

/** Партнёрское членство пользователя (любой статус партнёра). */
export async function getPartnerMembership(userId: string): Promise<PartnerMembership | null> {
  const row = await db.partnerUser.findUnique({
    where: { userId },
    select: {
      partnerId: true,
      role: true,
      partner: {
        select: {
          id: true,
          slug: true,
          code: true,
          status: true,
          companyName: true,
          hideFromClients: true,
          onboardingDoneAt: true,
          contactEmail: true,
          applicantUserId: true,
          reviewComment: true,
          createdAt: true,
          branding: { select: { brandName: true } },
        },
      },
    },
  });
  if (!row) return null;
  return {
    partnerId: row.partnerId,
    role: row.role === "owner" ? "owner" : "member",
    partner: {
      id: row.partner.id,
      slug: row.partner.slug,
      code: row.partner.code,
      status: asStatus(row.partner.status),
      companyName: row.partner.companyName,
      brandName: row.partner.branding?.brandName ?? row.partner.companyName,
      hideFromClients: row.partner.hideFromClients,
      onboardingDoneAt: row.partner.onboardingDoneAt,
      contactEmail: row.partner.contactEmail,
      applicantUserId: row.partner.applicantUserId,
      reviewComment: row.partner.reviewComment,
      createdAt: row.partner.createdAt,
    },
  };
}

function asStatus(value: string): PartnerStatus {
  return (PARTNER_STATUSES as readonly string[]).includes(value) ? (value as PartnerStatus) : "pending";
}

/** Активное партнёрское членство — вход в кабинет `/partner`. */
export async function requireActivePartner(userId: string): Promise<PartnerMembership> {
  const membership = await getPartnerMembership(userId);
  if (!membership) throw new PartnerError("Вы не участник партнёрской программы", 403, "not_partner");
  if (membership.partner.status !== "active") {
    throw new PartnerError("Партнёрский кабинет недоступен: статус партнёра не «активен»", 403, "partner_inactive");
  }
  return membership;
}

// ---------------------------------------------------------------------------
// Application
// ---------------------------------------------------------------------------

export type PartnerApplicationInput = {
  companyName: string;
  inn: string;
  type: string;
  city: string;
  phone: string;
  telegram?: string | null;
  contactEmail: string;
  venuesCount: number;
  slug: string;
  termsAccepted: boolean;
};

function cleanText(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export function parseApplicationInput(raw: unknown): PartnerApplicationInput {
  const body = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const input: PartnerApplicationInput = {
    companyName: cleanText(body.companyName, 120),
    inn: cleanText(body.inn, 12).replace(/\s+/g, ""),
    type: cleanText(body.type, 32),
    city: cleanText(body.city, 80),
    phone: cleanText(body.phone, 32),
    telegram: cleanText(body.telegram, 64) || null,
    contactEmail: cleanText(body.contactEmail, 160).toLowerCase(),
    venuesCount: Math.max(0, Math.min(100000, Math.floor(Number(body.venuesCount) || 0))),
    slug: cleanText(body.slug, 64),
    termsAccepted: body.termsAccepted === true,
  };
  if (input.companyName.length < 2) throw new PartnerError("Укажите название компании");
  if (!isValidInn(input.inn)) throw new PartnerError("ИНН — 10 или 12 цифр");
  if (!(PARTNER_TYPES as readonly string[]).includes(input.type)) throw new PartnerError("Выберите тип партнёра");
  if (input.city.length < 2) throw new PartnerError("Укажите город");
  if (input.phone.replace(/\D/g, "").length < 10) throw new PartnerError("Укажите телефон");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.contactEmail)) throw new PartnerError("Укажите корректную почту");
  const slug = validateSlug(input.slug);
  if (!slug.ok) throw new PartnerError(slug.error);
  input.slug = slug.slug;
  if (!input.termsAccepted) throw new PartnerError("Нужно согласиться с условиями партнёрской программы");
  return input;
}

export async function isSlugAvailable(slug: string, exceptPartnerId?: string): Promise<boolean> {
  if (RESERVED_SLUGS.has(slug)) return false;
  const existing = await db.partner.findUnique({ where: { slug }, select: { id: true } });
  return !existing || existing.id === exceptPartnerId;
}

async function generateUniqueCode(tx: Prisma.TransactionClient): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const code = partnerCodeFromBytes(crypto.randomBytes(8));
    const clash = await tx.partner.findUnique({ where: { code }, select: { id: true } });
    if (!clash) return code;
  }
  throw new PartnerError("Не удалось сгенерировать код партнёра, попробуйте ещё раз", 409);
}

/**
 * Подача заявки. Один пользователь — одна заявка/партнёр; после отказа
 * можно подать заново (старая запись переводится в pending с новыми данными).
 */
export async function applyForPartnership(
  input: PartnerApplicationInput,
  actor: { userId: string; organizationId: string | null; name: string | null },
): Promise<{ partnerId: string; slug: string; status: PartnerStatus }> {
  await ensurePartnerSchemaExtras();
  const existing = await getPartnerMembership(actor.userId);
  if (existing && existing.partner.status !== "rejected") {
    throw new PartnerError(
      existing.partner.status === "pending"
        ? "Заявка уже на рассмотрении"
        : "Вы уже участник партнёрской программы",
      409,
      "already_partner",
    );
  }
  if (existing && existing.role !== "owner") {
    throw new PartnerError("Заявку подаёт владелец партнёра", 403);
  }
  if (!(await isSlugAvailable(input.slug, existing?.partnerId))) {
    throw new PartnerError("Такой адрес ссылки уже занят — выберите другой", 409, "slug_taken");
  }

  const result = await db.$transaction(async (tx) => {
    if (existing) {
      const updated = await tx.partner.update({
        where: { id: existing.partnerId },
        data: {
          slug: input.slug,
          status: "pending",
          type: input.type,
          companyName: input.companyName,
          inn: input.inn,
          city: input.city,
          phone: input.phone,
          telegram: input.telegram,
          contactEmail: input.contactEmail,
          venuesCount: input.venuesCount,
          termsAcceptedAt: new Date(),
          agreementVersion: PARTNER_AGREEMENT_VERSION,
          applicantOrganizationId: actor.organizationId,
          reviewComment: null,
          reviewedAt: null,
          reviewedByUserId: null,
        },
        select: { id: true, slug: true },
      });
      return updated;
    }
    const code = await generateUniqueCode(tx);
    const created = await tx.partner.create({
      data: {
        slug: input.slug,
        code,
        status: "pending",
        type: input.type,
        companyName: input.companyName,
        inn: input.inn,
        city: input.city,
        phone: input.phone,
        telegram: input.telegram,
        contactEmail: input.contactEmail,
        venuesCount: input.venuesCount,
        termsAcceptedAt: new Date(),
        agreementVersion: PARTNER_AGREEMENT_VERSION,
        applicantUserId: actor.userId,
        applicantOrganizationId: actor.organizationId,
        members: { create: { userId: actor.userId, role: "owner" } },
        branding: { create: { brandName: input.companyName } },
      },
      select: { id: true, slug: true },
    });
    return created;
  });

  sendPartnerApplicationReceivedEmail({
    to: input.contactEmail,
    companyName: input.companyName,
    slug: result.slug,
  }).catch((err) => console.error("partner application email failed", err));

  notifyPlatformAdmin(
    [
      "🤝 Заявка на партнёрство",
      `Компания: ${escapeTelegramHtml(input.companyName)}`,
      `Тип: ${PARTNER_TYPE_LABELS[input.type as PartnerType] ?? input.type}`,
      `Город: ${escapeTelegramHtml(input.city)}`,
      `Заведений: ${input.venuesCount}`,
      `Телефон: ${escapeTelegramHtml(input.phone)}`,
      input.telegram ? `Telegram: ${escapeTelegramHtml(input.telegram)}` : null,
      `Почта: ${escapeTelegramHtml(input.contactEmail)}`,
      `Проверить: ${APP_URL}/root/partners/${result.id}`,
    ]
      .filter(Boolean)
      .join("\n"),
    { kind: "partner_application" },
  ).catch((err) => console.error("partner application admin notify failed", err));

  return { partnerId: result.id, slug: result.slug, status: "pending" };
}

// ---------------------------------------------------------------------------
// Review (ROOT)
// ---------------------------------------------------------------------------

export type ReviewAction = "approve" | "reject" | "suspend" | "reactivate";

export async function reviewPartner(
  partnerId: string,
  action: ReviewAction,
  reviewer: { userId: string },
  comment: string,
): Promise<{ status: PartnerStatus }> {
  const partner = await db.partner.findUnique({
    where: { id: partnerId },
    select: {
      id: true,
      status: true,
      slug: true,
      code: true,
      companyName: true,
      contactEmail: true,
      applicantUserId: true,
    },
  });
  if (!partner) throw new PartnerError("Партнёр не найден", 404);
  const trimmed = comment.trim().slice(0, 1000);

  let next: PartnerStatus;
  switch (action) {
    case "approve":
      if (partner.status === "active") return { status: "active" };
      next = "active";
      break;
    case "reject":
      if (partner.status !== "pending") throw new PartnerError("Отклонить можно только заявку на рассмотрении", 409);
      if (!trimmed) throw new PartnerError("Укажите причину отказа");
      next = "rejected";
      break;
    case "suspend":
      if (partner.status !== "active") throw new PartnerError("Приостановить можно только активного партнёра", 409);
      if (!trimmed) throw new PartnerError("Укажите причину приостановки");
      next = "suspended";
      break;
    case "reactivate":
      if (partner.status !== "suspended") throw new PartnerError("Возобновить можно только приостановленного партнёра", 409);
      next = "active";
      break;
    default:
      throw new PartnerError("Неизвестное действие");
  }

  await db.partner.update({
    where: { id: partnerId },
    data: {
      status: next,
      reviewComment: trimmed || null,
      reviewedAt: new Date(),
      reviewedByUserId: reviewer.userId,
    },
  });
  invalidatePartnerBranding(partnerId);

  const notify = async () => {
    if (action === "approve") {
      await sendPartnerApprovedEmail({
        to: partner.contactEmail,
        companyName: partner.companyName,
        slug: partner.slug,
        code: partner.code,
      });
      await notifyEmployee(
        partner.applicantUserId,
        [
          "🤝 <b>Вы партнёр WeSetup</b>",
          `Заявка «${escapeTelegramHtml(partner.companyName)}» одобрена. Кабинет открыт: ${APP_URL}/partner/onboarding`,
          `Ссылка для клиентов: ${partnerPublicUrl(partner.slug)}`,
          `Код партнёра: <code>${partner.code}</code>`,
        ].join("\n"),
      );
    } else if (action === "reject") {
      await sendPartnerRejectedEmail({ to: partner.contactEmail, companyName: partner.companyName, comment: trimmed });
      await notifyEmployee(
        partner.applicantUserId,
        `Заявка на партнёрство «${escapeTelegramHtml(partner.companyName)}» отклонена.\nКомментарий: ${escapeTelegramHtml(trimmed)}`,
      );
    } else if (action === "suspend") {
      await sendPartnerSuspendedEmail({ to: partner.contactEmail, companyName: partner.companyName, comment: trimmed });
      await notifyEmployee(
        partner.applicantUserId,
        `⏸ Партнёрский кабинет «${escapeTelegramHtml(partner.companyName)}» приостановлен.\nКомментарий: ${escapeTelegramHtml(trimmed)}`,
      );
    } else {
      await notifyEmployee(
        partner.applicantUserId,
        `▶️ Партнёрский кабинет «${escapeTelegramHtml(partner.companyName)}» снова активен.`,
      );
    }
  };
  notify().catch((err) => console.error("partner review notify failed", err));

  return { status: next };
}

// ---------------------------------------------------------------------------
// Attach / detach clients
// ---------------------------------------------------------------------------

export type AttachSource = "link" | "code" | "invite" | "manual";

/**
 * Собственная организация партнёра не может быть его клиентом: по ИНН,
 * по организации заявителя и по членству людей партнёра в организации.
 */
export async function isPartnerOwnOrganization(partnerId: string, organizationId: string): Promise<boolean> {
  const [partner, org] = await Promise.all([
    db.partner.findUnique({
      where: { id: partnerId },
      select: { inn: true, applicantOrganizationId: true, members: { select: { userId: true } } },
    }),
    db.organization.findUnique({ where: { id: organizationId }, select: { inn: true } }),
  ]);
  if (!partner || !org) return false;
  if (partner.applicantOrganizationId === organizationId) return true;
  if (org.inn && org.inn.replace(/\D/g, "") === partner.inn) return true;
  const memberIds = partner.members.map((m) => m.userId);
  if (memberIds.length === 0) return false;
  const [homeUser, membership] = await Promise.all([
    db.user.findFirst({ where: { id: { in: memberIds }, organizationId }, select: { id: true } }),
    db.organizationMember.findFirst({ where: { userId: { in: memberIds }, organizationId }, select: { id: true } }),
  ]);
  return Boolean(homeUser || membership);
}

export async function findPartnerForAttach(
  by: { slug?: string | null; code?: string | null },
): Promise<{ id: string; slug: string; companyName: string; brandName: string; status: PartnerStatus } | null> {
  const where: Prisma.PartnerWhereInput = by.slug
    ? { slug: by.slug }
    : by.code && isValidPartnerCode(by.code)
      ? { code: normalizePartnerCode(by.code) }
      : { id: "__none__" };
  const partner = await db.partner.findFirst({
    where,
    select: { id: true, slug: true, status: true, companyName: true, branding: { select: { brandName: true } } },
  });
  if (!partner) return null;
  return {
    id: partner.id,
    slug: partner.slug,
    companyName: partner.companyName,
    brandName: partner.branding?.brandName ?? partner.companyName,
    status: asStatus(partner.status),
  };
}

export async function attachOrganizationToPartner(input: {
  partnerId: string;
  organizationId: string;
  accessLevel: PartnerAccessLevel;
  source: AttachSource;
  actorUserId: string | null;
}): Promise<{ partnerClientId: string; created: boolean }> {
  await ensurePartnerSchemaExtras();
  const partner = await db.partner.findUnique({
    where: { id: input.partnerId },
    select: { id: true, status: true, slug: true, applicantUserId: true, contactEmail: true },
  });
  if (!partner) throw new PartnerError("Партнёр не найден", 404);
  if (partner.status !== "active") throw new PartnerError("Партнёр сейчас не принимает клиентов", 409, "partner_inactive");
  if (await isPartnerOwnOrganization(partner.id, input.organizationId)) {
    throw new PartnerError("Собственная организация партнёра не может быть его клиентом", 409, "own_organization");
  }

  const result = await db.$transaction(async (tx) => {
    const active = await tx.partnerClient.findFirst({
      where: { organizationId: input.organizationId, detachedAt: null },
      select: { id: true, partnerId: true },
    });
    if (active) {
      if (active.partnerId === partner.id) return { partnerClientId: active.id, created: false };
      throw new PartnerError("У организации уже есть консультант. Сначала отключите текущего в настройках", 409, "already_attached");
    }
    try {
      const created = await tx.partnerClient.create({
        data: {
          partnerId: partner.id,
          organizationId: input.organizationId,
          accessLevel: input.accessLevel,
          source: input.source,
        },
        select: { id: true },
      });
      return { partnerClientId: created.id, created: true };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new PartnerError("У организации уже есть консультант", 409, "already_attached");
      }
      throw error;
    }
  });

  invalidateOrgBranding(input.organizationId);

  if (result.created) {
    const org = await db.organization.findUnique({ where: { id: input.organizationId }, select: { name: true } });
    const orgName = org?.name ?? "Организация";
    await db.auditLog
      .create({
        data: {
          organizationId: input.organizationId,
          userId: input.actorUserId ?? undefined,
          action: "partner.attached",
          entity: "PartnerClient",
          entityId: result.partnerClientId,
          details: { partnerId: partner.id, accessLevel: input.accessLevel, source: input.source },
        },
      })
      .catch((err) => console.error("partner attach audit failed", err));
    sendPartnerClientAttachedEmail({ to: partner.contactEmail, organizationName: orgName, accessLevel: input.accessLevel })
      .catch((err) => console.error("partner attach email failed", err));
    notifyEmployee(
      partner.applicantUserId,
      `🆕 Новый клиент: <b>${escapeTelegramHtml(orgName)}</b>\nДоступ: ${input.accessLevel === "edit" ? "просмотр и редактирование" : "только просмотр"}\n${APP_URL}/partner`,
    ).catch((err) => console.error("partner attach telegram failed", err));
    await markInviteRegistered(partner.id, input.organizationId).catch((err) =>
      console.error("partner invite mark failed", err),
    );
  }
  return result;
}

export async function detachOrganizationFromPartner(input: {
  organizationId: string;
  by: "client" | "partner" | "admin";
  actorUserId: string | null;
  /** Для партнёра/ROOT — сверяем, что отвязываем именно эту привязку. */
  partnerId?: string;
}): Promise<{ detached: boolean }> {
  const active = await db.partnerClient.findFirst({
    where: {
      organizationId: input.organizationId,
      detachedAt: null,
      ...(input.partnerId ? { partnerId: input.partnerId } : {}),
    },
    select: {
      id: true,
      partnerId: true,
      partner: { select: { applicantUserId: true, contactEmail: true } },
      organization: { select: { name: true } },
    },
  });
  if (!active) return { detached: false };
  await db.partnerClient.update({
    where: { id: active.id },
    data: { detachedAt: new Date(), detachedBy: input.by },
  });
  invalidateOrgBranding(input.organizationId);
  await db.auditLog
    .create({
      data: {
        organizationId: input.organizationId,
        userId: input.actorUserId ?? undefined,
        action: "partner.detached",
        entity: "PartnerClient",
        entityId: active.id,
        details: { partnerId: active.partnerId, by: input.by },
      },
    })
    .catch((err) => console.error("partner detach audit failed", err));
  sendPartnerClientDetachedEmail({
    to: active.partner.contactEmail,
    organizationName: active.organization.name,
    detachedBy: input.by,
  }).catch((err) => console.error("partner detach email failed", err));
  notifyEmployee(
    active.partner.applicantUserId,
    `🔌 Сопровождение <b>${escapeTelegramHtml(active.organization.name)}</b> отключено (${
      input.by === "client" ? "клиентом" : input.by === "admin" ? "администратором платформы" : "партнёром"
    }). Доступ в кабинет клиента закрыт, начисления остановлены.`,
  ).catch((err) => console.error("partner detach telegram failed", err));
  return { detached: true };
}

/**
 * Уровень доступа консультанта к организации.
 *
 * Менять его может и клиент («Настройки → Консультант»), и сам партнёр
 * из своего кабинета. Поэтому два обязательных отличия от прежней
 * версии:
 *
 * - `partnerId` сужает поиск привязки. Без него партнёрский роут менял
 *   бы уровень любой организации по её id, включая чужого клиента.
 * - `by` решает, уведомлять ли клиента. Когда переключил сам клиент,
 *   писать ему об этом незачем; когда партнёр — клиент обязан узнать,
 *   потому что речь о доступе к его журналам.
 */
export async function setClientAccessLevel(input: {
  organizationId: string;
  level: PartnerAccessLevel;
  actorUserId: string | null;
  /** Сужает привязку — обязателен для вызова со стороны партнёра. */
  partnerId?: string;
  by?: "client" | "partner";
}): Promise<void> {
  const by = input.by ?? "client";
  const active = await db.partnerClient.findFirst({
    where: {
      organizationId: input.organizationId,
      detachedAt: null,
      ...(input.partnerId ? { partnerId: input.partnerId } : {}),
    },
    select: {
      id: true,
      accessLevel: true,
      partnerId: true,
      partner: { select: { companyName: true, branding: { select: { brandName: true } } } },
      organization: { select: { name: true } },
    },
  });
  if (!active) throw new PartnerError("У организации нет консультанта", 404);
  if (active.accessLevel === input.level) return;
  await db.partnerClient.update({ where: { id: active.id }, data: { accessLevel: input.level } });
  invalidateOrgBranding(input.organizationId);
  await db.auditLog
    .create({
      data: {
        organizationId: input.organizationId,
        userId: input.actorUserId ?? undefined,
        action: "partner.access_level",
        entity: "PartnerClient",
        entityId: active.id,
        details: { partnerId: active.partnerId, from: active.accessLevel, to: input.level, by },
      },
    })
    .catch((err) => console.error("partner level audit failed", err));

  if (by === "partner") {
    notifyClientAccessLevelChanged({
      organizationId: input.organizationId,
      organizationName: active.organization.name,
      partnerClientId: active.id,
      brandName: active.partner.branding?.brandName ?? active.partner.companyName,
      level: input.level,
    }).catch((err) => console.error("partner level notify failed", err));
  }
}

/**
 * Клиенту — тремя каналами сразу: уведомление в кабинете, Telegram и
 * письмо. Речь о том, кто может писать в его журналы, поэтому пропустить
 * это сообщение нельзя, а какой канал человек читает — заранее неизвестно.
 * Все отправки best-effort: молчание канала не должно ронять саму смену.
 */
async function notifyClientAccessLevelChanged(input: {
  organizationId: string;
  organizationName: string;
  partnerClientId: string;
  brandName: string;
  level: PartnerAccessLevel;
}): Promise<void> {
  const human =
    input.level === "edit"
      ? "просмотр и редактирование"
      : "только просмотр";
  // Скрытый партнёр: клиент знает, что у службы сопровождения сменился
  // доступ, — но без бренда и слова «консультант».
  const hidden = await isPartnerHiddenForOrg(input.organizationId);
  const who = hidden ? NEUTRAL_SUPPORT_NAME : `Консультант ${input.brandName}`;
  const brandName = hidden ? NEUTRAL_SUPPORT_NAME : input.brandName;
  const title =
    input.level === "edit"
      ? `${who}: включено редактирование журналов`
      : `${who}: оставлен только просмотр`;

  const { notifyManagement } = await import("@/lib/notifications");
  await Promise.allSettled([
    notifyManagement({
      organizationId: input.organizationId,
      kind: "partner_access_level",
      dedupeKey: `partner-level-${input.partnerClientId}-${input.level}`,
      title,
      linkHref: "/settings/consultant",
      linkLabel: "Настройки консультанта",
      items: [
        {
          id: input.partnerClientId,
          label: `Теперь доступно: ${human}`,
          hint: "изменить или отключить — в настройках",
        },
      ],
    }),
    notifyOrganization(
      input.organizationId,
      hidden
        ? `🔐 У службы сопровождения WeSetup изменён уровень доступа.\nТеперь доступно: ${human}.\nВернуть «только просмотр» или отключить сопровождение — ${APP_URL}/settings/consultant`
        : `🔐 Консультант <b>${escapeTelegramHtml(input.brandName)}</b> изменил свой уровень доступа.\nТеперь ему доступно: ${human}.\nВернуть «только просмотр» или отключить консультанта — ${APP_URL}/settings/consultant`,
      ["owner"],
      undefined,
      undefined,
      // Push уходит из колокольчика (notifyManagement выше).
      { appPush: false },
    ),
    (async () => {
      const to = await findOrganizationOwnerEmail(input.organizationId);
      if (!to) return;
      await sendConsultantAccessLevelChangedEmail({
        to,
        brandName,
        organizationName: input.organizationName,
        level: input.level,
      });
    })(),
  ]);
}

/**
 * Почта, на которую пишем руководству организации: сперва владелец
 * аккаунта, затем — любой активный человек из руководства. У организации,
 * которую консультант завёл и ещё не передал, владельца может не быть
 * вовсе — тогда писать некому и это нормально.
 */
async function findOrganizationOwnerEmail(organizationId: string): Promise<string | null> {
  const owner = await db.organizationMember.findFirst({
    where: { organizationId, role: "owner", user: { isActive: true } },
    select: { user: { select: { email: true } } },
  });
  if (owner?.user.email) return owner.user.email;
  const manager = await db.user.findFirst({
    where: {
      organizationId,
      isActive: true,
      archivedAt: null,
      role: { in: getDbRoleValuesWithLegacy(MANAGEMENT_ROLES) },
    },
    orderBy: { createdAt: "asc" },
    select: { email: true },
  });
  return manager?.email ?? null;
}

export async function setClientHidesBranding(input: { organizationId: string; hide: boolean }): Promise<void> {
  const active = await db.partnerClient.findFirst({
    where: { organizationId: input.organizationId, detachedAt: null },
    select: { id: true },
  });
  if (!active) throw new PartnerError("У организации нет консультанта", 404);
  await db.partnerClient.update({ where: { id: active.id }, data: { clientHidesBranding: input.hide } });
  invalidateOrgBranding(input.organizationId);
}

/** Данные для страницы клиента «Консультант». */
export async function getOrganizationConsultant(organizationId: string) {
  const active = await db.partnerClient.findFirst({
    where: { organizationId, detachedAt: null },
    select: {
      id: true,
      accessLevel: true,
      clientHidesBranding: true,
      attachedAt: true,
      partner: {
        select: {
          id: true,
          slug: true,
          companyName: true,
          hideFromClients: true,
          status: true,
          city: true,
          type: true,
          branding: {
            select: {
              brandName: true,
              logoLightMime: true,
              logoDarkMime: true,
              version: true,
              accentColor: true,
              supportPhone: true,
              supportTelegram: true,
              supportEmail: true,
              pdfSignature: true,
              loginGreeting: true,
            },
          },
        },
      },
    },
  });
  if (!active) return null;
  const brand = toBrandView(active.partner);
  return {
    partnerClientId: active.id,
    accessLevel: isPartnerAccessLevel(active.accessLevel) ? active.accessLevel : ("view" as PartnerAccessLevel),
    clientHidesBranding: active.clientHidesBranding,
    attachedAt: active.attachedAt,
    partnerStatus: asStatus(active.partner.status),
    partnerType: active.partner.type,
    city: active.partner.city,
    brand,
    consultantLine: consultantLine(brand),
  };
}

// ---------------------------------------------------------------------------
// Invites
// ---------------------------------------------------------------------------

export async function createClientInvite(input: {
  partnerId: string;
  email: string;
}): Promise<{ id: string; status: string }> {
  const email = input.email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new PartnerError("Укажите корректную почту");
  const partner = await db.partner.findUnique({
    where: { id: input.partnerId },
    select: { id: true, slug: true, status: true, companyName: true, contactEmail: true, branding: {
      select: { brandName: true, supportPhone: true, supportTelegram: true, supportEmail: true },
    } },
  });
  if (!partner || partner.status !== "active") throw new PartnerError("Партнёр неактивен", 403);

  const existing = await db.partnerInvite.findUnique({
    where: { partnerId_email: { partnerId: partner.id, email } },
    select: { id: true, status: true, sentAt: true },
  });
  if (existing?.status === "declined") {
    throw new PartnerError("Этот адрес отказался от приглашений — повторно писать нельзя", 409, "declined");
  }
  if (existing?.status === "registered") {
    throw new PartnerError("Этот клиент уже зарегистрировался по вашему приглашению", 409, "registered");
  }
  if (existing && Date.now() - existing.sentAt.getTime() < 24 * 60 * 60 * 1000) {
    throw new PartnerError("Приглашение уже отправлено сегодня — повторить можно через сутки", 429, "too_soon");
  }

  const raw = generateInviteToken();
  const tokenHash = hashInviteToken(raw);
  const invite = existing
    ? await db.partnerInvite.update({
        where: { id: existing.id },
        data: { tokenHash, status: "sent", sentAt: new Date() },
        select: { id: true, status: true },
      })
    : await db.partnerInvite.create({
        data: { partnerId: partner.id, email, tokenHash, status: "sent" },
        select: { id: true, status: true },
      });

  const brandName = partner.branding?.brandName ?? partner.companyName;
  const contact =
    partner.branding?.supportPhone || partner.branding?.supportTelegram || partner.branding?.supportEmail || partner.contactEmail;
  const sent = await sendPartnerClientInviteEmail({
    to: email,
    partnerSlug: partner.slug,
    brandName,
    declineUrl: `${APP_URL}/p/${partner.slug}/decline?token=${raw}`,
    contactLine: contact ? `Связаться с консультантом: ${contact}` : null,
  });
  if (!sent) throw new PartnerError("Письмо не отправилось — проверьте адрес и попробуйте позже", 409, "send_failed");
  return invite;
}

export async function declineInviteByToken(rawToken: string): Promise<{ ok: boolean; brandName?: string }> {
  const tokenHash = hashInviteToken(rawToken);
  const invite = await db.partnerInvite.findUnique({
    where: { tokenHash },
    select: { id: true, status: true, partner: { select: { companyName: true, branding: { select: { brandName: true } } } } },
  });
  if (!invite) return { ok: false };
  if (invite.status !== "declined") {
    await db.partnerInvite.update({ where: { id: invite.id }, data: { status: "declined", declinedAt: new Date() } });
  }
  return { ok: true, brandName: invite.partner.branding?.brandName ?? invite.partner.companyName };
}

/** Клиент привязался → приглашение на его почту (если было) становится registered. */
async function markInviteRegistered(partnerId: string, organizationId: string): Promise<void> {
  const users = await db.user.findMany({
    where: { organizationId, role: { in: ["manager", "owner", "head_chef", "technologist"] } },
    select: { email: true },
    take: 20,
  });
  const emails = users.map((u) => u.email.toLowerCase());
  if (emails.length === 0) return;
  await db.partnerInvite.updateMany({
    where: { partnerId, email: { in: emails }, status: "sent" },
    data: { status: "registered", registeredAt: new Date(), registeredOrganizationId: organizationId },
  });
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

export async function addClientNote(input: {
  partnerId: string;
  organizationId: string;
  author: { userId: string; name: string };
  text: string;
}) {
  const text = input.text.trim().slice(0, 2000);
  if (!text) throw new PartnerError("Заметка пустая");
  const client = await db.partnerClient.findFirst({
    where: { partnerId: input.partnerId, organizationId: input.organizationId },
    orderBy: { attachedAt: "desc" },
    select: { id: true },
  });
  if (!client) throw new PartnerError("Клиент не найден", 404);
  return db.partnerClientNote.create({
    data: {
      partnerId: input.partnerId,
      partnerClientId: client.id,
      authorUserId: input.author.userId,
      authorName: input.author.name,
      text,
    },
    select: { id: true, text: true, authorName: true, createdAt: true },
  });
}

export async function deleteClientNote(input: { partnerId: string; noteId: string }) {
  const result = await db.partnerClientNote.deleteMany({ where: { id: input.noteId, partnerId: input.partnerId } });
  if (result.count === 0) throw new PartnerError("Заметка не найдена", 404);
}

// ---------------------------------------------------------------------------
// Team
// ---------------------------------------------------------------------------

export async function listTeam(partnerId: string) {
  const rows = await db.partnerUser.findMany({
    where: { partnerId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      role: true,
      createdAt: true,
      user: { select: { id: true, name: true, email: true, isActive: true, lastLoginAt: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    role: r.role === "owner" ? "owner" : "member",
    userId: r.user.id,
    name: r.user.name,
    email: r.user.email,
    isActive: r.user.isActive,
    lastLoginAt: r.user.lastLoginAt,
    since: r.createdAt,
  }));
}

/**
 * Добавление участника по почте. Существующий аккаунт — просто связываем;
 * нового заводим в организации партнёра без доступа к журналам и шлём
 * ссылку на установку пароля.
 */
export async function addTeamMember(input: {
  partnerId: string;
  email: string;
  name: string;
}): Promise<{ userId: string; created: boolean }> {
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim().slice(0, 120);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new PartnerError("Укажите корректную почту");
  const partner = await db.partner.findUnique({
    where: { id: input.partnerId },
    select: { id: true, companyName: true, applicantOrganizationId: true, applicant: { select: { organizationId: true } } },
  });
  if (!partner) throw new PartnerError("Партнёр не найден", 404);

  const existing = await db.user.findUnique({
    where: { email },
    select: { id: true, name: true, partnerMembership: { select: { partnerId: true } } },
  });
  if (existing) {
    if (existing.partnerMembership) {
      if (existing.partnerMembership.partnerId === partner.id) throw new PartnerError("Этот человек уже в команде", 409);
      throw new PartnerError("Этот человек уже состоит в другом партнёре", 409);
    }
    await db.partnerUser.create({ data: { partnerId: partner.id, userId: existing.id, role: "member" } });
    notifyEmployee(
      existing.id,
      `🤝 Вас добавили в команду партнёра <b>${escapeTelegramHtml(partner.companyName)}</b>. Переключатель «Партнёрский кабинет» — в шапке сайта.`,
    ).catch(() => undefined);
    return { userId: existing.id, created: false };
  }

  if (name.length < 2) throw new PartnerError("Укажите имя нового участника");
  const homeOrgId = partner.applicantOrganizationId ?? partner.applicant.organizationId;
  const raw = generateInviteToken();
  const user = await db.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        email,
        name,
        passwordHash: "",
        role: "cook",
        positionTitle: "Сотрудник партнёра",
        organizationId: homeOrgId,
        isActive: false,
        journalAccessMigrated: true,
      },
      select: { id: true },
    });
    await tx.inviteToken.create({ data: { userId: created.id, tokenHash: hashInviteToken(raw), expiresAt: inviteExpiresAt() } });
    await tx.partnerUser.create({ data: { partnerId: partner.id, userId: created.id, role: "member" } });
    return created;
  });
  sendPartnerTeamInviteEmail({ to: email, name, companyName: partner.companyName, inviteUrl: buildInviteUrl(raw) }).catch(
    (err) => console.error("partner team invite email failed", err),
  );
  return { userId: user.id, created: true };
}

export async function removeTeamMember(input: { partnerId: string; memberId: string; actorUserId: string }) {
  const row = await db.partnerUser.findFirst({
    where: { id: input.memberId, partnerId: input.partnerId },
    select: { id: true, role: true, userId: true },
  });
  if (!row) throw new PartnerError("Участник не найден", 404);
  if (row.role === "owner") throw new PartnerError("Владельца партнёра удалить нельзя", 409);
  await db.partnerUser.delete({ where: { id: row.id } });
}

// ---------------------------------------------------------------------------
// Profile: onboarding, payout details, agreement
// ---------------------------------------------------------------------------

export function parsePayoutDetails(type: unknown, raw: unknown): { payoutType: PayoutType; details: PayoutDetails } {
  if (!(PAYOUT_TYPES as readonly string[]).includes(String(type))) throw new PartnerError("Выберите тип получателя");
  const payoutType = type as PayoutType;
  const body = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const details: PayoutDetails = {
    fullName: cleanText(body.fullName, 200),
    inn: cleanText(body.inn, 12).replace(/\D/g, ""),
    bank: cleanText(body.bank, 200),
    bik: cleanText(body.bik, 9).replace(/\D/g, ""),
    account: cleanText(body.account, 20).replace(/\D/g, ""),
  };
  if (details.fullName.length < 3) throw new PartnerError(payoutType === "company" ? "Укажите название юрлица" : "Укажите ФИО");
  if (payoutType === "company" ? details.inn.length !== 10 : details.inn.length !== 12) {
    throw new PartnerError(payoutType === "company" ? "ИНН юрлица — 10 цифр" : "ИНН физлица/ИП — 12 цифр");
  }
  if (details.bank.length < 3) throw new PartnerError("Укажите банк");
  if (details.bik.length !== 9) throw new PartnerError("БИК — 9 цифр");
  if (details.account.length !== 20) throw new PartnerError("Расчётный счёт — 20 цифр");
  if (payoutType === "company") {
    details.kpp = cleanText(body.kpp, 9).replace(/\D/g, "");
    if (details.kpp.length !== 9) throw new PartnerError("КПП — 9 цифр");
  }
  if (payoutType !== "self_employed") {
    const ogrn = cleanText(body.ogrn, 15).replace(/\D/g, "");
    if (ogrn && ogrn.length !== (payoutType === "company" ? 13 : 15)) {
      throw new PartnerError(payoutType === "company" ? "ОГРН — 13 цифр" : "ОГРНИП — 15 цифр");
    }
    if (ogrn) details.ogrn = ogrn;
  }
  return { payoutType, details };
}

export async function savePayoutDetails(partnerId: string, payoutType: PayoutType, details: PayoutDetails) {
  await db.partner.update({
    where: { id: partnerId },
    data: { payoutType, payoutDetails: details as unknown as Prisma.InputJsonValue },
  });
}

export async function markOnboardingDone(partnerId: string) {
  await db.partner.update({ where: { id: partnerId }, data: { onboardingDoneAt: new Date() } });
}

export async function setAgreementSigned(partnerId: string, signed: boolean, number: string | null) {
  await db.partner.update({
    where: { id: partnerId },
    data: { agreementSignedAt: signed ? new Date() : null, agreementNumber: signed ? number?.trim().slice(0, 64) || null : null },
  });
}
