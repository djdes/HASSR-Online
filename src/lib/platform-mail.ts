import { z } from "zod";

/**
 * Personal outgoing mailbox of a platform panel user — pure part (validation,
 * provider presets). Sending lives in platform-mail.server.ts.
 */

export const SMTP_PORTS = [25, 465, 587, 2525] as const;

export type SmtpProviderPreset = {
  key: string;
  title: string;
  host: string;
  port: number;
  secure: boolean;
  /** Short hint shown under the preset (app passwords etc.). */
  hint: string;
};

export const SMTP_PROVIDER_PRESETS: readonly SmtpProviderPreset[] = [
  { key: "yandex", title: "Яндекс 360", host: "smtp.yandex.ru", port: 465, secure: true, hint: "Нужен пароль приложения: Яндекс ID → Безопасность → Пароли приложений" },
  { key: "mailru", title: "Mail.ru", host: "smtp.mail.ru", port: 465, secure: true, hint: "Нужен пароль для внешнего приложения: Настройки → Безопасность" },
  { key: "gmail", title: "Gmail", host: "smtp.gmail.com", port: 465, secure: true, hint: "Нужен пароль приложения (двухэтапная проверка Google)" },
  { key: "beget", title: "Beget", host: "smtp.beget.com", port: 465, secure: true, hint: "Логин — полный адрес почты, пароль — от ящика" },
];

/**
 * A public mail server name: a dotted hostname, not a bare word, localhost or
 * an IP literal from private ranges — otherwise the form could be used to
 * relay through the server's own mailer or probe internal services.
 */
export function isAllowedSmtpHost(raw: string): boolean {
  const host = raw.trim().toLowerCase();
  if (!/^[a-z0-9.-]+$/.test(host) || !host.includes(".")) return false;
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return false;
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    if (a === 10 || a === 127 || a === 0 || a >= 224) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
  }
  return true;
}

/**
 * True for addresses the server must never connect to on a person's behalf:
 * loopback, private, link-local, CGNAT, multicast, unspecified (v4 and v6,
 * including v4-mapped v6). A public-looking name can still resolve here.
 */
export function isPrivateIp(ip: string): boolean {
  const value = ip.trim().toLowerCase();
  const mapped = value.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  const v4 = (mapped ? mapped[1] : value).match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return (
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  if (!value.includes(":")) return true;
  return (
    value === "::" || value === "::1" ||
    value.startsWith("fc") || value.startsWith("fd") ||
    value.startsWith("fe8") || value.startsWith("fe9") || value.startsWith("fea") || value.startsWith("feb") ||
    value.startsWith("ff")
  );
}

const email = z.string().trim().toLowerCase().email("Проверьте адрес почты").max(200);

export const mailSenderSchema = z.object({
  fromName: z.string().trim().min(2, "Укажите имя отправителя").max(120),
  fromEmail: email,
  host: z
    .string()
    .trim()
    .toLowerCase()
    .min(3, "Укажите SMTP-сервер")
    .max(200)
    .refine(isAllowedSmtpHost, "Укажите внешний SMTP-сервер, например smtp.yandex.ru"),
  port: z.coerce
    .number()
    .int()
    .refine((port) => (SMTP_PORTS as readonly number[]).includes(port), "Порт: 465 (SSL), 587 или 25"),
  secure: z.boolean(),
  username: z.string().trim().min(1, "Укажите логин").max(200),
  /** Empty on update = keep the stored password. */
  password: z.string().max(500).optional().default(""),
  replyTo: z.union([email, z.literal("")]).optional().default(""),
  position: z.string().trim().max(120).optional().default(""),
  phone: z.string().trim().max(40).optional().default(""),
  signature: z.string().trim().max(1000).optional().default(""),
});

export type MailSenderInput = z.infer<typeof mailSenderSchema>;

/** `"Денис Волков" <denis@bfs.ru>` with quotes escaped. */
export function formatFromAddress(name: string, address: string): string {
  const clean = name.replace(/["\\\r\n]/g, "").trim();
  return clean ? `"${clean}" <${address}>` : address;
}

/** Human status of the mailbox for lists. */
export type MailSenderStatus = "none" | "unverified" | "verified" | "disabled" | "error";

export function mailSenderStatus(sender: { enabled: boolean; verifiedAt: Date | string | null; lastError: string | null } | null): MailSenderStatus {
  if (!sender) return "none";
  if (!sender.enabled) return "disabled";
  if (sender.verifiedAt) return "verified";
  return sender.lastError ? "error" : "unverified";
}
