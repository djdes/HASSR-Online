import { Prisma, type CrmTask } from "@prisma/client";

import { db } from "@/lib/db";
import { renderEmailLayout, sendRawEmail } from "@/lib/email";
import { escapeHtml } from "@/lib/html-escape";
import { DEFAULT_LIFECYCLE_SETTINGS, LIFECYCLE_SETTING_KEY, normalizeLifecycleSettings, type LifecycleSettings } from "@/lib/lifecycle/plan";
import { listSalesHeads } from "@/lib/crm/notify.server";
import { getPlatformAdministrators } from "@/lib/platform-admin";
import { sendTelegramMessage } from "@/lib/telegram";
import { isTechnicalEmail } from "@/lib/technical-email";

/**
 * Задачи CRM (2026-11-09): создание с ключом события, оповещение
 * исполнителя, «выполнено / отменить», согласование скидки и закрытие всех
 * задач сценария, когда клиент заплатил.
 */

const APP_URL = () => process.env.NEXTAUTH_URL || "https://wesetup.ru";

export const CRM_TASK_KINDS = ["call", "approve_discount", "payment_overdue", "lost_reason", "manual"] as const;
export type CrmTaskKind = (typeof CRM_TASK_KINDS)[number];

export const CRM_TASK_KIND_LABELS: Record<string, string> = {
  call: "Связаться по оплате",
  approve_discount: "Согласовать скидку",
  payment_overdue: "Оплата просрочена",
  lost_reason: "Узнать причину отказа",
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
    const ok = await db.user.count({ where: { id: userId, isActive: true, archivedAt: null, OR: [{ isRoot: true }, { platformSections: { isEmpty: false } }] } });
    if (!ok) throw new CrmTaskError("Исполнителем можно выбрать только сотрудника панели платформы");
  }
  const value = JSON.stringify(settings);
  await db.platformSetting.upsert({ where: { key: LIFECYCLE_SETTING_KEY }, create: { key: LIFECYCLE_SETTING_KEY, value }, update: { value } });
  return settings;
}

/** Кого можно назначить: владелец платформы и сотрудники панели. */
export async function listTaskAssignees(): Promise<{ id: string; name: string }[]> {
  return db.user.findMany({
    where: { isActive: true, archivedAt: null, OR: [{ isRoot: true }, { platformSections: { isEmpty: false } }] },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
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

export type TaskActor = { id: string; name: string | null; superadmin: boolean };

async function loadTask(id: string): Promise<CrmTask> {
  const task = await db.crmTask.findUnique({ where: { id } });
  if (!task) throw new CrmTaskError("Задача не найдена", 404);
  return task;
}

/** Выполнено / отменено — с итогом. */
export async function closeCrmTask(id: string, actor: TaskActor, args: { status: "done" | "cancelled"; result: string | null }): Promise<void> {
  const task = await loadTask(id);
  if (task.status === "done" || task.status === "cancelled") return;
  if (task.kind === "approve_discount" && args.status === "done") throw new CrmTaskError("Согласование закрывается решением: согласовать или отказать");
  await db.crmTask.update({
    where: { id },
    data: { status: args.status, result: args.result?.trim() || null, closedAt: new Date(), closedById: actor.id },
  });
}

/**
 * Решение по скидке. Согласовано — звонок, который ждал, открывается со
 * скидкой из решения; отказано — открывается с обычной скидкой полосы.
 */
export async function decideDiscount(id: string, actor: TaskActor, args: { approve: boolean; percent: number | null; comment: string | null }): Promise<void> {
  const task = await loadTask(id);
  if (task.kind !== "approve_discount") throw new CrmTaskError("Это не согласование скидки");
  if (task.approvalStatus !== "pending") throw new CrmTaskError("Решение уже принято", 409);
  const settings = await readLifecycleSettings();
  if (!actor.superadmin && settings.approverId && settings.approverId !== actor.id && task.assigneeId !== actor.id) {
    throw new CrmTaskError("Согласует тот, кто назначен в настройках задач", 403);
  }
  const percent = args.approve ? Math.min(90, Math.max(0, Math.round(args.percent ?? task.discountPercent ?? 0))) : null;
  const now = new Date();
  const status = args.approve ? "approved" : "rejected";
  const comment = args.comment?.trim() || null;
  await db.$transaction(async (tx) => {
    await tx.crmTask.update({
      where: { id },
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
  });
  const opened = await db.crmTask.findMany({ where: { approvalTaskId: id, status: "open" } });
  for (const call of opened) await notifyTaskAssignee(call).catch(() => 0);
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

export type TaskRow = CrmTask & { assigneeName: string | null; organizationName: string | null; decidedByName: string | null };

export async function listCrmTasks(args: { includeClosed: boolean; assigneeId?: string | null }): Promise<TaskRow[]> {
  const where: Prisma.CrmTaskWhereInput = {
    ...(args.includeClosed ? { closedAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } } : { status: { in: ["open", "waiting"] } }),
    ...(args.assigneeId ? { assigneeId: args.assigneeId } : {}),
  };
  const tasks = await db.crmTask.findMany({ where, orderBy: [{ dueAt: "asc" }], take: 300 });
  const userIds = [...new Set(tasks.flatMap((task) => [task.assigneeId, task.decidedById]).filter((value): value is string => Boolean(value)))];
  const orgIds = [...new Set(tasks.map((task) => task.organizationId).filter((value): value is string => Boolean(value)))];
  const [users, orgs] = await Promise.all([
    userIds.length ? db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : [],
    orgIds.length ? db.organization.findMany({ where: { id: { in: orgIds } }, select: { id: true, name: true } }) : [],
  ]);
  const userName = new Map(users.map((user) => [user.id, user.name]));
  const orgName = new Map(orgs.map((org) => [org.id, org.name]));
  return tasks.map((task) => ({
    ...task,
    assigneeName: task.assigneeId ? (userName.get(task.assigneeId) ?? null) : null,
    organizationName: task.organizationId ? (orgName.get(task.organizationId) ?? null) : null,
    decidedByName: task.decidedById ? (userName.get(task.decidedById) ?? null) : null,
  }));
}
