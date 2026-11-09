import { Prisma } from "@prisma/client";

import { TOPUP_TARIFF_KEY } from "@/lib/balance/topup-core";
import { BILLING_PAY_HREF, formatMskDay, lastDayBefore } from "@/lib/billing-period";
import { hasPendingInvoice, listBillingUnits, ownerContact, readTrialSettings, stateForUnit } from "@/lib/billing.server";
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
import { FREE_MAX_JOURNALS, tierForHeadcount, type PaidTier, type PlanTarget } from "@/lib/tariff-plans";

import { dueTodayOrNextWorkday } from "./calendar";
import { composeTrialEmail, rub } from "./emails";
import { planLifecycle, taskKey, type LifecycleFacts, type LifecyclePlan, type LifecycleSettings } from "./plan";

/**
 * Ежедневный прогон сценария «пробный и оплата» (2026-11-09): зовёт его
 * крон биллинга (`/api/cron/billing-transition`, 06:15 МСК). Решения —
 * `planLifecycle`, здесь только данные и исполнение. Повторный запуск
 * безопасен: письмо и счёт — по ключу в `CrmReminderLog`, задача — по
 * `CrmTask.dedupeKey`.
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

/** «Забрать» ключ события: true — наш, можно отправлять. */
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

async function recentEntries(orgIds: string[], since: Date): Promise<number> {
  const [entries, cells] = await Promise.all([
    db.journalEntry.count({ where: { organizationId: { in: orgIds }, createdAt: { gte: since } } }),
    db.journalDocumentEntry.count({ where: { document: { organizationId: { in: orgIds } }, createdAt: { gte: since } } }),
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
function recommendedTarget(seats: number, points: number): PlanTarget {
  const perPoint = Math.ceil(Math.max(1, seats) / Math.max(1, points));
  return { tier: tierForHeadcount(perPoint), cycle: "month", points: Math.max(1, points) };
}

async function priceOf(organizationId: string, target: PlanTarget, now: Date): Promise<number | null> {
  const quote = await quoteCheckout({ organizationId, target, now, allowIndividual: true }).catch(() => null);
  return quote && quote.ok ? quote.offer.priceRub : null;
}

/** Счёт на тариф (если у организации есть ИНН и реквизиты исполнителя заполнены). */
async function issueInvoice(unit: Unit, target: PlanTarget, owner: { userId: string; email: string }) {
  const result = await createInvoiceOrder({ organizationId: unit.organizationId, userId: owner.userId, email: owner.email, target, allowIndividual: true });
  if (!result.ok) {
    console.info("[lifecycle] invoice skipped", { unit: unit.key, error: result.error });
    return null;
  }
  return result.order;
}

async function trialEmail(unit: Unit, plan: LifecyclePlan, facts: LifecycleFacts, now: Date): Promise<{ sent: boolean; invoice: boolean }> {
  const owner = await ownerContact(unit.organizationId);
  if (!owner || !facts.trialEndsAt) return { sent: false, invoice: false };
  const target = recommendedTarget(facts.seats, unit.pointsInUse);
  const [monthRub, yearRub] = await Promise.all([priceOf(unit.organizationId, target, now), priceOf(unit.organizationId, { ...target, cycle: "year" }, now)]);
  if (monthRub === null || yearRub === null) return { sent: false, invoice: false };

  const order = owner.email ? await issueInvoice(unit, target, { userId: owner.userId, email: owner.email }) : null;
  const rendered = order ? await renderInvoice(order.id).catch(() => null) : null;
  const payUrl = `${APP_URL()}${BILLING_PAY_HREF}`;
  const mail = composeTrialEmail({
    stage: plan.stage === "trial_second" ? "trial_second" : "trial_first",
    orgName: unit.organizationName,
    lastDayLabel: formatMskDay(lastDayBefore(facts.trialEndsAt)),
    workdaysLeft: plan.workdaysLeft,
    seats: facts.seats,
    journals: unit.enabledJournals,
    points: unit.pointsInUse,
    freeUsers: FREE_MAX_USERS,
    freeJournals: FREE_MAX_JOURNALS,
    tierTitle: TIER_NAMES[target.tier],
    monthRub,
    yearRub,
    invoice: order && rendered ? { number: String(order.id), amountRub: Number(order.amountRub), dueLabel: formatMskDay(order.invoiceDueAt ?? new Date(now.getTime() + 7 * DAY_MS)) } : null,
    payUrl,
    requisitesUrl: payUrl,
    supportTelegram: COMPANY_TELEGRAM.handle,
  });

  let sent = false;
  if (owner.telegram) {
    try {
      const { notifyEmployee } = await import("@/lib/telegram");
      await notifyEmployee(owner.userId, mail.telegramText, { label: "Продлить доступ", miniAppUrl: BILLING_PAY_HREF }, { delivery: { organizationId: unit.organizationId, kind: `lifecycle.${plan.stage}` } });
      sent = true;
    } catch (error) {
      console.error("[lifecycle] telegram failed", error);
    }
  }
  if (owner.email) {
    const { emailBrandForOrganization, renderEmailLayout, sendRawEmail } = await import("@/lib/email");
    const html = renderEmailLayout(mail.title, mail.html, await emailBrandForOrganization(unit.organizationId));
    const attachments = order && rendered ? [{ filename: invoiceFilename(String(order.id)).utf8, content: rendered.pdf, contentType: "application/pdf" }] : undefined;
    sent = (await sendRawEmail(owner.email, mail.subject, html, { attachments }).catch(() => false)) || sent;
  }
  return { sent, invoice: Boolean(order && rendered) };
}

/** Задача менеджеру (и согласование, если нужно). Возвращает число созданных. */
async function createTasks(unit: Unit, plan: LifecyclePlan, facts: LifecycleFacts, settings: LifecycleSettings, now: Date): Promise<number> {
  if (!plan.task) return 0;
  const orgs = await db.organization.findMany({ where: { id: { in: unit.scopeOrgIds } }, select: { id: true, accountManagerId: true, inn: true } });
  const managerId = orgs.find((org) => org.accountManagerId)?.accountManagerId ?? settings.assigneeId;
  const owner = await ownerContact(unit.organizationId);
  const ownerUser = owner ? await db.user.findUnique({ where: { id: owner.userId }, select: { phone: true } }) : null;
  const contact = await db.crmContact.findFirst({ where: { organizationId: { in: unit.scopeOrgIds } }, orderBy: { lastActivityAt: "desc" }, select: { id: true } });
  const target = recommendedTarget(facts.seats, unit.pointsInUse);
  const monthRub = await priceOf(unit.organizationId, target, now);
  const due = dueTodayOrNextWorkday(now);
  const name = unit.organizationName;
  const ends = facts.trialEndsAt ? formatMskDay(lastDayBefore(facts.trialEndsAt)) : null;
  const who = owner ? [owner.name, ownerUser?.phone, owner.email].filter(Boolean).join(" · ") : "контакт владельца не найден";
  const facts1 = `Сотрудников: ${facts.seats}, журналов: ${unit.enabledJournals}, точек: ${unit.pointsInUse}. Записей в журналах за неделю: ${facts.recentEntries}.`;
  const card = `${APP_URL()}/root/organizations/${unit.organizationId}`;
  const base = { organizationId: unit.organizationId, contactId: contact?.id ?? null, dueAt: due };

  let task: NewTask;
  if (plan.task.kind === "call") {
    const offer = monthRub !== null ? `Тариф «${TIER_NAMES[target.tier]}»: ${rub(monthRub)} в месяц.` : null;
    const discount = plan.task.discountPercent ? `КП со скидкой ${plan.task.discountPercent} % — карточка клиента → «Документы клиенту».` : null;
    task = {
      ...base,
      kind: "call",
      title: `${plan.task.urgent ? "Срочно: " : ""}позвонить «${name}» — пробный до ${ends}`,
      note: [`Владелец: ${who}.`, facts1, offer, discount, orgs.some((org) => org.inn) ? "Счёт уже ушёл клиенту письмом." : "ИНН не указан — счёт не выставлен, предложите оформить.", card].filter(Boolean).join("\n"),
      assigneeId: managerId ?? null,
      dedupeKey: taskKey(plan),
      discountPercent: plan.task.discountPercent,
    };
  } else if (plan.task.kind === "lost_reason") {
    task = {
      ...base,
      kind: "lost_reason",
      title: `Узнать, почему «${name}» не оплатил после пробного`,
      note: [`Владелец: ${who}.`, facts1, plan.task.discountPercent ? `Можно вернуть со скидкой ${plan.task.discountPercent} %.` : null, "Итог запишите в задачу: отказ, отложили, вернули.", card].filter(Boolean).join("\n"),
      assigneeId: managerId ?? null,
      dedupeKey: taskKey(plan),
    };
  } else {
    const end = facts.subscriptionEnd ? formatMskDay(lastDayBefore(facts.subscriptionEnd)) : "—";
    task = {
      ...base,
      kind: "payment_overdue",
      title: `Оплата не пришла: «${name}» — оплачено было по ${end}`,
      note: [
        `Владелец: ${who}.`,
        facts.paysByInvoice ? "Платят по счёту — позвоните в бухгалтерию: возможно, платёж в пути или счёт не дошёл." : "Платили картой — напомните о продлении, предложите счёт, если удобнее.",
        "Пока решения нет, у клиента идёт отсрочка, потом аккаунт перейдёт на бесплатный тариф.",
        card,
      ].join("\n"),
      assigneeId: managerId ?? null,
      dedupeKey: taskKey(plan),
    };
  }

  let created = 0;
  if (plan.task.kind === "call") await supersedeOpenCalls(unit.scopeOrgIds, task.dedupeKey ?? "");
  if (plan.task.kind === "call" && plan.task.needsApproval) {
    // Особая скидка большому клиенту — сначала решение директора; звонок ждёт.
    let approval = await db.crmTask.findFirst({ where: { organizationId: { in: unit.scopeOrgIds }, kind: "approve_discount", approvalStatus: "pending" }, select: { id: true } });
    if (!approval) {
      const made = await createCrmTask({
        ...base,
        kind: "approve_discount",
        title: `Согласовать скидку ${plan.task.discountPercent ?? 0} % для «${name}» (${facts.seats} сотрудников)`,
        note: [facts1, monthRub !== null ? `Без скидки: ${rub(monthRub)} в месяц.` : null, `Пробный до ${ends}. Решение нужно сегодня — менеджер ждёт, чтобы позвонить.`, card].filter(Boolean).join("\n"),
        assigneeId: settings.approverId,
        dedupeKey: `${plan.key}:approval`,
        discountPercent: plan.task.discountPercent,
        approvalStatus: "pending",
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

export async function runLifecycleJob(options: { now?: Date; dryRun?: boolean } = {}): Promise<LifecycleReport> {
  const now = options.now ?? new Date();
  const dryRun = options.dryRun === true;
  const settings = await readLifecycleSettings();
  const report: LifecycleReport = { enabled: settings.enabled, dryRun, planned: 0, emails: 0, invoices: 0, tasks: 0, failed: 0, results: [] };
  if (!settings.enabled) return report;
  const trialSettings = await readTrialSettings();
  const units = await listBillingUnits();
  const weekAgo = new Date(now.getTime() - 7 * DAY_MS);

  for (const unit of units) {
    const state = stateForUnit(unit, trialSettings, now);
    const facts: LifecycleFacts = {
      key: unit.key,
      kind: state.kind,
      reason: state.reason,
      trialEndsAt: state.trialEndsAt,
      paidUntil: state.paidUntil,
      subscriptionEnd: unit.subscriptionEnd,
      seats: state.activeUsers,
      // Сначала «как будто живой»: дорогие запросы — только тем, у кого есть ступень.
      recentEntries: 1,
      paysByInvoice: true,
      pendingInvoice: false,
      inactive: unit.inactive || unit.exempt,
    };
    if (!planLifecycle(facts, settings, now)) continue;
    let stage = "?";
    try {
      facts.recentEntries = await recentEntries(unit.scopeOrgIds, weekAgo);
      facts.paysByInvoice = await paysByInvoice(unit.scopeOrgIds);
      facts.pendingInvoice = await hasPendingInvoice(unit.scopeOrgIds, now);
      const plan = planLifecycle(facts, settings, now);
      if (!plan) continue;
      // «Узнать причину» — продолжение разговора: только тем, кому сценарий
      // уже писал перед концом пробного (старые аккаунты без писем не трогаем).
      if (plan.stage === "trial_lost" && facts.trialEndsAt) {
        const warned = await db.crmReminderLog.count({ where: { dedupeKey: { startsWith: `lc:${unit.key}:trial:${facts.trialEndsAt.toISOString()}:trial_` } } });
        if (!warned) continue;
      }
      stage = plan.stage;
      report.planned += 1;
      if (dryRun) {
        report.results.push({ unit: unit.key, stage, outcome: `planned: email=${plan.email} invoice=${plan.invoice} task=${plan.task?.kind ?? "—"}` });
        continue;
      }
      const outcome: string[] = [];
      if (plan.email || plan.invoice) {
        const claimed = await claim(plan.key, `lifecycle.${plan.stage}`);
        if (claimed) {
          if (plan.email) {
            const result = await trialEmail(unit, plan, facts, now);
            if (!result.sent) await release(claimed);
            else {
              report.emails += 1;
              if (result.invoice) report.invoices += 1;
            }
            outcome.push(result.sent ? `email${result.invoice ? "+invoice" : ""}` : "email failed");
          } else {
            // Продление по счёту: тот же тариф, период и точки.
            const owner = await ownerContact(unit.organizationId);
            const tier = state.paidTier && state.paidTier !== "legacy" ? (state.paidTier as PaidTier) : null;
            const order = owner?.email && tier ? await issueInvoice(unit, { tier, cycle: state.planCycle, points: state.planPoints }, { userId: owner.userId, email: owner.email }) : null;
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
        const created = await createTasks(unit, plan, facts, settings, now);
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
