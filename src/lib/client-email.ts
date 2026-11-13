import { z } from "zod";
import { deliverableEmail, messageHtml } from "@/lib/client-documents";
import { escapeHtml } from "@/lib/html-escape";

export const clientEmailContentSchema = z.object({
  to: z.string().trim().max(254).refine((value) => Boolean(deliverableEmail(value)), "Укажите настоящий адрес почты").transform((value) => value.toLowerCase()),
  subject: z.string().trim().min(1, "Укажите тему письма").max(200).refine((value) => !/[\r\n\u0000-\u001f\u007f]/.test(value), "Тема должна быть одной строкой"),
  message: z.string().trim().min(1, "Напишите текст письма").max(20000),
});

export const clientEmailSchema = clientEmailContentSchema.extend({ requestId: z.uuid() });
export type ClientEmailInput = z.infer<typeof clientEmailSchema>;

export type ClientEmailSender = {
  fromName: string;
  fromEmail: string;
  position: string;
  phone: string;
  signature: string;
};

/** Only escaped plain text enters the shared brand layout. */
export function clientEmailContent(input: Pick<ClientEmailInput, "subject" | "message">, sender: ClientEmailSender) {
  const signature = [sender.fromName, sender.position, sender.phone, sender.fromEmail, sender.signature].filter(Boolean).join("\n");
  return {
    title: escapeHtml(input.subject),
    body: `${messageHtml(input.message)}<div style="margin-top:24px;padding-top:16px;border-top:1px solid #ececf4;color:#3c4053">${messageHtml(signature)}</div>`,
    text: `${input.message}\n\n${signature}`,
  };
}

export type ClientEmailView = {
  id: string;
  to: string;
  subject: string;
  message: string;
  html: string;
  senderName: string;
  fromEmail: string;
  status: string;
  error: string | null;
  createdAt: string;
  sentAt: string | null;
};

export type ClientEmailHistory = { items: ClientEmailView[]; nextCursor: string | null };
