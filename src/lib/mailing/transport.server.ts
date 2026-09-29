import fs from "node:fs/promises";
import path from "node:path";

import nodemailer from "nodemailer";

import type { OutgoingEmail, SendOutcome } from "./queue";

/**
 * Отправитель рекламных писем.
 *
 * Отдельный SMTP — `MARKETING_SMTP_HOST/PORT/USER/PASSWORD/SECURE` и
 * `MARKETING_FROM`. Не задан — письма идут через основной SMTP
 * (`SMTP_HOST`, тот же relay, что у кодов входа и счетов); ROOT видит
 * об этом жёлтое предупреждение.
 *
 * Сухая отправка: `MAILING_DRY_RUN_DIR` задан — ничего не уходит наружу,
 * письмо целиком (заголовки, текст, HTML, вложения) пишется файлом `.eml`
 * и отдельно `.html` в эту папку. SMTP пустой и папки нет — только лог.
 */

export type MarketingSendMode = "marketing-smtp" | "main-smtp" | "dry-run-dir" | "log-only";

export type MarketingSenderInfo = {
  mode: MarketingSendMode;
  /** «WeSetup <noreply@wesetup.ru>» — как увидит получатель. */
  from: string;
  fromAddress: string;
  /** Отдельный отправитель настроен (MARKETING_SMTP_HOST). */
  separateSender: boolean;
  dryRunDir: string | null;
  unsubscribeMailto: string;
};

const LOCAL_SMTP_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function env(name: string): string {
  return (process.env[name] ?? "").trim();
}

export function mailingDryRunDir(): string | null {
  return env("MAILING_DRY_RUN_DIR") || null;
}

function mainSmtpConfigured(): boolean {
  const host = env("SMTP_HOST");
  return host.length > 0 && host !== "localhost";
}

export function marketingFrom(): string {
  return env("MARKETING_FROM") || env("SMTP_FROM") || "WeSetup <noreply@wesetup.ru>";
}

function addressOf(from: string): string {
  const m = from.match(/<([^>]+)>/);
  return (m ? m[1] : from).trim();
}

/** Адрес для `List-Unsubscribe: mailto:` — запросы разбирает поддержка. */
export function unsubscribeMailto(): string {
  return env("MAILING_UNSUBSCRIBE_EMAIL") || "support@wesetup.ru";
}

export function marketingSenderInfo(): MarketingSenderInfo {
  const dir = mailingDryRunDir();
  const separateSender = Boolean(env("MARKETING_SMTP_HOST"));
  const mode: MarketingSendMode = dir
    ? "dry-run-dir"
    : separateSender
      ? "marketing-smtp"
      : mainSmtpConfigured()
        ? "main-smtp"
        : "log-only";
  const from = marketingFrom();
  return { mode, from, fromAddress: addressOf(from), separateSender, dryRunDir: dir, unsubscribeMailto: unsubscribeMailto() };
}

type Transporter = ReturnType<typeof nodemailer.createTransport>;
let cached: { key: string; transporter: Transporter } | null = null;

function smtpTransporter(mode: "marketing-smtp" | "main-smtp"): Transporter {
  const key =
    mode === "marketing-smtp"
      ? `m:${env("MARKETING_SMTP_HOST")}:${env("MARKETING_SMTP_PORT")}:${env("MARKETING_SMTP_USER")}:${env("MARKETING_SMTP_SECURE")}`
      : `s:${env("SMTP_HOST")}:${env("SMTP_PORT")}`;
  if (cached?.key === key) return cached.transporter;
  let transporter: Transporter;
  if (mode === "marketing-smtp") {
    const port = Number(env("MARKETING_SMTP_PORT")) || 587;
    const user = env("MARKETING_SMTP_USER");
    transporter = nodemailer.createTransport({
      host: env("MARKETING_SMTP_HOST"),
      port,
      secure: env("MARKETING_SMTP_SECURE") === "true" || port === 465,
      ...(user ? { auth: { user, pass: process.env.MARKETING_SMTP_PASSWORD ?? "" } } : {}),
      connectionTimeout: 10_000,
      socketTimeout: 20_000,
    });
  } else {
    // Как в src/lib/email.ts: локальный relay с самоподписанным сертификатом.
    const host = env("SMTP_HOST") || "localhost";
    const domain = addressOf(env("SMTP_FROM") || "noreply@wesetup.ru").split("@")[1];
    transporter = nodemailer.createTransport({
      host,
      port: Number(env("SMTP_PORT")) || 25,
      secure: false,
      ...(env("SMTP_HELO_NAME") || domain ? { name: env("SMTP_HELO_NAME") || domain } : {}),
      tls: { rejectUnauthorized: !LOCAL_SMTP_HOSTS.has(host) },
      connectionTimeout: 5_000,
      socketTimeout: 10_000,
    });
  }
  cached = { key, transporter };
  return transporter;
}

/**
 * Заголовки рекламного письма: отписка ссылкой (one-click, RFC 8058) и
 * письмом. Почтовые сервисы показывают по ним кнопку «Отписаться».
 */
export function unsubscribeHeaders(msg: Pick<OutgoingEmail, "oneClickUrl" | "recipientId">): Record<string, string> {
  const mailto = `mailto:${unsubscribeMailto()}?subject=${encodeURIComponent(`unsubscribe ${msg.recipientId}`)}`;
  return {
    "List-Unsubscribe": `<${msg.oneClickUrl}>, <${mailto}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}

function mailOptions(msg: OutgoingEmail) {
  return {
    from: marketingFrom(),
    to: msg.to,
    subject: msg.subject,
    text: msg.text,
    html: msg.html,
    headers: {
      ...unsubscribeHeaders(msg),
      "X-WeSetup-Mailing": msg.campaignId,
    },
    ...(msg.attachments && msg.attachments.length > 0 ? { attachments: msg.attachments } : {}),
  };
}

/** Код ответа SMTP → временный ли сбой и не пора ли в стоп-лист. */
export function classifySmtpError(error: unknown): { error: string; transient: boolean; bounce: boolean } {
  const e = (error ?? {}) as { responseCode?: unknown; code?: unknown; message?: unknown; response?: unknown };
  const text = String(e.response ?? e.message ?? error ?? "ошибка SMTP").slice(0, 300);
  const code = typeof e.responseCode === "number" ? e.responseCode : null;
  if (code !== null && code >= 500) {
    const bounce =
      [550, 551, 553].includes(code) && /user|mailbox|recipient|address|no such|unknown|not exist|не существ/i.test(text);
    return { error: `${code}: ${text}`, transient: false, bounce };
  }
  if (code !== null && code >= 400) return { error: `${code}: ${text}`, transient: true, bounce: false };
  if (e.code === "EENVELOPE") return { error: text, transient: false, bounce: false };
  return { error: text, transient: true, bounce: false };
}

function safeName(value: string): string {
  return value.replace(/[^A-Za-z0-9_.-]+/g, "_").slice(0, 80);
}

/** Файл сухой отправки: `<папка>/<рассылка>/<получатель>-<канал>.<расширение>`. */
export async function writeDryRunFile(
  campaignId: string,
  recipientId: string,
  suffix: string,
  content: string | Buffer
): Promise<string | null> {
  const dir = mailingDryRunDir();
  if (!dir) return null;
  const folder = path.join(dir, safeName(campaignId));
  await fs.mkdir(folder, { recursive: true });
  const file = path.join(folder, `${safeName(recipientId)}-${suffix}`);
  await fs.writeFile(file, content);
  return file;
}

export async function sendMarketingEmail(msg: OutgoingEmail): Promise<SendOutcome> {
  const info = marketingSenderInfo();
  if (info.mode === "dry-run-dir") {
    // Тот же nodemailer собирает письмо целиком — в .eml видно ровно то,
    // что ушло бы по SMTP, включая List-Unsubscribe.
    const builder = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: "unix" });
    const built = (await builder.sendMail(mailOptions(msg))) as { message?: Buffer | string };
    const raw = built.message ?? "";
    const eml = await writeDryRunFile(msg.campaignId, msg.recipientId, "email.eml", raw);
    await writeDryRunFile(msg.campaignId, msg.recipientId, "email.html", msg.html);
    console.info(`[mailing] dry-run email → ${eml}`, { to: msg.to, subject: msg.subject, test: msg.isTest });
    return { kind: "sent", dryRun: true, note: "Сухая отправка: письмо записано в папку, наружу не ушло" };
  }
  if (info.mode === "log-only") {
    console.info(`[mailing] dry-run email (SMTP не настроен, только лог)`, {
      to: msg.to,
      subject: msg.subject,
      campaign: msg.campaignId,
      recipient: msg.recipientId,
      text: msg.text.slice(0, 500),
    });
    return { kind: "sent", dryRun: true, note: "Сухая отправка: SMTP не настроен, письмо только в логе" };
  }
  try {
    await smtpTransporter(info.mode).sendMail(mailOptions(msg));
    return { kind: "sent" };
  } catch (error) {
    const c = classifySmtpError(error);
    return { kind: "failed", error: c.error, transient: c.transient, bounce: c.bounce };
  }
}
