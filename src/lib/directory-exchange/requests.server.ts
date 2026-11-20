import type { Prisma } from "@prisma/client";

import { advisoryLockKey, withAdvisoryTryLock } from "@/lib/advisory-lock";
import { loadAccountBilling } from "@/lib/billing.server";
import { db } from "@/lib/db";
import { DirectoryExchangeError } from "@/lib/directory-exchange/errors";
import { EXCHANGE_KINDS, normalizeExchangeKinds, type ExchangeKind } from "@/lib/directory-exchange/kinds";
import {
  countersLine,
  decisionNotificationLabel,
  decisionTitle,
  ownerRequestLetter,
  ownerRequestNotice,
  requesterDecisionLetter,
  type RequestLetter,
} from "@/lib/directory-exchange/request-letters";
import {
  REQUEST_DAY_MS,
  REQUEST_NOT_OWNER_MESSAGE,
  decideRequestApproval,
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
  exchangeAccountKey,
  runDirectoryExchangeWithin,
  transferOnce,
  withExchangeLock,
  type ExchangeActor,
  type ExchangeRunOutcome,
  type TransferSelection,
} from "@/lib/directory-exchange/run.server";
import { acceptsLegacyExchangeCode, findExchangeCabinet } from "@/lib/directory-exchange/settings.server";
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
 *   • заявителю и после подтверждения известно только название кабинета:
 *     ни названий, ни id организаций владельца (и самого кабинета) нет ни в
 *     журнале его организации, ни в письме, ни в уведомлении;
 *   • у кабинета одна чужая компания: связь со второй подтвердить нельзя,
 *     пока есть первая (`decideRequestApproval`);
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
/** Колокольчик и Telegram владельцу кабинета о новом запросе — один раз на запрос. */
const OWNER_NOTIFICATION_KIND = "directory_exchange.request_incoming";

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
  /**
   * Свои рабочие организации владельца кабинета: для переноса — откуда взять
   * данные, для связи — какие из них будут обмениваться с заявителем.
   */
  sources: Array<{ id: string; name: string }>;
  /** Связь: свои организации, которые уже обмениваются запрошенными списками (отмечены по умолчанию). */
  linkedIds: string[];
};

/** Письма и уведомления по действию: вызывается после ответа, не бросает. */
export type Notify = () => Promise<void>;

export type CreateRequestResult = {
  request: ExchangeRequestView;
  /** Сама ссылка — только в письме владельцу кабинета; маршрут её не отдаёт. */
  token: string;
  notify: Notify;
};

export type DecideRequestResult = {
  status: "approved" | "declined";
  summary?: ExchangeSummary;
  /** Первый обмен не уложился в ожидание и идёт в фоне: итог — в карточке, письмо заявителю — после него. */
  running?: boolean;
  /** Письмо и уведомление заявителю; при `running` сначала дожидается обмена. Вызывать в `after()`. */
  notify: Notify;
};
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
 * В журнал заявителя не попадает ничего об организациях владельца кабинета,
 * кроме названия кабинета: ни id кабинета, ни то, что передано в
 * `cabinetOnly` (например, из какой организации владелец разрешил перенос).
 */
async function auditBoth(
  action: string,
  request: RequestParties,
  by: { side: "requester" | "cabinet"; actor: ExchangeActor },
  extra: Prisma.InputJsonObject = {},
  cabinetOnly: Prisma.InputJsonObject = {},
): Promise<void> {
  const shared: Prisma.InputJsonObject = {
    requestId: request.id,
    mode: request.mode,
    kinds: [...request.kinds],
    cabinetName: request.cabinetName,
    requesterOrganizationId: request.requesterOrganizationId,
    requesterName: request.requesterName,
    by: by.side,
    ...extra,
  };
  const sides = [
    { organizationId: request.requesterOrganizationId, own: by.side === "requester", details: shared },
    {
      organizationId: request.masterOrganizationId,
      own: by.side === "cabinet",
      details: { ...shared, masterOrganizationId: request.masterOrganizationId, ...cabinetOnly },
    },
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
          details: side.details,
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

/**
 * Владельцу аккаунта кабинета о новом запросе: письмо с кнопкой «Открыть
 * запрос» (Р3), колокольчик в его домашней организации и Telegram (Р4 серии
 * A). Ссылки колокольчика и Telegram — по номеру запроса (страница откроет его
 * только владельцу), токен живёт только в письме. Каждый канал — отдельно:
 * сбой одного не мешает остальным и не ломает запрос.
 */
function ownerRequestNotify(args: {
  requestId: string;
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

    const notice = ownerRequestNotice(args);
    const href = `/exchange-request/${encodeURIComponent(args.requestId)}`;
    const dedupeKey = `${OWNER_NOTIFICATION_KIND}:${args.requestId}`;
    let homeOrganizationId: string | null = null;
    try {
      const owner = await db.user.findUnique({
        where: { id: args.ownerUserId },
        select: { organizationId: true, isActive: true, archivedAt: true },
      });
      if (owner?.isActive && !owner.archivedAt) {
        homeOrganizationId = owner.organizationId;
        const { upsertNotification } = await import("@/lib/notifications");
        await upsertNotification({
          organizationId: owner.organizationId,
          userId: args.ownerUserId,
          kind: OWNER_NOTIFICATION_KIND,
          dedupeKey,
          title: notice.title,
          linkHref: href,
          linkLabel: "Открыть запрос",
          items: [{ id: args.requestId, label: notice.label, hint: notice.hint }],
        });
      }
    } catch (error) {
      console.error("[directory-exchange] request notification failed", error);
    }
    if (!homeOrganizationId) return;
    try {
      const { notifyEmployee } = await import("@/lib/telegram");
      // Без привязанного Telegram `notifyEmployee` молча ничего не шлёт; push
      // в приложение уже ушёл вместе с колокольчиком.
      await notifyEmployee(
        args.ownerUserId,
        notice.telegramText,
        { label: "Открыть запрос", miniAppUrl: `${APP_URL}${href}` },
        {
          appPush: false,
          delivery: { organizationId: homeOrganizationId, kind: OWNER_NOTIFICATION_KIND, dedupeKey },
          // Об одном запросе — одно сообщение, даже если отправка повторится.
          policy: { skipOnRerun: true },
        },
      );
    } catch (error) {
      console.error("[directory-exchange] request telegram failed", error);
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
  requesterOrganization: { select: { id: true, name: true, inn: true, isDemo: true, kind: true, accountId: true } },
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
 * Аккаунт, которому принадлежит мастер-кабинет с таким кодом. Код для
 * запросов — `exchangeCode` кабинета (серия B, Р13). Прежние коды действуют,
 * пока владелец не выдал новый (`acceptsLegacyExchangeCode`): собственный код
 * кабинета (`serviceCode`) либо, у кабинетов постарше, код пула, к которому он
 * подключён (`linkedServiceCode`): именно его такой кабинет и показывал своему
 * владельцу. Только организации вида «мастер-кабинет»: обычная организация с
 * тем же кодом пула кабинетом не считается. Код пула не уникален — если им
 * пользуются кабинеты разных аккаунтов, адресат неясен, и это «не найден».
 */
async function cabinetAccountByCode(code: string): Promise<string | null> {
  const cabinets = { kind: MASTER_ORG_KIND, isDemo: false, accountId: { not: null } } as const;
  const current = await db.organization.findFirst({ where: { ...cabinets, exchangeCode: code }, select: { accountId: true } });
  if (current?.accountId) return current.accountId;
  const own = await db.organization.findFirst({ where: { ...cabinets, serviceCode: code }, select: { accountId: true } });
  if (own?.accountId) return (await acceptsLegacyExchangeCode(own.accountId)) ? own.accountId : null;
  const linked = await db.organization.findMany({
    where: { ...cabinets, linkedServiceCode: code },
    select: { accountId: true },
    take: 20,
  });
  const accounts = new Set(linked.map((organization) => organization.accountId));
  const [only] = accounts;
  return accounts.size === 1 && only && (await acceptsLegacyExchangeCode(only)) ? only : null;
}

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
  const cabinetAccountId = await cabinetAccountByCode(code);
  if (!cabinetAccountId) return null;
  const exchange = await findExchangeCabinet(cabinetAccountId);
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
 * владелец кабинета недавно отклонил запрос аккаунта, организация закрыта;
 * 429 — суточный лимит.
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
      const [requestsToday, open, member, declined] = await Promise.all([
        countToday(),
        db.directoryExchangeRequest.findFirst({ where: { ...pair, status: "pending" }, select: { id: true } }),
        db.directoryExchangeMember.findUnique({
          where: { masterOrganizationId_organizationId: { masterOrganizationId: cabinet.id, organizationId: requester.id } },
          select: { id: true },
        }),
        // Последний отказ этого кабинета любой организации аккаунта заявителя.
        db.directoryExchangeRequest.findFirst({
          where: { masterOrganizationId: cabinet.id, status: "declined", decidedAt: { not: null }, ...accountRequests },
          orderBy: { decidedAt: "desc" },
          select: { decidedAt: true },
        }),
      ]);
      const decision = decideRequestCreation({
        phase,
        kinds: input.kinds,
        requestsToday,
        sameAccount: cabinet.accountId === accountId,
        hasOpenRequest: Boolean(open),
        alreadyMember: Boolean(member),
        lastDeclinedAt: declined?.decidedAt ?? null,
        now,
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
      requestId: created.id,
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
  // Под замком обмена кабинета: идущий обмен дописывает свои связи, и только
  // потом участник уходит — связи не остаются «сиротами».
  return withExchangeLock(
    masterOrganizationId,
    () =>
      db.$transaction(async (tx) => {
        const members = await tx.directoryExchangeMember.deleteMany({ where: { masterOrganizationId, organizationId, foreign: true } });
        // Соответствия уходят только вместе с участником: у участника своего
        // аккаунта (не `foreign`) этот путь не трогает ничего.
        if (members.count === 0) return false;
        await tx.directoryExchangeLink.deleteMany({ where: { masterOrganizationId, organizationId } });
        await tx.directoryExchangeSkip.deleteMany({ where: { masterOrganizationId, organizationId } });
        return true;
      }),
    { waitMs: 30_000 },
  );
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
/** Свои организации владельца, которые уже обмениваются хотя бы одним из `kinds` в этом кабинете. */
async function ownMembersSharing(masterOrganizationId: string, accountId: string | null, kinds: readonly string[]): Promise<string[]> {
  if (!accountId) return [];
  const members = await db.directoryExchangeMember.findMany({
    where: { masterOrganizationId, foreign: false, organization: { accountId, isDemo: false, ...NOT_DIRECTORY_ORG_WHERE } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { organizationId: true, kinds: true },
  });
  return members.filter((member) => member.kinds.some((kind) => kinds.includes(kind))).map((member) => member.organizationId);
}

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
    sources: status === "pending" && accountId ? await transferSources(accountId, now) : [],
    linkedIds: mode === "link" && status === "pending" ? await ownMembersSharing(request.masterOrganizationId, accountId, request.kinds) : [],
  };
}

/* ───────────────────────── решение ───────────────────────── */

/**
 * Организация другой компании, уже связанная с кабинетом (её название — для
 * текста владельцу); null — кабинет свободен. Вторая организация той же
 * компании, что и заявитель, кабинет не занимает.
 */
async function linkedCompanyOf(request: RequestRow): Promise<string | null> {
  const cabinetAccountId = request.masterOrganization.accountId;
  const requesterKey = exchangeAccountKey(request.requesterOrganization);
  const foreign = await db.directoryExchangeMember.findMany({
    where: { masterOrganizationId: request.masterOrganizationId, foreign: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { organization: { select: { id: true, name: true, accountId: true } } },
  });
  const other = foreign.find(
    ({ organization }) => organization.accountId !== cabinetAccountId && exchangeAccountKey(organization) !== requesterKey,
  );
  return other?.organization.name ?? null;
}

/** Можно ли подтвердить запрос сейчас (`decideRequestApproval`); нет — `DirectoryExchangeError`. */
async function assertApprovable(request: RequestRow, mode: RequestMode, now: Date): Promise<void> {
  const requester = request.requesterOrganization;
  const [billing, locked, linkedCompany] = await Promise.all([
    loadAccountBilling(requester.id, now).catch(() => null),
    isOrganizationLocked(requester.id, now),
    mode === "link" ? linkedCompanyOf(request) : Promise.resolve(null),
  ]);
  const verdict = decideRequestApproval({
    mode,
    // Тариф не прочитался — считаем неоплаченным: данные получает только платный аккаунт.
    requesterPhase: billing ? phaseOfKind(billing.state.kind) : "free",
    requesterLocked: locked,
    requesterName: requester.name,
    linkedCompany,
  });
  if (!verdict.ok) throw new DirectoryExchangeError(verdict.message, verdict.status, `request_${verdict.reason}`);
}

/**
 * Свои организации владельца для связи: переданные (только рабочие организации
 * его аккаунта, не закрытые) или — если не переданы — те, что уже обмениваются
 * запрошенными списками. Пусто — 400: без своей организации обмениваться
 * заявителю не с кем.
 */
async function chooseOwnOrganizations(
  request: RequestRow,
  allowed: readonly ExchangeKind[],
  wanted: readonly string[] | null,
  now: Date,
): Promise<string[]> {
  const accountId = request.masterOrganization.accountId;
  if (!accountId) throw new DirectoryExchangeError("Организация не найдена", 404);
  const ids = wanted && wanted.length > 0 ? [...new Set(wanted.map((id) => id.trim()).filter(Boolean))] : await ownMembersSharing(request.masterOrganizationId, accountId, allowed);
  if (ids.length === 0) {
    throw new DirectoryExchangeError("Выберите свою организацию, которая будет обмениваться с этой компанией", 400, "request_no_own_organization");
  }
  const own = await db.organization.findMany({
    where: { id: { in: ids }, accountId, isDemo: false, ...NOT_DIRECTORY_ORG_WHERE },
    select: { id: true },
  });
  if (own.length !== ids.length) throw new DirectoryExchangeError("Организация не найдена", 404);
  for (const organization of own) {
    if (await isOrganizationLocked(organization.id, now)) throw new DirectoryExchangeError(ORG_LOCKED_MESSAGE, 409, ORG_LOCKED_CODE);
  }
  return ids;
}

/**
 * Подтверждённая связь (Р4): организация-заявитель — участник обмена кабинета
 * с разрешёнными списками и пометкой `foreign`; обмен запускается сразу.
 * К общим меню и сырью кабинета она НЕ подключается — это другой доступ.
 */
async function approveLink(
  request: RequestRow,
  allowed: ExchangeKind[],
  ownOrganizationIds: readonly string[],
  actor: ExchangeActor,
  now: Date,
  waitMs?: number,
): Promise<ExchangeRunOutcome> {
  const masterOrganizationId = request.masterOrganizationId;
  // Проверка «кабинет свободен» и запись участника — под замком обмена
  // кабинета: два одновременных подтверждения разных компаний не пройдут оба.
  await withExchangeLock(masterOrganizationId, async () => {
    const linkedCompany = await linkedCompanyOf(request);
    if (linkedCompany) {
      const verdict = decideRequestApproval({
        mode: "link",
        requesterPhase: "paid",
        requesterLocked: false,
        requesterName: request.requesterOrganization.name,
        linkedCompany,
      });
      if (!verdict.ok) throw new DirectoryExchangeError(verdict.message, verdict.status, `request_${verdict.reason}`);
    }
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
    // Свои организации владельца, выбранные им на странице: им добавляются
    // разрешённые списки (то, чем они уже обменивались, остаётся).
    for (const organizationId of ownOrganizationIds) {
      const current = await db.directoryExchangeMember.findUnique({
        where: { masterOrganizationId_organizationId: { masterOrganizationId, organizationId } },
        select: { kinds: true },
      });
      const kinds = EXCHANGE_KINDS.filter((kind) => allowed.includes(kind) || current?.kinds.includes(kind));
      await db.directoryExchangeMember.upsert({
        where: { masterOrganizationId_organizationId: { masterOrganizationId, organizationId } },
        create: { masterOrganizationId, organizationId, kinds, foreign: false, createdByUserId: actor.userId },
        update: { kinds },
      });
    }
  });

  // Связь уже установлена: не удавшийся первый обмен пройдёт при следующей синхронизации.
  const failed = (busyMessage: string | null): ExchangeSummary => ({
    ...emptySummary(),
    notes: [
      busyMessage
        ? `Связь установлена. ${busyMessage}`
        : "Связь установлена. Первый обмен не удался — он повторится при следующей синхронизации.",
    ],
  });
  try {
    const outcome = await runDirectoryExchangeWithin(masterOrganizationId, { actor, now, waitMs });
    if (!outcome.running) return outcome;
    // Сбой в фоне уже записан в лог (`runDirectoryExchangeWithin`).
    return { running: true, done: outcome.done.then((summary) => summary ?? failed(null)) };
  } catch (error) {
    const busy = error instanceof DirectoryExchangeError && error.code === EXCHANGE_BUSY_CODE;
    if (!busy) console.error("[directory-exchange] first exchange with a foreign member failed", { masterOrganizationId, error });
    return { running: false, summary: failed(busy ? (error as Error).message : null) };
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
  /**
   * Связь: свои организации владельца, которые будут обмениваться с
   * заявителем. Не переданы — те, что уже обмениваются запрошенными списками;
   * таких нет — отказ 400 (выбрать надо явно).
   */
  organizationIds?: readonly string[] | null;
  now?: Date;
  /** Сколько ждать первого обмена связи до ухода в фон (по умолчанию 8 с; проверки ставят меньше). */
  waitMs?: number;
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
  // Заявитель сейчас: на платном ли тарифе и не закрыт ли; кабинет — не связан
  // ли уже с другой компанией. Отказ запрос не закрывает — он ждёт дальше.
  await assertApprovable(request, mode, now);

  let ownOrganizationIds: string[] = [];
  if (mode === "link") {
    ownOrganizationIds = await chooseOwnOrganizations(request, allowed, input.organizationIds ?? null, now);
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

  let summary: ExchangeSummary | null = null;
  let background: Promise<ExchangeSummary | null> | null = null;
  try {
    if (mode === "link") {
      const outcome = await approveLink(request, allowed, ownOrganizationIds, actor, now, input.waitMs);
      if (outcome.running) background = outcome.done;
      else summary = outcome.summary;
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
        // Перенос запоминается с запросом: заявитель может его отменить (п. 12).
        requestId: request.id,
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

  const saveResult = (result: ExchangeSummary) =>
    db.directoryExchangeRequest
      .update({ where: { id: request.id }, data: { resultJson: result as unknown as Prisma.InputJsonObject } })
      .then(() => undefined)
      .catch((error) => console.error("[directory-exchange] request result not saved", { id: request.id, error }));
  if (summary) await saveResult(summary);
  await auditBoth(
    "request_approved",
    parties,
    { side: "cabinet", actor },
    { allowedKinds: allowed },
    // Из какой своей организации владелец разрешил перенос — только в его журнал.
    sourceOrganizationId ? { sourceOrganizationId } : {},
  );
  const notifyWith = (result: ExchangeSummary) =>
    requesterDecisionNotify({ ...notifyBase, status: "approved", allowedKinds: allowed, summary: result });
  if (background) {
    const pending = background;
    return {
      status: "approved",
      running: true,
      // Заявитель узнаёт итог, когда обмен дошёл: письмо — с тем, что он получил.
      notify: async () => {
        const result = (await pending) ?? emptySummary();
        await saveResult(result);
        await notifyWith(result)();
      },
    };
  }
  const result = summary ?? emptySummary();
  return { status: "approved", summary: result, notify: notifyWith(result) };
}
