import { randomUUID } from "node:crypto";

import { Prisma } from "@prisma/client";

import { formatMskDay } from "@/lib/billing-period";
import { CrmTaskError, createCrmTask, notifyTaskAssignee, readLifecycleSettings, type TaskActor } from "@/lib/crm/tasks.server";
import { ingestCrmItems } from "@/lib/crm/ingest.server";
import { db } from "@/lib/db";
import { renderEmailLayout } from "@/lib/email";
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

import { advanceDealFor } from "./deals.server";
import { quoted } from "./emails";
import { discountedRub, offerPriceLine, renderOfferEmail, termsMismatch, type OfferInput } from "./offer";
import { loadPlatformStaff, managerSignature } from "./people.server";
import { approverFor, limitOf } from "./staff";

/**
 * Спец-КП со скидкой из CRM (2026-11-10). Скидка ≤ лимита роли — сразу:
 * персональный код на организацию (прежние коды CRM этой организации
 * гасятся), письмо с точным тарифом и ценой от имени менеджера, ссылка на
 * оплату с кодом, счёт со скидкой (при ИНН), запись в ленте, сделка →
 * «Сообщение отправлено». Больше — задача «Согласовать скидку» тому, чей
 * лимит покрывает; после согласования у просящего задача «Отправить КП»
 * ровно на согласованные условия (`decideDiscount`).
 */

const APP_URL = () => (process.env.NEXTAUTH_URL || "https://wesetup.ru").replace(/\/+$/, "");
/** Повторная отправка КП организации раньше этого — отказ (двойной клик, две вкладки). */
const OFFER_LOCK_MS = 2 * 60 * 1000;

export type OfferResult =
  | { ok: true; status: "sent"; code: string | null; invoiceId: number | null; invoiceError?: string; via: string; note?: string }
  | { ok: true; status: "approval"; approverName: string; taskId: string };

type Terms = { tier?: string; cycle?: string; points?: number; percent?: number; approvedById?: string; lifetime?: boolean; validDays?: number; toEmail?: string; note?: string | null };

async function lock(key: string): Promise<boolean> {
  try {
    await db.crmReminderLog.create({ data: { dedupeKey: key, kind: "lifecycle.offer_lock" } });
    return true;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return false;
    throw error;
  }
}

/** Сколько точек у клиента в работе — меньше оплатить нельзя (касса откажет). */
async function pointsInUse(organizationId: string): Promise<number> {
  const { loadBillingUnit } = await import("@/lib/billing.server");
  const unit = await loadBillingUnit(organizationId).catch(() => null);
  return unit?.pointsInUse ?? 1;
}

export async function sendSpecialOffer(request: OfferInput, actor: TaskActor & { organizationId: string }): Promise<OfferResult> {
  let input = request;
  const org = await db.organization.findUnique({ where: { id: input.organizationId }, select: { id: true, name: true, type: true, inn: true, accountManagerId: true } });
  if (!org) throw new CrmTaskError("Организация не найдена", 404);
  if (actor.own && org.accountManagerId && org.accountManagerId !== actor.id) throw new CrmTaskError("Организация не найдена", 404);
  const [staff, pricing, settings] = await Promise.all([loadPlatformStaff(), readPlanPricing(), readLifecycleSettings()]);

  // Лимит — из роли (владелец — 90 %): коммерческий директор со всеми разделами всё равно 25 %.
  let ceiling = limitOf(staff, actor.id);
  let originTask: { id: string; dealId: string | null } | null = null;
  if (input.taskId) {
    const task = await db.crmTask.findUnique({ where: { id: input.taskId } });
    if (!task || task.organizationId !== org.id) throw new CrmTaskError("Задача не относится к этой организации");
    if (task.status !== "open") throw new CrmTaskError("Задача уже закрыта", 409);
    if (actor.own && task.assigneeId && task.assigneeId !== actor.id) throw new CrmTaskError("Задача не найдена", 404);
    const terms = (task.terms ?? null) as Terms | null;
    if (task.kind === "offer" && task.approvalStatus === "approved" && typeof terms?.percent === "number") {
      if (task.assigneeId !== actor.id) throw new CrmTaskError("Согласованное КП отправляет тот, кто просил согласование", 403);
      const mismatch = termsMismatch(terms, input);
      if (mismatch) throw new CrmTaskError(mismatch);
      // Согласовано целиком: «на все продления» и срок кода — как в заявке, не из запроса.
      input = { ...input, lifetime: terms.lifetime === true, validDays: Math.min(input.validDays, typeof terms.validDays === "number" ? terms.validDays : input.validDays) };
      ceiling = Math.max(ceiling, terms.percent);
    } else if (task.approvalStatus === "approved" && task.discountPercent && task.assigneeId === actor.id) {
      // Звонок сценария, по которому скидку уже согласовали (крупный клиент) — её и можно дать.
      ceiling = Math.max(ceiling, task.discountPercent);
    }
    originTask = { id: task.id, dealId: task.dealId };
  }

  const inUse = await pointsInUse(org.id);
  if (input.points < inUse) throw new CrmTaskError(`У клиента в работе ${inUse} точ. — КП на меньшее число точек оплатить не получится`);
  const fullRub = planPeriodPriceRub(pricing.rates, input.tier, input.cycle, input.points);
  const priceLine = offerPriceLine({ ...input, fullRub });
  const contact = await db.crmContact.findFirst({ where: { organizationId: org.id }, orderBy: { lastActivityAt: "desc" }, select: { id: true } });
  const deal = originTask?.dealId
    ? { id: originTask.dealId }
    : await db.crmDeal.findFirst({ where: { organizationId: org.id, stage: { notIn: ["won", "lost"] } }, orderBy: { periodEnd: "desc" }, select: { id: true } });

  if (input.discountPercent > ceiling) {
    const approver = approverFor(staff, input.discountPercent, actor.id, settings.approverId);
    if (!approver) throw new CrmTaskError(`Скидку ${input.discountPercent} % согласовать некому — у всех лимит меньше`);
    const task = await createCrmTask({
      kind: "approve_discount",
      title: `Согласовать скидку ${input.discountPercent} %: ${quoted(org.name)}`.slice(0, 200),
      note: [
        `Просит: ${actor.name ?? "менеджер"} (лимит ${ceiling} %).`,
        `Предложение: ${priceLine}.`,
        `Код действует ${input.validDays} дн.${input.lifetime ? ", скидка на все продления" : ", на первую оплату"}.`,
        input.note ? `Комментарий: ${input.note}` : null,
      ]
        .filter(Boolean)
        .join("\n"),
      organizationId: org.id,
      contactId: contact?.id ?? null,
      dealId: deal?.id ?? null,
      assigneeId: approver.id,
      dueAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
      discountPercent: input.discountPercent,
      approvalStatus: "pending",
      createdById: actor.id,
      terms: {
        tier: input.tier,
        cycle: input.cycle,
        points: input.points,
        percent: input.discountPercent,
        lifetime: input.lifetime,
        validDays: input.validDays,
        toEmail: input.toEmail,
        note: input.note || null,
        requestedById: actor.id,
        source: "offer",
      },
    });
    if (!task) throw new CrmTaskError("Согласование не создано — попробуйте ещё раз", 500);
    await notifyTaskAssignee(task).catch(() => 0);
    if (contact) {
      await ingestCrmItems([
        { externalKey: `crm-approval:${task.id}`, contactId: contact.id, channel: "note", direction: "note", subject: "Скидка на согласовании", body: `${priceLine}. Согласует: ${approver.name}.`, occurredAt: new Date(), authorName: actor.name, authorUserId: actor.id, identity: {} },
      ]).catch(() => undefined);
    }
    return { ok: true, status: "approval", approverName: approver.name, taskId: task.id };
  }

  // Двойной запрос — второй КП не уходит: недавний замок или тот же двухминутный интервал.
  const recent = await db.crmReminderLog.count({ where: { dedupeKey: { startsWith: `lc:offer-lock:${org.id}:` }, sentAt: { gt: new Date(Date.now() - OFFER_LOCK_MS) } } });
  const lockKey = `lc:offer-lock:${org.id}:${Math.floor(Date.now() / OFFER_LOCK_MS)}`;
  if (recent || !(await lock(lockKey))) throw new CrmTaskError("КП этой организации только что отправлено — проверьте ленту", 409);

  // Код скидки: персональный на организацию, одно использование, срок N дней.
  // Прежние коды CRM этой организации гасятся после отправки — действует последнее предложение.
  let code: string | null = null;
  let codeId: string | null = null;
  const endsAt = promoEndsAfterDays(new Date(), input.validDays);
  const campaignId = `crm-org:${org.id}`;
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
    codeId = created.get("crm-offer")?.id ?? null;
    if (!code) throw new CrmTaskError("Код скидки не создан — попробуйте ещё раз", 500);
  }

  // КП (веб-версия и PDF) — тот же тариф и код, подпись менеджера.
  const manager = await managerSignature(actor.id);
  const resolved = await resolveProposalForm(
    {
      sphere: normalizeSphere(org.type),
      companyName: org.name,
      recipientName: null,
      promoCode: code,
      sender: { name: manager?.name ?? actor.name ?? "Команда WeSetup", position: manager?.position ?? null, phone: manager?.phone ?? null, email: manager?.email ?? null, telegram: null },
    },
    { sender: await readDefaultProposalSender() },
  );
  resolved.vars.plan = input.tier;
  const preview = await buildProposalPreview(resolved, proposalAppOrigin());

  // Счёт со скидкой — если у организации есть ИНН.
  let invoice: { id: number; amountRub: number; pdf: Buffer } | null = null;
  let invoiceError: string | undefined;
  if (input.attachInvoice) {
    const owner = await db.user.findFirst({ where: { organizationId: org.id, isActive: true, archivedAt: null, isRoot: false, role: { in: ["owner", "manager"] } }, orderBy: { createdAt: "asc" }, select: { id: true } });
    const { hasPendingInvoice } = await import("@/lib/billing.server");
    if (!org.inn?.trim()) invoiceError = "у организации не указан ИНН";
    // Свой неоплаченный счёт клиента не закрываем новым: бухгалтерия могла его уже оплатить.
    else if (await hasPendingInvoice([org.id])) invoiceError = "у клиента уже есть неоплаченный счёт — новый не выставлен";
    else if (owner) {
      const created = await createInvoiceOrder({ organizationId: org.id, userId: owner.id, email: input.toEmail, target: { tier: input.tier, cycle: input.cycle, points: input.points }, promoCode: code, allowIndividual: true });
      if (created.ok) {
        const rendered = await renderInvoice(created.order.id);
        if (rendered) invoice = { id: created.order.id, amountRub: Number(created.order.amountRub), pdf: rendered.pdf };
        // Счёт из КП — не решение клиента «платим»: автопереход его не ждёт (только новый счёт).
        if (created.created) await db.crmReminderLog.create({ data: { dedupeKey: `lc:invoice:${created.order.id}`, kind: "lifecycle.invoice" } }).catch(() => null);
      } else invoiceError = created.error;
    }
  }

  const ownerName = await db.user
    .findFirst({ where: { organizationId: org.id, isActive: true, archivedAt: null, isRoot: false, role: { in: ["owner", "manager"] } }, orderBy: { createdAt: "asc" }, select: { name: true, email: true, contactEmail: true } })
    .then((user) => (user && [user.email, user.contactEmail].some((email) => email?.trim().toLowerCase() === input.toEmail.toLowerCase()) ? user.name : null));
  const app = APP_URL();
  const letter = renderOfferEmail({
    orgName: org.name,
    recipientName: ownerName,
    tier: input.tier,
    cycle: input.cycle,
    points: input.points,
    fullRub,
    discountPercent: input.discountPercent,
    code,
    codeEndsLabel: code ? formatMskDay(new Date(endsAt.getTime() - 1)) : null,
    lifetime: input.lifetime,
    invoice: invoice ? { number: String(invoice.id), amountRub: invoice.amountRub } : null,
    links: { pay: `${app}/settings/subscription${code ? `?promo=${encodeURIComponent(code)}` : ""}`, web: preview.webUrl, pdf: preview.pdfUrl },
    note: input.note,
    manager,
  });
  const messageId = `crm-kp-${randomUUID()}@wesetup.ru`;
  const sent = await sendStaffEmail({
    senderUserId: actor.id,
    to: input.toEmail,
    subject: letter.subject,
    html: renderEmailLayout(letter.subject, letter.html),
    text: letter.text,
    messageId: `<${messageId}>`,
    attachments: invoice ? [{ filename: invoiceFilename(String(invoice.id)).utf8, content: invoice.pdf, contentType: "application/pdf" }] : undefined,
  });
  if (!sent.ok) {
    // Письмо не ушло — новый код не нужен, прежний у клиента продолжает действовать.
    if (codeId) await db.promoCode.update({ where: { id: codeId }, data: { active: false } }).catch(() => undefined);
    await db.crmReminderLog.deleteMany({ where: { dedupeKey: lockKey } }).catch(() => undefined);
    throw new CrmTaskError(sent.error, 502);
  }
  await db.promoCode.updateMany({ where: { campaignId, active: true, ...(codeId ? { id: { not: codeId } } : {}) }, data: { active: false } });

  const now = new Date();
  await ingestCrmItems([
    {
      externalKey: `email-out:${messageId}:${input.toEmail}`,
      ...(contact ? { contactId: contact.id } : {}),
      channel: "email",
      direction: "out",
      subject: letter.subject,
      body: letter.text,
      href: preview.webUrl,
      occurredAt: now,
      authorName: actor.name,
      authorUserId: actor.id,
      identity: { email: input.toEmail, organizationId: org.id, company: org.name },
    },
  ]).catch((error) => console.error("[crm-offer] лента", error));
  const amount = discountedRub(fullRub, input.discountPercent);
  await advanceDealFor({ dealId: deal?.id ?? null, organizationIds: [org.id] }, "message_sent", {
    messageSentAt: now,
    // В воронке суммы — в месяц: годовое КП делим на 12, чтобы колонки складывались.
    amountRub: Math.round(input.cycle === "year" ? amount / 12 : amount),
    offerJson: { tier: input.tier, cycle: input.cycle, points: input.points, discountPercent: input.discountPercent, amountRub: amount, code, sentAt: now.toISOString(), by: actor.name } as Prisma.InputJsonValue,
  }).catch(() => null);
  if (originTask) {
    await db.crmTask.update({ where: { id: originTask.id }, data: { status: "done", result: `КП отправлено: ${priceLine}${code ? `, код ${code}` : ""}`, closedAt: now, closedById: actor.id } });
  }
  await db.auditLog
    .create({
      data: {
        organizationId: actor.organizationId,
        userId: actor.id,
        userName: actor.name,
        action: "crm.offer.send",
        entity: "crm",
        entityId: org.id,
        details: { org: org.name, code, invoice: invoice?.id ?? null, tier: input.tier, cycle: input.cycle, points: input.points, discountPercent: input.discountPercent } as Prisma.InputJsonValue,
      },
    })
    .catch(() => undefined);
  return { ok: true, status: "sent", code, invoiceId: invoice?.id ?? null, invoiceError, via: sent.via, note: sent.via === "system" ? "Ушло с общего адреса, ответ придёт на вашу почту" : undefined };
}

/** Что подставить в форму КП: тариф под команду, точки, получатель, лимит, согласованные условия задачи. */
export async function offerDefaults(organizationId: string, actor: TaskActor, taskId: string | null) {
  const { loadBillingUnit } = await import("@/lib/billing.server");
  const [org, unit, staff, pricing, settings] = await Promise.all([
    db.organization.findUnique({ where: { id: organizationId }, select: { id: true, name: true, inn: true, accountManagerId: true } }),
    loadBillingUnit(organizationId).catch(() => null),
    loadPlatformStaff(),
    readPlanPricing(),
    readLifecycleSettings(),
  ]);
  if (!org) return null;
  // Охват «свои»: чужой клиент — как будто его нет.
  if (actor.own && org.accountManagerId && org.accountManagerId !== actor.id) return null;
  const owner = await db.user.findFirst({ where: { organizationId, isActive: true, archivedAt: null, isRoot: false, role: { in: ["owner", "manager"] } }, orderBy: { createdAt: "asc" }, select: { email: true, contactEmail: true } });
  const { isTechnicalEmail } = await import("@/lib/technical-email");
  const toEmail = [owner?.contactEmail, owner?.email].find((value) => value && value.includes("@") && !isTechnicalEmail(value)) ?? "";
  const seats = unit?.activeUsers ?? 1;
  const points = Math.max(1, unit?.pointsInUse ?? 1);
  const { tierForHeadcount } = await import("@/lib/tariff-plans");
  const { suggestedDiscount } = await import("./plan");
  const found = taskId ? await db.crmTask.findUnique({ where: { id: taskId }, select: { kind: true, approvalStatus: true, terms: true, discountPercent: true, organizationId: true, assigneeId: true } }) : null;
  // Задача — только этой организации и (для охвата «свои») своя или общая.
  const task = found && found.organizationId === organizationId && !(actor.own && found.assigneeId && found.assigneeId !== actor.id) ? found : null;
  const terms = task?.kind === "offer" && task.approvalStatus === "approved" ? ((task.terms ?? null) as Terms | null) : null;
  return {
    organizationId,
    orgName: org.name,
    hasInn: Boolean(org.inn?.trim()),
    toEmail: terms?.toEmail || toEmail,
    note: terms?.note ?? "",
    lifetime: terms?.lifetime === true,
    validDays: typeof terms?.validDays === "number" ? terms.validDays : 7,
    seats,
    pointsInUse: points,
    limit: limitOf(staff, actor.id),
    rates: pricing.rates,
    tier: (terms?.tier as "standard" | "premium" | "vip" | undefined) ?? tierForHeadcount(Math.ceil(seats / points)),
    cycle: (terms?.cycle as "month" | "year" | undefined) ?? "year",
    points: terms?.points ?? points,
    discountPercent: terms?.percent ?? (task?.discountPercent || suggestedDiscount(seats, settings.discounts)),
    locked: Boolean(terms),
  };
}
