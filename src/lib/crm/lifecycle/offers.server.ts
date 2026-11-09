import { randomUUID } from "node:crypto";

import { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { renderEmailLayout } from "@/lib/email";
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

import { mskDay } from "./calendar";
import { quoted, renderOfferEmail, rub } from "./copy";
import type { ApprovalDecision, OfferInput } from "./forms";
import { CYCLE_NAMES, TIER_NAMES } from "./offer";
import { approverFor, loadPlatformStaff, limitOf, type StaffPerson } from "./people.server";
import { advanceDeal } from "./tasks.server";

/**
 * Спец-КП со скидкой из сделки или задачи CRM и согласование скидки сверх
 * лимита роли. Скидка ≤ лимита — сразу: персональный код на организацию
 * (прежние коды этой сделки гасятся), письмо с точным тарифом и ценой от имени
 * менеджера, счёт со скидкой (при ИНН), запись в ленте. Больше — задача
 * «Согласовать скидку» тому, чей лимит покрывает; после «Согласовать» у
 * просящего задача «Отправить КП» ровно на согласованные условия.
 */

const APP_URL = () => (process.env.NEXTAUTH_URL || "https://wesetup.ru").replace(/\/+$/, "");
/** Повторная отправка КП по сделке раньше этого — отказ (двойной запрос, двойной клик). */
const OFFER_LOCK_MS = 2 * 60 * 1000;

type OfferPayload = Omit<OfferInput, "taskId"> & {
  requestedById: string;
  requestedByName: string | null;
  approvedPercent?: number;
  approvedById?: string;
  originTaskId?: string | null;
};

async function loadDeal(dealId: string, actor: CrmActor) {
  const deal = await db.crmDeal.findUnique({
    where: { id: dealId },
    select: { id: true, ownerId: true, contactId: true, organizationId: true, kind: true, stage: true, offerJson: true },
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

/** Сколько точек у клиента в работе — меньше оплатить нельзя (касса откажет). */
async function pointsInUse(organizationId: string): Promise<number> {
  const { loadBillingUnit } = await import("@/lib/billing.server");
  const unit = await loadBillingUnit(organizationId).catch(() => null);
  return unit?.pointsInUse ?? 1;
}

export type OfferResult =
  | { ok: true; status: "sent"; code: string | null; invoiceId: number | null; invoiceError?: string; via: string; note?: string }
  | { ok: true; status: "approval"; approverName: string; taskId: string };

/**
 * Отправить спец-КП (или запросить согласование). `taskId` — задача сделки, из
 * которой отправляют: она закроется «Отправил КП». Задача «Отправить КП» после
 * согласования — потолок скидки, но только на свою сделку, своему менеджеру и
 * ровно на согласованные тариф, период и точки.
 */
export async function sendSpecialOffer(input: OfferInput, actor: CrmActor): Promise<OfferResult> {
  const { deal, org } = await loadDeal(input.dealId, actor);
  const [staff, pricing] = await Promise.all([loadPlatformStaff(), readPlanPricing()]);

  let ceiling = limitOf(staff, actor.id);
  let originTask: { id: string } | null = null;
  if (input.taskId) {
    const task = await db.crmTask.findUnique({ where: { id: input.taskId }, select: { id: true, payloadJson: true, kind: true, status: true, assigneeId: true, dealId: true } });
    if (!task || task.dealId !== deal.id) throw new CrmActionError("Задача не относится к этой сделке", 400);
    if (task.status !== "open") throw new CrmActionError("Задача уже закрыта", 409);
    if (actor.own && task.assigneeId && task.assigneeId !== actor.id) throw new CrmActionError("Задача закреплена за другим менеджером", 404);
    const payload = task.payloadJson as Partial<OfferPayload> | null;
    if (task.kind === "offer" && typeof payload?.approvedPercent === "number") {
      if (task.assigneeId !== actor.id) throw new CrmActionError("Согласованное КП отправляет тот, кто просил согласование", 403);
      if (payload.tier !== input.tier || payload.cycle !== input.cycle || payload.points !== input.points) {
        throw new CrmActionError(
          `Согласовано на ${TIER_NAMES[payload.tier ?? "standard"]}, ${payload.points ?? 1} точ., ${payload.cycle === "year" ? "за год" : "помесячно"} — другие условия отправьте на новое согласование`,
        );
      }
      ceiling = Math.max(ceiling, payload.approvedPercent);
    }
    originTask = { id: task.id };
  }

  const inUse = await pointsInUse(org.id);
  if (input.points < inUse) throw new CrmActionError(`У клиента в работе ${inUse} точ. — КП на меньшее число точек оплатить не получится`);
  const price = priceSummary(pricing.rates, input);

  if (input.discountPercent > ceiling) {
    const approver = approverFor(staff, input.discountPercent, actor.id);
    if (!approver) throw new CrmActionError(`Скидку ${input.discountPercent} % согласовать некому — у всех лимит меньше`);
    const payload: OfferPayload = { ...input, requestedById: actor.id, requestedByName: actor.name, originTaskId: input.taskId ?? null };
    const offerFacts = deal.offerJson as { users?: number; points?: number } | null;
    const task = await db.crmTask.create({
      data: {
        dealId: deal.id,
        contactId: deal.contactId,
        organizationId: org.id,
        assigneeId: approver.id,
        kind: "approval",
        title: `Согласовать скидку ${input.discountPercent} %: ${quoted(org.name)}`.slice(0, 200),
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
      `🤝 ${actor.name ?? "Менеджер"} просит согласовать скидку ${input.discountPercent} %: ${quoted(org.name)}, ${price.line}.\n${APP_URL()}/root/crm/tasks?kind=approval`,
    );
    await ingestCrmItems([
      { externalKey: `crm-approval:${task.id}`, contactId: deal.contactId ?? undefined, channel: "note", direction: "note", subject: "Скидка на согласовании", body: `${price.line}. Согласует: ${approver.name}.`, occurredAt: new Date(), authorName: actor.name, authorUserId: actor.id, identity: {} },
    ]).catch(() => undefined);
    return { ok: true, status: "approval", approverName: approver.name, taskId: task.id };
  }

  // Двойной запрос (двойной клик, две вкладки) — второй КП не уходит.
  const lockKey = `lc:offer-lock:${deal.id}:${Math.floor(Date.now() / OFFER_LOCK_MS)}`;
  if (!(await claim(lockKey, "lifecycle_offer_lock", deal.contactId))) throw new CrmActionError("КП по этой сделке только что отправлено — проверьте ленту", 409);

  // Код скидки: персональный на организацию, одно использование, срок N дней.
  // Прежние коды этой сделки гасятся — действует только последнее предложение.
  let code: string | null = null;
  const endsAt = promoEndsAfterDays(new Date(), input.validDays);
  const campaignId = `crm-deal:${deal.id}`;
  await db.promoCode.updateMany({ where: { campaignId, active: true }, data: { active: false } });
  if (input.discountPercent > 0) {
    const created = await createPersonalPromoCodes([{ key: "crm-offer", email: null, organizationId: org.id, companyName: org.name }], {
      kind: "percent",
      value: input.discountPercent,
      lifetime: input.lifetime,
      endsAt,
      note: `Спец-КП CRM · ${actor.name ?? actor.id}`,
      campaignId,
    });
    code = created.get("crm-offer")?.code ?? null;
    if (!code) throw new CrmActionError("Код скидки не создан — попробуйте ещё раз", 500);
  }

  // КП (веб-версия и PDF) — тот же тариф и код, подпись менеджера.
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
  let invoice: { id: number; amountRub: number; pdf: Buffer } | null = null;
  let invoiceError: string | undefined;
  const hasInn = Boolean(org.inn?.trim() || (org.legalProfileJson as { inn?: string } | null)?.inn);
  if (input.attachInvoice && hasInn) {
    const owner = await db.user.findFirst({ where: { organizationId: org.id, isActive: true, archivedAt: null, role: { in: ["owner", "manager"] } }, orderBy: { createdAt: "asc" }, select: { id: true } });
    if (owner) {
      const created = await createInvoiceOrder({ organizationId: org.id, userId: owner.id, email: input.toEmail, target: { tier: input.tier, cycle: input.cycle, points: input.points }, promoCode: code, allowIndividual: true });
      if (created.ok) {
        const rendered = await renderInvoice(created.order.id);
        if (rendered) invoice = { id: created.order.id, amountRub: Number(created.order.amountRub), pdf: rendered.pdf };
        await claim(`lc:invoice:${created.order.id}`, "lifecycle_invoice", deal.contactId).catch(() => null);
      } else {
        invoiceError = created.error;
        console.warn(`[crm-offer] счёт не выставлен: ${created.error}`);
      }
    }
  } else if (input.attachInvoice) {
    invoiceError = "у организации не указан ИНН";
  }

  const app = APP_URL();
  const letter = renderOfferEmail({
    orgName: org.name,
    recipientName: null,
    tier: input.tier,
    cycle: input.cycle,
    points: input.points,
    fullRub: price.full,
    discountPercent: input.discountPercent,
    discountedRub: price.discounted,
    code,
    codeEndsDay: code ? mskDay(new Date(endsAt.getTime() - 1)) : null,
    lifetime: input.lifetime,
    invoice: invoice ? { number: String(invoice.id), amountRub: invoice.amountRub } : null,
    links: { pay: `${app}/settings/subscription${code ? `?promo=${encodeURIComponent(code)}` : ""}`, web: preview.webUrl, pdf: preview.pdfUrl },
    note: input.note,
    manager: { name: sender.name, position: sender.position ?? null, phone: sender.phone, email: sender.email },
  });
  const messageId = `crm-kp-${randomUUID()}@wesetup.ru`;
  const sent = await sendStaffEmail({
    senderUserId: actor.id,
    to: input.toEmail,
    subject: letter.subject,
    html: renderEmailLayout(letter.subject, letter.html, null, { preheader: letter.subject }),
    text: letter.text,
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
      subject: letter.subject,
      body: letter.text,
      href: preview.webUrl,
      occurredAt: now,
      authorName: actor.name,
      authorUserId: actor.id,
      identity: {},
    },
  ]).catch((error) => console.error("[crm-offer] лента", error));
  await advanceDeal(deal.id, "message_sent", {
    messageSentAt: now,
    ...(invoice ? { invoiceOrderId: invoice.id } : {}),
    offerJson: {
      ...((deal.offerJson as object | null) ?? {}),
      sent: { tier: input.tier, cycle: input.cycle, points: input.points, discountPercent: input.discountPercent, amountRub: price.discounted, code, at: now.toISOString(), by: actor.name },
    } as Prisma.InputJsonValue,
    amountRub: price.discounted,
  });
  if (originTask) {
    await db.crmTask.update({ where: { id: originTask.id }, data: { status: "done", result: "offer_sent", resultNote: `${price.line}${code ? `, код ${code}` : ""}`, completedAt: now, completedById: actor.id } });
  }
  await db.auditLog
    .create({
      data: {
        organizationId: actor.organizationId,
        userId: actor.id,
        userName: actor.name,
        action: "crm.offer.send",
        entity: "crm",
        entityId: deal.id,
        details: { org: org.name, code, invoice: invoice?.id ?? null, tier: input.tier, cycle: input.cycle, points: input.points, discountPercent: input.discountPercent } as Prisma.InputJsonValue,
      },
    })
    .catch(() => undefined);
  return { ok: true, status: "sent", code, invoiceId: invoice?.id ?? null, invoiceError, via: sent.via, note: sent.via === "system" ? `Ушло с общего адреса ${sent.from}` : undefined };
}

/**
 * «Согласовать» / «Отклонить» скидку. Решает тот, кому назначено, или
 * сотрудник с лимитом не меньше запрошенного; просящий сам себе — нет.
 * Согласовать можно не больше запрошенного и не больше своего лимита.
 */
export async function decideApproval(taskId: string, decision: ApprovalDecision, actor: CrmActor): Promise<{ offerTaskId: string | null }> {
  const task = await db.crmTask.findUnique({ where: { id: taskId } });
  if (!task || task.kind !== "approval") throw new CrmActionError("Задача согласования не найдена", 404);
  if (task.status !== "open") throw new CrmActionError("Уже решено", 409);
  const payload = task.payloadJson as OfferPayload | null;
  if (!payload) throw new CrmActionError("В задаче нет предложения");
  const staff = await loadPlatformStaff();
  const myLimit = limitOf(staff, actor.id);
  const requested = payload.discountPercent;
  if (task.assigneeId !== actor.id && myLimit < requested) throw new CrmActionError("Решает тот, кому назначено согласование, или сотрудник с лимитом не меньше запрошенного", 403);
  if (payload.requestedById === actor.id) throw new CrmActionError("Свою заявку на скидку согласует другой сотрудник", 403);
  const percent = decision.percent ?? requested;
  if (decision.approve) {
    if (percent > requested) throw new CrmActionError(`Запрошено ${requested} % — согласовать можно столько же или меньше`);
    if (myLimit < percent) throw new CrmActionError(`Ваш лимит ${myLimit} % — меньше ${percent} %`, 403);
  }
  const now = new Date();
  await db.crmTask.update({
    where: { id: taskId },
    data: { status: "done", result: decision.approve ? "approved" : "rejected", resultNote: decision.comment || (decision.approve ? `${percent} %` : null), completedAt: now, completedById: actor.id },
  });
  const requester = staff.find((person) => person.id === payload.requestedById);
  const org = task.organizationId ? await db.organization.findUnique({ where: { id: task.organizationId }, select: { name: true } }) : null;
  const orgName = quoted(org?.name ?? "клиент");
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
        title: `Скидка ${percent} % согласована — отправить КП: ${orgName}`.slice(0, 200),
        body: `Согласовал: ${actor.name ?? "—"}${decision.comment ? ` — ${decision.comment}` : ""}.\nОткройте «Отправить КП» — форма заполнена: ${TIER_NAMES[payload.tier]}, ${payload.points} точ., ${payload.cycle === "year" ? "за год" : "помесячно"}.`,
        // Срок — через 4 часа: задача не «просрочена» в момент появления.
        dueAt: new Date(now.getTime() + 4 * 60 * 60 * 1000),
        scenario: "offer",
        payloadJson: { ...payload, discountPercent: percent, approvedPercent: percent, approvedById: actor.id } as unknown as Prisma.InputJsonValue,
        createdById: actor.id,
      },
      select: { id: true },
    });
    offerTaskId = offerTask.id;
    if (payload.originTaskId) {
      await db.crmTask.updateMany({ where: { id: payload.originTaskId, dealId: task.dealId, status: "open" }, data: { status: "cancelled", result: "superseded", completedAt: now } });
    }
  }
  if (requester) {
    await notifyPerson(
      requester,
      `lc:approval-decision:${taskId}`,
      decision.approve ? `Скидка ${percent} % согласована` : "Скидка отклонена",
      decision.approve
        ? `✅ Скидка ${percent} % согласована (${actor.name ?? "—"}): ${orgName}. Отправьте КП: ${APP_URL()}/root/crm/tasks?kind=offer`
        : `✖ Скидка отклонена (${actor.name ?? "—"}): ${orgName}${decision.comment ? ` — ${decision.comment}` : ""}.`,
    );
  }
  return { offerTaskId };
}
