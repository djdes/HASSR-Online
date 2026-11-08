/**
 * Отсев входящей почты CRM: что из рабочего ящика — обращение человека, а что
 * автоответ, недоставка, рассылка, робот или спам. Чистая функция.
 *
 * Порядок важен и идёт от явной воли человека к эвристикам:
 * allow-правило → block-правило → нет отправителя → наш домен → недоставка →
 * автоответ → спам-метка → рассылка → адрес робота. Признаки автоответов —
 * RFC 3834 (`Auto-Submitted`) и распространённые нестандартные заголовки
 * (как в is-autoreply и arp242.net/autoreply.html).
 */

import type { CrmFilterReason } from "@/lib/crm/constants";
import { isOurDomain, matchSenderRule, type SenderRule } from "@/lib/crm/identity";

/** Заголовки письма: имена в нижнем регистре, значения — строкой. */
export type MailHeaders = Record<string, string>;

export type IncomingMail = {
  fromAddress: string | null;
  subject: string;
  headers: MailHeaders;
  /** Content-Type верхнего уровня (`multipart/report` — отчёт о доставке). */
  contentType?: string | null;
};

export type MailVerdict = { accept: true } | { accept: false; reason: CrmFilterReason };

const BOUNCE_SENDER = /^(mailer-daemon|postmaster|mail-daemon|mailerdaemon)@/i;
const BOUNCE_SUBJECT =
  /(undeliver|undelivered|delivery status notification|delivery failure|returned mail|mail delivery (failed|subsystem)|failure notice|не доставлено|недоставлен|ошибка доставки)/i;
const AUTO_SUBJECT =
  /^(auto(matic)?[\s-]*(reply|response|answer)|автоответ|автоматический ответ|out of (the )?office|ooo\b|нет на месте|в отпуске|отсутствую|i am away|i'm away)/i;
const ROBOT_LOCAL =
  /^(no-?reply|do-?not-?reply|donotreply|noreply|notifications?|notify|mailer|bounces?|robot|daemon|info-noreply|news(letter)?|digest|alerts?)([._+-]|$)/i;

function header(headers: MailHeaders, name: string): string {
  return (headers[name] ?? "").trim();
}

function isAutoReply(mail: IncomingMail): boolean {
  const autoSubmitted = header(mail.headers, "auto-submitted").toLowerCase();
  if (autoSubmitted && autoSubmitted !== "no") return true;
  if (header(mail.headers, "x-autoreply") || header(mail.headers, "x-autorespond") || header(mail.headers, "x-autoresponse")) return true;
  if (/\b(all|autoreply|oof|dr)\b/i.test(header(mail.headers, "x-auto-response-suppress"))) return true;
  if (/^auto_reply$/i.test(header(mail.headers, "precedence"))) return true;
  return AUTO_SUBJECT.test(mail.subject.trim().replace(/^(re|fw|fwd|ответ)\s*:\s*/i, ""));
}

function isSpamFlagged(headers: MailHeaders): boolean {
  if (/^yes\b/i.test(header(headers, "x-spam-flag"))) return true;
  if (/^yes\b/i.test(header(headers, "x-spam-status"))) return true;
  // Яндекс: 1 — не спам, 4 — спам.
  return header(headers, "x-yandex-spam") === "4";
}

function isBulk(headers: MailHeaders): boolean {
  if (header(headers, "list-id") || header(headers, "list-unsubscribe")) return true;
  return /^(bulk|list|junk)$/i.test(header(headers, "precedence"));
}

export function classifyIncomingMail(
  mail: IncomingMail,
  options: { rules: readonly SenderRule[]; ourDomains: readonly string[] },
): MailVerdict {
  const from = mail.fromAddress?.trim().toLowerCase() || null;
  const rule = matchSenderRule(from, options.rules);
  if (rule === "allow") return { accept: true };
  if (rule === "block") return { accept: false, reason: "blocked" };
  if (!from) return { accept: false, reason: "no_sender" };
  if (isOurDomain(from, options.ourDomains)) return { accept: false, reason: "internal" };
  if (BOUNCE_SENDER.test(from) || /multipart\/report/i.test(mail.contentType ?? "") || BOUNCE_SUBJECT.test(mail.subject)) {
    return { accept: false, reason: "bounce" };
  }
  if (isAutoReply(mail)) return { accept: false, reason: "auto_reply" };
  if (isSpamFlagged(mail.headers)) return { accept: false, reason: "spam" };
  if (isBulk(mail.headers)) return { accept: false, reason: "newsletter" };
  if (ROBOT_LOCAL.test(from.slice(0, from.indexOf("@")))) return { accept: false, reason: "robot" };
  return { accept: true };
}
