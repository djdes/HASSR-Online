import { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { emailBrandForOrganization, renderEmailLayout, sendRawEmail, type EmailAttachment } from "@/lib/email";
import { staffSender } from "@/lib/client-documents.server";
import { createInvoiceOrder, renderInvoice } from "@/lib/invoices/service";
import { invoiceFilename } from "@/lib/invoices/build";
import { claim, deliver, settle } from "@/lib/crm/notify.server";
import { ingestCrmItems, resolveCrmContact } from "@/lib/crm/ingest.server";
import { readPlanPricing } from "@/lib/tariffs";

import { DAY_MS, mskDay } from "./calendar";
import { quoted, renderClientMessage, renderTaskCopy, type ManagerSignature } from "./copy";
import type { OfferSnapshot } from "./offer";
import { loadPlatformStaff, limitOf, pickAssignee, type StaffPerson } from "./people.server";
import {
  planLifecycle,
  STAGE_SCENARIOS,
  type DealView,
  type InvoiceTarget,
  type LifecyclePlan,
  type MessagePlan,
  type TaskPlan,
} from "./planner";
import type { LifecycleSettings } from "./settings";
import { readLifecycleSettings } from "./settings.server";
import { AUTO_INVOICE_PREFIX, loadLifecycleSnapshots, type SnapshotRow } from "./snapshot.server";
import { advanceStage, isOpenStage, type DealStage } from "./stages";

/**
 * Исполнитель автоворонки: снимки аккаунтов → план (`planner.ts`) → сделки,
 * письма клиенту со счётом, задачи ответственным, оповещения. Каждое действие
 * — по уникальному ключу (`CrmReminderLog` для писем, `CrmTask.dedupeKey` для
 * задач, `CrmDeal.dedupeKey` для сделок): два прогона подряд ничего не
 * дублируют. Запускается из прогона CRM (крон раз в 5 минут) не чаще раза в
 * 15 минут; кнопка «Обновить сейчас» и проверка — без паузы.
 */

const APP_URL = () => (process.env.NEXTAUTH_URL || "https://wesetup.ru").replace(/\/+$/, "");
const LAST_RUN_KEY = "crm:lifecycle:lastRun";
const MIN_INTERVAL_MS = 15 * 60 * 1000;

export type LifecycleRunResult = {
  ok: boolean;
  skipped?: "disabled" | "interval";
  dryRun: boolean;
  now: string;
  scanned: number;
  deals: { created: number; won: number; lost: number; moved: number };
  messages: { sent: number; failed: number };
  tasks: { created: number; superseded: number; closed: number };
  errors: string[];
  /** Что сделано (для прогноза и проверки). */
  log: string[];
};

function emptyResult(now: Date, dryRun: boolean): LifecycleRunResult {
  return { ok: true, dryRun, now: now.toISOString(), scanned: 0, deals: { created: 0, won: 0, lost: 0, moved: 0 }, messages: { sent: 0, failed: 0 }, tasks: { created: 0, superseded: 0, closed: 0 }, errors: [], log: [] };
}

function dealView(row: {
  id: string;
  dedupeKey: string;
  kind: string;
  stage: string;
  stageManual: boolean;
  periodEnd: Date | null;
  offerJson: Prisma.JsonValue;
  contractSignedAt: Date | null;
}): DealView {
  return {
    id: row.id,
    dedupeKey: row.dedupeKey,
    kind: row.kind === "renewal" ? "renewal" : "trial",
    stage: row.stage,
    stageManual: row.stageManual,
    periodEnd: row.periodEnd,
    offer: (row.offerJson as OfferSnapshot | null) ?? null,
    contractSignedAt: row.contractSignedAt,
  };
}

function planKeys(plan: LifecyclePlan): { messages: string[]; tasks: string[] } {
  return { messages: plan.messages.map((m) => m.key), tasks: plan.tasks.map((t) => t.key) };
}

async function existingKeys(messageKeys: string[], taskKeys: string[]): Promise<Set<string>> {
  const done = new Set<string>();
  if (messageKeys.length) {
    for (const row of await db.crmReminderLog.findMany({ where: { dedupeKey: { in: messageKeys } }, select: { dedupeKey: true } })) done.add(row.dedupeKey);
  }
  if (taskKeys.length) {
    for (const row of await db.crmTask.findMany({ where: { dedupeKey: { in: taskKeys } }, select: { dedupeKey: true } })) if (row.dedupeKey) done.add(row.dedupeKey);
  }
  return done;
}

async function signatureOf(userId: string | null): Promise<ManagerSignature | null> {
  if (!userId) return null;
  const sender = await staffSender(userId).catch(() => null);
  return sender ? { name: sender.name, position: sender.position ?? null, phone: sender.phone, email: sender.email } : null;
}

function isUnique(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/** Контакт CRM владельца аккаунта (переписка сделки): найти или завести. */
async function ensureOwnerContact(row: SnapshotRow, now: Date): Promise<{ id: string; ownerId: string | null } | null> {
  if (!row.owner) return null;
  const resolved = await resolveCrmContact(
    {
      email: row.owner.email,
      phone: row.owner.phone,
      name: row.owner.name,
      userId: row.owner.userId,
      organizationId: row.unit.organizationId,
      company: row.unit.organizationName,
    },
    { create: true, source: "signup", occurredAt: now },
  );
  if (!resolved) return null;
  const contact = await db.crmContact.findUnique({ where: { id: resolved.id }, select: { id: true, ownerId: true } });
  return contact;
}

async function event(contactId: string | null, key: string, body: string, now: Date, subject?: string): Promise<void> {
  if (!contactId) return;
  await ingestCrmItems([{ externalKey: key, contactId, channel: "note", direction: "event", subject: subject ?? null, body, occurredAt: now, authorName: "Автоворонка", identity: {} }]).catch((error) =>
    console.error("[crm-lifecycle] запись в ленту не удалась", error),
  );
}

type DealRow = { id: string; stage: string; stageManual: boolean; ownerId: string | null; invoiceOrderId: number | null; messageSentAt: Date | null; offerJson?: Prisma.JsonValue };

type UnitContext = {
  row: SnapshotRow;
  contactId: string | null;
  assigneeId: string | null;
  deals: Map<string, DealRow>;
};

/** Счёт для письма: действующий неоплаченный на подписку или новый по рекомендации. */
async function ensureInvoice(ctx: UnitContext, target: InvoiceTarget, now: Date, dryRun: boolean): Promise<{ id: number; amountRub: number; dueAt: Date; pdf: Buffer } | null> {
  const { row } = ctx;
  if (!row.owner?.email) return null;
  const valid = row.unit.invoices
    .filter((invoice) => !invoice.dueAt || invoice.dueAt.getTime() > now.getTime() + DAY_MS)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  let orderId = valid?.id ?? null;
  if (!orderId) {
    if (dryRun) return null;
    const created = await createInvoiceOrder({ organizationId: row.unit.organizationId, userId: row.owner.userId, email: row.owner.email, target }).catch((error) => {
      console.error("[crm-lifecycle] счёт не выставлен", error);
      return null;
    });
    if (!created?.ok) {
      if (created && !created.ok) console.warn(`[crm-lifecycle] счёт ${row.unit.unitKey}: ${created.error}`);
      return null;
    }
    orderId = created.order.id;
    // Счёт автоворонки помечаем, чтобы не ставить по нему задачу «счёт не оплачен».
    // Вернулся уже существующий (клиент выставил сам) — это не наш счёт.
    if (created.created) await claim(`${AUTO_INVOICE_PREFIX}${orderId}`, "lifecycle_invoice", ctx.contactId).catch(() => null);
    row.unit.invoices.push({ id: orderId, createdAt: created.order.createdAt, dueAt: created.order.invoiceDueAt, amountRub: Number(created.order.amountRub), auto: created.created });
  }
  const rendered = await renderInvoice(orderId).catch(() => null);
  if (!rendered) return null;
  return {
    id: orderId,
    amountRub: Number(rendered.order.amountRub),
    dueAt: rendered.order.invoiceDueAt ?? new Date(rendered.order.createdAt.getTime() + 7 * DAY_MS),
    pdf: rendered.pdf,
  };
}

async function moveDeal(dealId: string, current: { stage: string; stageManual: boolean }, to: DealStage, data: Prisma.CrmDealUpdateInput = {}): Promise<DealStage | null> {
  const next = advanceStage(current, to);
  await db.crmDeal.update({ where: { id: dealId }, data: { ...data, ...(next ? { stage: next } : {}) } });
  return next;
}

async function sendMessage(ctx: UnitContext, message: MessagePlan, now: Date, dryRun: boolean, result: LifecycleRunResult): Promise<boolean> {
  const { row } = ctx;
  const owner = row.owner;
  if (!owner || (!owner.email && !owner.telegramChatId)) return false;
  if (dryRun) {
    result.log.push(`✉️ ${row.unit.organizationName}: ${message.scenario} за ${message.stage} дн.${message.attachInvoice ? " + счёт" : ""}`);
    return true;
  }
  const logId = await claim(message.key, "lifecycle_message", ctx.contactId);
  if (!logId) return false;
  const invoice = message.attachInvoice && message.invoiceTarget ? await ensureInvoice(ctx, message.invoiceTarget, now, dryRun) : null;
  const manager = await signatureOf(ctx.assigneeId);
  const app = APP_URL();
  const rendered = renderClientMessage(message, {
    orgName: row.unit.organizationName,
    recipientName: owner.name?.trim() || null,
    invoice: invoice ? { number: String(invoice.id), amountRub: invoice.amountRub, dueDay: mskDay(new Date(invoice.dueAt.getTime() - 1)) } : null,
    innMissing: message.innHint,
    manager,
    links: { pay: `${app}/settings/subscription`, pricing: `${app}/pricing`, organization: `${app}/settings/organization` },
    graceDays: row.graceDays,
  });
  let delivered = 0;
  if (owner.email) {
    const attachments: EmailAttachment[] = invoice ? [{ filename: invoiceFilename(String(invoice.id)).utf8, content: invoice.pdf, contentType: "application/pdf" }] : [];
    const brand = await emailBrandForOrganization(row.unit.organizationId).catch(() => null);
    const html = renderEmailLayout(rendered.subject, rendered.html, brand, { preheader: rendered.subject });
    const ok = await sendRawEmail(owner.email, rendered.subject, html, { replyTo: manager?.email ?? null, attachments }).catch((error) => {
      console.error("[crm-lifecycle] письмо не ушло", error);
      return false;
    });
    if (ok) delivered += 1;
  }
  if (owner.telegramChatId && message.telegram) {
    try {
      const { notifyEmployee } = await import("@/lib/telegram");
      await notifyEmployee(owner.userId, rendered.telegram, { label: "Оплатить", miniAppUrl: "/settings/subscription" }, { delivery: { organizationId: row.unit.organizationId, kind: "crm:lifecycle" } });
      delivered += 1;
    } catch (error) {
      console.error("[crm-lifecycle] Telegram не ушёл", error);
    }
  }
  await settle(logId, delivered);
  if (!delivered) {
    result.messages.failed += 1;
    return false;
  }
  result.messages.sent += 1;
  result.log.push(`✉️ ${row.unit.organizationName}: ${rendered.subject}${invoice ? ` + счёт № ${invoice.id}` : ""}`);
  if (ctx.contactId) {
    await ingestCrmItems([
      {
        externalKey: message.key,
        contactId: ctx.contactId,
        channel: "email",
        direction: "event",
        subject: `Автоворонка: ${rendered.subject}`,
        body: `${rendered.text}${invoice ? `\n\nВо вложении — счёт № ${invoice.id} (PDF).` : ""}`,
        href: invoice ? `/root/organizations/${row.unit.organizationId}` : null,
        occurredAt: now,
        authorName: "Автоворонка",
        identity: {},
      },
    ]).catch((error) => console.error("[crm-lifecycle] лента: письмо", error));
  }
  const deal = ctx.deals.get(message.dealKey);
  if (deal) {
    const next = await moveDeal(deal.id, deal, "message_sent", { messageSentAt: now, ...(invoice ? { invoiceOrderId: invoice.id } : {}) });
    if (next) deal.stage = next;
    deal.messageSentAt = now;
    if (invoice) deal.invoiceOrderId = invoice.id;
  }
  return true;
}

async function createTask(ctx: UnitContext, task: TaskPlan, sentKeys: ReadonlySet<string>, now: Date, dryRun: boolean, result: LifecycleRunResult): Promise<string | null> {
  const { row } = ctx;
  const deal = task.dealKey ? ctx.deals.get(task.dealKey) : undefined;
  const copy = renderTaskCopy(task, {
    orgName: row.unit.organizationName,
    contact: { name: row.owner?.name ?? null, phone: row.owner?.phone ?? null, telegram: Boolean(row.owner?.telegramChatId), email: row.owner?.email ?? null },
    messageSent: Boolean(task.messageKey && sentKeys.has(task.messageKey)),
    invoice: deal?.invoiceOrderId ? { number: String(deal.invoiceOrderId), amountRub: 0 } : null,
    hasInn: row.unit.hasInn,
  });
  if (dryRun) {
    result.log.push(`📋 ${copy.title}`);
    return null;
  }
  if (task.supersede && deal) {
    const superseded = await db.crmTask.updateMany({
      where: { dealId: deal.id, status: "open", scenario: { in: [...STAGE_SCENARIOS] }, NOT: { dedupeKey: task.key } },
      data: { status: "cancelled", result: "superseded", completedAt: now },
    });
    result.tasks.superseded += superseded.count;
  }
  const assigneeId = deal?.ownerId ?? ctx.assigneeId;
  if (task.scenario === "invoice_expired" && task.invoice) {
    // Счёт истёк — задача «счёт не оплачен» по нему больше не нужна.
    await db.crmTask.updateMany({ where: { dedupeKey: `lc:task:invoice_unpaid:${task.invoice.id}`, status: "open" }, data: { status: "cancelled", result: "superseded", completedAt: now } });
  }
  try {
    const created = await db.crmTask.create({
      data: {
        dealId: deal?.id ?? null,
        contactId: ctx.contactId,
        organizationId: row.unit.organizationId,
        assigneeId,
        kind: task.kind,
        title: copy.title,
        body: copy.body,
        dueAt: task.dueAt,
        scenario: task.scenario,
        dedupeKey: task.key,
        payloadJson: { offer: task.offer, approval: task.approval, stage: task.stage, segment: task.segment } as unknown as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
    result.tasks.created += 1;
    result.log.push(`📋 ${copy.title}`);
    return created.id;
  } catch (error) {
    if (isUnique(error)) return null;
    throw error;
  }
}

async function closeDealTasks(dealId: string, result: "paid" | "obsolete", now: Date, onlyStage = false): Promise<number> {
  const closed = await db.crmTask.updateMany({
    where: { dealId, status: "open", ...(onlyStage ? { scenario: { in: [...STAGE_SCENARIOS] } } : { kind: { not: "approval" } }) },
    data: { status: result === "paid" ? "done" : "cancelled", result, completedAt: now },
  });
  return closed.count;
}

async function executeUnit(
  row: SnapshotRow,
  dealRows: Map<string, DealRow>,
  plan: LifecyclePlan,
  staff: StaffPerson[],
  settings: LifecycleSettings,
  now: Date,
  dryRun: boolean,
  result: LifecycleRunResult,
): Promise<string[]> {
  const createdTaskIds: string[] = [];
  const needsContact = Boolean(plan.deal) || plan.messages.length > 0 || plan.tasks.length > 0 || plan.won.length > 0 || plan.lost.length > 0;
  const contact = needsContact && !dryRun ? await ensureOwnerContact(row, now) : null;
  const currentDeal = plan.deal ? dealRows.get(plan.deal.key) : undefined;
  const assigneeId = pickAssignee(staff, {
    dealOwnerId: currentDeal?.ownerId,
    accountManagerId: row.accountManagerId,
    contactOwnerId: contact?.ownerId,
    defaultAssigneeId: settings.defaultAssigneeId,
  });
  // Контакт клиента — за ответственным: иначе он «свободный лид» и менеджеру с
  // охватом «свои» видна чужая сделка в карточке.
  if (contact && !contact.ownerId && assigneeId) {
    await db.crmContact.update({ where: { id: contact.id }, data: { ownerId: assigneeId } }).catch(() => undefined);
    contact.ownerId = assigneeId;
  }
  const ctx: UnitContext = { row, contactId: contact?.id ?? null, assigneeId, deals: dealRows };
  const org = row.unit.organizationName;

  for (const won of plan.won) {
    const deal = dealRows.get(won.dealKey);
    if (!deal) continue;
    result.deals.won += 1;
    result.log.push(`💰 ${org}: ${won.reason}`);
    if (dryRun) continue;
    await db.crmDeal.update({ where: { id: deal.id }, data: { stage: "won", wonAt: now, lostAt: null, lostReason: null } });
    deal.stage = "won";
    result.tasks.closed += await closeDealTasks(deal.id, "paid", now);
    await event(ctx.contactId, `lc:won:${deal.id}`, `Сделка закрыта: ${won.reason}.`, now, "Оплачено");
    if (ctx.contactId) await db.crmContact.updateMany({ where: { id: ctx.contactId, stage: { in: ["new", "in_work"] } }, data: { stage: "won" } });
    const owner = staff.find((person) => person.id === (deal.ownerId ?? assigneeId));
    if (owner) {
      const key = `lc:won-notice:${deal.id}`;
      const logId = await claim(key, "lifecycle_won", ctx.contactId);
      if (logId) {
        const delivered = await deliver([{ id: owner.id, email: owner.contactEmail || owner.email, telegramChatId: owner.telegramChatId }], { subject: `${quoted(org)} оплатили`, text: `💰 ${quoted(org)}: ${won.reason.toLowerCase()}. Сделка закрыта, открытые задачи сняты.\n${APP_URL()}/root/crm/funnel` }, "lifecycle_won", key);
        await settle(logId, delivered);
      }
    }
  }
  for (const reopened of plan.reopened) {
    const deal = dealRows.get(reopened.dealKey);
    if (!deal) continue;
    result.log.push(`↺ ${org}: ${reopened.reason}`);
    if (dryRun) continue;
    await db.crmDeal.update({ where: { id: deal.id }, data: { stage: "registered", stageManual: false, wonAt: null, lostAt: null, lostReason: null } });
    deal.stage = "registered";
    await event(ctx.contactId, `lc:reopen:${deal.id}:${now.getTime()}`, `Сделка снова в работе: ${reopened.reason}.`, now, "Сделка");
  }
  for (const lost of plan.lost) {
    const deal = dealRows.get(lost.dealKey);
    if (!deal || !isOpenStage(deal.stage)) continue;
    result.deals.lost += 1;
    result.log.push(`✖ ${org}: ${lost.reason}`);
    if (dryRun) continue;
    await db.crmDeal.update({ where: { id: deal.id }, data: { stage: "lost", lostAt: now, lostReason: lost.reason } });
    deal.stage = "lost";
    result.tasks.closed += await closeDealTasks(deal.id, "obsolete", now, true);
    await event(ctx.contactId, `lc:lost:${deal.id}`, `Сделка закрыта: ${lost.reason}.`, now, "Отказ");
  }

  if (plan.deal) {
    const offer = plan.deal.offer;
    if (!currentDeal) {
      result.deals.created += 1;
      result.log.push(`➕ ${org}: сделка «${plan.deal.kind === "trial" ? "новый клиент" : "продление"}»`);
      if (!dryRun) {
        try {
          const created = await db.crmDeal.create({
            data: {
              kind: plan.deal.kind,
              dedupeKey: plan.deal.key,
              unitKey: row.unit.unitKey,
              organizationId: row.unit.organizationId,
              contactId: ctx.contactId,
              ownerId: assigneeId,
              periodEnd: plan.deal.periodEnd,
              offerJson: offer as unknown as Prisma.InputJsonValue,
              amountRub: offer.amountRub,
            },
            select: { id: true, stage: true, stageManual: true, ownerId: true, invoiceOrderId: true, messageSentAt: true },
          });
          dealRows.set(plan.deal.key, created);
          await event(ctx.contactId, `lc:deal:${created.id}`, plan.deal.kind === "trial" ? "Новая сделка: пробный период → оплата." : "Новая сделка: продление оплаченного срока.", now, "Сделка");
        } catch (error) {
          if (!isUnique(error)) throw error;
          const existing = await db.crmDeal.findUnique({ where: { dedupeKey: plan.deal.key }, select: { id: true, stage: true, stageManual: true, ownerId: true, invoiceOrderId: true, messageSentAt: true } });
          if (existing) dealRows.set(plan.deal.key, existing);
        }
      }
    } else if (!dryRun && isOpenStage(currentDeal.stage)) {
      // Отправленное спец-КП (`sent`) и его сумма не затираются пересчётом рекомендации.
      const sent = (currentDeal.offerJson as { sent?: { amountRub?: number } } | null | undefined)?.sent;
      await db.crmDeal.update({
        where: { id: currentDeal.id },
        data: {
          periodEnd: plan.deal.periodEnd,
          offerJson: { ...offer, ...(sent ? { sent } : {}) } as unknown as Prisma.InputJsonValue,
          ...(sent ? {} : { amountRub: offer.amountRub }),
          ...(ctx.contactId ? { contactId: ctx.contactId } : {}),
          ...(currentDeal.ownerId ? {} : assigneeId ? { ownerId: assigneeId } : {}),
        },
      });
      if (!currentDeal.ownerId && assigneeId) currentDeal.ownerId = assigneeId;
    }
  }

  for (const change of plan.stageChanges) {
    const deal = dealRows.get(change.dealKey);
    if (!deal || dryRun) continue;
    const next = await moveDeal(deal.id, deal, change.to, change.to === "contract_signed" ? { contractSignedAt: row.unit.contractSignedAt } : {});
    if (next) {
      deal.stage = next;
      result.deals.moved += 1;
      result.log.push(`→ ${org}: ${change.reason}`);
    }
  }

  const sentKeys = new Set<string>();
  for (const message of plan.messages) {
    if (await sendMessage(ctx, message, now, dryRun, result)) sentKeys.add(message.key);
  }
  for (const task of plan.tasks) {
    const id = await createTask(ctx, task, sentKeys, now, dryRun, result);
    if (id) createdTaskIds.push(id);
  }
  return createdTaskIds;
}

/** Ответственным — одно сообщение о новых задачах прогона. */
export async function notifyAssignees(taskIds: string[], staff?: StaffPerson[]): Promise<number> {
  if (!taskIds.length) return 0;
  const tasks = await db.crmTask.findMany({ where: { id: { in: taskIds }, notifiedAt: null, status: "open" }, orderBy: { dueAt: "asc" }, select: { id: true, title: true, assigneeId: true, dueAt: true } });
  const people = staff ?? (await loadPlatformStaff());
  const byAssignee = new Map<string, typeof tasks>();
  for (const task of tasks) {
    const key = task.assigneeId ?? "";
    byAssignee.set(key, [...(byAssignee.get(key) ?? []), task]);
  }
  let sent = 0;
  for (const [assigneeId, list] of byAssignee) {
    const recipients = assigneeId
      ? people.filter((person) => person.id === assigneeId)
      : people.filter((person) => person.salesHead);
    if (!recipients.length) continue;
    const lines = list.slice(0, 10).map((task) => `• ${task.title} — до ${task.dueAt.toLocaleString("ru-RU", { timeZone: "Europe/Moscow", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}`);
    const text = `📋 Новые задачи CRM (${list.length})${assigneeId ? "" : " — без ответственного"}:\n${lines.join("\n")}${list.length > 10 ? `\n…и ещё ${list.length - 10}` : ""}\n${APP_URL()}/root/crm/tasks`;
    const key = `lc:new-tasks:${assigneeId || "none"}:${list.map((task) => task.id).join(",").slice(0, 180)}`;
    const logId = await claim(key, "lifecycle_tasks", null);
    if (!logId) continue;
    const delivered = await deliver(
      recipients.map((person) => ({ id: person.id, email: person.contactEmail || person.email, telegramChatId: person.telegramChatId })),
      { subject: `Новые задачи CRM: ${list.length}`, text },
      "lifecycle_tasks",
      key,
    );
    await settle(logId, delivered);
    if (delivered) {
      sent += 1;
      await db.crmTask.updateMany({ where: { id: { in: list.map((task) => task.id) } }, data: { notifiedAt: new Date() } });
    }
  }
  return sent;
}

/**
 * Прогон автоворонки. `now` — для проверки с переводом времени; `force` —
 * без паузы 15 минут; `dryRun` — только посчитать, ничего не записывая.
 */
export async function runLifecycle(options: { now?: Date; force?: boolean; dryRun?: boolean; onlyUnitKeys?: ReadonlySet<string> } = {}): Promise<LifecycleRunResult> {
  const now = options.now ?? new Date();
  const dryRun = options.dryRun === true;
  const result = emptyResult(now, dryRun);
  const settings = await readLifecycleSettings();
  if (!settings.enabled) return { ...result, skipped: "disabled" };
  if (!options.force && !dryRun) {
    const last = await db.platformSetting.findUnique({ where: { key: LAST_RUN_KEY } });
    const lastAt = last ? Date.parse(last.value) : NaN;
    if (Number.isFinite(lastAt) && now.getTime() - lastAt < MIN_INTERVAL_MS && now.getTime() >= lastAt) return { ...result, skipped: "interval" };
  }
  if (!dryRun) {
    await db.platformSetting.upsert({ where: { key: LAST_RUN_KEY }, create: { key: LAST_RUN_KEY, value: now.toISOString() }, update: { value: now.toISOString() } });
  }

  const [rows, staff, pricing] = await Promise.all([loadLifecycleSnapshots(now, options.onlyUnitKeys), loadPlatformStaff(), readPlanPricing()]);
  result.scanned = rows.length;
  const dealRecords = rows.length
    ? await db.crmDeal.findMany({
        where: { unitKey: { in: rows.map((row) => row.unit.unitKey) } },
        select: { id: true, dedupeKey: true, unitKey: true, kind: true, stage: true, stageManual: true, periodEnd: true, offerJson: true, contractSignedAt: true, ownerId: true, invoiceOrderId: true, messageSentAt: true },
      })
    : [];
  const dealsByUnit = new Map<string, typeof dealRecords>();
  for (const deal of dealRecords) dealsByUnit.set(deal.unitKey, [...(dealsByUnit.get(deal.unitKey) ?? []), deal]);

  // Два прохода: первый — какие ключи понадобятся, второй — с уже сделанными.
  const inputs = rows.map((row) => {
    const deals = (dealsByUnit.get(row.unit.unitKey) ?? []).map(dealView);
    const ownerGuess = pickAssignee(staff, {
      dealOwnerId: dealsByUnit.get(row.unit.unitKey)?.find((deal) => isOpenStage(deal.stage))?.ownerId,
      accountManagerId: row.accountManagerId,
      defaultAssigneeId: settings.defaultAssigneeId,
    });
    return { row, deals, assigneeLimit: limitOf(staff, ownerGuess) };
  });
  const firstPass = inputs.map(({ row, deals, assigneeLimit }) =>
    planLifecycle({ unit: row.unit, deals, done: new Set(), now, settings, rates: pricing.rates, assigneeLimit }),
  );
  const keys = firstPass.map(planKeys);
  const done = await existingKeys(
    keys.flatMap((k) => k.messages),
    keys.flatMap((k) => k.tasks),
  );

  const createdTaskIds: string[] = [];
  for (const { row, deals, assigneeLimit } of inputs) {
    try {
      const plan = planLifecycle({ unit: row.unit, deals, done, now, settings, rates: pricing.rates, assigneeLimit });
      const dealRows = new Map<string, DealRow>(
        (dealsByUnit.get(row.unit.unitKey) ?? []).map((deal) => [
          deal.dedupeKey,
          { id: deal.id, stage: deal.stage, stageManual: deal.stageManual, ownerId: deal.ownerId, invoiceOrderId: deal.invoiceOrderId, messageSentAt: deal.messageSentAt, offerJson: deal.offerJson },
        ]),
      );
      createdTaskIds.push(...(await executeUnit(row, dealRows, plan, staff, settings, now, dryRun, result)));
    } catch (error) {
      result.ok = false;
      const text = `${row.unit.organizationName}: ${error instanceof Error ? error.message.slice(0, 200) : String(error)}`;
      result.errors.push(text);
      console.error("[crm-lifecycle] единица не обработана", row.unit.unitKey, error);
    }
  }
  if (!dryRun) await notifyAssignees(createdTaskIds, staff).catch((error) => result.errors.push(`оповещение: ${String(error)}`));
  return result;
}
