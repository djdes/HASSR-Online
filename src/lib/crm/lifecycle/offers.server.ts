import { randomUUID } from "node:crypto";

import { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { staffSender } from "@/lib/client-documents.server";
import { CrmActionError, type CrmActor } from "@/lib/crm/actions.server";
import { claim, deliver, settle } from "@/lib/crm/notify.server";
import { ingestCrmItems } from "@/lib/crm/ingest.server";
import { createInvoiceOrder, renderInvoice } from "@/lib/invoices/service";
import { invoiceFilename } from "@/lib/invoices/build";
import { normalizeSphere } from "@/lib/org-profile";
import { sendStaffEmail } from "@/lib/platform-mail.server";
import { createPersonalPromoCodes } from "@/lib/promo/personal-codes";
import { promoEndsAfterDays } from "@/lib/promo/valid-days";
import { buildProposalPreview, resolveProposalForm } from "@/lib/proposal/root.server";
import { readDefaultProposalSender } from "@/lib/proposal/context.server";
import { proposalAppOrigin } from "@/lib/proposal/token";
import { readPlanPricing } from "@/lib/tariffs";
import { planPeriodPriceRub } from "@/lib/tariff-plans";

import { quoted, rub } from "./copy";
import type { ApprovalDecision, OfferInput } from "./forms";
import { CYCLE_NAMES, TIER_NAMES } from "./offer";
import { approverFor, loadPlatformStaff, limitOf, type StaffPerson } from "./people.server";
import { advanceDeal } from "./tasks.server";

/**
 * Спец-КП со скидкой из сделки или задачи CRM и согласование скидки сверх
 * лимита роли. Скидка ≤ лимита — сразу: персональный код на организацию,
 * КП с кодом от имени менеджера, счёт со скидкой (при ИНН), запись в ленте.
 * Больше — задача «Согласовать скидку» тому, чей лимит покрывает; после
 * «Согласовать» у менеджера задача «Отправить КП» с той же формой.
 */

const APP_URL = () => (process.env.NEXTAUTH_URL || "https://wesetup.ru").replace(/\/+$/, "");

type OfferPayload = Omit<OfferInput, "taskId"> & { requestedById: string; requestedByName: string | null; approvedPercent?: number; approvedById?: string; originTaskId?: string | null };

async function loadDeal(dealId: string, actor: CrmActor) {
  const deal = await db.crmDeal.findUnique({
    where: { id: dealId },
    select: { id: true, ownerId: true, contactId: true, organizationId: true, kind: true, stage: true },
  });
  if (!deal) throw new CrmActionError("Сделка не найдена", 404);
  if (actor.own && deal.ownerId && deal.ownerId !== actor.id) throw new CrmActionError("Сделка закреплена за другим менеджером", 404);
  const org = await db.organization.findUnique({ where: { id: deal.organizationId }, select: { id: true, name: true, type: true, inn: true, legalProfileJson: true } });
  if (!org) throw new CrmActionError("Организация не найдена", 404);
  return { deal, org };
}

function priceSummary(rates: Awaited<ReturnType<typeof readPlanPricing>>["rates"], input: Pick<OfferInput, "tier" | "cycle" | "points" | "discountPercent">): { full: number; discounted: number; line: string } {
  const full = planPeriodPriceRub(rates, input.tier, input.cycle, input.points);
  const discounted = Math.round((full * (100 - input.discountPercent)) / 100);
  const pointsPart = input.points > 1 ? ` на ${input.points} точ.` : "";
  return { full, discounted, line: `${TIER_NAMES[input.tier]}${pointsPart} ${CYCLE_NAMES[input.cycle]}: ${rub(full)}${input.discountPercent ? ` → ${rub(discounted)} (−${input.discountPercent} %)` : ""}` };
}

async function notifyPerson(person: StaffPerson, key: string, subject: string, text: string) {
  const logId = await claim(key, "lifecycle_offer", null);
  if (!logId) return;
  const delivered = await deliver([{ id: person.id, email: person.contactEmail || person.email, telegramChatId: person.telegramChatId }], { subject, text }, "lifecycle_offer", key);
  await settle(logId, delivered);
}

export type OfferResult =
  | { ok: true; status: "sent"; code: string | null; invoiceId: number | null; invoiceError?: string; via: string; note?: string }
  | { ok: true; status: "approval"; approverName: string; taskId: string };

/**
 * Отправить спец-КП (или запросить согласование). `approvalTaskId` — задача
 * «Отправить КП» после согласования: её процент — потолок скидки.
 */
export async function sendSpecialOffer(input: OfferInput, actor: CrmActor): Promise<OfferResult> {
  const { deal, org } = await loadDeal(input.dealId, actor);
  const [staff, pricing] = await Promise.all([loadPlatformStaff(), readPlanPricing()]);
  const price = priceSummary(pricing.rates, input);

  // Потолок без согласования: лимит роли или согласованный процент задачи.
  let ceiling = limitOf(staff, actor.id);
  let originTask: { id: string; payloadJson: Prisma.JsonValue; kind: string; status: string; assigneeId: string | null } | null = null;
  if (input.taskId) {
    originTask = await db.crmTask.findUnique({ where: { id: input.taskId }, select: { id: true, payloadJson: true, kind: true, status: true, assigneeId: true } });
    if (!originTask || originTask.status !== "open") throw new CrmActionError("Задача уже закрыта", 409);
    const payload = originTask.payloadJson as Partial<OfferPayload> | null;
    if (originTask.kind === "offer" && typeof payload?.approvedPercent === "number") ceiling = Math.max(ceiling, payload.approvedPercent);
  }

  if (input.discountPercent > ceiling) {
    const approver = approverFor(staff, input.discountPercent, actor.id);
    if (!approver) throw new CrmActionError(`Скидку ${input.discountPercent} % согласовать некому — у всех лимит меньше`);
    const payload: OfferPayload = { ...input, requestedById: actor.id, requestedByName: actor.name, originTaskId: input.taskId ?? null };
    const users = await db.crmDeal.findUnique({ where: { id: deal.id }, select: { offerJson: true } });
    const offerFacts = users?.offerJson as { users?: number; points?: number; segment?: string } | null;
    const task = await db.crmTask.create({
      data: {
        dealId: deal.id,
        contactId: deal.contactId,
        organizationId: org.id,
        assigneeId: approver.id,
        kind: "approval",
        title: `Согласовать скидку ${input.discountPercent} % для ${quoted(org.name)}`.slice(0, 200),
        body: [
          `Просит: ${actor.name ?? "менеджер"} (лимит ${ceiling} %).`,
          `Предложение: ${price.line}.`,
          offerFacts?.users ? `По аккаунту: ${offerFacts.users} сотрудников, ${offerFacts.points ?? 1} точ.` : null,
          `Код действует ${input.validDays} дн.${input.lifetime ? ", скидка на все продления" : ", на первую оплату"}.`,
          input.note ? `Комментарий: ${input.note}` : null,
        ]
          .filter(Boolean)
          .join("\n"),
        dueAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
        scenario: "approval",
        payloadJson: payload as unknown as Prisma.InputJsonValue,
        createdById: actor.id,
      },
      select: { id: true },
    });
    await notifyPerson(
      approver,
      `lc:approval:${task.id}`,
      `Согласовать скидку ${input.discountPercent} %`,
      `🤝 ${actor.name ?? "Менеджер"} просит согласовать скидку ${input.discountPercent} % для ${quoted(org.name)}: ${price.line}.\n${APP_URL()}/root/crm/tasks`,
    );
    await ingestCrmItems([
      { externalKey: `crm-approval:${task.id}`, contactId: deal.contactId ?? undefined, channel: "note", direction: "note", subject: "Скидка на согласовании", body: `${price.line}. Согласует: ${approver.name}.`, occurredAt: new Date(), authorName: actor.name, authorUserId: actor.id, identity: {} },
    ]).catch(() => undefined);
    return { ok: true, status: "approval", approverName: approver.name, taskId: task.id };
  }

  // Код скидки: персональный на организацию, одно использование, срок N дней.
  let code: string | null = null;
  const endsAt = promoEndsAfterDays(new Date(), input.validDays);
  if (input.discountPercent > 0) {
    const created = await createPersonalPromoCodes([{ key: "crm-offer", email: null, organizationId: org.id, companyName: org.name }], {
      kind: "percent",
      value: input.discountPercent,
      lifetime: input.lifetime,
      endsAt,
      note: `Спец-КП CRM · ${actor.name ?? actor.id}`,
      campaignId: `crm-deal:${deal.id}`,
    });
    code = created.get("crm-offer")?.code ?? null;
    if (!code) throw new CrmActionError("Код скидки не создан — попробуйте ещё раз", 500);
  }

  // КП от имени менеджера: подпись, тариф, код.
  const sender = await staffSender(actor.id);
  const resolved = await resolveProposalForm(
    {
      sphere: normalizeSphere(org.type),
      companyName: org.name,
      recipientName: null,
      promoCode: code,
      sender: { name: sender.name, position: sender.position ?? null, phone: sender.phone, email: sender.email, telegram: null },
    },
    { sender: await readDefaultProposalSender() },
  );
  resolved.vars.plan = input.tier;
  const preview = await buildProposalPreview(resolved, proposalAppOrigin());

  // Счёт со скидкой — если у организации есть ИНН.
  let invoice: { id: number; pdf: Buffer } | null = null;
  let invoiceError: string | undefined;
  const hasInn = Boolean(org.inn?.trim() || (org.legalProfileJson as { inn?: string } | null)?.inn);
  if (input.attachInvoice && hasInn) {
    const owner = await db.user.findFirst({ where: { organizationId: org.id, isActive: true, archivedAt: null, role: { in: ["owner", "manager"] } }, orderBy: { createdAt: "asc" }, select: { id: true } });
    if (owner) {
      const created = await createInvoiceOrder({ organizationId: org.id, userId: owner.id, email: input.toEmail, target: { tier: input.tier, cycle: input.cycle, points: input.points }, promoCode: code, allowIndividual: true });
      if (created.ok) {
        const rendered = await renderInvoice(created.order.id);
        if (rendered) invoice = { id: created.order.id, pdf: rendered.pdf };
        await claim(`lc:invoice:${created.order.id}`, "lifecycle_invoice", deal.contactId).catch(() => null);
      } else {
        invoiceError = created.error;
        console.warn(`[crm-offer] счёт не выставлен: ${created.error}`);
      }
    }
  } else if (input.attachInvoice) {
    invoiceError = "у организации не указан ИНН";
  }

  const intro = input.note ? `<p style="margin:0 0 16px;color:#3f3f46;line-height:1.6">${input.note.replace(/[&<>]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[ch] ?? ch).replace(/\n/g, "<br>")}</p>` : "";
  const html = intro ? preview.email.html.replace(/<body([^>]*)>/i, (match) => `${match}${intro}`) : preview.email.html;
  const messageId = `crm-kp-${randomUUID()}@wesetup.ru`;
  const sent = await sendStaffEmail({
    senderUserId: actor.id,
    to: input.toEmail,
    subject: preview.content.subject,
    html,
    text: `${input.note ? `${input.note}\n\n` : ""}${preview.email.text}`,
    messageId: `<${messageId}>`,
    attachments: invoice ? [{ filename: invoiceFilename(String(invoice.id)).utf8, content: invoice.pdf, contentType: "application/pdf" }] : undefined,
  });
  if (!sent.ok) throw new CrmActionError(sent.error, 502);

  const now = new Date();
  await ingestCrmItems([
    {
      externalKey: `email-out:${messageId}:${input.toEmail}`,
      contactId: deal.contactId ?? undefined,
      channel: "email",
      direction: "out",
      subject: `КП: ${preview.content.subject}`,
      body: [`${price.line}.`, code ? `Код ${code} до ${endsAt.toLocaleDateString("ru-RU", { timeZone: "Europe/Moscow" })}.` : null, invoice ? `Счёт № ${invoice.id} во вложении.` : null, `Веб-версия: ${preview.webUrl}`, input.note || null]
        .filter(Boolean)
        .join("\n"),
      href: preview.webUrl,
      occurredAt: now,
      authorName: actor.name,
      authorUserId: actor.id,
      identity: {},
    },
  ]).catch((error) => console.error("[crm-offer] лента", error));
  const offerJson = await db.crmDeal.findUnique({ where: { id: deal.id }, select: { offerJson: true } });
  await advanceDeal(deal.id, "message_sent", {
    messageSentAt: now,
    ...(invoice ? { invoiceOrderId: invoice.id } : {}),
    offerJson: { ...((offerJson?.offerJson as object | null) ?? {}), sent: { tier: input.tier, cycle: input.cycle, points: input.points, discountPercent: input.discountPercent, code, at: now.toISOString(), by: actor.name } } as Prisma.InputJsonValue,
    amountRub: price.discounted,
  });
  if (originTask) {
    await db.crmTask.update({ where: { id: originTask.id }, data: { status: "done", result: "offer_sent", resultNote: `${price.line}${code ? `, код ${code}` : ""}`, completedAt: now, completedById: actor.id } });
  }
  await db.auditLog
    .create({ data: { organizationId: actor.organizationId, userId: actor.id, userName: actor.name, action: "crm.offer.send", entity: "crm", entityId: deal.id, details: { org: org.name, code, invoice: invoice?.id ?? null, ...input, toEmail: undefined } as Prisma.InputJsonValue } })
    .catch(() => undefined);
  return { ok: true, status: "sent", code, invoiceId: invoice?.id ?? null, invoiceError, via: sent.via, note: sent.via === "system" ? `Ушло с общего адреса ${sent.from}` : undefined };
}

/** «Согласовать» / «Отклонить» скидку из задачи согласования. */
export async function decideApproval(taskId: string, decision: ApprovalDecision, actor: CrmActor): Promise<{ offerTaskId: string | null }> {
  const task = await db.crmTask.findUnique({ where: { id: taskId } });
  if (!task || task.kind !== "approval") throw new CrmActionError("Задача согласования не найдена", 404);
  if (task.status !== "open") throw new CrmActionError("Уже решено", 409);
  const payload = task.payloadJson as OfferPayload | null;
  if (!payload) throw new CrmActionError("В задаче нет предложения");
  const staff = await loadPlatformStaff();
  const percent = decision.percent ?? payload.discountPercent;
  if (task.assigneeId !== actor.id && limitOf(staff, actor.id) < percent) throw new CrmActionError("Согласовать может тот, кому назначено, или сотрудник с лимитом не меньше", 403);
  if (decision.approve && limitOf(staff, actor.id) < percent) throw new CrmActionError(`Ваш лимит ${limitOf(staff, actor.id)} % — меньше ${percent} %`, 403);
  const now = new Date();
  await db.crmTask.update({
    where: { id: taskId },
    data: { status: "done", result: decision.approve ? "approved" : "rejected", resultNote: decision.comment || (decision.approve ? `${percent} %` : null), completedAt: now, completedById: actor.id },
  });
  const requester = staff.find((person) => person.id === payload.requestedById);
  const org = task.organizationId ? await db.organization.findUnique({ where: { id: task.organizationId }, select: { name: true } }) : null;
  const orgName = org?.name ?? "клиент";
  await ingestCrmItems([
    {
      externalKey: `crm-approval-decision:${taskId}`,
      contactId: task.contactId ?? undefined,
      channel: "note",
      direction: "note",
      subject: decision.approve ? "Скидка согласована" : "Скидка отклонена",
      body: `${decision.approve ? `Согласовано: ${percent} %` : "Отклонено"}${decision.comment ? ` — ${decision.comment}` : ""} (${actor.name ?? "согласующий"}).`,
      occurredAt: now,
      authorName: actor.name,
      authorUserId: actor.id,
      identity: {},
    },
  ]).catch(() => undefined);
  let offerTaskId: string | null = null;
  if (decision.approve) {
    const offerTask = await db.crmTask.create({
      data: {
        dealId: task.dealId,
        contactId: task.contactId,
        organizationId: task.organizationId,
        assigneeId: payload.requestedById,
        kind: "offer",
        title: `Скидка ${percent} % согласована: отправить КП ${quoted(orgName)}`.slice(0, 200),
        body: `Согласовал: ${actor.name ?? "—"}${decision.comment ? ` — ${decision.comment}` : ""}.\nОткройте «Отправить КП» — форма заполнена.`,
        dueAt: now,
        scenario: "offer",
        payloadJson: { ...payload, discountPercent: percent, approvedPercent: percent, approvedById: actor.id } as unknown as Prisma.InputJsonValue,
        createdById: actor.id,
      },
      select: { id: true },
    });
    offerTaskId = offerTask.id;
    if (payload.originTaskId) {
      await db.crmTask.updateMany({ where: { id: payload.originTaskId, status: "open" }, data: { status: "cancelled", result: "superseded", completedAt: now } });
    }
  }
  if (requester) {
    await notifyPerson(
      requester,
      `lc:approval-decision:${taskId}`,
      decision.approve ? `Скидка ${percent} % согласована` : "Скидка отклонена",
      decision.approve
        ? `✅ Скидка ${percent} % для ${quoted(orgName)} согласована (${actor.name ?? "—"}). Отправьте КП: ${APP_URL()}/root/crm/tasks`
        : `✖ Скидка для ${quoted(orgName)} отклонена (${actor.name ?? "—"})${decision.comment ? `: ${decision.comment}` : ""}.`,
    );
  }
  return { offerTaskId };
}
