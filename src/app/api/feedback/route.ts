import { NextResponse, after } from "next/server";
import { z } from "zod";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { sendFeedbackAdminEmail, sendFeedbackReceivedEmail } from "@/lib/email";
import { getPlatformAdminEmail, notifyPlatformAdmin } from "@/lib/platform-admin";
import { escapeHtml } from "@/lib/html-escape";
import { feedbackValidationDescriptor } from "@/lib/feedback-copy";
import { resolveRequestLocale } from "@/i18n/site-locale";
import {
  absoluteReportPageUrl,
  composeAttachmentCaption,
  normalizeReportPagePath,
  ticketCode,
} from "@/lib/bug-report";
import {
  emailAttachmentPayload,
  sendAttachmentsToPlatformAdmins,
  validateSignedAttachments,
} from "@/lib/support-attachments";

const feedbackSchema = z.object({
  type: z.enum(["bug", "suggestion", "partnership"], {
    message: "Выберите тип обращения",
  }),
  message: z
    .string()
    .trim()
    .min(3, "Сообщение слишком короткое")
    .max(4000, "Сообщение слишком длинное"),
  phone: z
    .string()
    .trim()
    .max(40)
    .optional()
    .or(z.literal("")),
  attachments: z.unknown().optional(),
  /** `location.href` из ярлыка «Сообщить о проблеме»; хост отбрасываем. */
  pageUrl: z.string().max(4000).optional(),
});

const APP_URL = process.env.NEXTAUTH_URL || "https://wesetup.ru";

const TYPE_LABELS: Record<string, string> = {
  bug: "🐞 Ошибка",
  suggestion: "💡 Улучшение",
  partnership: "🤝 Сотрудничество",
};

function composeTelegramMessage(params: {
  type: "bug" | "suggestion" | "partnership";
  message: string;
  reportId: string;
  userName?: string | null;
  userEmail?: string | null;
  organizationName?: string | null;
  phone?: string | null;
  pageUrl?: string | null;
}): string {
  const typeLabel = TYPE_LABELS[params.type] ?? params.type;
  const lines: string[] = [];
  lines.push(`<b>${typeLabel}</b> · тикет ${ticketCode(params.reportId)}`);
  lines.push("");
  lines.push(escapeHtml(params.message));
  lines.push("");
  if (params.userName || params.userEmail) {
    const who = [params.userName, params.userEmail].filter(Boolean).join(" · ");
    lines.push(`👤 ${escapeHtml(who)}`);
  }
  if (params.organizationName) {
    lines.push(`🏢 ${escapeHtml(params.organizationName)}`);
  }
  if (params.phone) {
    lines.push(`📞 ${escapeHtml(params.phone)}`);
  }
  if (params.pageUrl) {
    lines.push(`🔗 ${escapeHtml(params.pageUrl)}`);
  }
  lines.push("");
  // Тот же якорь, что и у обращений из бота: на это сообщение можно
  // ответить свайп-реплаем, и ответ уйдёт человеку.
  lines.push(`#fb_${params.reportId}`);
  lines.push(
    `<a href="${APP_URL}/root/feedback">Открыть панель обращений</a>`
  );
  return lines.join("\n");
}

/**
 * POST /api/feedback
 *
 * Сохраняет обращение и уведомляет админа платформы — в Telegram
 * (`notifyPlatformAdmin`) и на почту. Отправки уходят в `after()`:
 * пользователь получает ответ сразу, а не ждёт SMTP и Telegram, но
 * результат каждой доставки записывается в сам отчёт
 * (`adminTgNotifiedAt` / `adminEmailedAt`) — раньше провал канала
 * оставался только в console.error, и владелец о нём не узнавал.
 */
export async function POST(request: Request) {
  const session = await requireAuth();

  let parsed;
  try {
    parsed = feedbackSchema.parse(await request.json());
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues[0]?.message ?? "Некорректные данные", ...feedbackValidationDescriptor(error.issues[0]) },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: "Не удалось прочитать запрос", errorCode: "FEEDBACK_UNREADABLE_REQUEST" },
      { status: 400 }
    );
  }

  // Вложения: только загруженные этим же пользователем (HMAC-подпись мет).
  const attachments = validateSignedAttachments(
    parsed.attachments,
    session.user.id
  );
  if (attachments === null) {
    return NextResponse.json(
      { error: "Вложения не прошли проверку — прикрепите файлы заново", errorCode: "FEEDBACK_INVALID_ATTACHMENTS" },
      { status: 400 }
    );
  }

  const orgId = getActiveOrgId(session);
  const org = await db.organization.findUnique({
    where: { id: orgId },
    select: { name: true },
  });

  const phone = parsed.phone ? parsed.phone : null;
  const pagePath = normalizeReportPagePath(parsed.pageUrl);
  const pageUrl = pagePath ? absoluteReportPageUrl(pagePath, APP_URL) : null;
  const userEmail = session.user.email ?? null;
  const organizationName =
    org?.name ?? session.user.organizationName ?? null;

  const report = await db.feedbackReport.create({
    data: {
      userId: session.user.id,
      userEmail: session.user.email ?? null,
      userName: session.user.name ?? null,
      organizationId: orgId || null,
      organizationName,
      type: parsed.type,
      source: "site",
      message: parsed.message,
      phone,
      pageUrl,
      ...(attachments.length > 0 ? { attachments } : {}),
    },
  });
  const ticket = ticketCode(report.id);
  const locale = resolveRequestLocale(request, {
    authenticated: true,
    userLocale: session.user.locale,
    organizationLocale: session.user.organizationLocale,
  });

  after(async () => {
    const adminEmail = getPlatformAdminEmail();
    const emailAtts = emailAttachmentPayload(attachments);
    const [telegramOk, emailOk] = await Promise.all([
      notifyPlatformAdmin(
        composeTelegramMessage({
          type: parsed.type,
          message:
            parsed.message +
            (attachments.length > 0
              ? `\n📎 ${attachments.map((a) => a.filename).join(", ")}`
              : ""),
          reportId: report.id,
          userName: session.user.name ?? null,
          userEmail: session.user.email ?? null,
          organizationName,
          phone,
          pageUrl,
        }),
        { kind: "feedback" }
      ).catch((error) => {
        console.error("Feedback telegram failed:", error);
        return false;
      }),
      adminEmail
        ? sendFeedbackAdminEmail({
            to: adminEmail,
            type: parsed.type,
            message: parsed.message,
            userName: session.user.name ?? null,
            userEmail: session.user.email ?? null,
            organizationName,
            phone,
            pageUrl,
            ticket,
            submittedAt: report.createdAt,
            attachmentLinks: emailAtts.links,
            attachments: emailAtts.files,
          }).catch((error) => {
            console.error("Feedback email failed:", error);
            return false;
          })
        : Promise.resolve(false),
      // Дальше — деструктуризация выше берёт только первые два.
      // Скриншот уходит фото с подписью: тикет, текст и страница.
      sendAttachmentsToPlatformAdmins(
        attachments,
        composeAttachmentCaption({
          reportId: report.id,
          message: parsed.message,
          pageUrl,
        }),
        "feedback"
      ).catch((error) => {
        console.error("Feedback attachments failed:", error);
      }),
      // Автору — подтверждение с номером тикета.
      userEmail
        ? sendFeedbackReceivedEmail({
            to: userEmail,
            ticket,
            message: parsed.message,
            pageUrl,
            attachmentsCount: attachments.length,
            locale,
          }).catch((error) => {
            console.error("Feedback receipt email failed:", error);
          })
        : Promise.resolve(),
    ]);

    try {
      await db.feedbackReport.update({
        where: { id: report.id },
        data: {
          adminTgNotifiedAt: telegramOk ? new Date() : null,
          adminEmailedAt: emailOk ? new Date() : null,
        },
      });
    } catch (error) {
      console.error("Feedback delivery status update failed:", error);
    }
  });

  return NextResponse.json({ ok: true, ticket, emailed: Boolean(userEmail) });
}
