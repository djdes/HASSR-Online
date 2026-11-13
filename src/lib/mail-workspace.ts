import { z } from "zod";
import { clientEmailContentSchema, type ClientEmailView } from "@/lib/client-email";

export const MAIL_RECIPIENT_LIMIT = 10;
export const mailWorkspaceContentSchema = clientEmailContentSchema.omit({ to: true }).extend({
  recipients: z.array(z.object({
    organizationId: z.string().trim().min(1).max(100),
    email: clientEmailContentSchema.shape.to,
  })).min(1, "Выберите получателя").max(MAIL_RECIPIENT_LIMIT, "Не более 10 получателей за раз")
    .refine(items => new Set(items.map(item => item.email)).size === items.length, "Один адрес можно выбрать только один раз"),
});
export const mailWorkspaceSchema = mailWorkspaceContentSchema.extend({ requestId: z.uuid() });
export type MailWorkspaceInput = z.infer<typeof mailWorkspaceSchema>;
export type MailRecipient = { organizationId: string; organizationName: string; email: string; label: string };
export type MailWorkspaceItem = ClientEmailView & { organizationId: string; organizationName: string };
export type MailWorkspaceHistory = { items: MailWorkspaceItem[]; nextCursor: string | null };
export type MailWorkspaceResult = { items: MailWorkspaceItem[]; interrupted: boolean };
