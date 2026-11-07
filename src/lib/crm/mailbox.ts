import { z } from "zod";

import { isAllowedSmtpHost } from "@/lib/platform-mail";

/** Ящики CRM: форма и готовые настройки популярных почтовиков. Чистый модуль. */

export type ImapPreset = { key: string; label: string; host: string; port: number; secure: boolean; sentFolder: string };

export const IMAP_PRESETS: readonly ImapPreset[] = [
  { key: "yandex", label: "Яндекс 360", host: "imap.yandex.ru", port: 993, secure: true, sentFolder: "Sent" },
  { key: "mailru", label: "Mail.ru для бизнеса", host: "imap.mail.ru", port: 993, secure: true, sentFolder: "Отправленные" },
  { key: "gmail", label: "Google Workspace", host: "imap.gmail.com", port: 993, secure: true, sentFolder: "[Gmail]/Sent Mail" },
  { key: "beget", label: "Beget", host: "imap.beget.com", port: 993, secure: true, sentFolder: "Sent" },
  { key: "timeweb", label: "Timeweb", host: "imap.timeweb.ru", port: 993, secure: true, sentFolder: "Sent" },
];

const folder = z.string().trim().max(200);

export const mailboxInputSchema = z.object({
  label: z.string().trim().min(2, "Назовите ящик, например «Рабочая почта»").max(80),
  host: z
    .string()
    .trim()
    .toLowerCase()
    .min(3)
    .max(200)
    .refine(isAllowedSmtpHost, "Укажите внешний IMAP-сервер, например imap.yandex.ru"),
  port: z.coerce.number().int().min(1).max(65535),
  secure: z.boolean(),
  username: z.string().trim().min(3, "Укажите логин — обычно это адрес почты").max(200),
  /** На изменении пустой пароль = оставить прежний. */
  password: z.string().max(500).optional(),
  inboxFolder: folder.min(1).default("INBOX"),
  sentFolder: folder.optional(),
  enabled: z.boolean().default(true),
});

export type MailboxInput = z.infer<typeof mailboxInputSchema>;

export type MailboxView = {
  id: string;
  label: string;
  host: string;
  port: number;
  secure: boolean;
  username: string;
  inboxFolder: string;
  sentFolder: string | null;
  enabled: boolean;
  lastSyncAt: string | null;
  lastError: string | null;
};
