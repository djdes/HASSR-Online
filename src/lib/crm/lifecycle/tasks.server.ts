import { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { CrmActionError, type CrmActor } from "@/lib/crm/actions.server";
import { claim, deliver, settle } from "@/lib/crm/notify.server";
import { ingestCrmItems } from "@/lib/crm/ingest.server";

import { atMsk, isWorkingDay, mskDay, mskHour, workingDaysBetween } from "./calendar";
import { TASK_RESULTS, TASK_RESULT_LABELS, type CompleteTaskInput, type DealPatch, type ManualTaskInput } from "./forms";
import { loadPlatformStaff } from "./people.server";
import { notifyAssignees } from "./run.server";
import { advanceStage, DEAL_STAGE_SHORT, type DealStage } from "./stages";

/**
 * Задачи и сделки CRM — действия людей: закрыть задачу с итогом, перенести,
 * переназначить, поставить свою; двинуть сделку, отметить договор и отказ.
 * Итог задачи пишется в ленту контакта и двигает сделку («Дозвонился» →
 * «Был прозвон»). Охват «свои»: менеджер действует только со своим и
 * свободным, назначает только себя.
 */

const APP_URL = () => (process.env.NEXTAUTH_URL || "https://wesetup.ru").replace(/\/+$/, "");

async function audit(actor: CrmActor, action: string, entityId: string, details: Record<string, unknown>) {
  await db.auditLog
    .create({ data: { organizationId: actor.organizationId, userId: actor.id, userName: actor.name, action, entity: "crm", entityId, details: details as Prisma.InputJsonValue } })
    .catch((error) => console.error("[crm] аудит не записан", error));
}

function assertOwn(actor: CrmActor, ownerId: string | null, what: string) {
  if (actor.own && ownerId && ownerId !== actor.id) throw new CrmActionError(`${what} закреплена за другим менеджером`, 404);
}

async function assertAssignable(actor: CrmActor, userId: string | null) {
  if (!userId) return;
  if (actor.own && userId !== actor.id) throw new CrmActionError("Менеджер назначает только себя — передать другому может РОП", 403);
  const user = await db.user.findFirst({ where: { id: userId, isActive: true, archivedAt: null, OR: [{ isRoot: true }, { platformSections: { has: "crm" } }] }, select: { id: true } });
  if (!user) throw new CrmActionError("Назначить можно только сотрудника с разделом «CRM»");
}

async function note(contactId: string | null, key: string, subject: string, body: string, actor: CrmActor, channel = "note") {
  if (!contactId) return;
  await ingestCrmItems([
    { externalKey: key, contactId, channel, direction: channel === "call" ? "out" : "note", subject, body, occurredAt: new Date(), authorName: actor.name, authorUserId: actor.id, identity: {} },
  ]).catch((error) => console.error("[crm] лента: задача", error));
}

/** Сделку двигает событие (итог задачи, письмо): ручную колонку не трогает. */
export async function advanceDeal(dealId: string | null, to: DealStage, data: Prisma.CrmDealUpdateInput = {}): Promise<DealStage | null> {
  if (!dealId) return null;
  const deal = await db.crmDeal.findUnique({ where: { id: dealId }, select: { stage: true, stageManual: true } });
  if (!deal) return null;
  const next = advanceStage(deal, to);
  await db.crmDeal.update({ where: { id: dealId }, data: { ...data, ...(next ? { stage: next } : {}) } });
  return next;
}

/** Письмо или звонок менеджера из карточки контакта двигают открытую сделку контакта. */
export async function markContactActivity(contactId: string, kind: "message_sent" | "called"): Promise<void> {
  const deal = await db.crmDeal.findFirst({ where: { contactId, stage: { notIn: ["won", "lost"] } }, orderBy: { createdAt: "desc" }, select: { id: true } });
  if (!deal) return;
  await advanceDeal(deal.id, kind, kind === "called" ? { calledAt: new Date() } : { messageSentAt: new Date() });
}

const RESULT_STAGE: Partial<Record<keyof typeof TASK_RESULTS, DealStage>> = {
  reached: "called",
  messaged: "called",
  promised: "called",
  offer_sent: "message_sent",
};

/** Время в прошлом (с запасом 5 минут) — отказ: «перезвонить вчера» не задача. */
function assertFuture(iso: string | null | undefined, what: string) {
  if (iso && new Date(iso).getTime() < Date.now() - 5 * 60 * 1000) throw new CrmActionError(`${what} — в прошлом. Выберите время позже`);
}

/** Менеджер с охватом «свои» не трогает чужую сделку, даже через свободную задачу. */
async function assertOwnDeal(actor: CrmActor, dealId: string | null) {
  if (!actor.own || !dealId) return;
  const deal = await db.crmDeal.findUnique({ where: { id: dealId }, select: { ownerId: true } });
  assertOwn(actor, deal?.ownerId ?? null, "Сделка");
}

export async function completeTask(taskId: string, input: CompleteTaskInput, actor: CrmActor): Promise<{ followUpId: string | null }> {
  const task = await db.crmTask.findUnique({ where: { id: taskId } });
  if (!task) throw new CrmActionError("Задача не найдена", 404);
  assertOwn(actor, task.assigneeId, "Задача");
  await assertOwnDeal(actor, task.dealId);
  assertFuture(input.followUpAt, "Перезвон");
  if (task.status !== "open") throw new CrmActionError("Задача уже закрыта", 409);
  if (task.kind === "approval") throw new CrmActionError("Согласование закрывается кнопками «Согласовать» / «Отклонить»");
  const now = new Date();
  await db.crmTask.update({ where: { id: taskId }, data: { status: "done", result: input.result, resultNote: input.note || null, completedAt: now, completedById: actor.id } });
  const label = TASK_RESULT_LABELS[input.result];
  await note(task.contactId, `crm-task:${taskId}`, `Задача: ${label}`, `${task.title}\n${label}${input.note ? `: ${input.note}` : ""}`, actor, input.result === "reached" || input.result === "no_answer" ? "call" : "note");
  const stage = RESULT_STAGE[input.result];
  if (stage) await advanceDeal(task.dealId, stage, stage === "called" ? { calledAt: now } : { messageSentAt: now });
  if (input.result === "declined" && task.dealId) {
    await db.crmDeal.update({ where: { id: task.dealId }, data: { stage: "lost", stageManual: true, lostAt: now, lostReason: input.note || "Отказ клиента" } });
    await db.crmTask.updateMany({ where: { dealId: task.dealId, status: "open", kind: { not: "approval" } }, data: { status: "cancelled", result: "obsolete", completedAt: now } });
  }
  let followUpId: string | null = null;
  if (input.followUpAt && input.result !== "declined") {
    const followUp = await db.crmTask.create({
      data: {
        dealId: task.dealId,
        contactId: task.contactId,
        organizationId: task.organizationId,
        assigneeId: task.assigneeId ?? actor.id,
        kind: "call",
        title: `Перезвонить: ${task.title.replace(/^(Перезвонить: )+/, "")}`.slice(0, 200),
        body: `${label}${input.note ? `: ${input.note}` : ""}\n\n${task.body}`.slice(0, 4000),
        dueAt: new Date(input.followUpAt),
        scenario: "manual",
        createdById: actor.id,
      },
      select: { id: true },
    });
    followUpId = followUp.id;
  }
  await audit(actor, "crm.task.complete", taskId, { result: input.result, followUp: followUpId });
  return { followUpId };
}

export async function patchTask(taskId: string, patch: { dueAt?: string; assigneeId?: string | null }, actor: CrmActor): Promise<void> {
  const task = await db.crmTask.findUnique({ where: { id: taskId }, select: { id: true, assigneeId: true, status: true } });
  if (!task) throw new CrmActionError("Задача не найдена", 404);
  assertOwn(actor, task.assigneeId, "Задача");
  if (task.status !== "open") throw new CrmActionError("Задача уже закрыта", 409);
  assertFuture(patch.dueAt, "Новый срок");
  const data: Prisma.CrmTaskUpdateInput = {};
  if (patch.dueAt) data.dueAt = new Date(patch.dueAt);
  if (patch.assigneeId !== undefined) {
    await assertAssignable(actor, patch.assigneeId);
    data.assigneeId = patch.assigneeId;
    data.notifiedAt = null;
  }
  await db.crmTask.update({ where: { id: taskId }, data });
  if (patch.assigneeId) await notifyAssignees([taskId]).catch(() => 0);
  await audit(actor, "crm.task.update", taskId, patch);
}

export async function createManualTask(input: ManualTaskInput, actor: CrmActor): Promise<string> {
  let organizationId: string | null = null;
  let contactId = input.contactId ?? null;
  let dealId = input.dealId ?? null;
  assertFuture(input.dueAt, "Срок");
  let dealContactId: string | null = null;
  if (dealId) {
    const deal = await db.crmDeal.findUnique({ where: { id: dealId }, select: { ownerId: true, contactId: true, organizationId: true } });
    if (!deal) throw new CrmActionError("Сделка не найдена", 404);
    assertOwn(actor, deal.ownerId, "Сделка");
    dealContactId = deal.contactId;
    contactId = contactId ?? deal.contactId;
    organizationId = deal.organizationId;
  }
  if (contactId) {
    const contact = await db.crmContact.findUnique({ where: { id: contactId }, select: { ownerId: true, organizationId: true } });
    if (!contact) throw new CrmActionError("Контакт не найден", 404);
    assertOwn(actor, contact.ownerId, "Контакт");
    if (dealId && dealContactId !== contactId && contact.organizationId !== organizationId) throw new CrmActionError("Сделка и контакт — разных клиентов");
    organizationId = organizationId ?? contact.organizationId;
    if (!dealId) {
      const deal = await db.crmDeal.findFirst({ where: { contactId, stage: { notIn: ["won", "lost"] } }, orderBy: { createdAt: "desc" }, select: { id: true, ownerId: true } });
      if (deal) {
        assertOwn(actor, deal.ownerId, "Сделка");
        dealId = deal.id;
      }
    }
  }
  const assigneeId = input.assigneeId === undefined ? actor.id : input.assigneeId;
  await assertAssignable(actor, assigneeId);
  const task = await db.crmTask.create({
    data: { dealId, contactId, organizationId, assigneeId, kind: input.kind, title: input.title, body: input.body ?? "", dueAt: new Date(input.dueAt), scenario: "manual", createdById: actor.id },
    select: { id: true },
  });
  if (assigneeId && assigneeId !== actor.id) await notifyAssignees([task.id]).catch(() => 0);
  await audit(actor, "crm.task.create", task.id, { title: input.title, assigneeId });
  return task.id;
}

export async function patchDeal(dealId: string, patch: DealPatch, actor: CrmActor): Promise<void> {
  const deal = await db.crmDeal.findUnique({ where: { id: dealId }, select: { id: true, ownerId: true, stage: true, contactId: true } });
  if (!deal) throw new CrmActionError("Сделка не найдена", 404);
  assertOwn(actor, deal.ownerId, "Сделка");
  const now = new Date();
  const data: Prisma.CrmDealUpdateInput = {};
  const notes: string[] = [];
  if (patch.stage && patch.stage !== deal.stage) {
    data.stage = patch.stage;
    // Колонку поставил человек — автоматика её не трогает (кроме оплаты после отказа).
    data.stageManual = true;
    if (patch.stage === "won") Object.assign(data, { wonAt: now, lostAt: null, lostReason: null });
    else if (patch.stage === "lost") Object.assign(data, { lostAt: now, lostReason: patch.lostReason || "Отказ клиента" });
    else Object.assign(data, { wonAt: null, lostAt: null, lostReason: null });
    notes.push(`Сделка → «${DEAL_STAGE_SHORT[patch.stage]}»${patch.stage === "lost" && patch.lostReason ? `: ${patch.lostReason}` : ""}`);
    if (patch.stage === "lost" || patch.stage === "won") {
      await db.crmTask.updateMany({
        where: { dealId, status: "open", kind: { not: "approval" } },
        data: { status: patch.stage === "won" ? "done" : "cancelled", result: patch.stage === "won" ? "paid" : "obsolete", completedAt: now },
      });
    }
  }
  if (patch.contractSigned !== undefined) {
    data.contractSignedAt = patch.contractSigned ? now : null;
    notes.push(patch.contractSigned ? "Договор подписан (отмечено вручную)" : "Отметка «договор подписан» снята");
    if (!patch.stage) {
      const current = await db.crmDeal.findUnique({ where: { id: dealId }, select: { stage: true, stageManual: true } });
      if (patch.contractSigned) {
        const next = current ? advanceStage(current, "contract_signed") : null;
        if (next) data.stage = next;
      } else if (current?.stage === "contract_signed" && !current.stageManual) {
        // Сняли отметку — карточка возвращается в «Зарегистрировался».
        data.stage = "registered";
      }
    }
  }
  if (patch.ownerId !== undefined) {
    await assertAssignable(actor, patch.ownerId);
    data.ownerId = patch.ownerId;
    await db.crmTask.updateMany({ where: { dealId, status: "open", kind: { not: "approval" } }, data: { assigneeId: patch.ownerId, notifiedAt: null } });
    notes.push("Сменился ответственный");
  }
  await db.crmDeal.update({ where: { id: dealId }, data });
  if (notes.length) await note(deal.contactId, `crm-deal:${dealId}:${now.getTime()}`, "Сделка", notes.join("\n"), actor);
  await audit(actor, "crm.deal.update", dealId, patch);
}

// --------------------------------------------------------------- оповещения

/**
 * Утром (9:00–10:00 рабочего дня) — каждому ответственному «задачи на сегодня
 * и просрочено». Просрочено на рабочий день и больше — эскалация РОП (кроме
 * самого ответственного), по разу на задачу, в рабочее время.
 */
export async function runTaskReminders(now = new Date()): Promise<{ daily: number; escalated: number }> {
  const today = mskDay(now);
  const hour = mskHour(now);
  if (!isWorkingDay(today) || hour < 9 || hour >= 19) return { daily: 0, escalated: 0 };
  const endOfToday = atMsk(today, 23, 59);
  const tasks = await db.crmTask.findMany({
    where: { status: "open", dueAt: { lte: endOfToday } },
    orderBy: { dueAt: "asc" },
    select: { id: true, title: true, assigneeId: true, dueAt: true },
  });
  if (!tasks.length) return { daily: 0, escalated: 0 };
  const staff = await loadPlatformStaff();
  let daily = 0;
  let escalated = 0;
  if (hour < 10) {
    const byAssignee = new Map<string, typeof tasks>();
    for (const task of tasks) if (task.assigneeId) byAssignee.set(task.assigneeId, [...(byAssignee.get(task.assigneeId) ?? []), task]);
    for (const [assigneeId, list] of byAssignee) {
      const person = staff.find((item) => item.id === assigneeId);
      if (!person) continue;
      const key = `lc:tasks-day:${assigneeId}:${today}`;
      const logId = await claim(key, "lifecycle_daily", null);
      if (!logId) continue;
      const overdue = list.filter((task) => task.dueAt.getTime() < atMsk(today, 0).getTime()).length;
      const lines = list.slice(0, 12).map((task) => `• ${task.title}`);
      const text = `☀️ Задачи CRM на сегодня: ${list.length}${overdue ? `, из них просрочено: ${overdue}` : ""}\n${lines.join("\n")}${list.length > 12 ? `\n…и ещё ${list.length - 12}` : ""}\n${APP_URL()}/root/crm/tasks`;
      const delivered = await deliver([{ id: person.id, email: person.contactEmail || person.email, telegramChatId: person.telegramChatId }], { subject: `Задачи CRM на сегодня: ${list.length}`, text }, "lifecycle_daily", key);
      await settle(logId, delivered);
      if (delivered) daily += 1;
    }
  }
  // Эскалация РОП: по разу на задачу (ключ на задачу), но одним сообщением на РОП за прогон.
  const heads = staff.filter((person) => person.salesHead);
  const fresh: { task: (typeof tasks)[number]; logId: string }[] = [];
  for (const task of tasks) {
    if (workingDaysBetween(mskDay(task.dueAt), today) < 1) continue;
    if (!heads.some((head) => head.id !== task.assigneeId)) continue;
    const logId = await claim(`lc:escalate:${task.id}`, "lifecycle_escalation", null);
    if (logId) fresh.push({ task, logId });
  }
  for (const head of heads) {
    const mine = fresh.filter((item) => item.task.assigneeId !== head.id);
    if (!mine.length) continue;
    const lines = mine.slice(0, 15).map(({ task }) => `• ${task.title} — ${staff.find((person) => person.id === task.assigneeId)?.name ?? "без ответственного"}`);
    const text = `⏰ Просрочены задачи CRM (${mine.length}):\n${lines.join("\n")}${mine.length > 15 ? `\n…и ещё ${mine.length - 15}` : ""}\n${APP_URL()}/root/crm/tasks?who=all`;
    const delivered = await deliver([{ id: head.id, email: head.contactEmail || head.email, telegramChatId: head.telegramChatId }], { subject: `Просрочены задачи CRM: ${mine.length}`, text }, "lifecycle_escalation", `lc:escalate-batch:${head.id}:${now.getTime()}`);
    if (delivered) escalated += mine.length;
  }
  for (const item of fresh) await settle(item.logId, 1);
  return { daily, escalated };
}
