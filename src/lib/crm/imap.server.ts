import { lookup } from "node:dns/promises";

import { ImapFlow } from "imapflow";
import { simpleParser, type AddressObject, type HeaderValue } from "mailparser";

import { CRM_MAIL_BACKFILL_MS, CRM_MAIL_BATCH, CRM_MAIL_MAX_BYTES, OUR_MAIL_DOMAINS } from "@/lib/crm/constants";
import { isOurDomain, normalizeEmail, type SenderRule } from "@/lib/crm/identity";
import { classifyIncomingMail, type MailHeaders } from "@/lib/crm/mail-filter";
import { htmlToText, stripQuotedReply, truncateBody } from "@/lib/crm/mail-text";
import type { CrmIngestItem } from "@/lib/crm/sources";
import { isAllowedSmtpHost, isPrivateIp } from "@/lib/platform-mail";

/**
 * Почта CRM по IMAP: imapflow (postalsys/imapflow) читает папки по UID,
 * mailparser (nodemailer/mailparser) разбирает письмо. Логика синхронизации
 * работает с интерфейсом `MailSession` — в тесте его подменяет фейк, в бою
 * его даёт `openImapSession`.
 */

export type FetchedMail = { uid: number; source: Buffer };

export type MailFolder = {
  uidValidity: string;
  /** UID, который получит следующее письмо (`UIDNEXT`). */
  uidNext: number;
  /** UID писем: строго после `afterUid`; с `since` — пришедшие с этой даты. */
  listUids(afterUid: number, since: Date | null): Promise<number[]>;
  fetch(uids: number[]): Promise<FetchedMail[]>;
  close(): void;
};

export type MailSession = {
  openFolder(path: string): Promise<MailFolder>;
  listFolders(): Promise<{ path: string; specialUse: string | null }[]>;
  logout(): Promise<void>;
};

export type FolderState = { uidValidity: string | null; lastUid: number };

export type ParsedMail = {
  messageId: string | null;
  fromAddress: string | null;
  fromName: string | null;
  recipients: { address: string; name: string | null }[];
  subject: string;
  date: Date | null;
  text: string;
  headers: MailHeaders;
  contentType: string | null;
};

function headerText(value: HeaderValue): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((item) => headerText(item as HeaderValue)).join(", ");
  if (typeof value === "object") {
    const record = value as unknown as Record<string, unknown>;
    if (typeof record.text === "string") return record.text;
    if (typeof record.value === "string") return record.value;
  }
  return String(value);
}

function addresses(value: AddressObject | AddressObject[] | undefined): { address: string; name: string | null }[] {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  return list
    .flatMap((group) => group.value)
    .map((item) => ({ address: normalizeEmail(item.address) ?? "", name: item.name?.trim() || null }))
    .filter((item) => item.address);
}

export async function parseMail(source: Buffer): Promise<ParsedMail> {
  const parsed = await simpleParser(source, { skipImageLinks: true, skipTextToHtml: true, skipTextLinks: true });
  // Заголовки — из сырых строк: mailparser сворачивает List-* в объект `list`,
  // и признак рассылки (List-Unsubscribe, List-Id) по разобранной карте не виден.
  const headers: MailHeaders = {};
  for (const [name, value] of parsed.headers) headers[name.toLowerCase()] = headerText(value);
  for (const line of parsed.headerLines ?? []) {
    const raw = line.line.slice(line.line.indexOf(":") + 1).replace(/\r?\n[ \t]+/g, " ").trim();
    const key = line.key.toLowerCase();
    headers[key] = headers[key] && !parsed.headers.has(key) ? `${headers[key]}, ${raw}` : raw;
  }
  const from = addresses(parsed.from)[0] ?? null;
  const text = parsed.text?.trim() || (typeof parsed.html === "string" ? htmlToText(parsed.html) : "");
  return {
    messageId: parsed.messageId?.trim().replace(/^<|>$/g, "").toLowerCase() || null,
    fromAddress: from?.address ?? null,
    fromName: from?.name ?? null,
    recipients: [...addresses(parsed.to), ...addresses(parsed.cc)],
    subject: parsed.subject?.trim() ?? "",
    date: parsed.date && !Number.isNaN(parsed.date.getTime()) ? parsed.date : null,
    text,
    headers,
    contentType: headers["content-type"] ?? null,
  };
}

function mailBody(mail: ParsedMail): string {
  return truncateBody(stripQuotedReply(mail.text) || "(без текста)");
}

/** Входящее письмо → запись ленты: принятое — к контакту, отсеянное — с причиной. */
export function inboxItem(mail: ParsedMail, ctx: { fallbackKey: string; rules: readonly SenderRule[]; now: Date }): CrmIngestItem {
  const verdict = classifyIncomingMail(
    { fromAddress: mail.fromAddress, subject: mail.subject, headers: mail.headers, contentType: mail.contentType },
    { rules: ctx.rules, ourDomains: OUR_MAIL_DOMAINS },
  );
  return {
    externalKey: mail.messageId ? `email:${mail.messageId}` : ctx.fallbackKey,
    channel: "email",
    direction: "in",
    subject: mail.subject || null,
    body: mailBody(mail),
    occurredAt: mail.date && mail.date.getTime() <= ctx.now.getTime() ? mail.date : ctx.now,
    identity: verdict.accept ? { email: mail.fromAddress, name: mail.fromName } : {},
    fromAddress: mail.fromAddress,
    fromName: mail.fromName,
    filteredReason: verdict.accept ? null : verdict.reason,
  };
}

/**
 * Наше письмо из «Отправленных» → исходящее каждому внешнему получателю.
 * Контакт не создаём: отправленное только отмечает ответ уже известным.
 * Ключ `email-out:<message-id>:<адрес>` совпадает с ключом письма, ушедшего
 * из карточки CRM, — одно письмо не попадёт в ленту дважды.
 */
export function sentItems(mail: ParsedMail, ctx: { fallbackKey: string; now: Date }): CrmIngestItem[] {
  const seen = new Set<string>();
  return mail.recipients
    .filter((recipient) => !isOurDomain(recipient.address, OUR_MAIL_DOMAINS))
    .filter((recipient) => (seen.has(recipient.address) ? false : (seen.add(recipient.address), true)))
    .map((recipient) => ({
      externalKey: mail.messageId ? `email-out:${mail.messageId}:${recipient.address}` : `${ctx.fallbackKey}:${recipient.address}`,
      channel: "email",
      direction: "out" as const,
      subject: mail.subject || null,
      body: mailBody(mail),
      occurredAt: mail.date && mail.date.getTime() <= ctx.now.getTime() ? mail.date : ctx.now,
      authorName: mail.fromName,
      identity: { email: recipient.address },
      fromAddress: mail.fromAddress,
      fromName: mail.fromName,
      createContact: false,
    }));
}

export type FolderSyncResult = { items: CrmIngestItem[]; next: FolderState; fetched: number; failed: number };

/**
 * Одна папка: новые письма по UID. Смена UIDVALIDITY (папку пересоздали)
 * или первый проход — окно за 30 дней; ничего не нашли — запоминаем
 * UIDNEXT, чтобы следующий проход не читал всю историю ящика.
 */
export async function syncMailFolder(
  session: MailSession,
  args: { mailboxId: string; folder: string; kind: "inbox" | "sent"; state: FolderState; rules: readonly SenderRule[]; now: Date },
): Promise<FolderSyncResult> {
  const folder = await session.openFolder(args.folder);
  try {
    const reset = args.state.uidValidity !== folder.uidValidity;
    const afterUid = reset ? 0 : args.state.lastUid;
    const since = reset ? new Date(args.now.getTime() - CRM_MAIL_BACKFILL_MS) : null;
    const uids = (await folder.listUids(afterUid, since))
      .filter((uid) => uid > afterUid)
      .sort((a, b) => a - b)
      .slice(0, CRM_MAIL_BATCH);
    const items: CrmIngestItem[] = [];
    let failed = 0;
    const fetched = uids.length ? await folder.fetch(uids) : [];
    for (const message of fetched) {
      try {
        const mail = await parseMail(message.source);
        const fallbackKey = `email:${args.mailboxId}:${args.folder}:${folder.uidValidity}:${message.uid}`;
        if (args.kind === "inbox") items.push(inboxItem(mail, { fallbackKey, rules: args.rules, now: args.now }));
        else items.push(...sentItems(mail, { fallbackKey, now: args.now }));
      } catch (error) {
        failed += 1;
        console.error(`[crm] письмо ${message.uid} в ${args.folder} не разобрано`, error);
      }
    }
    const lastUid = uids.length ? uids[uids.length - 1] : reset ? Math.max(0, folder.uidNext - 1) : afterUid;
    return { items, next: { uidValidity: folder.uidValidity, lastUid }, fetched: fetched.length, failed };
  } finally {
    folder.close();
  }
}

export class CrmMailError extends Error {}

/** Имя сервера → публичный IP (внутренние адреса запрещены, как у SMTP «Моей почты»). */
async function resolvePublicImapHost(host: string): Promise<string> {
  if (!isAllowedSmtpHost(host)) throw new CrmMailError("Такой адрес IMAP-сервера не подходит");
  let found: { address: string }[];
  try {
    found = await lookup(host, { all: true });
  } catch {
    throw new CrmMailError("Такого IMAP-сервера нет — проверьте адрес");
  }
  if (!found.length) throw new CrmMailError("Такого IMAP-сервера нет — проверьте адрес");
  if (found.some((item) => isPrivateIp(item.address))) throw new CrmMailError("Адрес ведёт во внутреннюю сеть — укажите внешний IMAP-сервер");
  return found[0].address;
}

export function describeImapError(error: unknown): string {
  if (error instanceof CrmMailError) return error.message;
  const record = (error ?? {}) as { authenticationFailed?: boolean; code?: string; responseText?: string; message?: string };
  const raw = record.responseText || record.message || String(error);
  if (record.authenticationFailed || /auth|login|credentials|invalid/i.test(raw)) {
    return "Сервер не принял логин или пароль. Для Яндекса и Mail.ru нужен пароль приложения и включённый IMAP.";
  }
  if (record.code === "ETIMEDOUT" || record.code === "ECONNREFUSED" || /timeout|timed out/i.test(raw)) return "Не удалось подключиться: проверьте адрес, порт и SSL.";
  if (/certificate|self.signed/i.test(raw)) return "Сертификат сервера не прошёл проверку — попробуйте порт 993 с SSL.";
  if (/nonexistent|doesn't exist|not exist|unknown mailbox/i.test(raw)) return "Такой папки в ящике нет — проверьте название.";
  return raw.slice(0, 300);
}

export type ImapConfig = { host: string; port: number; secure: boolean; username: string; password: string };

export async function openImapSession(config: ImapConfig): Promise<MailSession> {
  const address = await resolvePublicImapHost(config.host);
  const client = new ImapFlow({
    host: address,
    port: config.port,
    secure: config.secure,
    servername: config.host,
    tls: { servername: config.host },
    auth: { user: config.username, pass: config.password },
    logger: false,
    disableAutoIdle: true,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 60_000,
  });
  // Без обработчика ошибка сокета после подключения уронила бы процесс.
  client.on("error", (error: unknown) => console.error("[crm] IMAP:", describeImapError(error)));
  await client.connect();
  return {
    async openFolder(path) {
      const lock = await client.getMailboxLock(path, { readOnly: true });
      const mailbox = client.mailbox;
      if (!mailbox) {
        lock.release();
        throw new CrmMailError(`Папка «${path}» не открылась`);
      }
      return {
        uidValidity: String(mailbox.uidValidity),
        uidNext: mailbox.uidNext,
        async listUids(afterUid, since) {
          const query = since ? { since } : { uid: `${afterUid + 1}:*` };
          const found = await client.search(query, { uid: true });
          return Array.isArray(found) ? found : [];
        },
        async fetch(uids) {
          const out: FetchedMail[] = [];
          for await (const message of client.fetch(uids, { uid: true, source: { maxLength: CRM_MAIL_MAX_BYTES } }, { uid: true })) {
            if (message.source) out.push({ uid: message.uid, source: message.source });
          }
          return out;
        },
        close() {
          lock.release();
        },
      };
    },
    async listFolders() {
      const list = await client.list();
      return list.map((item) => ({ path: item.path, specialUse: item.specialUse ?? null }));
    },
    async logout() {
      await client.logout().catch(() => client.close());
    },
  };
}
