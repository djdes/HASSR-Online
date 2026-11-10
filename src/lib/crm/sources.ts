/**
 * Строки существующих таблиц → записи ленты CRM. Чистые функции: сбор
 * (`sources.server.ts`) только выбирает строки, а что из них получится —
 * канал, направление, ключ, ссылка на точечный инструмент — решается здесь.
 */

import { CRM_BODY_MAX, type CrmDirection } from "@/lib/crm/constants";
import { normalizeEmail } from "@/lib/crm/identity";
import { truncateBody } from "@/lib/crm/mail-text";
import { isTechnicalEmail } from "@/lib/technical-email";

/** Ключ услуги «Покажите за 15 минут» (`src/lib/demo-request.ts`). */
export const CRM_DEMO_SERVICE_KEY = "demo-call";

export type CrmIdentity = {
  email?: string | null;
  phone?: string | null;
  name?: string | null;
  company?: string | null;
  telegramChatId?: string | null;
  userId?: string | null;
  organizationId?: string | null;
};

export type CrmIngestItem = {
  externalKey: string;
  channel: string;
  direction: CrmDirection;
  subject?: string | null;
  body: string;
  href?: string | null;
  occurredAt: Date;
  authorName?: string | null;
  authorUserId?: string | null;
  identity: CrmIdentity;
  fromAddress?: string | null;
  fromName?: string | null;
  /** Отсеянное письмо: хранится без контакта. */
  filteredReason?: string | null;
  /** false — только к уже известному контакту (наши письма из «Отправленных»). */
  createContact?: boolean;
  /** Контакт известен заранее (действие в карточке) — склейка не нужна. */
  contactId?: string;
};

/** Настоящая почта человека: служебные адреса сотрудников без почты — не контакт. */
export function contactEmail(raw: string | null | undefined): string | null {
  const email = normalizeEmail(raw);
  return email && !isTechnicalEmail(email) ? email : null;
}

function text(value: string | null | undefined): string {
  return (value ?? "").trim();
}

function body(value: string): string {
  return truncateBody(value, CRM_BODY_MAX);
}

export type ServiceRequestRow = {
  id: string;
  serviceKey: string;
  serviceTitle: string;
  organizationId: string | null;
  organizationName: string | null;
  userId: string | null;
  contactName: string;
  contactPhone: string;
  contactEmail: string | null;
  comment: string | null;
  scheduledAt: Date | null;
  createdAt: Date;
};

export function mapServiceRequest(row: ServiceRequestRow): CrmIngestItem {
  const demo = row.serviceKey === CRM_DEMO_SERVICE_KEY;
  const when = row.scheduledAt ? `Время показа: ${row.scheduledAt.toISOString().slice(0, 16).replace("T", " ")} UTC` : demo ? "Просит перезвонить" : "";
  return {
    externalKey: `service:${row.id}`,
    channel: demo ? "demo" : "service",
    direction: "in",
    subject: row.serviceTitle,
    body: body([text(row.comment) || `Заявка: ${row.serviceTitle}`, when].filter(Boolean).join("\n")),
    href: "/root/service-requests",
    occurredAt: row.createdAt,
    identity: {
      email: contactEmail(row.contactEmail),
      phone: text(row.contactPhone) || null,
      name: text(row.contactName) || null,
      company: row.organizationName,
      userId: row.userId,
      organizationId: row.organizationId,
    },
  };
}

export type FeedbackRow = {
  id: string;
  type: string;
  message: string;
  userId: string | null;
  userEmail: string | null;
  userName: string | null;
  organizationId: string | null;
  organizationName: string | null;
  phone: string | null;
  source: string;
  telegramChatId: string | null;
  responseMessage: string | null;
  respondedAt: Date | null;
  respondedById: string | null;
  respondedByName: string | null;
  createdAt: Date;
};

const FEEDBACK_SUBJECT: Record<string, string> = {
  bug: "Сообщение об ошибке",
  suggestion: "Предложение",
  support: "Вопрос в поддержку",
};

export function mapFeedbackReport(row: FeedbackRow): CrmIngestItem[] {
  const identity: CrmIdentity = {
    email: contactEmail(row.userEmail),
    phone: text(row.phone) || null,
    name: text(row.userName) || null,
    company: row.organizationName,
    telegramChatId: row.telegramChatId,
    userId: row.userId,
    organizationId: row.organizationId,
  };
  const items: CrmIngestItem[] = [
    {
      externalKey: `feedback:${row.id}`,
      channel: row.source === "telegram" ? "telegram" : "feedback",
      direction: "in",
      subject: FEEDBACK_SUBJECT[row.type] ?? "Обращение",
      body: body(text(row.message) || "Без текста"),
      href: "/root/feedback",
      occurredAt: row.createdAt,
      identity,
    },
  ];
  if (row.responseMessage && row.respondedAt) {
    items.push({
      externalKey: `feedback-reply:${row.id}`,
      channel: row.source === "telegram" ? "telegram" : "feedback",
      direction: "out",
      subject: "Ответ поддержки",
      body: body(row.responseMessage),
      href: "/root/feedback",
      occurredAt: row.respondedAt,
      authorName: row.respondedByName,
      authorUserId: row.respondedById,
      identity,
    });
  }
  return items;
}

export type SupportMessageRow = {
  id: string;
  author: string;
  body: string;
  attachmentsCount: number;
  authorUserId: string | null;
  authorName: string | null;
  operatorName: string | null;
  broadcastId: string | null;
  createdAt: Date;
  thread: {
    id: string;
    key: string;
    userEmail: string | null;
    userName: string | null;
    phone: string | null;
    organizationId: string | null;
    organizationName: string | null;
  };
};

/** Реплика онлайн-чата. Рассылка «всем» — не ответ конкретному клиенту: null. */
export function mapSupportMessage(row: SupportMessageRow): CrmIngestItem | null {
  if (row.broadcastId) return null;
  const client = row.author === "client";
  const key = row.thread.key;
  const threadUserId = key.startsWith("guest:") || key.startsWith("org:") ? null : key;
  const content = text(row.body) || (row.attachmentsCount ? "📎 Вложение" : "");
  if (!content) return null;
  return {
    externalKey: `chat:${row.id}`,
    channel: "chat",
    direction: client ? "in" : "out",
    subject: null,
    body: body(row.attachmentsCount && text(row.body) ? `${content}\n📎 Вложений: ${row.attachmentsCount}` : content),
    href: "/root/feedback",
    occurredAt: row.createdAt,
    authorName: client ? row.authorName : (row.operatorName ?? row.authorName),
    authorUserId: row.authorUserId,
    identity: {
      email: contactEmail(row.thread.userEmail),
      phone: text(row.thread.phone) || null,
      name: text(row.thread.userName) || null,
      company: row.thread.organizationName,
      userId: client ? (row.authorUserId ?? threadUserId) : threadUserId,
      organizationId: row.thread.organizationId,
    },
  };
}

export type GuestInvoiceRow = {
  id: number;
  email: string;
  amountRub: number;
  description: string;
  organizationId: string | null;
  buyerJson: unknown;
  createdAt: Date;
};

function readBuyer(value: unknown): { name: string | null; inn: string | null } {
  if (!value || typeof value !== "object") return { name: null, inn: null };
  const record = value as Record<string, unknown>;
  return {
    name: typeof record.name === "string" && record.name.trim() ? record.name.trim() : null,
    inn: typeof record.inn === "string" && record.inn.trim() ? record.inn.trim() : null,
  };
}

export function mapGuestInvoice(row: GuestInvoiceRow): CrmIngestItem {
  const buyer = readBuyer(row.buyerJson);
  const amount = new Intl.NumberFormat("ru-RU").format(Math.round(row.amountRub));
  return {
    externalKey: `invoice:${row.id}`,
    channel: "invoice",
    direction: "event",
    subject: `Счёт по ИНН № ${row.id}`,
    body: body([`${row.description} — ${amount} ₽`, buyer.name ? `Покупатель: ${buyer.name}${buyer.inn ? `, ИНН ${buyer.inn}` : ""}` : ""].filter(Boolean).join("\n")),
    href: "/root/invoices",
    occurredAt: row.createdAt,
    identity: { email: contactEmail(row.email), company: buyer.name, organizationId: row.organizationId },
  };
}

export type SignupRow = {
  id: string;
  name: string;
  createdAt: Date;
  owner: { id: string; name: string; email: string; phone: string | null } | null;
};

export function mapSignup(row: SignupRow): CrmIngestItem {
  return {
    externalKey: `signup:${row.id}`,
    channel: "signup",
    direction: "event",
    subject: "Регистрация",
    body: body(`Зарегистрировал(а) организацию «${row.name}»`),
    href: `/root/organizations/${row.id}`,
    occurredAt: row.createdAt,
    identity: {
      email: contactEmail(row.owner?.email),
      phone: text(row.owner?.phone) || null,
      name: text(row.owner?.name) || null,
      company: row.name,
      userId: row.owner?.id ?? null,
      organizationId: row.id,
    },
  };
}

export type BlankDownloadRow = { id: string; email: string; userId: string | null; organizationId: string | null; createdAt: Date; title: string | null; company?: string | null };

export function mapBlankDownload(row: BlankDownloadRow): CrmIngestItem {
  const company = text(row.company) || null;
  return {
    externalKey: `blank:${row.id}`,
    channel: "blank",
    direction: "event",
    subject: "Скачал(а) шаблон журнала",
    body: body(row.title ? `Шаблон: ${row.title}` : "Скачал(а) шаблон журнала с сайта"),
    href: "/root/blank-downloads",
    occurredAt: row.createdAt,
    identity: { email: contactEmail(row.email), company, userId: row.userId, organizationId: row.organizationId },
  };
}

export type PartnerApplicationRow = {
  id: string;
  companyName: string;
  inn: string;
  city: string;
  phone: string;
  telegram: string | null;
  contactEmail: string;
  type: string;
  applicantUserId: string;
  applicantOrganizationId: string | null;
  createdAt: Date;
};

const PARTNER_TYPES: Record<string, string> = {
  consultant: "консультант",
  integrator: "интегратор",
  equipment_service: "сервис оборудования",
  other: "другое",
};

export function mapPartnerApplication(row: PartnerApplicationRow): CrmIngestItem {
  return {
    externalKey: `partner:${row.id}`,
    channel: "partner",
    direction: "in",
    subject: "Заявка партнёра",
    body: body(
      [`${row.companyName}, ${row.city}`, `Тип: ${PARTNER_TYPES[row.type] ?? row.type}`, `ИНН ${row.inn}`, row.telegram ? `Telegram: ${row.telegram}` : ""]
        .filter(Boolean)
        .join("\n"),
    ),
    href: "/root/partners",
    occurredAt: row.createdAt,
    identity: {
      email: contactEmail(row.contactEmail),
      phone: text(row.phone) || null,
      company: row.companyName,
      userId: row.applicantUserId,
      organizationId: row.applicantOrganizationId,
    },
  };
}
