import { Prisma, type CrmTask } from "@prisma/client";

import { db } from "@/lib/db";
import { renderEmailLayout, sendRawEmail } from "@/lib/email";
import { escapeHtml } from "@/lib/html-escape";
import { stageForOutcome } from "@/lib/lifecycle/deals";
import { advanceDealFor, markDealsWon } from "@/lib/lifecycle/deals.server";
import { loadPlatformStaff, platformStaffWhere } from "@/lib/lifecycle/people.server";
import { DEFAULT_LIFECYCLE_SETTINGS, LIFECYCLE_SETTING_KEY, normalizeLifecycleSettings, type LifecycleSettings } from "@/lib/lifecycle/plan";
import { checkApproval, limitOf } from "@/lib/lifecycle/staff";
import { TASK_OUTCOMES, type TaskOutcome } from "@/lib/lifecycle/task-outcomes";
import { listSalesHeads } from "@/lib/crm/notify.server";
import { getPlatformAdministrators } from "@/lib/platform-admin";
import { sendTelegramMessage } from "@/lib/telegram";
import { isTechnicalEmail } from "@/lib/technical-email";

/**
 * Задачи CRM (2026-11-09, доработаны 2026-11-10): создание с ключом
 * события, оповещение исполнителя, закрытие с итогом звонка и следующим
 * шагом, согласование скидки (не своей, не больше запрошенного, в пределах
 * лимита роли) и закрытие всех задач сценария, когда клиент заплатил.
 */

const APP_URL = () => process.env.NEXTAUTH_URL || "https://wesetup.ru";

export const CRM_TASK_KINDS = ["call", "approve_discount", "offer", "payment_overdue", "last_chance", "lost_reason", "winback", "manual"] as const;
export type CrmTaskKind = (typeof CRM_TASK_KINDS)[number];

export const CRM_TASK_KIND_LABELS: Record<string, string> = {
  call: "Связаться по оплате",
  approve_discount: "Согласовать скидку",
  offer: "Отправить КП",
  payment_overdue: "Оплата просрочена",
  last_chance: "Последний шанс",
  lost_reason: "Узнать причину отказа",
  winback: "Вернуть на платный",
  manual: "Задача",
};

export class CrmTaskError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

// ---------------------------------------------------------------- settings

export async function readLifecycleSettings(): Promise<LifecycleSettings> {
  try {
    const row = await db.platformSetting.findUnique({ where: { key: LIFECYCLE_SETTING_KEY } });
    return row ? normalizeLifecycleSettings(JSON.parse(row.value)) : DEFAULT_LIFECYCLE_SETTINGS;
  } catch (error) {
    console.error("[crm-tasks] settings read failed — defaults", error);
    return DEFAULT_LIFECYCLE_SETTINGS;
  }
}

export async function writeLifecycleSettings(raw: unknown): Promise<LifecycleSettings> {
  const settings = normalizeLifecycleSettings(raw);
  for (const userId of [settings.assigneeId, settings.approverId]) {
    if (!userId) continue;
    const ok = await db.user.count({ where: { id: userId, ...platformStaffWhere() } });
    if (!ok) throw new CrmTaskError("Исполнителем можно выбрать только сотрудника команды платформы");
  }
  const value = JSON.stringify(settings);
  await db.platformSetting.upsert({ where: { key: LIFECYCLE_SETTING_KEY }, create: { key: LIFECYCLE_SETTING_KEY, value }, update: { value } });
  return settings;
}

/** Кого можно назначить: владелец платформы и сотрудники панели из команды платформы. */
export async function listTaskAssignees(): Promise<{ id: string; name: string }[]> {
  return db.user.findMany({ where: platformStaffWhere(), orderBy: { name: "asc" }, select: { id: true, name: true } });
}

// ---------------------------------------------------------------- create

export type NewTask = {
  kind: CrmTaskKind;
  title: string;
  note?: string | null;
  organizationId?: string | null;
  contactId?: string | null;
  assigneeId: string | null;
  dueAt: Date;
  status?: "open" | "waiting";
  dedupeKey?: string | null;
  discountPercent?: number | null;
  approvalStatus?: "pending" | null;
  approvalTaskId?: string | null;
  createdById?: string | null;
  dealId?: string | null;
  /** Условия спец-КП: { tier, cycle, points, percent, requestedById, … }. */
  terms?: Record<string, unknown> | null;
};

/** Создаёт задачу; с тем же ключом уже есть — null (крон прошёл второй раз). */
export async function createCrmTask(task: NewTask): Promise<CrmTask | null> {
  try {
    return await db.crmTask.create({
      data: {
        kind: task.kind,
        title: task.title,
        note: task.note ?? null,
        organizationId: task.organizationId ?? null,
        contactId: task.contactId ?? null,
        assigneeId: task.assigneeId,
        dueAt: task.dueAt,
        status: task.status ?? "open",
        dedupeKey: task.dedupeKey ?? null,
        discountPercent: task.discountPercent ?? null,
        approvalStatus: task.approvalStatus ?? null,
        approvalTaskId: task.approvalTaskId ?? null,
        createdById: task.createdById ?? null,
        dealId: task.dealId ?? null,
        ...(task.terms ? { terms: task.terms as Prisma.InputJsonValue } : {}),
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return null;
    throw error;
  }
}

type Person = { id: string | null; name: string; email: string | null; telegramChatId: string | null };

async function person(userId: string | null): Promise<Person[]> {
  if (userId) {
    const user = await db.user.findFirst({
      where: { id: userId, isActive: true, archivedAt: null },
      select: { id: true, name: true, email: true, contactEmail: true, telegramChatId: true },
    });
    if (user) {
      const email = [user.contactEmail, user.email].find((value) => value && value.includes("@") && !isTechnicalEmail(value)) ?? null;
      return [{ id: user.id, name: user.name, email, telegramChatId: user.telegramChatId }];
    }
  }
  // Исполнителя нет — РОП, нет РОП — администраторы платформы.
  const heads = await listSalesHeads();
  if (heads.length) return heads.map((head) => ({ id: head.id, name: head.name, email: head.email, telegramChatId: head.telegramChatId }));
  return (await getPlatformAdministrators("admins")).map((admin) => ({ id: null, name: "", email: admin.email, telegramChatId: admin.telegramChatId }));
}

/** «Новая задача» исполнителю: Telegram, без него — почта. */
export async function notifyTaskAssignee(task: Pick<CrmTask, "id" | "title" | "note" | "dueAt" | "assigneeId" | "kind">): Promise<number> {
  const url = `${APP_URL()}/root/crm/tasks#${task.id}`;
  const due = task.dueAt.toLocaleString("ru-RU", { timeZone: "Europe/Moscow", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
  const heading = task.kind === "approve_discount" ? "🟣 Нужно согласование" : "📋 Новая задача";
  let delivered = 0;
  for (const to of await person(task.assigneeId)) {
    let ok = false;
    if (to.telegramChatId) {
      ok = await sendTelegramMessage(
        to.telegramChatId,
        [`<b>${heading}: ${escapeHtml(task.title)}</b>`, task.note ? escapeHtml(task.note) : null, `Срок: ${due}`, `<a href="${url}">Открыть задачу</a>`].filter(Boolean).join("\n\n"),
        { delivery: { kind: "crm:task", dedupeKey: `crm-task:${task.id}:${to.id ?? to.email}` } },
      ).catch(() => false);
    }
    if (!ok && to.email) {
      const body =
        (task.note ? `<p style="margin:0 0 12px;color:#3f3f46;line-height:1.6;white-space:pre-line">${escapeHtml(task.note)}</p>` : "") +
        `<p style="margin:0 0 12px;color:#3f3f46">Срок: ${escapeHtml(due)}</p>` +
        `<p style="margin:16px 0 0"><a href="${url}" style="color:#5566f6;font-weight:600">Открыть задачу</a></p>`;
      ok = await sendRawEmail(to.email, `${heading.replace(/^\S+\s/, "")}: ${task.title}`, renderEmailLayout(task.title, body)).catch(() => false);
    }
    if (ok) delivered += 1;
  }
  return delivered;
}

// ---------------------------------------------------------------- actions

export type TaskActor = { id: string; name: string | null; superadmin: boolean; own?: boolean };

async function loadTask(id: string, actor?: TaskActor): Promise<CrmTask> {
  const task = await db.crmTask.findUnique({ where: { id } });
  if (!task) throw new CrmTaskError("Задача не найдена", 404);
  // Охват «свои»: свои задачи и общая очередь, чужие — как будто нет.
  if (actor?.own && task.assigneeId && task.assigneeId !== actor.id) throw new CrmTaskError("Задача не найдена", 404);
  return task;
}

export type CloseTaskArgs = {
  status: "done" | "cancelled";
  result: string | null;
  /** Итог звонка: двигает сделку воронки. */
  outcome?: TaskOutcome | null;
  /** Следующий шаг: задача «Перезвонить» на это время. */
  nextDueAt?: Date | null;
};

/** Выполнено / отменено — с итогом; итог двигает сделку, следующий шаг — новая задача. */
export async function closeCrmTask(id: string, actor: TaskActor, args: CloseTaskArgs): Promise<{ followUpId: string | null }> {
  const task = await loadTask(id, actor);
  if (task.status === "done" || task.status === "cancelled") return { followUpId: null };
  if (task.kind === "approve_discount" && args.status === "done") throw new CrmTaskError("Согласование закрывается решением: согласовать или отказать");
  if (args.outcome === "callback" && !args.nextDueAt) throw new CrmTaskError("Когда перезвонить? Укажите дату следующего шага");
  const now = new Date();
  const result = [args.outcome ? TASK_OUTCOMES[args.outcome] : null, args.result?.trim() || null].filter(Boolean).join(". ") || null;
  await db.crmTask.update({
    where: { id },
    data: { status: args.status, result, outcome: args.outcome ?? null, closedAt: now, closedById: actor.id },
  });

  // Итог звонка → колонка сделки («Был прозвон», «Отказ»).
  const stage = args.outcome ? stageForOutcome(args.outcome) : null;
  if (stage && (task.dealId || task.organizationId)) {
    await advanceDealFor(
      { dealId: task.dealId, organizationIds: task.organizationId ? [task.organizationId] : [] },
      stage,
      stage === "lost" ? { lostReason: args.result?.trim() || "Отказ после звонка" } : { calledAt: now },
    ).catch((error) => console.error("[crm-tasks] deal move failed", error));
  }

  let followUpId: string | null = null;
  if (args.nextDueAt && args.outcome !== "declined") {
    const made = await createCrmTask({
      kind: task.kind === "manual" ? "manual" : "call",
      title: `Перезвонить: ${task.title.replace(/^(?:Срочно:\s*)?(?:позвонить\s+|перезвонить:\s*)+/i, "")}`.slice(0, 200),
      note: [result ? `Прошлый разговор: ${result}.` : null, task.note].filter(Boolean).join("\n"),
      organizationId: task.organizationId,
      contactId: task.contactId,
      dealId: task.dealId,
      assigneeId: task.assigneeId ?? actor.id,
      dueAt: args.nextDueAt,
      // Задача сценария — и перезвон закроется сам, когда клиент заплатит.
      dedupeKey: task.dedupeKey?.startsWith("lc:") ? `lc:followup:${task.id}` : null,
      discountPercent: task.discountPercent,
      createdById: actor.id,
    });
    followUpId = made?.id ?? null;
    if (made && made.assigneeId !== actor.id) await notifyTaskAssignee(made).catch(() => 0);
  }
  return { followUpId };
}

type Terms = { tier?: string; cycle?: string; points?: number; percent?: number; requestedById?: string | null; source?: string; note?: string | null; lifetime?: boolean; validDays?: number };

function termsOf(task: Pick<CrmTask, "terms">): Terms {
  return task.terms && typeof task.terms === "object" && !Array.isArray(task.terms) ? (task.terms as Terms) : {};
}

/**
 * Решение по скидке. Решает назначенный или тот, чей лимит покрывает; свою
 * заявку — никто сам себе, больше запрошенного — нельзя.
 *  - Сценарий (крупный клиент перед звонком): звонок, который ждал,
 *    открывается со скидкой из решения; отказано — с обычной скидкой.
 *  - Спец-КП менеджера: согласовано — у просящего задача «Отправить КП»
 *    ровно на согласованные тариф, период, точки и процент.
 */
export async function decideDiscount(id: string, actor: TaskActor, args: { approve: boolean; percent: number | null; comment: string | null }): Promise<{ offerTaskId: string | null }> {
  const task = await db.crmTask.findUnique({ where: { id } });
  if (!task) throw new CrmTaskError("Задача не найдена", 404);
  if (task.kind !== "approve_discount") throw new CrmTaskError("Это не согласование скидки");
  if (task.approvalStatus !== "pending") throw new CrmTaskError("Решение уже принято", 409);
  const [settings, staff] = await Promise.all([readLifecycleSettings(), loadPlatformStaff()]);
  const terms = termsOf(task);
  const requested = Math.round(task.discountPercent ?? terms.percent ?? 0);
  const myLimit = limitOf(staff, actor.id);
  const assigned = task.assigneeId === actor.id || (!task.assigneeId && settings.approverId === actor.id);
  if (!actor.superadmin && !assigned && myLimit < requested) {
    throw new CrmTaskError("Решает тот, кому назначено согласование, или сотрудник с лимитом скидки не меньше запрошенного", 403);
  }
  const percent = args.approve ? Math.min(90, Math.max(0, Math.round(args.percent ?? requested))) : null;
  const refusal = checkApproval({
    actorId: actor.id,
    actorLimit: myLimit,
    requestedById: terms.requestedById ?? task.createdById ?? null,
    requestedPercent: requested,
    percent: percent ?? 0,
    approve: args.approve,
  });
  if (refusal) throw new CrmTaskError(refusal, 403);

  const now = new Date();
  const status = args.approve ? "approved" : "rejected";
  const comment = args.comment?.trim() || null;
  let offerTaskId: string | null = null;
  await db.$transaction(async (tx) => {
    const claimed = await tx.crmTask.updateMany({
      where: { id, approvalStatus: "pending" },
      data: {
        approvalStatus: status,
        discountPercent: percent ?? task.discountPercent,
        decidedById: actor.id,
        decidedAt: now,
        status: "done",
        result: [args.approve ? `Согласовано: ${percent} %` : "Отказано", comment].filter(Boolean).join(". "),
        closedAt: now,
        closedById: actor.id,
      },
    });
    if (!claimed.count) throw new CrmTaskError("Решение уже принято", 409);
    const waiting = await tx.crmTask.findMany({ where: { approvalTaskId: id, status: "waiting" } });
    for (const call of waiting) {
      const note = [call.note, args.approve ? `Скидку ${percent} % согласовали.` : `Особую скидку не согласовали${comment ? `: ${comment}` : ""} — предложите обычную.`]
        .filter(Boolean)
        .join("\n");
      await tx.crmTask.update({
        where: { id: call.id },
        data: { status: "open", approvalStatus: status, discountPercent: args.approve ? percent : null, note, dueAt: call.dueAt < now ? now : call.dueAt },
      });
    }
    // Спец-КП: просящему — «Отправить КП» на согласованные условия.
    if (terms.source === "offer" && terms.requestedById) {
      const offerTask = await tx.crmTask.create({
        data: {
          kind: args.approve ? "offer" : "manual",
          title: (args.approve ? `Скидка ${percent} % согласована — отправить КП: ${task.title.replace(/^Согласовать скидку \d+ %:?\s*(для\s*)?/, "")}` : `Скидку не согласовали: ${task.title.replace(/^Согласовать скидку \d+ %:?\s*(для\s*)?/, "")}`).slice(0, 200),
          note: [
            `Решение: ${actor.name ?? "—"}${comment ? ` — ${comment}` : ""}.`,
            args.approve ? "Кнопка «КП со скидкой» — форма заполнена согласованными условиями, менять их нельзя." : "Предложите скидку в пределах своего лимита или оплату за год.",
          ].join("\n"),
          organizationId: task.organizationId,
          contactId: task.contactId,
          dealId: task.dealId,
          assigneeId: terms.requestedById,
          dueAt: new Date(now.getTime() + 4 * 60 * 60 * 1000),
          status: "open",
          discountPercent: args.approve ? percent : null,
          approvalStatus: status,
          approvalTaskId: id,
          terms: args.approve ? ({ ...terms, percent, approvedById: actor.id } as Prisma.InputJsonValue) : Prisma.JsonNull,
          createdById: actor.id,
        },
      });
      offerTaskId = offerTask.id;
    }
  });
  const opened = await db.crmTask.findMany({ where: { approvalTaskId: id, status: "open" } });
  for (const next of opened) await notifyTaskAssignee(next).catch(() => 0);
  return { offerTaskId };
}

/**
 * Клиент заплатил — все открытые задачи сценария по его организациям
 * закрываются: звонить больше не нужно.
 */
export async function closeLifecycleTasksOnPayment(organizationIds: string[]): Promise<number> {
  if (!organizationIds.length) return 0;
  const result = await db.crmTask.updateMany({
    where: { organizationId: { in: organizationIds }, status: { in: ["open", "waiting"] }, dedupeKey: { startsWith: "lc:" } },
    data: { status: "cancelled", result: "Клиент оплатил", closedAt: new Date() },
  });
  // И сделка воронки — «Оплачено».
  await markDealsWon(organizationIds).catch((error) => console.error("[crm-tasks] deals won failed", error));
  return result.count;
}

/** Повторная задача ступени заменяет прежнюю открытую того же клиента. */
export async function supersedeOpenCalls(organizationIds: string[], keepKey: string): Promise<void> {
  if (!organizationIds.length) return;
  await db.crmTask.updateMany({
    where: { organizationId: { in: organizationIds }, kind: "call", status: { in: ["open", "waiting"] }, dedupeKey: { startsWith: "lc:", not: keepKey } },
    data: { status: "cancelled", result: "Заменена повторной задачей", closedAt: new Date() },
  });
}

// ---------------------------------------------------------------- read

export type TaskClient = { phone: string | null; email: string | null };

export type TaskRow = CrmTask & {
  assigneeName: string | null;
  organizationName: string | null;
  decidedByName: string | null;
  /** Как связаться: контакт CRM, иначе владелец организации. */
  client: TaskClient;
};

export type TaskFilter = {
  includeClosed: boolean;
  /** Охват «свои»: только задачи этого человека и общая очередь. */
  ownScopeId?: string | null;
  /** Мои / все / без ответственного. */
  who?: "mine" | "all" | "unassigned";
  me?: string | null;
  kind?: string | null;
};

export async function listCrmTasks(args: TaskFilter): Promise<TaskRow[]> {
  const and: Prisma.CrmTaskWhereInput[] = [
    args.includeClosed ? { closedAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } } : { status: { in: ["open", "waiting"] } },
  ];
  if (args.ownScopeId) and.push({ OR: [{ assigneeId: args.ownScopeId }, { assigneeId: null }] });
  if (args.who === "mine" && args.me) and.push({ assigneeId: args.me });
  if (args.who === "unassigned") and.push({ assigneeId: null });
  if (args.kind) and.push({ kind: args.kind });
  const tasks = await db.crmTask.findMany({ where: { AND: and }, orderBy: [{ dueAt: "asc" }], take: 300 });
  const userIds = [...new Set(tasks.flatMap((task) => [task.assigneeId, task.decidedById]).filter((value): value is string => Boolean(value)))];
  const orgIds = [...new Set(tasks.map((task) => task.organizationId).filter((value): value is string => Boolean(value)))];
  const contactIds = [...new Set(tasks.map((task) => task.contactId).filter((value): value is string => Boolean(value)))];
  const [users, orgs, contacts, owners] = await Promise.all([
    userIds.length ? db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : [],
    orgIds.length ? db.organization.findMany({ where: { id: { in: orgIds } }, select: { id: true, name: true } }) : [],
    contactIds.length ? db.crmContact.findMany({ where: { id: { in: contactIds } }, select: { id: true, phone: true, email: true } }) : [],
    orgIds.length
      ? db.user.findMany({
          where: { organizationId: { in: orgIds }, isActive: true, archivedAt: null, isRoot: false, role: { in: ["owner", "manager"] } },
          orderBy: { createdAt: "asc" },
          select: { organizationId: true, phone: true, email: true, contactEmail: true },
        })
      : [],
  ]);
  const userName = new Map(users.map((user) => [user.id, user.name]));
  const orgName = new Map(orgs.map((org) => [org.id, org.name]));
  const contactOf = new Map(contacts.map((contact) => [contact.id, contact]));
  const ownerOf = new Map<string, (typeof owners)[number]>();
  for (const owner of owners) if (owner.organizationId && !ownerOf.has(owner.organizationId)) ownerOf.set(owner.organizationId, owner);
  return tasks.map((task) => {
    const contact = task.contactId ? contactOf.get(task.contactId) : undefined;
    const owner = task.organizationId ? ownerOf.get(task.organizationId) : undefined;
    const ownerEmail = [owner?.contactEmail, owner?.email].find((value) => value && value.includes("@") && !isTechnicalEmail(value)) ?? null;
    return {
      ...task,
      assigneeName: task.assigneeId ? (userName.get(task.assigneeId) ?? null) : null,
      organizationName: task.organizationId ? (orgName.get(task.organizationId) ?? null) : null,
      decidedByName: task.decidedById ? (userName.get(task.decidedById) ?? null) : null,
      client: {
        phone: contact?.phone?.trim() || owner?.phone?.trim() || null,
        email: contact?.email?.trim() || ownerEmail,
      },
    };
  });
}

/** Счётчики для сводки CRM: задачи на сегодня, просроченные, согласования. */
export async function countCrmTasks(args: { ownScopeId?: string | null; now?: Date }): Promise<{ today: number; overdue: number; approvals: number }> {
  const now = args.now ?? new Date();
  const scope: Prisma.CrmTaskWhereInput = args.ownScopeId ? { OR: [{ assigneeId: args.ownScopeId }, { assigneeId: null }] } : {};
  const endOfDay = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  endOfDay.setUTCHours(23, 59, 59, 999);
  const todayEnd = new Date(endOfDay.getTime() - 3 * 60 * 60 * 1000);
  const [today, overdue, approvals] = await Promise.all([
    db.crmTask.count({ where: { ...scope, status: "open", dueAt: { gt: now, lte: todayEnd } } }),
    db.crmTask.count({ where: { ...scope, status: "open", dueAt: { lte: now }, kind: { not: "approve_discount" } } }),
    db.crmTask.count({ where: { ...scope, kind: "approve_discount", approvalStatus: "pending", status: "open" } }),
  ]);
  return { today, overdue, approvals };
}
