import { db } from "@/lib/db";
import {
  CHECKOUT_ABANDON_AFTER_MS,
  CHECKOUT_ABANDON_GIVE_UP_MS,
  CHECKOUT_CHANNEL,
  CHECKOUT_ORDER_GRACE_MS,
  ONBOARDING_DUE_MS,
  checkoutTaskKey,
  composeAbandonedCheckout,
  composeOnboardingTask,
  decideAbandonedCheckout,
  mapCheckoutVisit,
  mapPaidOrder,
  needsOnboardingTask,
  onboardingTaskKey,
  type CheckoutVisit,
} from "@/lib/crm/checkout";
import { ingestCrmItems } from "@/lib/crm/ingest.server";
import { normalizeEmail } from "@/lib/crm/identity";
import { isWorkingTime } from "@/lib/crm/reminders";
import { createCrmTask, notifyTaskAssignee, readLifecycleSettings } from "@/lib/crm/tasks.server";
import { platformOrgId } from "@/lib/partners/partner-hint";
import { notifyPlatformAdmin } from "@/lib/platform-admin";

/**
 * Незавершённая оплата в CRM и Telegram (спека checkout-conversion-2026-11-22).
 * Правила и тексты — `checkout.ts`; здесь только база и отправка.
 */

const APP_URL = () => (process.env.NEXTAUTH_URL || "https://wesetup.ru").replace(/\/+$/, "");

/** Запись «открыл оформление» в ленту CRM. Никогда не бросает: оформление важнее. */
export async function recordCheckoutVisit(visit: CheckoutVisit): Promise<boolean> {
  try {
    if (visit.organizationId && visit.organizationId === platformOrgId()) return false;
    const item = mapCheckoutVisit(visit, APP_URL());
    if (!item) return false;
    const result = await ingestCrmItems([item]);
    return result.created > 0;
  } catch (error) {
    console.error("[crm-checkout] visit not recorded", error);
    return false;
  }
}

/** Исполнитель: ответственный контакта → менеджер организации → исполнитель сценария → общая очередь РОП. */
async function assigneeFor(contact: { ownerId: string | null; organizationId: string | null }): Promise<string | null> {
  if (contact.ownerId) return contact.ownerId;
  if (contact.organizationId) {
    const org = await db.organization.findUnique({ where: { id: contact.organizationId }, select: { accountManagerId: true } });
    if (org?.accountManagerId) return org.accountManagerId;
  }
  return (await readLifecycleSettings()).assigneeId ?? null;
}

export type CheckoutFollowupReport = { scanned: number; alerted: number; skipped: Record<string, number> };

/**
 * Шаг прогона CRM (раз в 5 минут): записи оформления старше 30 минут без
 * оплаты и без счёта → задача «позвонить» и сообщение админам. Только в
 * рабочие часы: ночная запись дождётся утра (окно — 72 часа).
 */
export async function runCheckoutFollowups(now = new Date()): Promise<CheckoutFollowupReport> {
  const report: CheckoutFollowupReport = { scanned: 0, alerted: 0, skipped: {} };
  if (!isWorkingTime(now)) return report;
  const rows = await db.crmInteraction.findMany({
    where: {
      channel: CHECKOUT_CHANNEL,
      externalKey: { startsWith: "checkout:visit:" },
      contactId: { not: null },
      occurredAt: { gte: new Date(now.getTime() - CHECKOUT_ABANDON_GIVE_UP_MS), lte: new Date(now.getTime() - CHECKOUT_ABANDON_AFTER_MS) },
    },
    orderBy: { occurredAt: "asc" },
    take: 200,
    select: {
      id: true,
      body: true,
      occurredAt: true,
      contact: { select: { id: true, name: true, company: true, email: true, phone: true, stage: true, ownerId: true, organizationId: true } },
    },
  });
  report.scanned = rows.length;
  if (!rows.length) return report;
  const handled = new Set(
    (await db.crmTask.findMany({ where: { dedupeKey: { in: rows.map((row) => checkoutTaskKey(row.id)) } }, select: { dedupeKey: true } })).map(
      (task) => task.dedupeKey,
    ),
  );
  const skip = (reason: string) => {
    report.skipped[reason] = (report.skipped[reason] ?? 0) + 1;
  };

  for (const row of rows) {
    const contact = row.contact;
    if (!contact) continue;
    const key = checkoutTaskKey(row.id);
    if (handled.has(key)) {
      skip("done");
      continue;
    }
    const email = normalizeEmail(contact.email);
    const owners = [email ? { email: { equals: email, mode: "insensitive" as const } } : null, contact.organizationId ? { organizationId: contact.organizationId } : null].filter(
      (item): item is NonNullable<typeof item> => item !== null,
    );
    const [orders, openTasks] = await Promise.all([
      owners.length
        ? db.paymentOrder.findMany({
            where: { OR: owners, createdAt: { gte: new Date(row.occurredAt.getTime() - CHECKOUT_ORDER_GRACE_MS) }, tariffKey: { not: "balance_topup" } },
            select: { status: true, paymentMethod: true, createdAt: true },
            take: 50,
          })
        : Promise.resolve([]),
      db.crmTask.count({ where: { contactId: contact.id, kind: "checkout", status: { in: ["open", "waiting"] } } }),
    ]);
    const decision = decideAbandonedCheckout(
      { occurredAt: row.occurredAt, contactStage: contact.stage, hasOpenTask: openTasks > 0, orders },
      now,
    );
    if (decision.action === "skip") {
      skip(decision.reason);
      continue;
    }

    const assigneeId = await assigneeFor(contact);
    const draft = composeAbandonedCheckout({
      contact,
      visitBody: row.body,
      step: decision.step,
      occurredAt: row.occurredAt,
      now,
      taskUrl: null,
    });
    const task = await createCrmTask({
      kind: "checkout",
      title: draft.title,
      note: draft.note,
      organizationId: contact.organizationId,
      contactId: contact.id,
      assigneeId,
      dueAt: now,
      dedupeKey: key,
    });
    // Ключ уже занят параллельным прогоном — сообщение отправил он.
    if (!task) {
      skip("done");
      continue;
    }
    await ingestCrmItems([
      {
        externalKey: `checkout:abandoned:${row.id}`,
        channel: CHECKOUT_CHANNEL,
        direction: "event",
        subject: "Не завершил(а) оплату",
        body: `Поставлена задача «${draft.title}»`,
        href: `/root/crm/tasks#${task.id}`,
        occurredAt: now,
        identity: {},
        contactId: contact.id,
      },
    ]).catch((error) => console.error("[crm-checkout] timeline event failed", error));
    const message = composeAbandonedCheckout({
      contact,
      visitBody: row.body,
      step: decision.step,
      occurredAt: row.occurredAt,
      now,
      taskUrl: `${APP_URL()}/root/crm/tasks#${task.id}`,
    });
    await notifyPlatformAdmin(message.telegram, {
      kind: "checkout",
      dedupeKey: key,
      email: false,
      client: { organizationId: contact.organizationId, email },
    }).catch((error) => console.error("[crm-checkout] admin alert failed", error));
    if (task.assigneeId) await notifyTaskAssignee(task).catch(() => 0);
    report.alerted += 1;
  }
  return report;
}

/**
 * Клиент оплатил (касса, баллы, счёт): задачи «незавершённая оплата» больше не
 * нужны, в ленту — событие оплаты, контакт — «Клиент»; новая подписка,
 * повышение или переход — задача «созвон по запуску». Зовёт `completePaidOrder`
 * в своём try/catch.
 */
export async function onCheckoutPaid(args: {
  order: {
    id: number;
    email: string;
    tariffKey: string;
    description: string;
    amountRub: unknown;
    pointsSpent?: number | null;
    isTest: boolean;
    changeKind?: string | null;
    userId?: string | null;
  };
  organizationId: string | null;
  organizationIds: string[];
  isNewClient: boolean;
  now?: Date;
}): Promise<{ closed: number; onboardingTaskId: string | null }> {
  const now = args.now ?? new Date();
  const { order } = args;
  const email = normalizeEmail(order.email);
  const scope = [...new Set([...(args.organizationIds ?? []), ...(args.organizationId ? [args.organizationId] : [])])];
  const contactWhere = [email ? { email } : null, scope.length ? { organizationId: { in: scope } } : null].filter(
    (item): item is NonNullable<typeof item> => item !== null,
  );
  if (!contactWhere.length) return { closed: 0, onboardingTaskId: null };

  const before = await db.crmContact.findMany({ where: { OR: contactWhere }, select: { id: true } });
  const closed = await db.crmTask.updateMany({
    where: {
      kind: "checkout",
      status: { in: ["open", "waiting"] },
      OR: [...(before.length ? [{ contactId: { in: before.map((row) => row.id) } }] : []), ...(scope.length ? [{ organizationId: { in: scope } }] : [])],
    },
    data: { status: "cancelled", result: "Клиент оплатил", closedAt: now },
  });
  // Тестовый платёж закрывает задачи, но клиента в CRM не делает.
  if (order.isTest) return { closed: closed.count, onboardingTaskId: null };

  const amountRub = Number(order.amountRub) || 0;
  const paidItem = mapPaidOrder({
    orderId: order.id,
    email: order.email,
    description: order.description,
    amountRub,
    pointsSpent: order.pointsSpent ?? 0,
    organizationId: args.organizationId,
    userId: order.userId ?? null,
    at: now,
  });
  if (paidItem) await ingestCrmItems([paidItem]);

  const contacts = await db.crmContact.findMany({
    where: { OR: contactWhere },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, company: true, email: true, phone: true, stage: true, ownerId: true, organizationId: true },
  });
  const live = contacts.filter((contact) => contact.stage !== "spam");
  if (live.length) {
    await db.crmContact.updateMany({ where: { id: { in: live.map((contact) => contact.id) }, stage: { not: "won" } }, data: { stage: "won" } });
  }
  if (!needsOnboardingTask(order, args.isNewClient)) return { closed: closed.count, onboardingTaskId: null };

  const contact = live.find((row) => row.email === email) ?? live[0] ?? null;
  const draft = composeOnboardingTask({
    contact: contact ?? { name: null, company: null, email, phone: null },
    orderId: order.id,
    description: order.description,
    amountRub,
    isNewClient: args.isNewClient,
    changeKind: order.changeKind,
  });
  const task = await createCrmTask({
    kind: "onboarding",
    title: draft.title,
    note: draft.note,
    organizationId: args.organizationId,
    contactId: contact?.id ?? null,
    assigneeId: await assigneeFor({ ownerId: contact?.ownerId ?? null, organizationId: args.organizationId }),
    dueAt: new Date(now.getTime() + ONBOARDING_DUE_MS),
    dedupeKey: onboardingTaskKey(order.id),
  });
  if (task?.assigneeId) await notifyTaskAssignee(task).catch(() => 0);
  return { closed: closed.count, onboardingTaskId: task?.id ?? null };
}
