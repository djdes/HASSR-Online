import { lookup } from "node:dns/promises";
import nodemailer from "nodemailer";
import { db } from "@/lib/db";
import { decryptSecret, encryptSecret } from "@/lib/integration-crypto";
import { isEmailDeliveryConfigured, sendRawEmail, type EmailAttachment } from "@/lib/email";
import { formatFromAddress, isAllowedSmtpHost, isPrivateIp, mailSenderStatus, type MailSenderInput, type MailSenderStatus } from "@/lib/platform-mail";

/**
 * Letters that a platform panel user sends to clients (contract, proposal,
 * invoice) go through that person's own SMTP account, signed with their name
 * (owner's request 2026-10-29: «если отправка идёт от другого пользователя,
 * то SMTP использовать другое»). Without a verified mailbox — the system
 * mailer, with Reply-To pointing at the person.
 */

export type MailSenderView = {
  fromName: string;
  fromEmail: string;
  host: string;
  port: number;
  secure: boolean;
  username: string;
  hasPassword: boolean;
  replyTo: string;
  position: string;
  phone: string;
  signature: string;
  enabled: boolean;
  verifiedAt: string | null;
  lastError: string | null;
  status: MailSenderStatus;
};

export async function readMailSender(userId: string): Promise<MailSenderView | null> {
  const row = await db.platformMailSender.findUnique({ where: { userId } });
  if (!row) return null;
  return {
    fromName: row.fromName,
    fromEmail: row.fromEmail,
    host: row.host,
    port: row.port,
    secure: row.secure,
    username: row.username,
    hasPassword: row.passwordEnc.length > 0,
    replyTo: row.replyTo ?? "",
    position: row.position ?? "",
    phone: row.phone ?? "",
    signature: row.signature ?? "",
    enabled: row.enabled,
    verifiedAt: row.verifiedAt?.toISOString() ?? null,
    lastError: row.lastError,
    status: mailSenderStatus(row),
  };
}

export class MailSenderError extends Error {}

/** Saves settings; any change of the connection resets verification. */
export async function saveMailSender(userId: string, input: MailSenderInput): Promise<void> {
  const existing = await db.platformMailSender.findUnique({ where: { userId } });
  if (!existing && !input.password) throw new MailSenderError("Укажите пароль от почты");
  const passwordEnc = input.password ? encryptSecret(input.password) : existing!.passwordEnc;
  const connectionChanged =
    !existing ||
    Boolean(input.password) ||
    existing.host !== input.host ||
    existing.port !== input.port ||
    existing.secure !== input.secure ||
    existing.username !== input.username ||
    existing.fromEmail !== input.fromEmail;
  const data = {
    fromName: input.fromName,
    fromEmail: input.fromEmail,
    host: input.host,
    port: input.port,
    secure: input.secure,
    username: input.username,
    passwordEnc,
    replyTo: input.replyTo || null,
    position: input.position || null,
    phone: input.phone || null,
    signature: input.signature || null,
    enabled: true,
    ...(connectionChanged ? { verifiedAt: null, lastError: null } : {}),
  };
  await db.platformMailSender.upsert({ where: { userId }, create: { userId, ...data }, update: data });
}

export async function disableMailSender(userId: string): Promise<void> {
  await db.platformMailSender.updateMany({ where: { userId }, data: { enabled: false } });
}

type SenderRow = NonNullable<Awaited<ReturnType<typeof db.platformMailSender.findUnique>>>;

/**
 * Resolves the server name once and refuses internal addresses: a public
 * name can point at 127.0.0.1 and turn the form into a relay through the
 * server's own mailer. We then connect to that exact IP (no second lookup
 * an attacker could flip) and keep the name for TLS verification.
 */
async function resolvePublicSmtpHost(host: string): Promise<string> {
  if (!isAllowedSmtpHost(host)) throw new MailSenderError("SMTP-сервер не разрешён");
  let addresses: { address: string }[];
  try {
    addresses = await lookup(host, { all: true });
  } catch {
    throw new MailSenderError("Такого SMTP-сервера нет — проверьте адрес.");
  }
  if (!addresses.length) throw new MailSenderError("Такого SMTP-сервера нет — проверьте адрес.");
  if (addresses.some((item) => isPrivateIp(item.address))) {
    throw new MailSenderError("Адрес сервера ведёт во внутреннюю сеть — укажите внешний SMTP-сервер.");
  }
  return addresses[0].address;
}

async function transportFor(row: SenderRow) {
  const address = await resolvePublicSmtpHost(row.host);
  return nodemailer.createTransport({
    host: address,
    port: row.port,
    secure: row.secure,
    name: "wesetup.ru",
    tls: { servername: row.host },
    auth: { user: row.username, pass: decryptSecret(row.passwordEnc) },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
}

/** Human-readable SMTP failure (no secrets). */
export function describeSmtpError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const code = (error as { code?: string; responseCode?: number })?.code;
  if (code === "EAUTH" || /auth|535|534/i.test(raw)) return "Сервер не принял логин или пароль. Для Яндекса, Mail.ru и Gmail нужен пароль приложения.";
  if (code === "ETIMEDOUT" || code === "ECONNECTION" || /timeout/i.test(raw)) return "Не удалось подключиться к серверу. Проверьте адрес, порт и SSL.";
  if (code === "EDNS" || /ENOTFOUND|getaddrinfo/i.test(raw)) return "Такого SMTP-сервера нет — проверьте адрес.";
  if (/self.signed|certificate/i.test(raw)) return "Сертификат сервера не прошёл проверку. Попробуйте порт 465 с SSL.";
  return raw.slice(0, 300);
}

/** Connects, authenticates and sends a test letter to the sender. */
export async function verifyMailSender(userId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const row = await db.platformMailSender.findUnique({ where: { userId } });
  if (!row) return { ok: false, error: "Сначала сохраните настройки почты" };
  try {
    const transport = await transportFor(row);
    await transport.verify();
    await transport.sendMail({
      from: formatFromAddress(row.fromName, row.fromEmail),
      to: row.fromEmail,
      subject: "WeSetup: проверка почты для писем клиентам",
      text: "Это проверочное письмо из панели WeSetup. Договоры, КП и счета, которые вы отправляете клиентам, будут уходить с этого адреса.",
    });
    await db.platformMailSender.update({ where: { userId }, data: { verifiedAt: new Date(), lastError: null, enabled: true } });
    return { ok: true };
  } catch (error) {
    const message = error instanceof MailSenderError ? error.message : describeSmtpError(error);
    await db.platformMailSender.update({ where: { userId }, data: { verifiedAt: null, lastError: message } });
    return { ok: false, error: message };
  }
}

export type StaffEmail = {
  /** Panel user on whose behalf the letter goes. */
  senderUserId: string;
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  attachments?: EmailAttachment[];
};

export type StaffEmailResult =
  | { ok: true; via: "personal"; from: string }
  | { ok: true; via: "system"; from: string; fallbackReason: string | null }
  | { ok: false; error: string };

/**
 * Sends a letter from the person: their verified mailbox first; if it is not
 * set up (or fails), the system mailer with Reply-To to them, and the reason
 * comes back so the UI can say which way the letter went.
 */
export async function sendStaffEmail(message: StaffEmail): Promise<StaffEmailResult> {
  const recipients = (Array.isArray(message.to) ? message.to : [message.to]).map((item) => item.trim()).filter(Boolean);
  if (!recipients.length) return { ok: false, error: "Не указан получатель" };
  const [row, user] = await Promise.all([
    db.platformMailSender.findUnique({ where: { userId: message.senderUserId } }),
    db.user.findUnique({ where: { id: message.senderUserId }, select: { name: true, email: true, contactEmail: true } }),
  ]);

  let fallbackReason: string | null = null;
  if (row?.enabled && row.verifiedAt) {
    const from = formatFromAddress(row.fromName, row.fromEmail);
    try {
      await (await transportFor(row)).sendMail({
        from,
        to: recipients.join(", "),
        replyTo: row.replyTo || undefined,
        subject: message.subject,
        html: message.html,
        text: message.text,
        attachments: message.attachments?.map((item) => ({ filename: item.filename, content: item.content, path: item.path, contentType: item.contentType })),
      });
      return { ok: true, via: "personal", from };
    } catch (error) {
      fallbackReason = error instanceof MailSenderError ? error.message : describeSmtpError(error);
      await db.platformMailSender.update({ where: { userId: message.senderUserId }, data: { lastError: fallbackReason } }).catch(() => undefined);
    }
  } else if (row && !row.enabled) {
    fallbackReason = "личная почта отключена";
  } else if (row) {
    fallbackReason = "личная почта не проверена";
  }

  if (!isEmailDeliveryConfigured()) {
    return { ok: false, error: fallbackReason ? `Личная почта не сработала (${fallbackReason}), а общая почта сервера не настроена` : "Почта сервера не настроена, а личная почта не подключена — откройте «Моя почта»" };
  }
  const replyTo = row?.replyTo || row?.fromEmail || user?.contactEmail || user?.email || null;
  const results = await Promise.all(
    recipients.map((to) => sendRawEmail(to, message.subject, message.html, { replyTo, attachments: message.attachments })),
  );
  if (results.some((sent) => !sent)) return { ok: false, error: "Письмо не ушло через общую почту — попробуйте ещё раз" };
  return { ok: true, via: "system", from: "noreply@wesetup.ru", fallbackReason };
}
