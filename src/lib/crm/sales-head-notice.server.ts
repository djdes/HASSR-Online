import { db } from "@/lib/db";
import { renderEmailLayout, sendRawEmail } from "@/lib/email";
import { escapeHtml } from "@/lib/html-escape";
import { sendTelegramMessage } from "@/lib/telegram";
import { isTechnicalEmail } from "@/lib/technical-email";

/**
 * Человека назначили РОП: письмо и Telegram — что теперь приходит ему и где
 * CRM. Сбой оповещения назначение не отменяет. true — ушло хоть куда-то.
 */
export async function notifySalesHeadGranted(args: { userId: string; grantedBy: string | null }): Promise<boolean> {
  const user = await db.user.findUnique({
    where: { id: args.userId },
    select: { id: true, name: true, email: true, contactEmail: true, telegramChatId: true, organizationId: true, isActive: true, archivedAt: true },
  });
  if (!user || !user.isActive || user.archivedAt) return false;
  const appUrl = process.env.NEXTAUTH_URL || "https://wesetup.ru";
  const by = args.grantedBy ? ` (назначил: ${args.grantedBy})` : "";
  const lines = [
    `Вы — РОП в CRM WeSetup${by}.`,
    "Теперь вам приходят все заявки (показ, услуги, счета, партнёры, регистрации, письма на рабочую почту) и напоминания: клиент ждёт ответа, клиент молчит, наступил следующий шаг. Каждое утро в 9:00 — сводка.",
    "Ответственного по клиенту можно назначить в его карточке — первые напоминания пойдут ему, эскалации — вам.",
  ];
  let ok = false;
  if (user.telegramChatId) {
    ok = await sendTelegramMessage(
      user.telegramChatId,
      [`<b>📈 ${escapeHtml(lines[0])}</b>`, escapeHtml(lines[1]), escapeHtml(lines[2]), `<a href="${appUrl}/root/crm">Открыть CRM</a>`].join("\n\n"),
      { userId: user.id, delivery: { organizationId: user.organizationId, kind: "crm.sales_head.granted", dedupeKey: `crm.sales_head.granted:${user.id}` } },
    ).catch(() => false);
  }
  const to = user.contactEmail?.trim() || (isTechnicalEmail(user.email) ? null : user.email);
  if (to) {
    // Первая строка — заголовок письма, в тексте её не повторяем.
    const paragraphs = [args.grantedBy ? `Назначил: ${args.grantedBy}.` : null, lines[1], lines[2]].filter((line): line is string => Boolean(line));
    const body = `${paragraphs.map((line) => `<p style="margin:0 0 12px;color:#3f3f46;line-height:1.6">${escapeHtml(line)}</p>`).join("")}<p style="margin:16px 0 0"><a href="${appUrl}/root/crm" style="color:#5566f6;font-weight:600">Открыть CRM</a></p>`;
    const mailed = await sendRawEmail(to, "Вы — РОП в CRM WeSetup", renderEmailLayout("Вы — РОП в CRM WeSetup", body)).catch(() => false);
    ok = ok || mailed;
  }
  return ok;
}
