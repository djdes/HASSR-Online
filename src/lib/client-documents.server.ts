import type { Session } from "next-auth";

import { readPlatformRequisites } from "@/lib/closing-documents/requisites";
import { db } from "@/lib/db";
import { loadDocumentOrgBlock } from "@/lib/document-org-block.server";
import { renderEmailLayout } from "@/lib/email";
import { invoiceFilename, invoiceRequisitesReady } from "@/lib/invoices/build";
import { createInvoiceOrder, renderInvoice } from "@/lib/invoices/service";
import { canUsePlatformSection } from "@/lib/platform-access";
import { platformViewerForSession } from "@/lib/platform-access.server";
import { sendStaffEmail, type StaffEmailResult } from "@/lib/platform-mail.server";
import { renderProposalPdf } from "@/lib/proposal";
import { listProposalPromoOptions, resolveProposalForm, type ProposalPromoOption } from "@/lib/proposal/root.server";
import { isProposalSphere } from "@/lib/proposal/spheres";
import type { ProposalPlan, ProposalSender, ProposalVars } from "@/lib/proposal/types";
import { loadClientContacts } from "@/lib/root-client-card.server";
import { isTechnicalEmail } from "@/lib/technical-email";
import { isBillingCycle, isPaidTier, normalizePoints, type BillingCycle, type PaidTier, type PlanRates } from "@/lib/tariff-plans";
import { readPlanPricing } from "@/lib/tariffs";

import {
  clientDocumentRecipients,
  defaultAddressee,
  defaultGreeting,
  defaultInvoiceMessage,
  defaultInvoiceSubject,
  defaultProposalMessage,
  messageHtml,
  type DocumentRecipient,
} from "./client-documents";

/**
 * «Документы клиенту» в карточке клиента: КП и счёт «от пользователя» —
 * письмо уходит с личной почты сотрудника панели (`sendStaffEmail`), КП
 * подписан им же. Договор — `src/lib/contracts`.
 */

export const CLIENT_PROPOSAL_AUDIT = "client_proposal.send";
export const CLIENT_INVOICE_AUDIT = "client_invoice.send";

export type StaffSender = Required<Pick<ProposalSender, "name">> & {
  position: string | null;
  phone: string | null;
  email: string | null;
  /** Есть проверенная личная почта — письмо уйдёт с неё. */
  personalMailbox: boolean;
};

/** Подпись КП: настройки «Моей почты» сотрудника, иначе его профиль. */
export async function staffSender(userId: string): Promise<StaffSender> {
  const [mailbox, user] = await Promise.all([
    db.platformMailSender.findUnique({ where: { userId } }),
    db.user.findUnique({ where: { id: userId }, select: { name: true, email: true, contactEmail: true, phone: true, positionTitle: true } }),
  ]);
  const login = user?.email && !isTechnicalEmail(user.email) ? user.email : null;
  return {
    name: mailbox?.fromName?.trim() || user?.name || "Команда WeSetup",
    position: mailbox?.position?.trim() || user?.positionTitle?.trim() || null,
    phone: mailbox?.phone?.trim() || user?.phone?.trim() || null,
    email: mailbox?.fromEmail?.trim() || user?.contactEmail?.trim() || login,
    personalMailbox: Boolean(mailbox?.enabled && mailbox.verifiedAt),
  };
}

export type ClientDocumentsContext = {
  organizationId: string;
  companyName: string;
  permissions: { sales: boolean; billing: boolean };
  recipients: DocumentRecipient[];
  proposal: {
    addressee: string | null;
    greeting: string;
    promoOptions: ProposalPromoOption[];
    sender: StaffSender;
    subject: string;
    message: string;
    lastSentAt: string | null;
    lastSentBy: string | null;
  };
  invoice: {
    blockers: string[];
    rates: PlanRates;
    current: { tier: PaidTier; cycle: BillingCycle; points: number } | null;
    latest: { id: number; amountRub: number; status: string; createdAt: string; tariffKey: string } | null;
  };
  contract: { number: string; status: string; date: string } | null;
};

export async function loadClientDocumentsContext(organizationId: string, session: Session): Promise<ClientDocumentsContext | null> {
  const [org, block, contacts, viewer, requisites, pricing, latestInvoice, latestContract, lastProposal, promoOptions, sender] = await Promise.all([
    db.organization.findUnique({
      where: { id: organizationId },
      select: { name: true, account: { select: { subscriptionPlan: true, planCycle: true, planPoints: true } } },
    }),
    loadDocumentOrgBlock(organizationId),
    loadClientContacts(organizationId),
    platformViewerForSession(session),
    readPlatformRequisites(),
    readPlanPricing(),
    db.paymentOrder.findFirst({
      where: { organizationId, paymentMethod: "invoice" },
      orderBy: { createdAt: "desc" },
      select: { id: true, amountRub: true, status: true, createdAt: true, tariffKey: true },
    }),
    db.clientContract.findFirst({ where: { organizationId }, orderBy: { createdAt: "desc" }, select: { number: true, status: true, issuedAt: true } }),
    db.auditLog.findFirst({ where: { organizationId, action: CLIENT_PROPOSAL_AUDIT }, orderBy: { createdAt: "desc" }, select: { createdAt: true, userName: true } }),
    listProposalPromoOptions().catch(() => []),
    staffSender(session.user.id),
  ]);
  if (!org || !block) return null;
  const companyName = block.org.shortName;
  const blockers: string[] = [];
  if (!invoiceRequisitesReady(requisites)) blockers.push("requisites");
  if (!block.org.inn) blockers.push("inn");
  const account = org.account;
  const current =
    account && isPaidTier(account.subscriptionPlan)
      ? { tier: account.subscriptionPlan, cycle: isBillingCycle(account.planCycle) ? account.planCycle : ("month" as BillingCycle), points: normalizePoints(account.planPoints) }
      : null;
  return {
    organizationId,
    companyName,
    permissions: { sales: canUsePlatformSection(viewer, "sales"), billing: canUsePlatformSection(viewer, "billing") },
    recipients: clientDocumentRecipients(contacts),
    proposal: {
      addressee: defaultAddressee({ name: block.org.directorName, post: block.org.directorPost }),
      greeting: defaultGreeting(block.org.directorName),
      promoOptions,
      sender,
      subject: `Коммерческое предложение WeSetup для ${companyName}`,
      message: defaultProposalMessage({ companyName, senderName: sender.name }),
      lastSentAt: lastProposal?.createdAt.toISOString() ?? null,
      lastSentBy: lastProposal?.userName ?? null,
    },
    invoice: {
      blockers,
      rates: pricing.rates,
      current,
      latest: latestInvoice
        ? { id: latestInvoice.id, amountRub: Number(latestInvoice.amountRub), status: latestInvoice.status, createdAt: latestInvoice.createdAt.toISOString(), tariffKey: latestInvoice.tariffKey }
        : null,
    },
    contract: latestContract ? { number: latestContract.number, status: latestContract.status, date: latestContract.issuedAt.toISOString().slice(0, 10) } : null,
  };
}

// ───────────────────────────── КП ─────────────────────────────

export type ClientProposalInput = {
  plan: ProposalPlan;
  addressee: string | null;
  greeting: string | null;
  extras: { ppk: boolean; equipment: boolean };
  promoCode: string | null;
};

/** Переменные КП для клиента: компания и сфера — из карточки, подпись — сотрудник. */
export async function buildClientProposalVars(
  organizationId: string,
  input: ClientProposalInput,
  senderUserId: string,
): Promise<{ vars: ProposalVars; warnings: string[]; companyName: string } | null> {
  const [org, block, sender] = await Promise.all([
    db.organization.findUnique({ where: { id: organizationId }, select: { type: true } }),
    loadDocumentOrgBlock(organizationId),
    staffSender(senderUserId),
  ]);
  if (!org || !block) return null;
  const sphere = isProposalSphere(org.type) ? org.type : "other";
  const companyName = block.org.shortName;
  const resolved = await resolveProposalForm({ sphere, companyName, promoCode: input.promoCode }, { sender: null });
  return {
    companyName,
    warnings: resolved.warnings,
    vars: {
      ...resolved.vars,
      plan: input.plan,
      addressee: input.addressee,
      greeting: input.greeting,
      extras: input.extras,
      sender: { name: sender.name, position: sender.position, phone: sender.phone, email: sender.email },
    },
  };
}

export function proposalFileName(companyName: string): string {
  const name = companyName.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  return `КП WeSetup — ${name || "предложение"}.pdf`;
}

export async function renderClientProposal(organizationId: string, input: ClientProposalInput, senderUserId: string) {
  const built = await buildClientProposalVars(organizationId, input, senderUserId);
  if (!built) return null;
  const bytes = await renderProposalPdf(built.vars);
  return { bytes, fileName: proposalFileName(built.companyName), warnings: built.warnings, vars: built.vars };
}

export async function sendClientProposal(args: {
  organizationId: string;
  input: ClientProposalInput;
  to: string[];
  subject: string;
  message: string;
  senderUserId: string;
}): Promise<{ result: StaffEmailResult; warnings: string[] } | null> {
  const rendered = await renderClientProposal(args.organizationId, args.input, args.senderUserId);
  if (!rendered) return null;
  const html = renderEmailLayout(
    args.subject,
    `${messageHtml(args.message)}<p style="margin:18px 0 0;font-size:13px;color:#6f7282">Вложение: ${rendered.fileName.replace(/</g, "&lt;")}</p>`,
  );
  const result = await sendStaffEmail({
    senderUserId: args.senderUserId,
    to: args.to,
    subject: args.subject,
    html,
    attachments: [{ filename: rendered.fileName, content: rendered.bytes, contentType: "application/pdf" }],
  });
  return { result, warnings: rendered.warnings };
}

// ───────────────────────────── счёт ─────────────────────────────

/**
 * Счёт из карточки: тот же `createInvoiceOrder`, что у кнопки клиента в
 * кабинете (сумма по тарифу и виду перехода — `quoteCheckout`, один
 * действующий счёт на подписку). Плательщик — владелец организации.
 */
export async function issueClientInvoice(args: {
  organizationId: string;
  tier: PaidTier;
  cycle: BillingCycle;
  points: number;
  promoCode: string | null;
  payerEmail: string | null;
  issuedByUserId: string;
}) {
  const contacts = await loadClientContacts(args.organizationId);
  const owner = contacts?.owner ?? null;
  const ownerLogin = owner ? await db.user.findUnique({ where: { id: owner.id }, select: { email: true } }) : null;
  return createInvoiceOrder({
    organizationId: args.organizationId,
    userId: owner?.id ?? args.issuedByUserId,
    email: args.payerEmail || owner?.email || ownerLogin?.email || "",
    target: { tier: args.tier, cycle: args.cycle, points: normalizePoints(args.points) },
    promoCode: args.promoCode,
  });
}

export async function sendClientInvoice(args: {
  organizationId: string;
  orderId: number;
  to: string[];
  subject: string | null;
  message: string | null;
  senderUserId: string;
}): Promise<{ ok: false; status: number; error: string } | { ok: true; result: StaffEmailResult; fileName: string }> {
  const rendered = await renderInvoice(args.orderId);
  if (!rendered || rendered.order.organizationId !== args.organizationId) return { ok: false, status: 404, error: "Счёт не найден" };
  const { order, pdf } = rendered;
  if (order.status === "cancelled") return { ok: false, status: 409, error: "Счёт отменён — выставьте новый" };
  const block = await loadDocumentOrgBlock(args.organizationId);
  const amount = `${Number(order.amountRub).toLocaleString("ru-RU")} ₽`;
  const subject = args.subject?.trim() || defaultInvoiceSubject(String(order.id));
  const message = args.message?.trim() || defaultInvoiceMessage({ number: String(order.id), amount, companyName: block?.org.shortName ?? "" });
  const fileName = invoiceFilename(String(order.id)).utf8;
  const html = renderEmailLayout(subject, `${messageHtml(message)}<p style="margin:18px 0 0;font-size:13px;color:#6f7282">Вложение: ${fileName}</p>`);
  const result = await sendStaffEmail({
    senderUserId: args.senderUserId,
    to: args.to,
    subject,
    html,
    attachments: [{ filename: fileName, content: pdf, contentType: "application/pdf" }],
  });
  return { ok: true, result, fileName };
}
