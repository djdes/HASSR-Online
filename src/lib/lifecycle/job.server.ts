import { Prisma } from "@prisma/client";

import { TOPUP_TARIFF_KEY } from "@/lib/balance/topup-core";
import { BILLING_PAY_HREF, formatMskDay, lastDayBefore } from "@/lib/billing-period";
import { AUTOMATIC_INVOICE_PREFIX, hasPendingInvoice, listBillingUnits, ownerContact, readTrialSettings, stateForUnit } from "@/lib/billing.server";
import { COMPANY_TELEGRAM } from "@/lib/company-contacts";
import {
  createCrmTask,
  notifyTaskAssignee,
  readLifecycleSettings,
  supersedeOpenCalls,
  type NewTask,
} from "@/lib/crm/tasks.server";
import { db } from "@/lib/db";
import { createInvoiceOrder, deliverInvoice, renderInvoice } from "@/lib/invoices/service";
import { invoiceFilename } from "@/lib/invoices/build";
import { quoteCheckout } from "@/lib/plan-checkout.server";
import { FREE_MAX_USERS } from "@/lib/plan-limits";
import { TIER_NAMES } from "@/lib/plan-catalog";
import { FREE_MAX_JOURNALS, paidTierFromPlan, tierForHeadcount, type PaidTier, type PlanTarget } from "@/lib/tariff-plans";

import { dueTodayOrNextWorkday } from "./calendar";
import { advanceDealFor, syncDeals } from "./deals.server";
import {
  composeGraceLastEmail,
  composeIdleTrialEmail,
  composeRenewalEarlyEmail,
  composeTrialEmail,
  quoted,
  rub,
  type ComposedNotice,
  type ManagerSignature,
} from "./emails";
import { loadPlatformStaff, managerSignature } from "./people.server";
import { LIFECYCLE_STAGE_LABELS, planLifecycle, taskKey, type LifecycleFacts, type LifecyclePlan, type LifecycleSettings } from "./plan";
import { approverFor, limitOf, pickAssignee, type StaffPerson } from "./staff";

/**
 * Ежедневный прогон сценария «пробный и оплата» (2026-11-09, доработан
 * 2026-11-10): зовёт его крон биллинга (`/api/cron/billing-transition`,
 * 06:15 МСК). Решения — `planLifecycle`, здесь только данные и исполнение.
 * Повторный запуск безопасен: письмо и счёт — по ключу в `CrmReminderLog`,
 * задача — по `CrmTask.dedupeKey`.
 *
 * Письма идут от имени ответственного менеджера: подпись — его имя,
 * должность и телефон, Reply-To — его почта, ответ клиента ляжет ему.
 * Счёт, который сценарий приложил сам, помечен `lc:invoice:<id>` — это не
 * решение клиента «платим», автопереход на бесплатный его не ждёт.
 */

const APP_URL = () => (process.env.NEXTAUTH_URL || "https://wesetup.ru").replace(/\/$/, "");
const DAY_MS = 24 * 60 * 60 * 1000;

export type LifecycleReport = {
  enabled: boolean;
  dryRun: boolean;
  planned: number;
  emails: number;
  invoices: number;
  tasks: number;
  failed: number;
  results: { unit: string; stage: string; outcome: string }[];
};

type Unit = Awaited<ReturnType<typeof listBillingUnits>>[number];
type State = ReturnType<typeof stateForUnit>;

/** «Забрать» ключ события: id записи — наш, можно отправлять; null — уже сделано. */
async function claim(dedupeKey: string, kind: string): Promise<string | null> {
  try {
    return (await db.crmReminderLog.create({ data: { dedupeKey, kind }, select: { id: true } })).id;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return null;
    throw error;
  }
}

async function release(id: string): Promise<void> {
  await db.crmReminderLog.delete({ where: { id } }).catch(() => undefined);
}

async function entriesSince(orgIds: string[], since: Date | null): Promise<number> {
  const created = since ? { gte: since } : undefined;
  const [entries, cells] = await Promise.all([
    db.journalEntry.count({ where: { organizationId: { in: orgIds }, ...(created ? { createdAt: created } : {}) } }),
    db.journalDocumentEntry.count({ where: { document: { organizationId: { in: orgIds } }, ...(created ? { createdAt: created } : {}) } }),
  ]);
  return entries + cells;
}

async function paysByInvoice(orgIds: string[]): Promise<boolean> {
  const last = await db.paymentOrder.findFirst({
    where: { organizationId: { in: orgIds }, status: "paid", tariffKey: { not: TOPUP_TARIFF_KEY } },
    orderBy: { paidAt: "desc" },
    select: { paymentMethod: true },
  });
  return last?.paymentMethod === "invoice";
}

/** Тариф под команду: сотрудников на точку → «Стандарт» или «Премиум». */
export function recommendedTarget(seats: number, points: number, cycle: "month" | "year" = "month"): PlanTarget {
  const perPoint = Math.ceil(Math.max(1, seats) / Math.max(1, points));
  return { tier: tierForHeadcount(perPoint), cycle, points: Math.max(1, points) };
}

async function priceOf(organizationId: string, target: PlanTarget, now: Date): Promise<number | null> {
  const quote = await quoteCheckout({ organizationId, target, now, allowIndividual: true }).catch(() => null);
  return quote && quote.ok ? quote.offer.priceRub : null;
}

/**
 * Счёт на тариф (если у организации есть ИНН и реквизиты исполнителя заполнены).
 * Свой неоплаченный счёт клиента сценарий не трогает: новый счёт закрыл бы его
 * (`createInvoiceOrder` отменяет прежние), а бухгалтерия, может быть, уже платит.
 */
async function issueInvoice(unit: Unit, target: PlanTarget, owner: { userId: string; email: string }, automatic: boolean, now: Date) {
  if (await hasPendingInvoice(unit.scopeOrgIds, now)) {
    console.info("[lifecycle] invoice skipped — client has own pending invoice", { unit: unit.key });
    return null;
  }
  const result = await createInvoiceOrder({ organizationId: unit.organizationId, userId: owner.userId, email: owner.email, target, allowIndividual: true });
  if (!result.ok) {
    console.info("[lifecycle] invoice skipped", { unit: unit.key, error: result.error });
    return null;
  }
  // Счёт к письму сценария — не решение клиента «платим» (`hasPendingInvoice`).
  // Помечаем только новый: вернувшийся прежний счёт — чей-то ещё.
  if (automatic && result.created) await claim(`${AUTOMATIC_INVOICE_PREFIX}${result.order.id}`, "lifecycle.invoice").catch(() => null);
  return result.order;
}

type Owner = NonNullable<Awaited<ReturnType<typeof ownerContact>>>;
type Signed = (ManagerSignature & { replyTo: string | null }) | null;

/** Письмо (и Telegram, если привязан) владельцу аккаунта — от имени менеджера. */
async function sendNotice(unit: Unit, owner: Owner, mail: ComposedNotice, kind: string, manager: Signed, invoice: { id: number; pdf: Buffer } | null): Promise<boolean> {
  let sent = false;
  if (owner.telegram) {
    try {
      const { notifyEmployee } = await import("@/lib/telegram");
      await notifyEmployee(owner.userId, mail.telegramText, { label: "Открыть тариф", miniAppUrl: BILLING_PAY_HREF }, { delivery: { organizationId: unit.organizationId, kind: `lifecycle.${kind}` } });
      sent = true;
    } catch (error) {
      console.error("[lifecycle] telegram failed", error);
    }
  }
  if (owner.email) {
    const { emailBrandForOrganization, renderEmailLayout, sendRawEmail } = await import("@/lib/email");
    const html = renderEmailLayout(mail.title, mail.html, await emailBrandForOrganization(unit.organizationId));
    const attachments = invoice ? [{ filename: invoiceFilename(String(invoice.id)).utf8, content: invoice.pdf, contentType: "application/pdf" }] : undefined;
    sent = (await sendRawEmail(owner.email, mail.subject, html, { attachments, replyTo: manager?.replyTo ?? null, text: mail.text }).catch(() => false)) || sent;
  }
  return sent;
}

/** Цели счёта на этой ступени: пробный — подобранный тариф; продление — то, что оплачено. */
function invoiceTarget(unit: Unit, state: State, plan: LifecyclePlan, facts: LifecycleFacts, settings: LifecycleSettings): PlanTarget {
  const paid = paidTierFromPlan(unit.plan);
  if (plan.stage === "renewal_early" && state.paidTier && state.paidTier !== "legacy") {
    return { tier: state.paidTier, cycle: "year", points: Math.max(state.planPoints, unit.pointsInUse) };
  }
  if (plan.stage === "grace_last" && facts.reason === "subscription_expired" && paid !== "legacy") {
    return { tier: paid, cycle: unit.planCycle === "year" ? "year" : "month", points: Math.max(unit.planPoints, unit.pointsInUse) };
  }
  return recommendedTarget(facts.seats, unit.pointsInUse, plan.stage === "renewal_early" ? "year" : settings.invoiceCycle);
}

type ClientMessage = { sent: boolean; invoice: boolean };

async function clientMessage(unit: Unit, state: State, plan: LifecyclePlan, facts: LifecycleFacts, settings: LifecycleSettings, manager: Signed, now: Date): Promise<ClientMessage> {
  const owner = await ownerContact(unit.organizationId);
  if (!owner || !plan.email) return { sent: false, invoice: false };
  const payUrl = `${APP_URL()}${BILLING_PAY_HREF}`;
  const common = { orgName: unit.organizationName, recipientName: owner.name, manager, payUrl, supportTelegram: COMPANY_TELEGRAM.handle };

  if (plan.email === "trial_idle") {
    if (!facts.trialEndsAt) return { sent: false, invoice: false };
    const mail = composeIdleTrialEmail({ ...common, lastDayLabel: formatMskDay(lastDayBefore(facts.trialEndsAt)), workdaysLeft: plan.workdaysLeft, helpUrl: `${APP_URL()}/journals` });
    return { sent: await sendNotice(unit, owner, mail, plan.stage, manager, null), invoice: false };
  }

  const target = invoiceTarget(unit, state, plan, facts, settings);
  const order = plan.invoice && owner.email ? await issueInvoice(unit, target, { userId: owner.userId, email: owner.email }, true, now) : null;
  const rendered = order ? await renderInvoice(order.id).catch(() => null) : null;
  const invoice = order && rendered ? { number: String(order.id), amountRub: Number(order.amountRub), dueLabel: formatMskDay(order.invoiceDueAt ?? new Date(now.getTime() + 7 * DAY_MS)), cycle: target.cycle } : null;
  const attach = order && rendered ? { id: order.id, pdf: rendered.pdf } : null;

  let mail: ComposedNotice;
  if (plan.email === "renewal_early") {
    if (!facts.paidUntil) return { sent: false, invoice: false };
    const amount = invoice?.amountRub ?? (await priceOf(unit.organizationId, target, now));
    mail = composeRenewalEarlyEmail({
      ...common,
      lastDayLabel: formatMskDay(lastDayBefore(facts.paidUntil)),
      daysLeft: Math.max(1, Math.ceil((facts.paidUntil.getTime() - now.getTime()) / DAY_MS)),
      planLabel: `«${TIER_NAMES[target.tier]}»${target.points > 1 ? `, ${target.points} точ.` : ""}`,
      amountRub: amount,
      invoice,
      requisitesUrl: payUrl,
    });
  } else {
    const month = { ...target, cycle: "month" as const };
    const [monthRub, yearRub] = await Promise.all([priceOf(unit.organizationId, month, now), priceOf(unit.organizationId, { ...target, cycle: "year" }, now)]);
    if (monthRub === null || yearRub === null) return { sent: false, invoice: false };
    const shared = {
      ...common,
      seats: facts.seats,
      journals: unit.enabledJournals,
      points: unit.pointsInUse,
      freeUsers: FREE_MAX_USERS,
      freeJournals: FREE_MAX_JOURNALS,
      tierTitle: TIER_NAMES[target.tier],
      monthRub,
      yearRub,
      invoice,
      requisitesUrl: payUrl,
    };
    if (plan.email === "grace_last") {
      if (!facts.graceEndsAt) return { sent: false, invoice: false };
      mail = composeGraceLastEmail({ ...shared, reason: facts.reason === "subscription_expired" ? "subscription_expired" : "trial_ended", lastDayLabel: formatMskDay(lastDayBefore(facts.graceEndsAt)), workdaysLeft: plan.workdaysLeft });
    } else {
      if (!facts.trialEndsAt) return { sent: false, invoice: false };
      mail = composeTrialEmail({ ...shared, stage: plan.stage === "trial_second" ? "trial_second" : "trial_first", lastDayLabel: formatMskDay(lastDayBefore(facts.trialEndsAt)), workdaysLeft: plan.workdaysLeft });
    }
  }
  const sent = await sendNotice(unit, owner, mail, plan.stage, manager, attach);
  return { sent, invoice: Boolean(invoice) };
}

type TaskContext = { staff: StaffPerson[]; managerId: string | null };

/** Факты для задачи — короткими строками, без ссылок (кнопки есть в карточке задачи). */
async function taskFacts(unit: Unit, facts: LifecycleFacts) {
  const owner = await ownerContact(unit.organizationId);
  const ownerUser = owner ? await db.user.findUnique({ where: { id: owner.userId }, select: { phone: true } }) : null;
  const contact = await db.crmContact.findFirst({ where: { organizationId: { in: unit.scopeOrgIds } }, orderBy: { lastActivityAt: "desc" }, select: { id: true } });
  const who = owner ? [owner.name, ownerUser?.phone, owner.email].filter(Boolean).join(" · ") : "контакт владельца не найден";
  const usage = `Сотрудников: ${facts.seats}, журналов: ${unit.enabledJournals}, точек: ${unit.pointsInUse}. Записей за неделю: ${facts.recentEntries}.`;
  return { who, usage, contactId: contact?.id ?? null };
}

/** Задача менеджеру (и согласование, если нужно). Возвращает число созданных. */
async function createTasks(unit: Unit, plan: LifecyclePlan, facts: LifecycleFacts, settings: LifecycleSettings, ctx: TaskContext, dealId: string | null, now: Date): Promise<number> {
  if (!plan.task) return 0;
  const orgs = await db.organization.findMany({ where: { id: { in: unit.scopeOrgIds } }, select: { inn: true } });
  const { who, usage, contactId } = await taskFacts(unit, facts);
  const target = recommendedTarget(facts.seats, unit.pointsInUse);
  const monthRub = await priceOf(unit.organizationId, target, now);
  const due = dueTodayOrNextWorkday(now);
  const name = quoted(unit.organizationName);
  const ends = facts.trialEndsAt ? formatMskDay(lastDayBefore(facts.trialEndsAt)) : null;
  const base = { organizationId: unit.organizationId, contactId, dueAt: due, dealId, assigneeId: ctx.managerId, dedupeKey: taskKey(plan) };
  const offer = monthRub !== null ? `Тариф «${TIER_NAMES[target.tier]}»: ${rub(monthRub)} в месяц.` : null;
  const discount = plan.task.discountPercent ? `Можно дать скидку ${plan.task.discountPercent} % — кнопка «КП со скидкой».` : null;
  const inn = orgs.some((org) => org.inn) ? "Счёт уже ушёл клиенту письмом." : "ИНН не указан — счёт не выставлен, предложите оформить.";

  let task: NewTask;
  if (plan.task.kind === "call") {
    task = {
      ...base,
      kind: "call",
      title: `${plan.task.urgent ? "Срочно: позвонить" : "Позвонить"} ${name} — пробный до ${ends}`,
      note: [`Владелец: ${who}.`, usage, offer, discount, inn].filter(Boolean).join("\n"),
      discountPercent: plan.task.discountPercent,
    };
  } else if (plan.task.kind === "last_chance") {
    const last = facts.graceEndsAt ? formatMskDay(lastDayBefore(facts.graceEndsAt)) : "—";
    task = {
      ...base,
      kind: "last_chance",
      title: `Последний шанс: ${name} — отсрочка до ${last}`,
      note: [
        `Владелец: ${who}.`,
        usage,
        facts.reason === "subscription_expired" ? "Оплата не продлена — после отсрочки команда уйдёт на бесплатный тариф." : "Пробный закончился, тариф не выбран — после отсрочки команда уйдёт на бесплатный.",
        "Письмо со счётом ушло. Узнайте, что мешает: согласование, сумма, неудобно платить.",
        discount,
      ]
        .filter(Boolean)
        .join("\n"),
      discountPercent: plan.task.discountPercent,
    };
  } else if (plan.task.kind === "lost_reason") {
    task = {
      ...base,
      kind: "lost_reason",
      title: `Узнать, почему ${name} не оплатил после пробного`,
      note: [`Владелец: ${who}.`, usage, plan.task.discountPercent ? `Можно вернуть со скидкой ${plan.task.discountPercent} %.` : null, "Итог отметьте при закрытии: отказ, перезвонить, обещали оплатить."].filter(Boolean).join("\n"),
    };
  } else if (plan.task.kind === "winback") {
    task = {
      ...base,
      kind: "winback",
      title: `Вернуть на платный: ${name} ведёт журналы на бесплатном`,
      note: [`Владелец: ${who}.`, usage, "Месяц на бесплатном, а журналы ведут — значит, сервис нужен. Предложите тариф для команды.", offer, discount].filter(Boolean).join("\n"),
      discountPercent: plan.task.discountPercent,
    };
  } else {
    const end = facts.subscriptionEnd ? formatMskDay(lastDayBefore(facts.subscriptionEnd)) : "—";
    task = {
      ...base,
      kind: "payment_overdue",
      title: `Оплата не пришла: ${name} — оплачено было по ${end}`,
      note: [
        `Владелец: ${who}.`,
        facts.paysByInvoice ? "Платят по счёту — позвоните в бухгалтерию: возможно, платёж в пути или счёт не дошёл." : "Платили картой — напомните о продлении, предложите счёт, если удобнее.",
        "Пока решения нет, у клиента идёт отсрочка, потом аккаунт перейдёт на бесплатный тариф.",
      ].join("\n"),
    };
  }

  let created = 0;
  // Согласование — только если скидка выше лимита ответственного (у директора 25 % — сам решает).
  const needsApproval = plan.task.needsApproval && (plan.task.discountPercent ?? 0) > limitOf(ctx.staff, ctx.managerId);
  if (plan.task.kind === "call") await supersedeOpenCalls(unit.scopeOrgIds, task.dedupeKey ?? "");
  // По этому пробному скидку уже решили (на первом касании) — второй раз не спрашиваем.
  const decided =
    plan.task.kind === "call" && needsApproval && facts.trialEndsAt
      ? await db.crmTask.findFirst({
          where: {
            organizationId: { in: unit.scopeOrgIds },
            kind: "approve_discount",
            approvalStatus: { in: ["approved", "rejected"] },
            dedupeKey: { startsWith: `lc:${unit.key}:trial:${facts.trialEndsAt.toISOString()}:` },
          },
          orderBy: { decidedAt: "desc" },
          select: { approvalStatus: true, discountPercent: true },
        })
      : null;
  if (decided) {
    const approved = decided.approvalStatus === "approved";
    task = {
      ...task,
      approvalStatus: approved ? "approved" : "rejected",
      discountPercent: approved ? decided.discountPercent : null,
      note: `${task.note}\n${approved ? `Скидку ${decided.discountPercent} % уже согласовали.` : "Особую скидку не согласовали — предложите обычные условия."}`,
    };
  } else if (plan.task.kind === "call" && needsApproval && plan.task.discountPercent) {
    // Особая скидка большому клиенту — сначала решение; звонок ждёт.
    let approval = await db.crmTask.findFirst({ where: { organizationId: { in: unit.scopeOrgIds }, kind: "approve_discount", approvalStatus: "pending" }, select: { id: true } });
    if (!approval) {
      const approver = approverFor(ctx.staff, plan.task.discountPercent, ctx.managerId, settings.approverId);
      const made = await createCrmTask({
        ...base,
        kind: "approve_discount",
        title: `Согласовать скидку ${plan.task.discountPercent} % для ${name} (${facts.seats} сотрудников)`,
        note: [usage, monthRub !== null ? `Без скидки: ${rub(monthRub)} в месяц.` : null, `Пробный до ${ends}. Решение нужно сегодня — менеджер ждёт, чтобы позвонить.`].filter(Boolean).join("\n"),
        assigneeId: approver?.id ?? settings.approverId,
        dedupeKey: `${plan.key}:approval`,
        discountPercent: plan.task.discountPercent,
        approvalStatus: "pending",
        terms: { tier: target.tier, cycle: target.cycle, points: target.points, percent: plan.task.discountPercent, requestedById: ctx.managerId, source: "lifecycle" },
      });
      if (made) {
        created += 1;
        await notifyTaskAssignee(made).catch(() => 0);
        approval = { id: made.id };
      }
    }
    if (approval) task = { ...task, status: "waiting", approvalTaskId: approval.id, note: `${task.note}\nЖдёт согласования скидки.` };
  }
  const made = await createCrmTask(task);
  if (made) {
    created += 1;
    if (made.status === "open") await notifyTaskAssignee(made).catch(() => 0);
  }
  return created;
}

/** Данные единицы для решения; дорогие запросы — только тем, у кого есть ступень. */
export async function lifecycleFactsFor(unit: Unit, state: State, now: Date, cheap: boolean): Promise<LifecycleFacts> {
  const facts: LifecycleFacts = {
    key: unit.key,
    kind: state.kind,
    reason: state.reason,
    trialEndsAt: state.trialEndsAt,
    paidUntil: state.paidUntil,
    subscriptionEnd: unit.subscriptionEnd,
    graceEndsAt: state.graceEndsAt,
    planCycle: state.planCycle,
    autoRenew: false,
    seats: state.activeUsers,
    // Сначала «как будто живой и начал»: проверим, есть ли ступень вообще.
    recentEntries: 1,
    totalEntries: 1,
    paysByInvoice: true,
    pendingInvoice: false,
    inactive: unit.inactive || unit.exempt,
  };
  if (cheap) return facts;
  facts.recentEntries = await entriesSince(unit.scopeOrgIds, new Date(now.getTime() - 7 * DAY_MS));
  facts.totalEntries = facts.recentEntries > 0 ? facts.recentEntries : await entriesSince(unit.scopeOrgIds, null);
  facts.paysByInvoice = await paysByInvoice(unit.scopeOrgIds);
  facts.pendingInvoice = await hasPendingInvoice(unit.scopeOrgIds, now, { includeAutomatic: true });
  facts.autoRenew = state.kind === "paid" && unit.autoRenew ? await autoRenewCovers(unit, now) : false;
  return facts;
}

/** Продлится ли само с баланса: включено, ничто не мешает и денег хватает. */
async function autoRenewCovers(unit: Unit, now: Date): Promise<boolean> {
  try {
    const { previewForUnit } = await import("@/lib/balance/auto-renew.server");
    const preview = await previewForUnit(unit, now);
    return preview.enabled && !preview.blockedReason && preview.priceRub !== null && preview.shortRub === 0;
  } catch (error) {
    console.error("[lifecycle] auto-renew preview failed", { unit: unit.key, error });
    return false;
  }
}

/**
 * «Узнать причину» и «вернуть» — продолжение разговора: только тем, кому
 * сценарий уже писал перед концом пробного (старые аккаунты без писем не трогаем).
 */
async function wasWarned(unit: Unit, plan: LifecyclePlan, facts: LifecycleFacts): Promise<boolean> {
  if (!(plan.stage === "trial_lost" || (plan.stage === "winback" && facts.reason !== "subscription_expired")) || !facts.trialEndsAt) return true;
  const warned = await db.crmReminderLog.count({ where: { dedupeKey: { startsWith: `lc:${unit.key}:trial:${facts.trialEndsAt.toISOString()}:trial_` } } });
  return warned > 0;
}

export type LifecyclePreview = { unitKey: string; organizationId: string; organizationName: string; stage: string; stageLabel: string; email: string | null; invoice: boolean; task: string | null; assigneeId: string | null; done: boolean };

/**
 * Что сценарий сделает в ближайшие `days` дней (прогон в 06:15 каждого дня):
 * кому письмо и какая задача. Данные — сегодняшние; уже сделанное отмечено.
 */
export async function forecastLifecycle(days = 7, from: Date = new Date()): Promise<{ day: string; items: LifecyclePreview[] }[]> {
  const settings = await readLifecycleSettings();
  const [trialSettings, units, staff] = await Promise.all([readTrialSettings(), listBillingUnits(), loadPlatformStaff()]);
  const orgs = await db.organization.findMany({ where: { id: { in: units.flatMap((unit) => unit.scopeOrgIds) } }, select: { id: true, accountManagerId: true } });
  const manager = new Map(orgs.map((org) => [org.id, org.accountManagerId]));
  const cache = new Map<string, LifecycleFacts>();
  // Ступень с окном (просрочка — 14 дней) даёт тот же ключ каждый день: показываем её один раз.
  const seen = new Set<string>();
  const out: { day: string; items: LifecyclePreview[] }[] = [];
  for (let offset = 0; offset < days; offset += 1) {
    const day = new Date(from.getTime() + offset * DAY_MS);
    const key = new Date(day.getTime() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const run = new Date(`${key}T06:15:00+03:00`);
    const at = offset === 0 && run < from ? from : run;
    const items: LifecyclePreview[] = [];
    for (const unit of units) {
      const state = stateForUnit(unit, trialSettings, at);
      const cheap = await lifecycleFactsFor(unit, state, at, true);
      if (!planLifecycle(cheap, settings, at)) continue;
      let real = cache.get(unit.key);
      if (!real) {
        real = await lifecycleFactsFor(unit, state, at, false);
        cache.set(unit.key, real);
      }
      const facts = { ...cheap, recentEntries: real.recentEntries, totalEntries: real.totalEntries, paysByInvoice: real.paysByInvoice, pendingInvoice: real.pendingInvoice };
      const plan = planLifecycle(facts, settings, at);
      if (!plan || seen.has(plan.key) || !(await wasWarned(unit, plan, facts))) continue;
      seen.add(plan.key);
      const [logged, tasked] = await Promise.all([
        db.crmReminderLog.count({ where: { dedupeKey: plan.key } }),
        plan.task ? db.crmTask.count({ where: { dedupeKey: taskKey(plan) } }) : Promise.resolve(0),
      ]);
      const done = (plan.email || plan.invoice ? logged > 0 : true) && (plan.task ? tasked > 0 : true);
      // Сделанное раньше — только в сегодняшнем дне, дальше это не прогноз.
      if (done && offset > 0) continue;
      const accountManager = unit.scopeOrgIds.map((id) => manager.get(id)).find(Boolean) ?? null;
      items.push({
        unitKey: unit.key,
        organizationId: unit.organizationId,
        organizationName: unit.organizationName,
        stage: plan.stage,
        stageLabel: LIFECYCLE_STAGE_LABELS[plan.stage],
        email: plan.email,
        invoice: plan.invoice,
        task: plan.task?.kind ?? null,
        assigneeId: plan.task ? pickAssignee(staff, [accountManager, settings.assigneeId]) : null,
        done,
      });
    }
    out.push({ day: key, items });
  }
  return out;
}

export async function runLifecycleJob(options: { now?: Date; dryRun?: boolean } = {}): Promise<LifecycleReport> {
  const now = options.now ?? new Date();
  const dryRun = options.dryRun === true;
  const settings = await readLifecycleSettings();
  const report: LifecycleReport = { enabled: settings.enabled, dryRun, planned: 0, emails: 0, invoices: 0, tasks: 0, failed: 0, results: [] };
  if (!settings.enabled) return report;
  if (!dryRun) await syncDeals(now).catch((error) => console.error("[lifecycle] deals sync failed", error));
  const [trialSettings, units, staff] = await Promise.all([readTrialSettings(), listBillingUnits(), loadPlatformStaff()]);
  const orgs = await db.organization.findMany({ where: { id: { in: units.flatMap((unit) => unit.scopeOrgIds) } }, select: { id: true, accountManagerId: true } });
  const accountManager = new Map(orgs.map((org) => [org.id, org.accountManagerId]));

  for (const unit of units) {
    const state = stateForUnit(unit, trialSettings, now);
    if (!planLifecycle(await lifecycleFactsFor(unit, state, now, true), settings, now)) continue;
    let stage = "?";
    try {
      const facts = await lifecycleFactsFor(unit, state, now, false);
      const plan = planLifecycle(facts, settings, now);
      if (!plan || !(await wasWarned(unit, plan, facts))) continue;
      stage = plan.stage;
      report.planned += 1;
      if (dryRun) {
        report.results.push({ unit: unit.key, stage, outcome: `planned: email=${plan.email ?? "—"} invoice=${plan.invoice} task=${plan.task?.kind ?? "—"}` });
        continue;
      }
      const managerId = pickAssignee(staff, [unit.scopeOrgIds.map((id) => accountManager.get(id)).find(Boolean) ?? null, settings.assigneeId]);
      const manager = await managerSignature(managerId);
      const outcome: string[] = [];
      if (plan.email || plan.invoice) {
        const claimed = await claim(plan.key, `lifecycle.${plan.stage}`);
        if (claimed) {
          if (plan.email) {
            const result = await clientMessage(unit, state, plan, facts, settings, manager, now);
            if (!result.sent) await release(claimed);
            else {
              report.emails += 1;
              if (result.invoice) report.invoices += 1;
              await advanceDealFor({ organizationIds: unit.scopeOrgIds }, "message_sent", { messageSentAt: now }).catch(() => null);
            }
            outcome.push(result.sent ? `email${result.invoice ? "+invoice" : ""}` : "email failed");
          } else {
            // Продление по счёту: тот же тариф, период и точки.
            const owner = await ownerContact(unit.organizationId);
            const tier = state.paidTier && state.paidTier !== "legacy" ? (state.paidTier as PaidTier) : null;
            const order = owner?.email && tier ? await issueInvoice(unit, { tier, cycle: state.planCycle, points: state.planPoints }, { userId: owner.userId, email: owner.email }, false, now) : null;
            if (order) {
              await deliverInvoice(order.id, unit.organizationName);
              report.invoices += 1;
              outcome.push(`invoice #${order.id}`);
            } else {
              await release(claimed);
              outcome.push("invoice skipped");
            }
          }
        } else outcome.push("already sent");
      }
      if (plan.task) {
        const dealId = await db.crmDeal
          .findFirst({ where: { organizationId: { in: unit.scopeOrgIds }, stage: { notIn: ["won"] } }, orderBy: { periodEnd: "desc" }, select: { id: true } })
          .then((deal) => deal?.id ?? null);
        const created = await createTasks(unit, plan, facts, settings, { staff, managerId }, dealId, now);
        report.tasks += created;
        outcome.push(created ? `tasks +${created}` : "task exists");
      }
      report.results.push({ unit: unit.key, stage, outcome: outcome.join(", ") || "nothing" });
    } catch (error) {
      report.failed += 1;
      report.results.push({ unit: unit.key, stage, outcome: `error: ${error instanceof Error ? error.message : String(error)}` });
      console.error("[lifecycle] unit failed", { unit: unit.key, error });
    }
  }
  console.info("[lifecycle] done", { dryRun, planned: report.planned, emails: report.emails, invoices: report.invoices, tasks: report.tasks, failed: report.failed });
  return report;
}
