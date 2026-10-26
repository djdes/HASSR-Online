/**
 * Перевод своей организации в клиенты своего партнёрского кабинета и
 * обратно — решения без базы.
 *
 * Сценарий владельца: человек завёл организацию как свою, настроил и
 * оплатил по своему тарифу, а потом её ведёт клиент, и партнёр только
 * получает вознаграждение с её оплат. Здесь решается, можно ли перевести
 * (или вернуть) и что именно поменяется — и то же самое показывается
 * человеку в окне подтверждения до нажатия. База (`org-conversion.ts`)
 * собирает снимок, спрашивает план и применяет его операции как есть.
 *
 * Решения (подробно — `.agent/tasks/orgsw/plan.md`):
 *  • организация выходит из личного аккаунта и становится своей единицей
 *    биллинга (без `accountId`, как организации, заведённые в партнёрском
 *    кабинете); свой `Account` у неё появится при передаче клиенту —
 *    второй аккаунт на того же человека завести нельзя (`ownerUserId`
 *    уникален);
 *  • тариф и оплаченный срок остаются у организации, личный аккаунт свой
 *    срок тоже сохраняет — за оплаченный период никто не теряет ни дня;
 *  • автопродление с карты владельца выключается, скидка навсегда
 *    остаётся на его аккаунте, баллы — у организации;
 *  • человек перестаёт быть членом организации и открывает её из
 *    партнёрского кабинета, как остальных клиентов: оплата и удаление в
 *    режиме партнёра закрыты — платить самому себе за комиссию нельзя;
 *  • вернуть можно только то, что перевёл сам, пока владение никто не
 *    принял и после перевода организацию никто не оплачивал.
 */

import {
  computeAccountBilling,
  isReallyPaid,
  type AccountBillingState,
  type TrialSettings,
} from "@/lib/billing-period";
import { employeesGenitiveLabel, employeesLabel } from "@/lib/plan-catalog";
import { isInactivePlan } from "@/lib/plan-limits";

import type { RewardRule } from "./rewards";

/** Ссылка Робокассы живёт 23 часа (`api/payments/robokassa/create`, EXPIRATION_HOURS) — берём сутки. */
export const PENDING_CARD_ORDER_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Допуск начислений на время привязки (`accruals.ts → linkActiveAt`,
 * 15 минут): оплата, прошедшая за 15 минут до перевода, могла бы дать
 * комиссию с платежа, сделанного ещё владельцем.
 */
export const RECENT_PAYMENT_WINDOW_MS = 15 * 60 * 1000;

export const CONVERTED_SOURCE = "converted";

// ---------------------------------------------------------------- общее

export type BlockerPresentation =
  | { key: "pending_invoice"; params: { invoiceId: string; amountRub: number } }
  | { key: "pending_invoice_due"; params: { invoiceId: string; amountRub: number; dueDate: string } }
  | { key: "pending_card_payment"; params: { orderId: string; startedAt: string; availableAt: string } }
  | { key: "recent_payment"; params: { orderId: string; minutes: number } }
  | { key: "team_lives_here"; params: { names: string[] } }
  | { key: "other_partner"; params: { partnerName: string } }
  | { key: "owned_by_client"; params: { ownerEmail: string } }
  | { key: "seat_limit"; params: { limit: number; total: number; organizationName: string } };

export type Blocker = { code: BlockerCode; message: string; presentation?: BlockerPresentation };

export type BlockerCode =
  | "not_partner"
  | "not_owner"
  | "foreign_mode"
  | "demo"
  | "directory"
  | "platform"
  | "deletion_requested"
  | "partner_inn"
  | "applicant_organization"
  | "team_lives_here"
  | "other_partner"
  | "already_client"
  | "pending_invoice"
  | "pending_card_payment"
  | "recent_payment"
  | "only_organization"
  // возврат
  | "link_missing"
  | "not_converted"
  | "converted_by_other"
  | "owned_by_client"
  | "paid_after_conversion"
  | "seat_limit";

/** Группы последствий — как в окне подтверждения. */
export type Consequences = {
  payment: string[];
  seats: string[];
  commission: string[];
  access: string[];
  next: string[];
  /** Stable display metadata for localized UI; legacy `message` strings remain for API compatibility. */
  presentation?: ConsequencePresentation;
};

export type ConsequenceLine =
  | { key: "subscriptionPaid"; params: { date: string } }
  | { key: "subscriptionResponsibility" }
  | { key: "accountPaidUntil"; params: { date: string } }
  | { key: "recurringDisabled" }
  | { key: "lifetimeDiscount"; params: { code: string } }
  | { key: "balanceRetained"; params: { amount: number } }
  | { key: "accountSeats"; params: { organizationCount: number; before: number; after: number } }
  | { key: "organizationSeats"; params: { count: number } }
  | { key: "seatLimit"; params: { limit: number } }
  | { key: "rewardIntro" }
  | { key: "rewardsByProgram" }
  | { key: "subscriptionReward"; params: { percent: number; months: number } }
  | { key: "subscriptionRewardNoLimit"; params: { percent: number } }
  | { key: "bonusReward"; params: { amount: number; paymentNumber: number } }
  | { key: "hardwareReward"; params: { percent: number } }
  | { key: "preConversionNoReward" }
  | { key: "organizationRemoved"; params: { organizationName: string } }
  | { key: "partnerAccess" }
  | { key: "clientControls" }
  | { key: "teamAccess"; params: { names: string } }
  | { key: "profileMoves"; params: { organizationName: string } }
  | { key: "settingsUnchanged" }
  | { key: "handoffOwner" }
  | { key: "returnRules" }
  | { key: "returnPayment" }
  | { key: "returnPaidUntil"; params: { date: string } }
  | { key: "returnRecurring" }
  | { key: "returnSeats"; params: { total: number; current: number; organizationCount: number } }
  | { key: "returnNewAccountSeats"; params: { count: number } }
  | { key: "returnCommission" }
  | { key: "returnOwner"; params: { organizationName: string } }
  | { key: "returnInviteCancelled"; params: { email: string } };

export type ConsequenceGroup = "payment" | "seats" | "commission" | "access" | "next";
export type ConsequencePresentation = Record<ConsequenceGroup, ConsequenceLine[]>;

/** «12 ноября 2026» по Москве. */
export function formatMskDate(date: Date): string {
  return date
    .toLocaleDateString("ru-RU", {
      timeZone: "Europe/Moscow",
      day: "numeric",
      month: "long",
      year: "numeric",
    })
    .replace(/\s*г\.?$/, "");
}

/** «12 ноября 2026, 14:05» по Москве. */
export function formatMskDateTime(date: Date): string {
  const time = date.toLocaleTimeString("ru-RU", {
    timeZone: "Europe/Moscow",
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${formatMskDate(date)}, ${time}`;
}

function rub(value: number): string {
  return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value)} ₽`;
}

function maxDate(dates: Array<Date | null | undefined>): Date | null {
  let best: Date | null = null;
  for (const date of dates) {
    if (date && (!best || date.getTime() > best.getTime())) best = date;
  }
  return best;
}

function quoted(name: string): string {
  return `«${name}»`;
}

// ---------------------------------------------------------------- перевод

export type ConversionOrder = {
  id: number;
  status: string;
  paymentMethod: string;
  amountRub: number;
  createdAt: Date;
  paidAt: Date | null;
  invoiceDueAt: Date | null;
};

export type ConversionSnapshot = {
  now: Date;
  actor: {
    userId: string;
    /** Домашняя организация (`User.organizationId`). */
    homeOrganizationId: string;
    /** Режим партнёра в кабинете клиента или ROOT «войти как». */
    inForeignMode: boolean;
  };
  /** Партнёрский кабинет человека (любой статус) — null, если его нет. */
  partner: {
    id: string;
    status: string;
    brandName: string;
    inn: string;
    applicantOrganizationId: string | null;
  } | null;
  /** Люди команды партнёра, кроме самого человека, связанные с этой организацией. */
  teamInOrganization: Array<{ userId: string; name: string; livesHere: boolean; isMember: boolean }>;
  organization: {
    id: string;
    name: string;
    inn: string | null;
    isDemo: boolean;
    kind: string;
    isPlatform: boolean;
    deletionRequested: boolean;
    accountId: string | null;
    subscriptionPlan: string;
    subscriptionEnd: Date | null;
    recurringActive: boolean;
    balanceRub: number;
    /** Активные сотрудники организации — те, кто занимает место в тарифе. */
    activeUsers: number;
    /** Роль человека в `OrganizationMember` этой организации, если есть. */
    actorMemberRole: string | null;
    /** Создание организации: после перевода пробный считается от него. */
    createdAt?: Date | null;
  };
  /** Аккаунт, в котором сейчас организация. */
  account: {
    id: string;
    ownerUserId: string;
    subscriptionPlan: string;
    subscriptionEnd: Date | null;
    lifetimeDiscount: { code: string; kind: "percent" | "fixed"; value: number } | null;
    /** Организации аккаунта (включая переводимую). */
    organizations: Array<{
      id: string;
      name: string;
      isDemo: boolean;
      kind: string;
      subscriptionEnd: Date | null;
      createdAt: Date;
      /** Человек — член этой организации с ролью владельца. */
      actorIsOwnerMember: boolean;
    }>;
    /** Активные сотрудники всего аккаунта (без демо и мастер-кабинета). */
    activeUsers: number;
  } | null;
  /** Действующая привязка организации к партнёру, если есть. */
  activeLink: { partnerId: string; brandName: string } | null;
  /**
   * Заказы организации, которые могут «перепрыгнуть» через перевод:
   * неоплаченные (счета — все, карта — за сутки) и оплаченные за 15 минут.
   */
  orders: ConversionOrder[];
  rule: RewardRule;
  settings: TrialSettings;
};

export type HomeMove = { toOrganizationId: string; toOrganizationName: string };

export type ConversionOps = {
  organizationId: string;
  partnerId: string;
  fromAccountId: string | null;
  /** Тариф и срок, которые остаются у организации (её зеркало). */
  organizationBilling: { subscriptionPlan: string; subscriptionEnd: Date | null };
  /** Поднять срок личного аккаунта до этой даты, чтобы он не потерял оплату. */
  accountEndRaiseTo: Date | null;
  disableRecurring: boolean;
  /** Чьё членство в организации снимается (сам человек и люди его команды). */
  removeMemberUserIds: string[];
  homeMove: HomeMove | null;
  link: { accessLevel: "edit"; source: typeof CONVERTED_SOURCE; convertedByUserId: string };
};

export type ConversionPlan =
  | { ok: true; ops: ConversionOps; consequences: Consequences }
  | { ok: false; blockers: Blocker[] };

/**
 * Показывать ли блок «Перевести в партнёрский кабинет»: у человека
 * действующий партнёрский кабинет и он владелец организации. Остальные
 * проверки — внутри плана, их причины блок показывает сам.
 */
export function isConversionOffered(snapshot: ConversionSnapshot): boolean {
  return snapshot.partner?.status === "active" && isOwner(snapshot);
}

/**
 * Владелец — тот, кто платит: владелец аккаунта организации. Организация
 * без аккаунта (легаси до миграции) — член с ролью `owner`.
 */
function isOwner(snapshot: ConversionSnapshot): boolean {
  const { organization, account, actor } = snapshot;
  if (organization.accountId) {
    return Boolean(account && account.id === organization.accountId && account.ownerUserId === actor.userId);
  }
  return organization.actorMemberRole === "owner";
}

/** Тариф и срок, которые организация уносит с собой: то, что было у её единицы биллинга. */
export function carriedBilling(snapshot: Pick<ConversionSnapshot, "organization" | "account">): {
  subscriptionPlan: string;
  subscriptionEnd: Date | null;
} {
  const { organization, account } = snapshot;
  // Пауза и отмена — свойства самой организации, их не перетираем тарифом аккаунта.
  const plan = isInactivePlan(organization.subscriptionPlan)
    ? organization.subscriptionPlan
    : account?.subscriptionPlan ?? organization.subscriptionPlan;
  // Тот же срок, что считает `loadBillingUnit`: аккаунт и зеркала его
  // организаций без демо и мастер-кабинета.
  const end = account
    ? maxDate([
        account.subscriptionEnd,
        ...account.organizations.filter(inTariffScope).map((o) => o.subscriptionEnd),
        organization.subscriptionEnd,
      ])
    : organization.subscriptionEnd;
  return { subscriptionPlan: plan, subscriptionEnd: end };
}

function inTariffScope(o: { isDemo: boolean; kind: string }): boolean {
  return !o.isDemo && o.kind !== "directory";
}

/**
 * Срок, до которого нужно поднять личный аккаунт: срок единицы биллинга —
 * максимум по аккаунту и зеркалам его организаций. Если он держался на
 * зеркале уходящей организации, без переноса остальные организации
 * владельца потеряли бы оплату. null — поднимать не нужно.
 */
export function accountEndAfterLeave(snapshot: Pick<ConversionSnapshot, "organization" | "account">): Date | null {
  const { organization, account } = snapshot;
  if (!account) return null;
  const leaving = organization.subscriptionEnd;
  if (!leaving) return null;
  const others = maxDate([
    account.subscriptionEnd,
    ...account.organizations
      .filter((o) => o.id !== organization.id && inTariffScope(o))
      .map((o) => o.subscriptionEnd),
  ]);
  if (others && others.getTime() >= leaving.getTime()) return null;
  return leaving;
}

/** Куда переезжает профиль, если переводится его домашняя организация. */
export function pickHomeTarget(snapshot: Pick<ConversionSnapshot, "organization" | "account">): HomeMove | null {
  const candidates = (snapshot.account?.organizations ?? [])
    .filter(
      (o) =>
        o.id !== snapshot.organization.id &&
        !o.isDemo &&
        o.kind !== "directory" &&
        o.actorIsOwnerMember,
    )
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
  const target = candidates[0];
  return target ? { toOrganizationId: target.id, toOrganizationName: target.name } : null;
}

function orderBlockers(snapshot: ConversionSnapshot): Blocker[] {
  const now = snapshot.now.getTime();
  const blockers: Blocker[] = [];
  const invoice = snapshot.orders.find(
    (o) =>
      o.status === "pending" &&
      o.paymentMethod === "invoice",
  );
  if (invoice) {
    blockers.push({
      code: "pending_invoice",
      presentation: invoice.invoiceDueAt
        ? { key: "pending_invoice_due", params: { invoiceId: String(invoice.id), amountRub: invoice.amountRub, dueDate: invoice.invoiceDueAt.toISOString() } }
        : { key: "pending_invoice", params: { invoiceId: String(invoice.id), amountRub: invoice.amountRub } },
      message:
        `Выставлен счёт №${invoice.id} на ${rub(invoice.amountRub)}, он ещё не оплачен` +
        (invoice.invoiceDueAt ? ` (действует до ${formatMskDate(invoice.invoiceDueAt)})` : "") +
        ". Перевод станет доступен после оплаты счёта или его отмены (напишите в поддержку) — иначе оплата, пришедшая после перевода, дала бы комиссию за продажу до перевода.",
    });
  }
  const card = snapshot.orders
    .filter(
      (o) =>
        o.status === "pending" &&
        o.paymentMethod !== "invoice" &&
        now - o.createdAt.getTime() < PENDING_CARD_ORDER_WINDOW_MS,
    )
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  if (card) {
    const until = new Date(card.createdAt.getTime() + PENDING_CARD_ORDER_WINDOW_MS);
    blockers.push({
      code: "pending_card_payment",
      presentation: { key: "pending_card_payment", params: {
        orderId: String(card.id), startedAt: card.createdAt.toISOString(), availableAt: until.toISOString(),
      } },
      message:
        `${formatMskDateTime(card.createdAt)} начата оплата картой (заказ №${card.id}), ссылка на оплату ещё действует. ` +
        `Перевод станет доступен после ${formatMskDateTime(until)} или через 15 минут после оплаты.`,
    });
  }
  const paid = snapshot.orders
    .filter((o) => o.paidAt && now - o.paidAt.getTime() < RECENT_PAYMENT_WINDOW_MS)
    .sort((a, b) => (b.paidAt as Date).getTime() - (a.paidAt as Date).getTime())[0];
  if (paid && paid.paidAt) {
    const minutes = Math.max(1, Math.ceil((RECENT_PAYMENT_WINDOW_MS - (now - paid.paidAt.getTime())) / 60000));
    blockers.push({
      code: "recent_payment",
      presentation: { key: "recent_payment", params: { orderId: String(paid.id), minutes } },
      message: `Только что прошла оплата (заказ №${paid.id}). Повторите перевод через ${minutes} мин.`,
    });
  }
  return blockers;
}

export function conversionBlockers(snapshot: ConversionSnapshot): Blocker[] {
  const { organization, partner, actor } = snapshot;
  const blockers: Blocker[] = [];

  if (!partner || partner.status !== "active") {
    blockers.push({ code: "not_partner", message: "Нужен действующий партнёрский кабинет." });
  }
  if (actor.inForeignMode) {
    blockers.push({
      code: "foreign_mode",
      message: "Сейчас вы работаете в чужом кабинете (как партнёр или через «Войти как»). Перейдите в свою организацию.",
    });
  }
  if (!isOwner(snapshot)) {
    blockers.push({
      code: "not_owner",
      message: "Перевести может только владелец организации — тот, чей аккаунт её оплачивает.",
    });
  }
  if (organization.isPlatform) {
    blockers.push({ code: "platform", message: "Служебную организацию платформы перевести нельзя." });
  }
  if (organization.isDemo) {
    blockers.push({ code: "demo", message: "Демо-организацию перевести нельзя — она удаляется сама." });
  }
  if (organization.kind === "directory") {
    blockers.push({ code: "directory", message: "Мастер-кабинет справочников перевести нельзя." });
  }
  if (organization.deletionRequested) {
    blockers.push({
      code: "deletion_requested",
      message: "Организация ждёт удаления. Сначала отмените удаление ниже на этой странице.",
    });
  }

  if (partner) {
    const orgInn = organization.inn?.replace(/\D/g, "") ?? "";
    if (orgInn && orgInn === partner.inn.replace(/\D/g, "")) {
      blockers.push({
        code: "partner_inn",
        message:
          "ИНН организации совпадает с ИНН вашего партнёрского кабинета — это ваша собственная компания. " +
          "Вознаграждение с собственных оплат не начисляется.",
      });
    }
    if (partner.applicantOrganizationId === organization.id) {
      blockers.push({
        code: "applicant_organization",
        message:
          "Из этой организации подана заявка партнёра — в ней работает ваша партнёрская команда. Перевести её нельзя.",
      });
    }
  }

  const livingTeam = snapshot.teamInOrganization.filter((m) => m.livesHere);
  if (livingTeam.length > 0) {
    blockers.push({
      code: "team_lives_here",
      presentation: { key: "team_lives_here", params: { names: livingTeam.map((member) => member.name) } },
      message:
        `В этой организации числятся сотрудники вашей партнёрской команды: ${livingTeam.map((m) => m.name).join(", ")}. ` +
        "Пока их профиль здесь, перевести её нельзя.",
    });
  }

  if (snapshot.activeLink) {
    if (partner && snapshot.activeLink.partnerId === partner.id) {
      blockers.push({ code: "already_client", message: "Организация уже клиент вашего партнёрского кабинета." });
    } else {
      blockers.push({
        code: "other_partner",
        presentation: { key: "other_partner", params: { partnerName: snapshot.activeLink.brandName } },
        message:
          `У организации уже есть консультант ${quoted(snapshot.activeLink.brandName)}. ` +
          "Сначала отключите его: «Настройки → Консультант».",
      });
    }
  }

  blockers.push(...orderBlockers(snapshot));

  if (organization.id === actor.homeOrganizationId && !pickHomeTarget(snapshot)) {
    blockers.push({
      code: "only_organization",
      message:
        "Это ваша единственная организация, и ваш профиль живёт в ней: после перевода у вас не останется своего кабинета. " +
        "Сначала создайте свою организацию — «Профиль → Добавить организацию».",
    });
  }

  return blockers;
}

/** Условия вознаграждения текстом — из действующей версии правил, без выдуманных цифр. */
export function rewardTermsText(rule: RewardRule): string {
  const parts: string[] = [];
  if (rule.subscriptionPercent > 0) {
    parts.push(
      `${String(rule.subscriptionPercent).replace(".", ",")} % от каждой оплаты подписки` +
        (rule.subscriptionMonths > 0 ? ` в течение ${rule.subscriptionMonths} мес. с первой оплаты после перевода` : ""),
    );
  }
  if (rule.bonusAmountRub > 0) {
    parts.push(`разовый бонус ${rub(rule.bonusAmountRub)} за ${rule.bonusAfterPayments}-ю оплату`);
  }
  if (rule.hardwarePercent > 0) {
    parts.push(`${String(rule.hardwarePercent).replace(".", ",")} % от оборудования из комплекта после отгрузки`);
  }
  if (parts.length === 0) return "Вознаграждение — по действующим правилам партнёрской программы.";
  return `Вознаграждение по действующим правилам: ${parts.join(", ")}.`;
}

function organizationStateAfter(snapshot: ConversionSnapshot, billing: { subscriptionPlan: string; subscriptionEnd: Date | null }): AccountBillingState {
  return computeAccountBilling(
    {
      plan: billing.subscriptionPlan,
      subscriptionEnd: billing.subscriptionEnd,
      activeUsers: snapshot.organization.activeUsers,
      createdAt: snapshot.organization.createdAt ?? null,
      inactive: isInactivePlan(billing.subscriptionPlan),
    },
    snapshot.settings,
    snapshot.now,
  );
}

export function planConversion(snapshot: ConversionSnapshot): ConversionPlan {
  const blockers = conversionBlockers(snapshot);
  if (blockers.length > 0 || !snapshot.partner) return { ok: false, blockers };

  const { organization, account, partner, actor, now } = snapshot;
  const billing = carriedBilling(snapshot);
  const accountEndRaiseTo = accountEndAfterLeave(snapshot);
  const homeMove = organization.id === actor.homeOrganizationId ? pickHomeTarget(snapshot) : null;
  const teamMembers = snapshot.teamInOrganization.filter((m) => m.isMember && !m.livesHere);
  const removeMemberUserIds = [
    ...(organization.actorMemberRole ? [actor.userId] : []),
    ...teamMembers.map((m) => m.userId),
  ];

  const ops: ConversionOps = {
    organizationId: organization.id,
    partnerId: partner.id,
    fromAccountId: organization.accountId,
    organizationBilling: billing,
    accountEndRaiseTo,
    disableRecurring: organization.recurringActive,
    removeMemberUserIds,
    homeMove,
    link: { accessLevel: "edit", source: CONVERTED_SOURCE, convertedByUserId: actor.userId },
  };

  // --- Оплата
  const payment: string[] = [];
  const presentation: ConsequencePresentation = { payment: [], seats: [], commission: [], access: [], next: [] };
  const paid = isReallyPaid(billing.subscriptionPlan, billing.subscriptionEnd, now);
  if (paid && billing.subscriptionEnd) {
    payment.push(
      `Подписка оплачена до ${formatMskDate(billing.subscriptionEnd)} — этот срок остаётся у организации. ` +
        "Следующую оплату делает сама организация, не ваш аккаунт.",
    );
    presentation.payment.push(
      { key: "subscriptionPaid", params: { date: billing.subscriptionEnd.toISOString() } },
      { key: "subscriptionResponsibility" },
    );
  } else {
    payment.push("Дальше подписку этой организации оплачивает она сама, не ваш аккаунт.");
    presentation.payment.push({ key: "subscriptionResponsibility" });
  }
  if (account) {
    const remaining = account.organizations.filter((o) => o.id !== organization.id && !o.isDemo && o.kind !== "directory");
    const accountEnd = maxDate([accountEndRaiseTo, account.subscriptionEnd, ...remaining.map((o) => o.subscriptionEnd)]);
    if (remaining.length > 0 && isReallyPaid(account.subscriptionPlan, accountEnd, now) && accountEnd) {
      payment.push(`Ваш аккаунт сохраняет свою оплату до ${formatMskDate(accountEnd)}.`);
      presentation.payment.push({ key: "accountPaidUntil", params: { date: accountEnd.toISOString() } });
    }
  }
  if (organization.recurringActive) {
    payment.push("Автопродление с вашей карты для этой организации выключится.");
    presentation.payment.push({ key: "recurringDisabled" });
  }
  if (account?.lifetimeDiscount) {
    payment.push(
      `Ваша скидка навсегда (${account.lifetimeDiscount.code}) остаётся на вашем аккаунте — к оплатам этой организации она больше не применяется.`,
    );
    presentation.payment.push({ key: "lifetimeDiscount", params: { code: account.lifetimeDiscount.code } });
  }
  if (organization.balanceRub > 0) {
    payment.push(`Баллы на балансе организации (${rub(organization.balanceRub)}) остаются у неё.`);
    presentation.payment.push({ key: "balanceRetained", params: { amount: organization.balanceRub } });
  }

  // --- Места
  const seats: string[] = [];
  if (account) {
    const before = account.activeUsers;
    const after = Math.max(0, before - organization.activeUsers);
    seats.push(
      `Сотрудники организации (${organization.activeUsers}) больше не занимают места в вашем аккаунте: ` +
        `было ${before}, станет ${after}.`,
    );
    presentation.seats.push({ key: "accountSeats", params: { organizationCount: organization.activeUsers, before, after } });
  } else {
    seats.push(`В организации ${employeesLabel(organization.activeUsers)}.`);
    presentation.seats.push({ key: "organizationSeats", params: { count: organization.activeUsers } });
  }
  const stateAfter = organizationStateAfter(snapshot, billing);
  if (stateAfter.kind === "needs_decision") {
    seats.push(
      `Оплаченного срока у организации нет, а бесплатный тариф — на ${employeesGenitiveLabel(stateAfter.seatLimit ?? 1)}. ` +
        "Чтобы в работе остались все сотрудники, клиенту нужно подключить тариф «Стандарт» или «Премиум».",
    );
    presentation.seats.push({ key: "seatLimit", params: { limit: stateAfter.seatLimit ?? 1 } });
  }

  // --- Комиссия
  const commission = [
    rewardTermsText(snapshot.rule),
    "С оплат, сделанных до перевода, вознаграждения нет.",
  ];
  const hasRewardTerms = snapshot.rule.subscriptionPercent > 0 || snapshot.rule.bonusAmountRub > 0 || snapshot.rule.hardwarePercent > 0;
  if (hasRewardTerms) presentation.commission.push({ key: "rewardIntro" });
  if (snapshot.rule.subscriptionPercent > 0) {
    presentation.commission.push(snapshot.rule.subscriptionMonths > 0
      ? { key: "subscriptionReward", params: { percent: snapshot.rule.subscriptionPercent, months: snapshot.rule.subscriptionMonths } }
      : { key: "subscriptionRewardNoLimit", params: { percent: snapshot.rule.subscriptionPercent } });
  }
  if (snapshot.rule.bonusAmountRub > 0) {
    presentation.commission.push({ key: "bonusReward", params: { amount: snapshot.rule.bonusAmountRub, paymentNumber: snapshot.rule.bonusAfterPayments } });
  }
  if (snapshot.rule.hardwarePercent > 0) {
    presentation.commission.push({ key: "hardwareReward", params: { percent: snapshot.rule.hardwarePercent } });
  }
  if (!hasRewardTerms) presentation.commission.push({ key: "rewardsByProgram" });
  presentation.commission.push({ key: "preConversionNoReward" });

  // --- Доступ
  const access: string[] = [
    `${quoted(organization.name)} уйдёт из вашего списка организаций. Открывать её вы будете из партнёрского кабинета — ` +
      "кнопкой «Открыть кабинет», как остальных клиентов, с правом редактирования.",
    "Оплачивать подписку и удалять организацию в режиме партнёра нельзя — это делает клиент.",
    "Руководители организации, как у любого клиента, могут отключить консультанта в своих настройках — тогда доступ к ней пропадёт.",
  ];
  presentation.access.push(
    { key: "organizationRemoved", params: { organizationName: organization.name } },
    { key: "partnerAccess" },
    { key: "clientControls" },
  );
  if (teamMembers.length > 0) {
    access.push(
      `Сотрудники вашей партнёрской команды (${teamMembers.map((m) => m.name).join(", ")}) тоже будут работать с ней через партнёрский кабинет.`,
    );
    presentation.access.push({ key: "teamAccess", params: { names: teamMembers.map((m) => m.name).join(", ") } });
  }
  if (homeMove) {
    access.push(
      `Ваш профиль переедет в ${quoted(homeMove.toOrganizationName)}: там вы будете оказываться после входа. ` +
        "На других устройствах нужно будет войти заново.",
    );
    presentation.access.push({ key: "profileMoves", params: { organizationName: homeMove.toOrganizationName } });
  }
  access.push("Сотрудники организации, журналы и настройки не меняются.");
  presentation.access.push({ key: "settingsUnchanged" });

  // --- Дальше
  const next = [
    "Передайте организацию владельцу: в карточке клиента — «Передать клиенту». Он задаст пароль и станет руководителем.",
    "Вернуть её в свой аккаунт можно в партнёрском кабинете («Сделать моей организацией»), пока владение не принято и организацию не оплачивали после перевода.",
  ];
  presentation.next.push({ key: "handoffOwner" }, { key: "returnRules" });

  return { ok: true, ops, consequences: { payment, seats, commission, access, next, presentation } };
}

// ---------------------------------------------------------------- возврат

export type ReturnSnapshot = {
  now: Date;
  actor: { userId: string };
  partnerId: string;
  /** Последняя привязка организации к этому партнёру. */
  link: {
    id: string;
    source: string;
    convertedByUserId: string | null;
    attachedAt: Date;
    detachedAt: Date | null;
  } | null;
  organization: {
    id: string;
    name: string;
    accountId: string | null;
    subscriptionPlan: string;
    subscriptionEnd: Date | null;
    activeUsers: number;
  };
  /** Владелец организации (член с ролью owner), если назначен. */
  owner: {
    userId: string;
    email: string;
    isActive: boolean;
    /** Заглушка приглашения: не входил, пароля нет, ссылка не использована. */
    isPendingInvite: boolean;
    /** Аккаунт владельца и сколько в нём организаций. */
    accountId: string | null;
    accountOrganizations: number;
  } | null;
  /** Оплаченные после перевода заказы организации (без возвратов). */
  paidOrdersAfterConversion: number;
  /** Личный аккаунт человека, куда вернётся организация. */
  account: {
    id: string;
    subscriptionPlan: string;
    subscriptionEnd: Date | null;
    /** Сроки зеркал организаций аккаунта. */
    organizationEnds: Array<Date | null>;
    activeUsers: number;
    /** Создание аккаунта и продлённый ROOT пробный — для пробного периода. */
    createdAt?: Date | null;
    trialEndsAt?: Date | null;
  } | null;
  settings: TrialSettings;
};

export type ReturnOps = {
  organizationId: string;
  linkId: string;
  /** Отменить неподтверждённое приглашение владельцу: удалить заглушку и её пустой аккаунт. */
  revokeOwner: { userId: string; email: string; accountId: string | null } | null;
  /** С каким тарифом и сроком заводить аккаунт, если у человека его нет. */
  attach: { ownerUserId: string; subscriptionPlan: string; subscriptionEnd: Date | null };
};

export type ReturnPlan =
  | { ok: true; ops: ReturnOps; consequences: Consequences }
  | { ok: false; blockers: Blocker[] };

/** Предлагать ли «Сделать моей организацией» на карточке клиента. */
export function isReturnOffered(snapshot: ReturnSnapshot): boolean {
  const link = snapshot.link;
  return Boolean(
    link &&
      !link.detachedAt &&
      link.source === CONVERTED_SOURCE &&
      link.convertedByUserId === snapshot.actor.userId,
  );
}

/**
 * Приглашение владельцу можно отменить, только пока его никто не принял:
 * заглушка не входила, пароля нет, ссылка не использована, а в её
 * аккаунте нет ничего, кроме этой организации.
 */
function revocableInvite(owner: ReturnSnapshot["owner"]): boolean {
  return Boolean(owner && owner.isPendingInvite && !owner.isActive && owner.accountOrganizations <= 1);
}

export function returnBlockers(snapshot: ReturnSnapshot): Blocker[] {
  const { link, owner, organization } = snapshot;
  const blockers: Blocker[] = [];
  if (!link || link.detachedAt) {
    return [{ code: "link_missing", message: "Клиент не найден или сопровождение уже отключено." }];
  }
  if (link.source !== CONVERTED_SOURCE) {
    return [
      {
        code: "not_converted",
        message: "Сделать своей можно только организацию, которую вы сами перевели из своего аккаунта.",
      },
    ];
  }
  if (link.convertedByUserId !== snapshot.actor.userId) {
    return [
      {
        code: "converted_by_other",
        message: "Эту организацию перевёл другой человек из вашей команды — вернуть её в свой аккаунт может только он.",
      },
    ];
  }
  if (owner && !revocableInvite(owner)) {
    blockers.push({
      code: "owned_by_client",
      presentation: { key: "owned_by_client", params: { ownerEmail: owner.email } },
      message: `Организацией уже владеет клиент (${owner.email}) — вернуть её нельзя.`,
    });
  }
  if (snapshot.paidOrdersAfterConversion > 0) {
    blockers.push({
      code: "paid_after_conversion",
      message: "После перевода организацию уже оплачивали — это оплата клиента, вернуть её в ваш аккаунт нельзя.",
    });
  }
  const seat = mergedSeatCheck(snapshot);
  if (seat) {
    blockers.push({
      code: "seat_limit",
      presentation: { key: "seat_limit", params: { limit: seat.limit, total: seat.total, organizationName: organization.name } },
      message:
        `В вашем аккаунте бесплатный тариф на ${employeesGenitiveLabel(seat.limit)}, а после возврата активных станет ${seat.total}. ` +
        `Подключите аккаунту тариф «Стандарт» или «Премиум», затем верните ${quoted(organization.name)}.`,
    });
  }
  return blockers;
}

/** Состояние личного аккаунта после возврата: вместе с организацией. */
export function mergedAccountState(snapshot: ReturnSnapshot): AccountBillingState | null {
  const { account, organization } = snapshot;
  if (!account) return null;
  return computeAccountBilling(
    {
      plan: account.subscriptionPlan,
      subscriptionEnd: maxDate([account.subscriptionEnd, ...account.organizationEnds, organization.subscriptionEnd]),
      activeUsers: account.activeUsers + organization.activeUsers,
      createdAt: account.createdAt ?? null,
      trialEndsAt: account.trialEndsAt ?? null,
      inactive: isInactivePlan(account.subscriptionPlan),
    },
    snapshot.settings,
    snapshot.now,
  );
}

function mergedSeatCheck(snapshot: ReturnSnapshot): { limit: number; total: number } | null {
  const state = mergedAccountState(snapshot);
  if (!state || state.seatLimit === null) return null;
  // Возвращаемой организации в аккаунте нет людей — добавлять нечего.
  if (snapshot.organization.activeUsers === 0) return null;
  if (state.activeUsers <= state.seatLimit) return null;
  return { limit: state.seatLimit, total: state.activeUsers };
}

export function planReturn(snapshot: ReturnSnapshot): ReturnPlan {
  const blockers = returnBlockers(snapshot);
  if (blockers.length > 0 || !snapshot.link) return { ok: false, blockers };

  const { organization, owner, account, now } = snapshot;
  const ops: ReturnOps = {
    organizationId: organization.id,
    linkId: snapshot.link.id,
    revokeOwner:
      owner && revocableInvite(owner)
        ? { userId: owner.userId, email: owner.email, accountId: owner.accountId }
        : null,
    attach: {
      ownerUserId: snapshot.actor.userId,
      subscriptionPlan: organization.subscriptionPlan,
      subscriptionEnd: organization.subscriptionEnd,
    },
  };

  const payment: string[] = [
    "Организация войдёт в ваш аккаунт: подписку снова оплачиваете вы, по тарифу аккаунта.",
  ];
  const presentation: ConsequencePresentation = { payment: [], seats: [], commission: [], access: [], next: [] };
  presentation.payment.push({ key: "returnPayment" });
  if (isReallyPaid(organization.subscriptionPlan, organization.subscriptionEnd, now) && organization.subscriptionEnd) {
    payment.push(`Оплаченный срок организации (до ${formatMskDate(organization.subscriptionEnd)}) сохраняется.`);
    presentation.payment.push({ key: "returnPaidUntil", params: { date: organization.subscriptionEnd.toISOString() } });
  }
  payment.push("Автопродление само не включится — его подключают при следующей оплате.");
  presentation.payment.push({ key: "returnRecurring" });

  const seats: string[] = [];
  if (account) {
    seats.push(
      `Активных сотрудников в вашем аккаунте станет ${account.activeUsers + organization.activeUsers} ` +
        `(сейчас ${account.activeUsers}, в организации ${organization.activeUsers}).`,
    );
    presentation.seats.push({
      key: "returnSeats",
      params: { total: account.activeUsers + organization.activeUsers, current: account.activeUsers, organizationCount: organization.activeUsers },
    });
  } else {
    seats.push(`Для вас заведётся аккаунт с тарифом организации; активных сотрудников — ${organization.activeUsers}.`);
    presentation.seats.push({ key: "returnNewAccountSeats", params: { count: organization.activeUsers } });
  }

  const commission = [
    "Сопровождение завершится: вознаграждение с будущих оплат организации начисляться не будет. Уже начисленное остаётся.",
  ];
  presentation.commission.push({ key: "returnCommission" });

  const access = [
    `Вы снова владелец: ${quoted(organization.name)} появится в вашем списке организаций.`,
  ];
  presentation.access.push({ key: "returnOwner", params: { organizationName: organization.name } });
  if (ops.revokeOwner) {
    access.push(
      `Приглашение владельцу (${ops.revokeOwner.email}) будет отменено — ссылка из письма перестанет работать.`,
    );
    presentation.access.push({ key: "returnInviteCancelled", params: { email: ops.revokeOwner.email } });
  }

  return { ok: true, ops, consequences: { payment, seats, commission, access, next: [], presentation } };
}
