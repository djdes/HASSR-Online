/**
 * «Документы клиенту» в карточке клиента (панель платформы): договор, КП и
 * счёт — общие чистые правила для сервера и диалогов. Без базы.
 */

import { z } from "zod";

import { personName, postInSentence } from "@/lib/contracts/format";
import { isTechnicalEmail } from "@/lib/technical-email";
import { addresseePostLine, formalGreeting, fullNameDative } from "@/lib/russian-names";
import { TRIAL_DAYS } from "@/lib/tariff-plans";

/** Поля КП из диалога карточки клиента (общие для PDF и отправки). */
export const clientProposalSchema = z.object({
  plan: z.enum(["standard", "premium"]).default("standard"),
  addressee: z.string().trim().max(200).nullish().transform((value) => value || null),
  greeting: z.string().trim().max(120).nullish().transform((value) => value || null),
  extras: z.object({ ppk: z.boolean().default(true), equipment: z.boolean().default(true) }).default({ ppk: true, equipment: true }),
  promoCode: z.string().trim().max(64).nullish().transform((value) => value || null),
});

export type DocumentRecipientSource = "owner" | "company" | "accountant" | "person";

export type DocumentRecipient = { email: string; label: string; source: DocumentRecipientSource };

type ContactsLike = {
  owner: { name: string; email: string | null } | null;
  company: { emails: string[]; accountantEmail: string | null };
  people: Array<{ id: string; name: string; email: string | null; isActive: boolean; archived: boolean; isRoot: boolean }>;
};

const EMAIL_RE = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]{2,}$/;

export function deliverableEmail(value: string | null | undefined): string | null {
  const email = (value ?? "").trim().toLowerCase();
  if (!email || email.length > 254 || !EMAIL_RE.test(email) || isTechnicalEmail(email)) return null;
  return email;
}

/**
 * Кому можно отправить документ: владелец, почты компании (ЕГРЮЛ и
 * «Реквизиты»), бухгалтер, активные сотрудники с настоящей почтой. Служебные
 * адреса и дубли — прочь; порядок — от самого вероятного адресата.
 */
export function clientDocumentRecipients(contacts: ContactsLike | null): DocumentRecipient[] {
  if (!contacts) return [];
  const out: DocumentRecipient[] = [];
  const add = (raw: string | null | undefined, label: string, source: DocumentRecipientSource) => {
    const email = deliverableEmail(raw);
    if (email && !out.some((item) => item.email === email)) out.push({ email, label, source });
  };
  if (contacts.owner) add(contacts.owner.email, contacts.owner.name, "owner");
  add(contacts.company.accountantEmail, "бухгалтер", "accountant");
  for (const email of contacts.company.emails) add(email, "компания", "company");
  for (const person of contacts.people) {
    if (!person.isActive || person.archived || person.isRoot) continue;
    add(person.email, person.name, "person");
  }
  return out;
}

/** «Генеральному директору Куликовой Виктории Викторовне» по руководителю из ЕГРЮЛ/«Реквизитов». */
export function defaultAddressee(director: { name: string | null; post: string | null }): string | null {
  const name = director.name?.trim();
  if (!name) return null;
  // ЕГРЮЛ пишет капслоком: «ГЕНЕРАЛЬНЫЙ ДИРЕКТОР» → «Генеральному директору».
  const post = addresseePostLine(postInSentence(director.post) ?? "руководитель");
  return `${post} ${fullNameDative(personName(name) ?? name)}`;
}

export function defaultGreeting(directorName: string | null | undefined): string {
  return formalGreeting(personName(directorName));
}

export function defaultInvoiceSubject(number: string): string {
  return `Счёт № ${number} на оплату WeSetup`;
}

/** Письмо со счётом по умолчанию — короткое, со ссылкой на вложение. */
export function defaultInvoiceMessage(params: { number: string; amount: string; companyName: string }): string {
  return [
    "Здравствуйте!",
    `Направляем счёт № ${params.number} на ${params.amount} для ${params.companyName} — он во вложении (PDF). В счёте есть QR-код: отсканируйте его в приложении банка, и реквизиты с суммой подставятся сами.`,
    "После оплаты доступ продлится автоматически, а закрывающие документы появятся в кабинете.",
  ].join("\n\n");
}

export function defaultProposalMessage(params: { companyName: string | null; senderName: string }): string {
  return [
    "Здравствуйте!",
    `Направляем коммерческое предложение WeSetup${params.companyName ? ` для ${params.companyName}` : ""} — оно во вложении (PDF): стоимость, что входит в тариф и как начать.`,
    `Первые ${TRIAL_DAYS} дней — бесплатно и без карты. Если удобнее обсудить голосом — ответьте на это письмо, созвонимся.`,
    `С уважением, ${params.senderName}`,
  ].join("\n\n");
}

export function messageHtml(message: string): string {
  const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  return message
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p style="margin:0 0 14px;color:#3c4053;line-height:1.6">${escape(paragraph).replace(/\n/g, "<br>")}</p>`)
    .join("");
}
