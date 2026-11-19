import type { Prisma } from "@prisma/client";

import { advisoryLockKey, withAdvisoryTryLock } from "@/lib/advisory-lock";
import { loadAccountBilling } from "@/lib/billing.server";
import { db } from "@/lib/db";
import { DirectoryExchangeError } from "@/lib/directory-exchange/errors";
import { normalizeExchangeKinds, type ExchangeKind } from "@/lib/directory-exchange/kinds";
import {
  countersLine,
  decisionNotificationLabel,
  decisionTitle,
  ownerRequestLetter,
  requesterDecisionLetter,
  type RequestLetter,
} from "@/lib/directory-exchange/request-letters";
import {
  REQUEST_DAY_MS,
  REQUEST_NOT_OWNER_MESSAGE,
  decideRequestCreation,
  decideRequestDecision,
  exchangeKindsLabel,
  isRequestMode,
  isRequestStale,
  isRequestStatus,
  narrowAllowedKinds,
  requestExpiresAt,
  type RequestMode,
  type RequestStatus,
} from "@/lib/directory-exchange/requests";
import {
  EXCHANGE_BUSY_CODE,
  runDirectoryExchange,
  transferOnce,
  type ExchangeActor,
  type TransferSelection,
} from "@/lib/directory-exchange/run.server";
import { findExchangeCabinet } from "@/lib/directory-exchange/settings.server";
import { emptySummary, summaryTotals, type ExchangeCounters, type ExchangeSummary } from "@/lib/directory-exchange/summary";
import { normalizeServiceCode } from "@/lib/dish-pool-code";
import { generateInviteToken, hashInviteToken } from "@/lib/invite-tokens";
import { MASTER_ORG_KIND, NOT_DIRECTORY_ORG_WHERE } from "@/lib/master-directory";
import { ORG_LOCKED_CODE, ORG_LOCKED_MESSAGE, phaseOfKind } from "@/lib/org-trial";
import { isOrganizationLocked } from "@/lib/org-trial.server";
import { isTechnicalEmail } from "@/lib/technical-email";

/**
 * Обмен справочниками с чужим аккаунтом (часть 3, 2026-11-19): запрос по
 * коду мастер-кабинета и подтверждение владельцем этого кабинета.
 *
 * Ход: владелец оплаченного аккаунта вводит код чужого кабинета → запрос
 * `pending` на 7 дней и письмо владельцу аккаунта кабинета со ссылкой
 * `/exchange-request/<токен>` → тот отмечает, какие списки разрешает, и
 * подтверждает либо отклоняет. Связь (`link`): организация-заявитель
 * становится участником обмена кабинета с пометкой `foreign`. Перенос
 * (`transfer`): разовый перенос из выбранной владельцем организации.
 *
 * Что здесь держится жёстко:
 *   • до подтверждения заявитель узнаёт только название кабинета — ни
 *     организаций чужого аккаунта, ни их записей, ни их числа;
 *   • код не найден, кабинет демо, строка не похожа на код — один и тот же
 *     ответ 404; тому, кому запросы недоступны (тариф, лимит), не сообщается
 *     даже это;
 *   • в базе только SHA-256 токена; сама ссылка ничего не открывает без входа
 *     под владельцем аккаунта кабинета;
 *   • обе стороны могут закончить связь; каждое действие — в журнале обеих
 *     сторон (`directory_exchange.request_*`), имя человека из другого
 *     аккаунта в чужой журнал не пишется;
 *   • письма и уведомления — после записи, в try/catch (`notify`).
 */

export const CABINET_NOT_FOUND_MESSAGE = "Мастер-кабинет с таким кодом не найден";
export const REQUEST_NOT_FOUND_MESSAGE = "Запрос не найден";
const OWNER_ONLY_MESSAGE = "Отправлять запросы в другую компанию может только владелец аккаунта";
const CLOSED_MESSAGE = "Запрос уже закрыт";
const LINK_ENDED_MESSAGE = "Связь с этим мастер-кабинетом уже разорвана";
const CREATE_BUSY_MESSAGE = "Не удалось отправить запрос — попробуйте ещё раз";
const EXCHANGE_PAGE_HREF = "/settings/master-cabinet";
const NOTIFICATION_KIND = "directory_exchange.request";

const APP_URL = (process.env.NEXTAUTH_URL || process.env.APP_URL || "https://wesetup.ru").replace(/\/+$/, "");

/** Запрос глазами заявителя. О кабинете — только название. */
export type ExchangeRequestView = {
  id: string;
  cabinetName: string;
  mode: RequestMode;
  kinds: ExchangeKind[];
  status: RequestStatus;
  expiresAt: string;
  createdAt: string;
};

/** Подтверждённая связь организации с кабинетом другого аккаунта. */
export type ForeignLinkView = { id: string; cabinetName: string; kinds: ExchangeKind[]; since: string };

/** Ждущий запрос глазами владельца кабинета. */
export type IncomingRequestView = {
  id: string;
  requesterName: string;
  mode: RequestMode;
  kinds: ExchangeKind[];
  expiresAt: string;
  createdAt: string;
};

/** Участник обмена из другого аккаунта глазами владельца кабинета. */
export type ForeignMemberView = { id: string; organizationId: string; name: string; kinds: ExchangeKind[]; since: string };

export type ExchangeRequestsState = {
  outgoing: ExchangeRequestView[];
  foreignLinks: ForeignLinkView[];
  incoming: IncomingRequestView[];
  foreignMembers: ForeignMemberView[];
};

/** Запрос на странице подтверждения — только владельцу аккаунта кабинета. */
export type TokenRequestView = {
  request: {
    id: string;
    requesterName: string;
    requesterInn: string | null;
    mode: RequestMode;
    kinds: ExchangeKind[];
    status: RequestStatus;
    expiresAt: string;
    createdAt: string;
    /** Что разрешено — после подтверждения. */
    allowedKinds: ExchangeKind[];
  };
  cabinet: { id: string; name: string };
  /** Перенос: свои организации владельца, из которых можно взять данные. */
  sources: Array<{ id: string; name: string }>;
};

/** Письма и уведомления по действию: вызывается после ответа, не бросает. */
export type Notify = () => Promise<void>;

export type CreateRequestResult = {
  request: ExchangeRequestView;
  /** Сама ссылка — только в письме владельцу кабинета; маршрут её не отдаёт. */
  token: string;
  notify: Notify;
};

export type DecideRequestResult = { status: "approved" | "declined"; summary?: ExchangeSummary; notify: Notify };
export type EndRequestResult = { action: "cancelled" | "left" | "disconnected" };

const notFound = () => new DirectoryExchangeError(REQUEST_NOT_FOUND_MESSAGE, 404);
const modeOf = (value: string): RequestMode => (isRequestMode(value) ? value : "link");
const statusOf = (value: string): RequestStatus => (isRequestStatus(value) ? value : "expired");

/* ───────────────────────── журнал ───────────────────────── */

type RequestParties = {
  id: string;
  mode: string;
  kinds: readonly string[];
  masterOrganizationId: string;
  requesterOrganizationId: string;
  cabinetName: string;
  requesterName: string;
};

/**
 * Действие — в журнал обеих сторон (Р7). Имя и id того, кто действовал,
 * пишутся только в журнал его стороны: другой стороне он чужой человек.
 */
async function auditBoth(
  action: string,
  request: RequestParties,
  by: { side: "requester" | "cabinet"; actor: ExchangeActor },
  extra: Prisma.InputJsonObject = {},
): Promise<void> {
  const details: Prisma.InputJsonObject = {
    requestId: request.id,
    mode: request.mode,
    kinds: [...request.kinds],
    masterOrganizationId: request.masterOrganizationId,
    cabinetName: request.cabinetName,
    requesterOrganizationId: request.requesterOrganizationId,
    requesterName: request.requesterName,
    by: by.side,
    ...extra,
  };
  const sides = [
    { organizationId: request.requesterOrganizationId, own: by.side === "requester" },
    { organizationId: request.masterOrganizationId, own: by.side === "cabinet" },
  ];
  for (const side of sides) {
    try {
      await db.auditLog.create({
        data: {
          organizationId: side.organizationId,
          userId: side.own ? by.actor.userId : null,
          userName: side.own ? by.actor.userName : null,
          action: `directory_exchange.${action}`,
          entity: "directory_exchange_request",
          entityId: request.id,
          details,
        },
      });
    } catch (error) {
      console.error("[directory-exchange] request audit failed", { action, organizationId: side.organizationId, error });
    }
  }
}

/* ───────────────────────── письма и уведомления ───────────────────────── */

/** Рабочая почта человека; служебные адреса (`*.local.haccp`, `*.local`) — не почта. */
async function workEmailOf(userId: string | null | undefined): Promise<string | null> {
  if (!userId) return null;
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { email: true, contactEmail: true, isActive: true, archivedAt: true },
  });
  if (!user || !user.isActive || user.archivedAt) return null;
  return (
    [user.contactEmail, user.email]
      .map((value) => (value ?? "").trim())
      .find((value) => value.includes("@") && !isTechnicalEmail(value)) ?? null
  );
}

async function deliver(to: string, letter: RequestLetter): Promise<void> {
  const { renderEmailLayout, sendRawEmail } = await import("@/lib/email");
  await sendRawEmail(to, letter.subject, renderEmailLayout(letter.title, letter.body));
}

/** Письмо владельцу аккаунта кабинета: кто просит, что именно, кнопка «Открыть запрос» (Р3). */
function ownerRequestNotify(args: {
  ownerUserId: string;
  token: string;
  mode: RequestMode;
  kinds: readonly ExchangeKind[];
  cabinetName: string;
  requesterName: string;
  requesterInn: string | null;
  expiresAt: Date;
}): Notify {
  return async () => {
    try {
      const to = await workEmailOf(args.ownerUserId);
      if (!to) {
        console.info("[directory-exchange] request letter skipped: the cabinet owner has no work e-mail");
        return;
      }
      await deliver(to, ownerRequestLetter({ ...args, url: `${APP_URL}/exchange-request/${encodeURIComponent(args.token)}` }));
    } catch (error) {
      console.error("[directory-exchange] request letter failed", error);
    }
  };
}

/** Счётчики организации-заявителя из итога (в итоге кабинета есть и другие участники — они заявителю не сообщаются). */
function requesterCounters(summary: ExchangeSummary | undefined, organizationId: string): ExchangeCounters | null {
  const own = summary?.organizations.find((organization) => organization.organizationId === organizationId);
  return own ? summaryTotals({ organizations: [own], notes: [] }) : null;
}

/** Решение по запросу: уведомление руководству организации-заявителя и письмо тому, кто запрашивал (Р6). */
function requesterDecisionNotify(args: {
  requestId: string;
  requesterOrganizationId: string;
  requestedByUserId: string;
  mode: RequestMode;
  cabinetName: string;
  requesterName: string;
  status: "approved" | "declined";
  allowedKinds: readonly ExchangeKind[];
  summary?: ExchangeSummary;
}): Notify {
  return async () => {
    const approved = args.status === "approved";
    const counters = approved ? requesterCounters(args.summary, args.requesterOrganizationId) : null;
    const lists = exchangeKindsLabel(args.allowedKinds);

    try {
      const { notifyManagement } = await import("@/lib/notifications");
      await notifyManagement({
        organizationId: args.requesterOrganizationId,
        kind: NOTIFICATION_KIND,
        dedupeKey: `${NOTIFICATION_KIND}:${args.requestId}`,
        title: decisionTitle(args.status),
        linkHref: EXCHANGE_PAGE_HREF,
        linkLabel: "Открыть",
        items: [
          {
            id: args.requestId,
            label: decisionNotificationLabel(args),
            ...(approved ? { hint: counters ? `${lists}: ${countersLine(counters)}` : lists } : {}),
          },
        ],
      });
    } catch (error) {
      console.error("[directory-exchange] decision notification failed", error);
    }

    try {
      const to = await workEmailOf(args.requestedByUserId);
      if (!to) {
        console.info("[directory-exchange] decision letter skipped: the requester has no work e-mail");
        return;
      }
      await deliver(to, requesterDecisionLetter({ ...args, url: `${APP_URL}${EXCHANGE_PAGE_HREF}`, counters }));
    } catch (error) {
      console.error("[directory-exchange] decision letter failed", error);
    }
  };
}

/* ───────────────────────── чтение ───────────────────────── */

/** Открытые запросы с истёкшим сроком становятся `expired` — лениво, при чтении. */
async function expireStale(where: Prisma.DirectoryExchangeRequestWhereInput, now: Date): Promise<void> {
  await db.directoryExchangeRequest.updateMany({
    where: { ...where, status: "pending", expiresAt: { lte: now } },
    data: { status: "expired" },
  });
}

const REQUEST_SELECT = {
  id: true,
  mode: true,
  kinds: true,
  status: true,
  expiresAt: true,
  createdAt: true,
  allowedKinds: true,
  requestedByUserId: true,
  masterOrganizationId: true,
  requesterOrganizationId: true,
  masterOrganization: {
    select: { id: true, name: true, accountId: true, kind: true, account: { select: { ownerUserId: true } } },
  },
  requesterOrganization: { select: { id: true, name: true, inn: true, isDemo: true, kind: true } },
} as const satisfies Prisma.DirectoryExchangeRequestSelect;

type RequestRow = Prisma.DirectoryExchangeRequestGetPayload<{ select: typeof REQUEST_SELECT }>;

function partiesOf(row: RequestRow): RequestParties {
  return {
    id: row.id,
    mode: row.mode,
    kinds: row.kinds,
    masterOrganizationId: row.masterOrganizationId,
    requesterOrganizationId: row.requesterOrganizationId,
    cabinetName: row.masterOrganization.name,
    requesterName: row.requesterOrganization.name,
  };
}

function requestView(row: {
  id: string;
  mode: string;
  kinds: string[];
  status: string;
  expiresAt: Date;
  createdAt: Date;
  masterOrganization: { name: string };
}): ExchangeRequestView {
  return {
    id: row.id,
    cabinetName: row.masterOrganization.name,
    mode: modeOf(row.mode),
    kinds: normalizeExchangeKinds(row.kinds),
    status: statusOf(row.status),
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Запросы и связи с чужими аккаунтами для окна и карточки обмена.
 * `outgoing` (ждущие запросы) и `foreignLinks` — активной организации;
 * `incoming` (ждущие запросы) и `foreignMembers` — кабинетов аккаунта.
 * Всё — только владельцу аккаунта активной организации; остальным
 * (руководитель без прав владельца, «войти как») — пустые списки.
 */
export async function loadExchangeRequests(
  userId: string,
  organizationId: string,
  options: { sessionAllows?: boolean; now?: Date } = {},
): Promise<ExchangeRequestsState> {
  const empty: ExchangeRequestsState = { outgoing: [], foreignLinks: [], incoming: [], foreignMembers: [] };
  if (options.sessionAllows === false) return empty;
  const now = options.now ?? new Date();
  const organization = await db.organization.findUnique({
    where: { id: organizationId },
    select: { id: true, accountId: true, isDemo: true, kind: true, account: { select: { ownerUserId: true } } },
  });
  const accountId = organization?.accountId;
  if (!organization || !accountId || organization.account?.ownerUserId !== userId) return empty;

  const ownCabinets = { accountId, kind: MASTER_ORG_KIND };
  await expireStale({ OR: [{ requesterOrganizationId: organization.id }, { masterOrganization: ownCabinets }] }, now);

  // Демо и сам кабинет запросов не отправляют и участниками не бывают.
  const asRequester = !organization.isDemo && organization.kind !== MASTER_ORG_KIND;
  const [outgoing, links, incoming, members] = await Promise.all([
    asRequester
      ? db.directoryExchangeRequest.findMany({
          where: { requesterOrganizationId: organization.id, status: "pending" },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 50,
          select: { id: true, mode: true, kinds: true, status: true, expiresAt: true, createdAt: true, masterOrganization: { select: { name: true } } },
        })
      : [],
    asRequester
      ? db.directoryExchangeMember.findMany({
          where: { organizationId: organization.id, foreign: true },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: { id: true, kinds: true, createdAt: true, masterOrganization: { select: { name: true } } },
        })
      : [],
    db.directoryExchangeRequest.findMany({
      where: { masterOrganization: ownCabinets, status: "pending" },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 100,
      select: { id: true, mode: true, kinds: true, expiresAt: true, createdAt: true, requesterOrganization: { select: { name: true } } },
    }),
    db.directoryExchangeMember.findMany({
      where: { foreign: true, masterOrganization: ownCabinets },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, organizationId: true, kinds: true, createdAt: true, organization: { select: { name: true } } },
    }),
  ]);

  return {
    outgoing: outgoing.map(requestView),
    foreignLinks: links.map((link) => ({
      id: link.id,
      cabinetName: link.masterOrganization.name,
      kinds: normalizeExchangeKinds(link.kinds),
      since: link.createdAt.toISOString(),
    })),
    incoming: incoming.map((row) => ({
      id: row.id,
      requesterName: row.requesterOrganization.name,
      mode: modeOf(row.mode),
      kinds: normalizeExchangeKinds(row.kinds),
      expiresAt: row.expiresAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
    })),
    foreignMembers: members.map((member) => ({
      id: member.id,
      organizationId: member.organizationId,
      name: member.organization.name,
      kinds: normalizeExchangeKinds(member.kinds),
      since: member.createdAt.toISOString(),
    })),
  };
}

/* ───────────────────────── создание ───────────────────────── */

/**
 * Кабинет по коду. Адресат запроса — кабинет обмена аккаунта (самый ранний,
 * тот же, что в `settings.server.ts`): в нём участвуют организации владельца,
 * и только с ним связь имеет смысл; код любого кабинета аккаунта ведёт к нему.
 * Нет кабинета, он демо, у аккаунта нет владельца — null: вызывающий отвечает
 * одним и тем же «не найден».
 */
async function findCabinetByCode(rawCode: unknown) {
  const code = normalizeServiceCode(rawCode);
  if (!code) return null;
  const byCode = await db.organization.findFirst({
    where: { serviceCode: code, kind: MASTER_ORG_KIND, isDemo: false, accountId: { not: null } },
    select: { accountId: true },
  });
  if (!byCode?.accountId) return null;
  const exchange = await findExchangeCabinet(byCode.accountId);
  if (!exchange) return null;
  const cabinet = await db.organization.findUnique({
    where: { id: exchange.id },
    select: { id: true, name: true, accountId: true, isDemo: true, account: { select: { ownerUserId: true } } },
  });
  if (!cabinet?.accountId || cabinet.isDemo || !cabinet.account?.ownerUserId) return null;
  return { id: cabinet.id, name: cabinet.name, accountId: cabinet.accountId, ownerUserId: cabinet.account.ownerUserId };
}

/**
 * Создать запрос по коду мастер-кабинета (Р1, Р2). `organizationId` —
 * активная организация заявителя, `actor` — владелец её аккаунта.
 * Отказы — `DirectoryExchangeError`: 400 — не выбраны списки или режим,
 * 402 — аккаунт не на платном тарифе, 403 — не владелец аккаунта, 404 — кабинет
 * не найден, 409 — свой кабинет, уже участник, уже есть открытый запрос,
 * организация закрыта; 429 — суточный лимит.
 */
export async function createExchangeRequest(input: {
  organizationId: string;
  actor: ExchangeActor;
  code: unknown;
  mode: unknown;
  kinds: unknown;
  now?: Date;
}): Promise<CreateRequestResult> {
  const now = input.now ?? new Date();
  if (!isRequestMode(input.mode)) throw new DirectoryExchangeError("Выберите: связь или разовый перенос", 400);
  const mode = input.mode;

  const requester = await db.organization.findUnique({
    where: { id: input.organizationId },
    select: { id: true, name: true, inn: true, accountId: true, isDemo: true, kind: true, account: { select: { ownerUserId: true } } },
  });
  if (!requester) throw new DirectoryExchangeError("Организация не найдена", 404);
  const accountId = requester.accountId;
  if (!accountId || requester.account?.ownerUserId !== input.actor.userId || requester.isDemo || requester.kind === MASTER_ORG_KIND) {
    throw new DirectoryExchangeError(OWNER_ONLY_MESSAGE, 403);
  }
  if (await isOrganizationLocked(requester.id, now)) {
    throw new DirectoryExchangeError(ORG_LOCKED_MESSAGE, 409, ORG_LOCKED_CODE);
  }

  const billing = await loadAccountBilling(requester.id, now);
  const phase = billing ? phaseOfKind(billing.state.kind) : "open";
  const accountRequests = { requesterOrganization: { accountId } };
  const requestsSince = new Date(now.getTime() - REQUEST_DAY_MS);
  const countToday = () =>
    db.directoryExchangeRequest.count({ where: { ...accountRequests, createdAt: { gt: requestsSince } } });
  const refuse = (decision: Extract<ReturnType<typeof decideRequestCreation>, { ok: false }>) =>
    new DirectoryExchangeError(decision.message, decision.status, `request_${decision.reason}`);

  // Сначала то, что зависит только от заявителя: списки, тариф, суточный
  // лимит. Кому запросы недоступны, тот не узнаёт даже, есть ли такой код.
  const own = decideRequestCreation({
    phase,
    kinds: input.kinds,
    requestsToday: await countToday(),
    sameAccount: false,
    hasOpenRequest: false,
    alreadyMember: false,
  });
  if (!own.ok) throw refuse(own);

  const cabinet = await findCabinetByCode(input.code);
  if (!cabinet) throw new DirectoryExchangeError(CABINET_NOT_FOUND_MESSAGE, 404);

  // Один создатель на аккаунт одновременно: два быстрых нажатия не заводят
  // два открытых запроса и не обходят суточный лимит.
  const locked = await withAdvisoryTryLock(
    advisoryLockKey("directory-exchange-request", accountId),
    async () => {
      const pair = { masterOrganizationId: cabinet.id, requesterOrganizationId: requester.id };
      await expireStale(pair, now);
      const [requestsToday, open, member] = await Promise.all([
        countToday(),
        db.directoryExchangeRequest.findFirst({ where: { ...pair, status: "pending" }, select: { id: true } }),
        db.directoryExchangeMember.findUnique({
          where: { masterOrganizationId_organizationId: { masterOrganizationId: cabinet.id, organizationId: requester.id } },
          select: { id: true },
        }),
      ]);
      const decision = decideRequestCreation({
        phase,
        kinds: input.kinds,
        requestsToday,
        sameAccount: cabinet.accountId === accountId,
        hasOpenRequest: Boolean(open),
        alreadyMember: Boolean(member),
      });
      if (!decision.ok) throw refuse(decision);

      const token = generateInviteToken();
      const created = await db.directoryExchangeRequest.create({
        data: {
          ...pair,
          requestedByUserId: input.actor.userId,
          mode,
          kinds: decision.kinds,
          tokenHash: hashInviteToken(token),
          expiresAt: requestExpiresAt(now),
          createdAt: now,
        },
        select: { id: true, mode: true, kinds: true, status: true, expiresAt: true, createdAt: true },
      });
      return { created, token, kinds: decision.kinds };
    },
    { attempts: 20, delayMs: 150, timeoutMs: 30_000 },
  );
  if (!locked.acquired) throw new DirectoryExchangeError(CREATE_BUSY_MESSAGE, 409);
  const { created, token, kinds } = locked.value;

  await auditBoth(
    "request_created",
    {
      id: created.id,
      mode,
      kinds,
      masterOrganizationId: cabinet.id,
      requesterOrganizationId: requester.id,
      cabinetName: cabinet.name,
      requesterName: requester.name,
    },
    { side: "requester", actor: input.actor },
    { expiresAt: created.expiresAt.toISOString() },
  );

  return {
    request: requestView({ ...created, masterOrganization: { name: cabinet.name } }),
    token,
    notify: ownerRequestNotify({
      ownerUserId: cabinet.ownerUserId,
      token,
      mode,
      kinds,
      cabinetName: cabinet.name,
      requesterName: requester.name,
      requesterInn: requester.inn,
      expiresAt: created.expiresAt,
    }),
  };
}

/* ───────────────────────── отмена, выход, отключение ───────────────────────── */

/** Убрать участника из другого аккаунта из обмена кабинета вместе с его соответствиями. Данные остаются у обеих сторон. */
async function removeForeignMember(masterOrganizationId: string, organizationId: string): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const members = await tx.directoryExchangeMember.deleteMany({ where: { masterOrganizationId, organizationId, foreign: true } });
    // Соответствия уходят только вместе с участником: у участника своего
    // аккаунта (не `foreign`) этот путь не трогает ничего.
    if (members.count === 0) return false;
    await tx.directoryExchangeLink.deleteMany({ where: { masterOrganizationId, organizationId } });
    return true;
  });
}

/**
 * `DELETE /requests/[id]`. Заявитель (активная организация): отменить ждущий
 * запрос или выйти из подтверждённой связи. Владелец кабинета: отключить
 * участника из другого аккаунта. `id` — id запроса, id связи
 * (`foreignLinks[].id`, `foreignMembers[].id`) или, для владельца кабинета,
 * id организации-участника (`foreignMembers[].organizationId`).
 * Чужое и несуществующее — одно и то же 404.
 */
export async function endExchangeRequest(input: {
  id: string;
  /** Активная организация вызывающего. */
  organizationId: string;
  /** Аккаунт, владелец которого — вызывающий. */
  accountId: string;
  actor: ExchangeActor;
  now?: Date;
}): Promise<EndRequestResult> {
  const now = input.now ?? new Date();
  const { id, organizationId, accountId, actor } = input;

  const endLink = async (
    link: { masterOrganizationId: string; organizationId: string; cabinetName: string; requesterName: string; kinds: readonly string[] },
    side: "requester" | "cabinet",
    requestId: string | null,
  ): Promise<EndRequestResult> => {
    if (!(await removeForeignMember(link.masterOrganizationId, link.organizationId))) {
      throw new DirectoryExchangeError(LINK_ENDED_MESSAGE, 409);
    }
    // Запись журнала привязана к запросу, которым связь была установлена.
    const origin =
      requestId ??
      (
        await db.directoryExchangeRequest.findFirst({
          where: {
            masterOrganizationId: link.masterOrganizationId,
            requesterOrganizationId: link.organizationId,
            mode: "link",
            status: "approved",
          },
          orderBy: { decidedAt: "desc" },
          select: { id: true },
        })
      )?.id ??
      `${link.masterOrganizationId}:${link.organizationId}`;
    await auditBoth(
      side === "requester" ? "request_left" : "request_disconnected",
      {
        id: origin,
        mode: "link",
        kinds: link.kinds,
        masterOrganizationId: link.masterOrganizationId,
        requesterOrganizationId: link.organizationId,
        cabinetName: link.cabinetName,
        requesterName: link.requesterName,
      },
      { side, actor },
    );
    return { action: side === "requester" ? "left" : "disconnected" };
  };

  const request = await db.directoryExchangeRequest.findUnique({ where: { id }, select: REQUEST_SELECT });
  if (request) {
    const requesterSide = request.requesterOrganizationId === organizationId;
    const cabinetSide = !requesterSide && request.masterOrganization.accountId === accountId;
    if (!requesterSide && !cabinetSide) throw notFound();

    if (request.status === "pending") {
      if (isRequestStale(request.status, request.expiresAt, now)) {
        await expireStale({ id: request.id }, now);
        throw new DirectoryExchangeError("Срок запроса уже истёк", 409);
      }
      // Ждущий запрос владелец кабинета решает на странице запроса, а не здесь.
      if (!requesterSide) {
        throw new DirectoryExchangeError("Подтвердить или отклонить запрос можно на его странице", 409);
      }
      const cancelled = await db.directoryExchangeRequest.updateMany({
        where: { id: request.id, status: "pending" },
        data: { status: "cancelled", decidedAt: now },
      });
      if (cancelled.count === 0) throw new DirectoryExchangeError(CLOSED_MESSAGE, 409);
      await auditBoth("request_cancelled", partiesOf(request), { side: "requester", actor });
      return { action: "cancelled" };
    }
    if (request.status === "approved" && request.mode === "link") {
      return endLink(
        {
          masterOrganizationId: request.masterOrganizationId,
          organizationId: request.requesterOrganizationId,
          cabinetName: request.masterOrganization.name,
          requesterName: request.requesterOrganization.name,
          kinds: request.allowedKinds,
        },
        requesterSide ? "requester" : "cabinet",
        request.id,
      );
    }
    throw new DirectoryExchangeError(CLOSED_MESSAGE, 409);
  }

  // Не запрос — связь: её id либо (для владельца кабинета) id организации-участника.
  const member = await db.directoryExchangeMember.findFirst({
    where: {
      foreign: true,
      OR: [
        { id, organizationId },
        { id, masterOrganization: { accountId, kind: MASTER_ORG_KIND } },
        { organizationId: id, masterOrganization: { accountId, kind: MASTER_ORG_KIND } },
      ],
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      masterOrganizationId: true,
      organizationId: true,
      kinds: true,
      masterOrganization: { select: { name: true } },
      organization: { select: { name: true } },
    },
  });
  if (!member) throw notFound();
  return endLink(
    {
      masterOrganizationId: member.masterOrganizationId,
      organizationId: member.organizationId,
      cabinetName: member.masterOrganization.name,
      requesterName: member.organization.name,
      kinds: member.kinds,
    },
    member.organizationId === organizationId ? "requester" : "cabinet",
    null,
  );
}

/* ───────────────────────── страница запроса ───────────────────────── */

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

/**
 * Запрос по ссылке из письма и то, владелец ли кабинета его открывает.
 * Владелец может открыть запрос и по его id — так на страницу ведёт карточка
 * «Входящие запросы» (сам токен в базе не хранится). Постороннему id не
 * говорит ничего: 404, как и неизвестная ссылка; с настоящей ссылкой не
 * владелец получает 403 (`decideRequestDecision` → `not_owner`).
 */
async function findRequest(tokenOrId: string, userId: string): Promise<{ request: RequestRow; isCabinetOwner: boolean }> {
  const value = tokenOrId.trim();
  if (!TOKEN_PATTERN.test(value)) throw notFound();
  const isOwner = (row: RequestRow) =>
    row.masterOrganization.kind === MASTER_ORG_KIND && row.masterOrganization.account?.ownerUserId === userId;

  const byToken = await db.directoryExchangeRequest.findUnique({
    where: { tokenHash: hashInviteToken(value) },
    select: REQUEST_SELECT,
  });
  if (byToken) return { request: byToken, isCabinetOwner: isOwner(byToken) };
  const byId = await db.directoryExchangeRequest.findUnique({ where: { id: value }, select: REQUEST_SELECT });
  if (!byId || !isOwner(byId)) throw notFound();
  return { request: byId, isCabinetOwner: true };
}

/** Рабочие организации аккаунта кабинета, из которых можно взять данные: не закрытые. */
async function transferSources(accountId: string, now: Date): Promise<Array<{ id: string; name: string }>> {
  const organizations = await db.organization.findMany({
    where: { accountId, isDemo: false, ...NOT_DIRECTORY_ORG_WHERE },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, name: true },
  });
  const open: Array<{ id: string; name: string }> = [];
  for (const organization of organizations) {
    if (!(await isOrganizationLocked(organization.id, now))) open.push(organization);
  }
  return open;
}

/**
 * `GET /api/exchange-requests/[token]` — запрос для страницы подтверждения.
 * Только владельцу аккаунта кабинета: 403 остальным, 404 на неизвестную ссылку.
 */
export async function loadExchangeRequestByToken(input: {
  token: string;
  userId: string;
  now?: Date;
}): Promise<TokenRequestView> {
  const now = input.now ?? new Date();
  const { request, isCabinetOwner } = await findRequest(input.token, input.userId);
  if (!isCabinetOwner) throw new DirectoryExchangeError(REQUEST_NOT_OWNER_MESSAGE, 403, "request_not_owner");
  let status = statusOf(request.status);
  if (isRequestStale(request.status, request.expiresAt, now)) {
    await expireStale({ id: request.id }, now);
    status = "expired";
  }
  const mode = modeOf(request.mode);
  const accountId = request.masterOrganization.accountId;
  return {
    request: {
      id: request.id,
      requesterName: request.requesterOrganization.name,
      requesterInn: request.requesterOrganization.inn?.trim() || null,
      mode,
      kinds: normalizeExchangeKinds(request.kinds),
      status,
      expiresAt: request.expiresAt.toISOString(),
      createdAt: request.createdAt.toISOString(),
      allowedKinds: normalizeExchangeKinds(request.allowedKinds),
    },
    cabinet: { id: request.masterOrganization.id, name: request.masterOrganization.name },
    sources: mode === "transfer" && status === "pending" && accountId ? await transferSources(accountId, now) : [],
  };
}

/* ───────────────────────── решение ───────────────────────── */

/**
 * Подтверждённая связь (Р4): организация-заявитель — участник обмена кабинета
 * с разрешёнными списками и пометкой `foreign`; обмен запускается сразу.
 * К общим меню и сырью кабинета она НЕ подключается — это другой доступ.
 */
async function approveLink(
  request: RequestRow,
  allowed: ExchangeKind[],
  actor: ExchangeActor,
  now: Date,
): Promise<ExchangeSummary> {
  const masterOrganizationId = request.masterOrganizationId;
  await db.directoryExchangeMember.upsert({
    where: {
      masterOrganizationId_organizationId: { masterOrganizationId, organizationId: request.requesterOrganizationId },
    },
    create: {
      masterOrganizationId,
      organizationId: request.requesterOrganizationId,
      kinds: allowed,
      foreign: true,
      createdByUserId: actor.userId,
    },
    update: { kinds: allowed, foreign: true },
  });

  try {
    return await runDirectoryExchange(masterOrganizationId, { actor, now });
  } catch (error) {
    // Связь уже установлена: обмен пройдёт при следующей синхронизации.
    const busy = error instanceof DirectoryExchangeError && error.code === EXCHANGE_BUSY_CODE;
    if (!busy) console.error("[directory-exchange] first exchange with a foreign member failed", { masterOrganizationId, error });
    return {
      ...emptySummary(),
      notes: [
        busy
          ? `Связь установлена. ${(error as Error).message}`
          : "Связь установлена. Первый обмен не удался — он повторится при следующей синхронизации.",
      ],
    };
  }
}

/**
 * `POST /api/exchange-requests/[token]` — решение владельца аккаунта кабинета.
 * Подтверждение: `allowedKinds` — что он разрешает (не шире запрошенного, по
 * умолчанию всё запрошенное); для переноса `sourceOrganizationId` — своя
 * организация-источник. Отказы: 400 — нечего разрешать или не выбран
 * источник, 403 — не владелец, 404 — ссылка или источник не найдены, 409 —
 * решение уже принято, запрос отменён или истёк, организация закрыта.
 */
export async function decideExchangeRequest(input: {
  token: string;
  actor: ExchangeActor;
  decision: "approve" | "decline";
  allowedKinds?: unknown;
  sourceOrganizationId?: string | null;
  now?: Date;
}): Promise<DecideRequestResult> {
  const now = input.now ?? new Date();
  const { actor } = input;
  const { request, isCabinetOwner } = await findRequest(input.token, actor.userId);
  const verdict = decideRequestDecision({ status: request.status, expiresAt: request.expiresAt, now, isCabinetOwner });
  // Срок вышел — запрос закрывается при первом же обращении владельца.
  if (isCabinetOwner && isRequestStale(request.status, request.expiresAt, now)) await expireStale({ id: request.id }, now);
  if (!verdict.ok) throw new DirectoryExchangeError(verdict.message, verdict.status, `request_${verdict.reason}`);
  const alreadyDecided = () => new DirectoryExchangeError("По этому запросу решение уже принято", 409, "request_decided");

  const mode = modeOf(request.mode);
  const parties = partiesOf(request);
  const notifyBase = {
    requestId: request.id,
    requesterOrganizationId: request.requesterOrganizationId,
    requestedByUserId: request.requestedByUserId,
    mode,
    cabinetName: request.masterOrganization.name,
    requesterName: request.requesterOrganization.name,
  };
  // Решение принимается один раз: статус меняется, только пока запрос ждёт.
  const stillPending = { id: request.id, status: "pending", expiresAt: { gt: now } };

  if (input.decision === "decline") {
    const declined = await db.directoryExchangeRequest.updateMany({
      where: stillPending,
      data: { status: "declined", decidedAt: now, decidedByUserId: actor.userId },
    });
    if (declined.count === 0) throw alreadyDecided();
    await auditBoth("request_declined", parties, { side: "cabinet", actor });
    return { status: "declined", notify: requesterDecisionNotify({ ...notifyBase, status: "declined", allowedKinds: [] }) };
  }

  const allowed = narrowAllowedKinds(request.kinds, input.allowedKinds);
  if (!allowed) throw new DirectoryExchangeError("Отметьте хотя бы один список из запрошенных", 400);

  const requester = request.requesterOrganization;
  if (requester.isDemo || requester.kind === MASTER_ORG_KIND) {
    throw new DirectoryExchangeError("Организация заявителя больше не может участвовать в обмене", 409);
  }
  if (await isOrganizationLocked(requester.id, now)) {
    throw new DirectoryExchangeError("Организация заявителя сейчас не может принять данные. Запрос остаётся открытым до конца срока.", 409);
  }

  let sourceOrganizationId: string | null = null;
  if (mode === "transfer") {
    const wanted = input.sourceOrganizationId?.trim();
    if (!wanted) throw new DirectoryExchangeError("Выберите организацию, из которой взять данные", 400);
    // Источник — только своя рабочая организация: аккаунта, которому принадлежит кабинет.
    const source = request.masterOrganization.accountId
      ? await db.organization.findFirst({
          where: { id: wanted, accountId: request.masterOrganization.accountId, isDemo: false, ...NOT_DIRECTORY_ORG_WHERE },
          select: { id: true },
        })
      : null;
    if (!source) throw new DirectoryExchangeError("Организация не найдена", 404);
    if (await isOrganizationLocked(source.id, now)) {
      throw new DirectoryExchangeError(ORG_LOCKED_MESSAGE, 409, ORG_LOCKED_CODE);
    }
    sourceOrganizationId = source.id;
  }

  const claimed = await db.directoryExchangeRequest.updateMany({
    where: stillPending,
    data: { status: "approved", decidedAt: now, decidedByUserId: actor.userId, allowedKinds: allowed, sourceOrganizationId },
  });
  if (claimed.count === 0) throw alreadyDecided();

  let summary: ExchangeSummary;
  try {
    if (mode === "link") {
      summary = await approveLink(request, allowed, actor, now);
    } else {
      const selection: TransferSelection = {};
      for (const kind of allowed) selection[kind] = "all";
      summary = await transferOnce({
        fromOrganizationId: sourceOrganizationId!,
        toOrganizationId: requester.id,
        selection,
        actor,
        // Единственное место, где перенос между аккаунтами разрешён: его
        // только что подтвердил владелец источника.
        crossAccount: true,
        now,
      });
    }
  } catch (error) {
    // Ничего не передано — запрос снова ждёт решения, владелец может повторить.
    await db.directoryExchangeRequest
      .updateMany({
        where: { id: request.id, status: "approved" },
        data: { status: "pending", decidedAt: null, decidedByUserId: null, allowedKinds: [], sourceOrganizationId: null },
      })
      .catch((revertError) => console.error("[directory-exchange] request revert failed", { id: request.id, revertError }));
    throw error;
  }

  await db.directoryExchangeRequest
    .update({ where: { id: request.id }, data: { resultJson: summary as unknown as Prisma.InputJsonObject } })
    .catch((error) => console.error("[directory-exchange] request result not saved", { id: request.id, error }));
  await auditBoth("request_approved", parties, { side: "cabinet", actor }, {
    allowedKinds: allowed,
    ...(sourceOrganizationId ? { sourceOrganizationId } : {}),
  });
  return {
    status: "approved",
    summary,
    notify: requesterDecisionNotify({ ...notifyBase, status: "approved", allowedKinds: allowed, summary }),
  };
}
