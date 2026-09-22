/**
 * Организации клиентов в кабинете партнёра: завести, настроить, передать.
 *
 * Зачем: консультант приходит к новому заведению и настраивает всё сам —
 * журналы, должности, сотрудников. Раньше начать было нечем: организацию
 * создаёт только сам клиент, зарегистрировавшись. Приходилось стоять у
 * него над плечом или диктовать шаги по телефону.
 *
 * Кому принадлежит организация. Клиенту, а не партнёру: у неё свой
 * `Account` и своя подписка. Иначе все клиенты консультанта делили бы
 * одну подписку с ним самим (тариф живёт на `Account`), и вознаграждение
 * за их оплаты считать было бы не с чего.
 *
 * Владельца можно указать сразу — тогда ему уходит приглашение — или
 * позже, кнопкой «Передать клиенту». До передачи у организации нет
 * `accountId`: это поддерживаемое состояние, `plan-limits.server.ts`
 * считает такую организацию по ней самой.
 *
 * Отдельный модуль, а не `service.ts`: тот уже за 40 КБ.
 */

import { attachAccountForNewOrganization } from "@/lib/create-organization";
import { db } from "@/lib/db";
import {
  buildInviteUrl,
  generateInviteToken,
  hashInviteToken,
  INVITE_TTL_DAYS,
  inviteExpiresAt,
} from "@/lib/invite-tokens";
import { defaultJournalAutomationJson } from "@/lib/journal-automation";
import { ensureLocationBuildings } from "@/lib/location-buildings";
import { normalizeOwnership, normalizeSphere, MAX_LOCATIONS } from "@/lib/org-profile";
import { refreshOrganizationLegalProfile } from "@/lib/org-legal-profile";
import { notifyPlatformAdmin } from "@/lib/platform-admin";
import { createRateLimiter } from "@/lib/rate-limit";
import { defaultDisabledCodesFor } from "@/lib/sphere-journal-rules";
import { escapeTelegramHtml } from "@/lib/telegram";

import type { PartnerAccessLevel } from "./access-guard";
import { invalidateOrgBranding } from "./branding";
import { sendPartnerClientOwnerInviteEmail } from "./emails";
import { PartnerError } from "./errors";
import { ensurePartnerSchemaExtras } from "./schema-extras";

/**
 * Сколько заведённых, но не переданных клиенту организаций партнёр может
 * держать одновременно. Потолок самоограничивающийся: каждая принятая
 * передача освобождает слот, и добросовестный консультант его не видит.
 * Он же — и главная защита от «наплодить бесплатных организаций».
 */
export const PARTNER_MAX_PENDING_CLIENT_ORGS = 10;

/** Пять новых организаций в час — запас на рабочий день, не на скрипт. */
const createLimiter = createRateLimiter({
  tokensPerInterval: 5,
  intervalMs: 60 * 60 * 1000,
});

export type ClientOwnerInput = {
  email: string;
  name: string;
  phone?: string | null;
};

export type CreateClientOrganizationInput = {
  name: string;
  sphere: string;
  ownershipKind?: string;
  inn?: string | null;
  address?: string | null;
  phone?: string | null;
  timezone?: string;
  locationsCount?: number;
  accessLevel?: PartnerAccessLevel;
  owner?: ClientOwnerInput | null;
};

/** В каком состоянии передача организации клиенту. */
export type ClientHandoverState = {
  status: "no_owner" | "invited" | "invite_expired" | "owned";
  ownerName: string | null;
  ownerEmail: string | null;
  /** Когда отправлено приглашение — выводим из срока жизни токена. */
  invitedAt: string | null;
  expiresAt: string | null;
  /** Можно ли отправить приглашение прямо сейчас (троттлинг — раз в сутки). */
  canResendAt: string | null;
};

const RESEND_COOLDOWN_MS = 24 * 60 * 60 * 1000;

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function normalizeEmail(raw: unknown): string {
  return text(raw, 160).toLowerCase();
}

function isEmail(value: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value);
}

/** Разбор тела «создать организацию». Бросает `PartnerError` при ошибке. */
export function parseCreateClientOrganization(raw: unknown): CreateClientOrganizationInput {
  const body = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;

  const name = text(body.name, 200);
  if (name.length < 2) throw new PartnerError("Название — минимум 2 символа");

  const inn = text(body.inn, 12).replace(/\D/g, "");
  if (inn && !/^(\d{10}|\d{12})$/.test(inn)) throw new PartnerError("ИНН — 10 или 12 цифр");

  const phone = text(body.phone, 50);
  if (phone && phone.replace(/\D/g, "").length < 10) throw new PartnerError("Телефон в неправильном формате");

  const locationsCount = Math.max(
    1,
    Math.min(MAX_LOCATIONS, Math.floor(Number(body.locationsCount) || 1)),
  );

  let owner: ClientOwnerInput | null = null;
  const rawOwner = body.owner;
  if (rawOwner && typeof rawOwner === "object") {
    const o = rawOwner as Record<string, unknown>;
    const email = normalizeEmail(o.email);
    // Пустой блок владельца — это «передам позже», а не ошибка: форма
    // присылает объект всегда, а поля в нём могут быть не заполнены.
    if (email || text(o.name, 120)) {
      if (!isEmail(email)) throw new PartnerError("Укажите корректную почту владельца");
      const ownerName = text(o.name, 120);
      if (ownerName.length < 2) throw new PartnerError("Укажите имя владельца");
      owner = { email, name: ownerName, phone: text(o.phone, 50) || null };
    }
  }

  return {
    name,
    sphere: text(body.sphere, 32) || "restaurant",
    ownershipKind: text(body.ownershipKind, 32) || "private",
    inn: inn || null,
    address: text(body.address, 500) || null,
    phone: phone || null,
    timezone: text(body.timezone, 64) || "Europe/Moscow",
    locationsCount,
    accessLevel: body.accessLevel === "view" ? "view" : "edit",
    owner,
  };
}

/**
 * Проверяет почту будущего владельца.
 *
 * Два отказа, оба принципиальные:
 * - человек из команды партнёра владельцем быть не может — иначе
 *   `isPartnerOwnOrganization` навсегда признает организацию собственной
 *   и перепривязать её станет нельзя;
 * - существующий живой аккаунт не переносим: `User.organizationId` —
 *   его домашняя организация, и увести человека оттуда значит сломать
 *   ему доступ к своей.
 */
async function assertOwnerEmailUsable(email: string): Promise<void> {
  const user = await db.user.findUnique({
    where: { email },
    select: {
      id: true,
      isActive: true,
      partnerMembership: { select: { partnerId: true } },
    },
  });
  if (!user) return;
  if (user.partnerMembership) {
    throw new PartnerError(
      "Эта почта принадлежит сотруднику партнёра. Владельцем организации клиента он быть не может",
      409,
      "partner_team_email",
    );
  }
  throw new PartnerError(
    "У этой почты уже есть аккаунт в WeSetup. Создайте организацию без владельца и передайте позже — или попросите клиента подключить вас по ссылке из раздела «Приглашения»",
    409,
    "email_taken",
  );
}

/** Сколько организаций партнёр завёл, но ещё не передал клиенту. */
/** Партнёр скрыл себя от клиентов — письма им без его имени. */
async function partnerHidden(partnerId: string): Promise<boolean> {
  const partner = await db.partner.findUnique({ where: { id: partnerId }, select: { hideFromClients: true } });
  return partner?.hideFromClients === true;
}

export async function countPendingClientOrganizations(partnerId: string): Promise<number> {
  return db.partnerClient.count({
    where: {
      partnerId,
      source: "manual",
      detachedAt: null,
      organization: { users: { none: { isActive: true } } },
    },
  });
}

export async function createClientOrganization(input: {
  partnerId: string;
  actorUserId: string;
  actorName: string;
  brandName: string;
  data: CreateClientOrganizationInput;
}): Promise<{ organizationId: string; partnerClientId: string }> {
  const { partnerId, data } = input;

  const partner = await db.partner.findUnique({
    where: { id: partnerId },
    select: { id: true, status: true, inn: true },
  });
  if (!partner) throw new PartnerError("Партнёр не найден", 404);
  if (partner.status !== "active") {
    throw new PartnerError("Партнёр сейчас не принимает клиентов", 409, "partner_inactive");
  }

  // Единственная из трёх веток `isPartnerOwnOrganization`, которая может
  // сработать на пустой организации: членов у неё пока нет, а
  // `applicantOrganizationId` — заведомо другой id.
  if (data.inn && data.inn === partner.inn) {
    throw new PartnerError(
      "Это ИНН самого партнёра — собственная организация не может быть клиентом",
      409,
      "own_organization",
    );
  }

  if (data.owner) await assertOwnerEmailUsable(data.owner.email);

  const pending = await countPendingClientOrganizations(partnerId);
  if (pending >= PARTNER_MAX_PENDING_CLIENT_ORGS) {
    throw new PartnerError(
      `Сначала передайте клиентам уже созданные организации — их накопилось ${pending}`,
      409,
      "too_many_pending",
    );
  }

  if (!createLimiter.consume(partnerId)) {
    throw new PartnerError(
      "Слишком много новых организаций подряд. Попробуйте через час",
      429,
      "rate_limited",
    );
  }

  // Частичный unique «одна активная привязка на организацию» создаётся
  // вручную — он должен существовать до вставки в `partnerClient`.
  await ensurePartnerSchemaExtras();

  const sphere = normalizeSphere(data.sphere);
  const inviteRaw = data.owner ? generateInviteToken() : null;

  const created = await db.$transaction(async (tx) => {
    const organization = await tx.organization.create({
      data: {
        name: data.name,
        type: sphere,
        ownershipKind: normalizeOwnership(data.ownershipKind),
        inn: data.inn,
        address: data.address,
        phone: data.phone,
        timezone: data.timezone ?? "Europe/Moscow",
        locationsCount: data.locationsCount ?? 1,
        subscriptionPlan: "free",
        disabledJournalCodes: defaultDisabledCodesFor(sphere) as never,
        // Гигиенический журнал ведётся сам с первого дня — как у всех
        // остальных путей создания организации.
        journalAutomationJson: defaultJournalAutomationJson() as never,
        // accountId не задаём: он появится вместе с владельцем.
      },
      select: { id: true },
    });

    let ownerUserId: string | null = null;
    if (data.owner && inviteRaw) {
      const user = await tx.user.create({
        data: {
          email: data.owner.email,
          name: data.owner.name,
          // Пустой хеш + isActive:false — та же заглушка, что у
          // приглашения сотрудника: пароль задаётся по ссылке из письма.
          passwordHash: "",
          role: "manager",
          phone: data.owner.phone,
          organizationId: organization.id,
          isActive: false,
          journalAccessMigrated: true,
        },
        select: { id: true },
      });
      ownerUserId = user.id;

      await attachAccountForNewOrganization(tx, {
        ownerUserId: user.id,
        organizationId: organization.id,
        subscriptionPlan: "free",
      });

      await tx.inviteToken.create({
        data: {
          userId: user.id,
          tokenHash: hashInviteToken(inviteRaw),
          expiresAt: inviteExpiresAt(),
        },
      });
    }

    const link = await tx.partnerClient.create({
      data: {
        partnerId,
        organizationId: organization.id,
        accessLevel: data.accessLevel ?? "edit",
        source: "manual",
      },
      select: { id: true },
    });

    return { organizationId: organization.id, ownerUserId, partnerClientId: link.id };
  });

  invalidateOrgBranding(created.organizationId);

  // Всё остальное — вне транзакции и best-effort: письмо или DaData не
  // должны откатывать уже созданную организацию.
  await db.auditLog
    .create({
      data: {
        organizationId: created.organizationId,
        userId: input.actorUserId,
        userName: `партнёр: ${input.brandName}, ${input.actorName}`,
        action: "partner.client_org_created",
        entity: "organization",
        entityId: created.organizationId,
        details: {
          partnerId,
          name: data.name,
          sphere,
          accessLevel: data.accessLevel ?? "edit",
          withOwner: Boolean(data.owner),
          locationsCount: data.locationsCount ?? 1,
        },
      },
    })
    .catch((err) => console.error("partner client org audit failed", err));

  if ((data.locationsCount ?? 1) >= 2) {
    await ensureLocationBuildings(created.organizationId, data.locationsCount ?? 1, {
      firstAddress: data.address,
    }).catch((err) => console.error("partner client org buildings failed", err));
  }

  if (data.inn) {
    void refreshOrganizationLegalProfile(created.organizationId, data.inn).catch(() => null);
  }

  if (data.owner && inviteRaw) {
    void partnerHidden(input.partnerId).then((hidden) => sendPartnerClientOwnerInviteEmail({
      to: data.owner!.email,
      name: data.owner!.name,
      organizationName: data.name,
      brandName: input.brandName,
      inviteUrl: buildInviteUrl(inviteRaw),
      hidden,
    })).catch((err) => console.error("partner owner invite email failed", err));
  }

  // Владельцу платформы видно каждое создание: «наплодить организаций»
  // заметно сразу, а рычаг («приостановить партнёра») уже есть.
  void notifyPlatformAdmin(
    `🏗 Партнёр <b>${escapeTelegramHtml(input.brandName)}</b> завёл организацию ` +
      `<b>${escapeTelegramHtml(data.name)}</b>\n` +
      `Владелец: ${data.owner ? escapeTelegramHtml(data.owner.email) : "ещё не назначен"}\n` +
      `Не передано клиентам у этого партнёра: ${pending + (data.owner ? 0 : 1)}`,
    { kind: "partner-client-org" },
  ).catch((err) => console.error("partner client org admin notify failed", err));

  return { organizationId: created.organizationId, partnerClientId: created.partnerClientId };
}

/** Состояние передачи организации клиенту. */
export async function getClientHandoverState(organizationId: string): Promise<ClientHandoverState> {
  const organization = await db.organization.findUnique({
    where: { id: organizationId },
    select: {
      members: {
        where: { role: "owner" },
        take: 1,
        select: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              isActive: true,
              inviteToken: { select: { expiresAt: true, usedAt: true } },
            },
          },
        },
      },
    },
  });

  const owner = organization?.members[0]?.user ?? null;
  if (!owner) {
    return {
      status: "no_owner",
      ownerName: null,
      ownerEmail: null,
      invitedAt: null,
      expiresAt: null,
      canResendAt: null,
    };
  }

  const token = owner.inviteToken;
  if (owner.isActive || !token || token.usedAt) {
    return {
      status: "owned",
      ownerName: owner.name,
      ownerEmail: owner.email,
      invitedAt: null,
      expiresAt: null,
      canResendAt: null,
    };
  }

  // Момент выдачи выводим из срока жизни: TTL фиксирован, и отдельное
  // поле «когда отправили» заводить ради троттлинга незачем.
  const issuedAt = new Date(token.expiresAt.getTime() - INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);
  const expired = token.expiresAt.getTime() <= Date.now();
  return {
    status: expired ? "invite_expired" : "invited",
    ownerName: owner.name,
    ownerEmail: owner.email,
    invitedAt: issuedAt.toISOString(),
    expiresAt: token.expiresAt.toISOString(),
    canResendAt: new Date(issuedAt.getTime() + RESEND_COOLDOWN_MS).toISOString(),
  };
}

/**
 * «Передать клиенту»: назначить владельца, переотправить приглашение или
 * исправить опечатку в адресе.
 *
 * Все три случая — один вызов: состояние определяется тем, что уже есть
 * в базе, а не отдельными кнопками с разной логикой.
 */
export async function assignClientOwner(input: {
  partnerId: string;
  organizationId: string;
  actorUserId: string;
  actorName: string;
  brandName: string;
  organizationName: string;
  owner: ClientOwnerInput;
}): Promise<ClientHandoverState> {
  const email = normalizeEmail(input.owner.email);
  if (!isEmail(email)) throw new PartnerError("Укажите корректную почту владельца");
  const ownerName = text(input.owner.name, 120);
  if (ownerName.length < 2) throw new PartnerError("Укажите имя владельца");

  const state = await getClientHandoverState(input.organizationId);
  if (state.status === "owned") {
    throw new PartnerError(
      "Владелец уже принял приглашение — сменить его может только он сам",
      409,
      "already_owned",
    );
  }

  const emailChanged = state.ownerEmail !== email;
  if (emailChanged) await assertOwnerEmailUsable(email);

  if (!emailChanged && state.canResendAt && new Date(state.canResendAt) > new Date()) {
    throw new PartnerError(
      "Приглашение на эту почту уже отправлено сегодня. Повторить можно завтра",
      429,
      "too_soon",
    );
  }

  const raw = generateInviteToken();
  const expiresAt = inviteExpiresAt();

  await db.$transaction(async (tx) => {
    let ownerUserId: string;
    if (state.status === "no_owner") {
      const user = await tx.user.create({
        data: {
          email,
          name: ownerName,
          passwordHash: "",
          role: "manager",
          phone: input.owner.phone ?? null,
          organizationId: input.organizationId,
          isActive: false,
          journalAccessMigrated: true,
        },
        select: { id: true },
      });
      ownerUserId = user.id;
      await attachAccountForNewOrganization(tx, {
        ownerUserId: user.id,
        organizationId: input.organizationId,
        subscriptionPlan: "free",
      });
    } else {
      const existing = await tx.organizationMember.findFirst({
        where: { organizationId: input.organizationId, role: "owner" },
        select: { userId: true },
      });
      if (!existing) throw new PartnerError("Владелец не найден", 404);
      ownerUserId = existing.userId;
      await tx.user.update({
        where: { id: ownerUserId },
        data: {
          email,
          name: ownerName,
          ...(input.owner.phone ? { phone: input.owner.phone } : {}),
        },
      });
    }

    await tx.inviteToken.upsert({
      where: { userId: ownerUserId },
      create: { userId: ownerUserId, tokenHash: hashInviteToken(raw), expiresAt },
      // Сбрасываем `usedAt`: токен одноразовый, и без сброса повторная
      // ссылка считалась бы уже использованной.
      update: { tokenHash: hashInviteToken(raw), expiresAt, usedAt: null },
    });
  });

  await db.auditLog
    .create({
      data: {
        organizationId: input.organizationId,
        userId: input.actorUserId,
        userName: `партнёр: ${input.brandName}, ${input.actorName}`,
        action: "partner.owner_invited",
        entity: "User",
        entityId: null,
        details: {
          partnerId: input.partnerId,
          email,
          resend: state.status !== "no_owner" && !emailChanged,
          changedEmail: emailChanged && state.status !== "no_owner",
        },
      },
    })
    .catch((err) => console.error("partner owner invite audit failed", err));

  await sendPartnerClientOwnerInviteEmail({
    to: email,
    name: ownerName,
    organizationName: input.organizationName,
    brandName: input.brandName,
    inviteUrl: buildInviteUrl(raw),
    hidden: await partnerHidden(input.partnerId),
  });

  return getClientHandoverState(input.organizationId);
}
