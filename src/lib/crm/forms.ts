import { z } from "zod";

import { CRM_STAGES, MANUAL_LEAD_CHANNELS } from "@/lib/crm/constants";

/** Формы CRM: одна схема для API и подсказок в интерфейсе. Чистый модуль. */

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value ? value : undefined));

export const manualLeadSchema = z
  .object({
    name: optionalText(200),
    company: optionalText(300),
    email: z.string().trim().toLowerCase().email("Проверьте почту").max(200).optional().or(z.literal("")),
    phone: optionalText(40),
    channel: z.enum(MANUAL_LEAD_CHANNELS, "Выберите, откуда лид"),
    message: z.string().trim().min(1, "Что написал или о чём просил клиент").max(4000),
  })
  .refine((value) => Boolean(value.email || value.phone), { message: "Нужен телефон или почта — иначе клиенту не ответить", path: ["phone"] });

export type ManualLeadInput = z.infer<typeof manualLeadSchema>;

export const contactPatchSchema = z.object({
  stage: z.enum(CRM_STAGES).optional(),
  ownerId: z.string().max(64).nullable().optional(),
  nextActionAt: z.iso.datetime({ offset: true }).nullable().optional(),
  nextActionNote: z.string().trim().max(500).nullable().optional(),
  name: z.string().trim().max(200).nullable().optional(),
  company: z.string().trim().max(300).nullable().optional(),
  email: z.string().trim().toLowerCase().email("Проверьте почту").max(200).nullable().optional().or(z.literal("")),
  phone: z.string().trim().max(40).nullable().optional(),
  note: z.string().trim().max(4000).nullable().optional(),
  /** Спам: стадия «Спам» и адрес — в стоп-лист почты. */
  blockSender: z.boolean().optional(),
});

export type ContactPatch = z.infer<typeof contactPatchSchema>;

export const CONTACT_MESSAGE_KINDS = ["email", "telegram", "call", "note", "resolved"] as const;

export const contactMessageSchema = z
  .object({
    kind: z.enum(CONTACT_MESSAGE_KINDS),
    mailboxUserId: z.string().trim().min(1).max(100).optional(),
    subject: z.string().trim().max(300).optional(),
    body: z.string().trim().max(10_000).default(""),
  })
  .refine((value) => value.kind === "resolved" || value.body.length > 0, { message: "Напишите текст", path: ["body"] })
  .refine((value) => value.kind !== "email" || Boolean(value.subject), { message: "Укажите тему письма", path: ["subject"] });

export type ContactMessageInput = z.infer<typeof contactMessageSchema>;

export const senderRuleSchema = z.object({
  pattern: z.string().trim().min(3).max(200),
  action: z.enum(["block", "allow"]),
  note: z.string().trim().max(200).optional(),
});
