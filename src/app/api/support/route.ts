import { NextResponse, after } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireApiAuth } from "@/lib/auth-helpers";
import { escapeTelegramHtml as esc } from "@/lib/telegram";
import {
  notifyPlatformAdmin,
  sendToSupportEmails,
} from "@/lib/platform-admin";
import { sendFeedbackAdminEmail } from "@/lib/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/support
 *
 * Body: { message: string }
 *
 * Принимает сообщение от management-юзера из виджета поддержки в
 * кабинете и кладёт его в тот же ящик, что форма обратной связи и бот:
 * строка `FeedbackReport` + уведомление админу платформы.
 *
 * Раньше отсюда писали в отдельный `SUPPORT_TELEGRAM_CHAT_ID`. На проде
 * он не задан — и каждое сообщение молча падало в AuditLog, где его
 * никто не читал. Четвёртый канал с собственным chat id никому не был
 * нужен: адрес админа платформы один (см. lib/platform-admin.ts).
 *
 * Сообщение содержит контекст: организация, кто пишет (имя, почта,
 * телефон), с какой страницы отправлено. Ответить можно реплаем на
 * сообщение в Telegram по тегу #fb_<id> или из панели /root/feedback.
 */
const bodySchema = z.object({
  message: z.string().min(5).max(2000),
  url: z.string().max(500).optional(),
});

export async function POST(request: Request) {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  const session = auth.session;

  let parsed;
  try {
    parsed = bodySchema.parse(await request.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        {
          error:
            err.issues[0]?.message ??
            "Сообщение должно быть от 5 до 2000 символов",
        },
        { status: 400 }
      );
    }
    throw err;
  }

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: {
      name: true,
      email: true,
      phone: true,
      organization: { select: { id: true, name: true } },
    },
  });

  const orgName = user?.organization?.name ?? "?";
  const orgId = user?.organization?.id ?? "?";

  const text =
    `<b>📨 Поддержка</b>\n\n` +
    `<b>Организация:</b> ${esc(orgName)} (id: <code>${esc(orgId)}</code>)\n` +
    `<b>От:</b> ${esc(user?.name ?? "?")} ` +
    (user?.email ? `· ${esc(user.email)}` : "") +
    (user?.phone ? ` · ${esc(user.phone)}` : "") +
    `\n` +
    (parsed.url ? `<b>Откуда:</b> ${esc(parsed.url)}\n` : "") +
    `\n${esc(parsed.message)}`;

  const report = await db.feedbackReport.create({
    data: {
      userId: session.user.id,
      userEmail: user?.email ?? null,
      userName: user?.name ?? null,
      // orgId/orgName выше — «?» для текста сообщения; в БД такой
      // внешний ключ не запишешь, поэтому берём настоящие значения.
      organizationId: user?.organization?.id ?? null,
      organizationName: user?.organization?.name ?? null,
      type: "support",
      source: "site",
      message: parsed.message,
      phone: user?.phone ?? null,
    },
    select: { id: true, createdAt: true },
  });

  // Ответ реплаем в Telegram ищет этот тег — тот же формат, что у формы
  // обратной связи и у сообщений боту.
  const adminText = `${text}

#fb_${report.id}`;

  after(async () => {
    const [tgOk, emailOk] = await Promise.all([
      // Своё подробное письмо — следом, всем администраторам.
      notifyPlatformAdmin(adminText, { kind: "support-widget", email: false, audience: "support" }),
      sendToSupportEmails((to) =>
        sendFeedbackAdminEmail({
          to,
          type: "support",
          message: parsed.message,
          userName: user?.name ?? null,
          userEmail: user?.email ?? null,
          organizationName: orgName,
          phone: user?.phone ?? null,
          submittedAt: report.createdAt,
        })
      ),
    ]);

    await db.feedbackReport
      .update({
        where: { id: report.id },
        data: {
          adminTgNotifiedAt: tgOk ? new Date() : null,
          adminEmailedAt: emailOk ? new Date() : null,
        },
      })
      .catch((err) => {
        console.error("[support] статусы доставки не записаны", err);
      });
  });

  return NextResponse.json({ ok: true });
}
