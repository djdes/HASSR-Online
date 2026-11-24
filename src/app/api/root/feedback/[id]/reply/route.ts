import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRoot } from "@/lib/auth-helpers";
import { applyFeedbackReply, FeedbackReplyError } from "@/lib/feedback-reply";
import { validateSignedAttachments } from "@/lib/support-attachments";

// Ответ — текст и/или скриншоты (2026-11-23): вложения подписаны при загрузке
// этим же администратором (`validateSignedAttachments`).
const replySchema = z.object({
  message: z.string().trim().max(5000).default(""),
  attachments: z.unknown().optional(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireRoot();
  const { id } = await params;

  const parsed = replySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Некорректные данные" },
      { status: 400 },
    );
  }

  const attachments = validateSignedAttachments(parsed.data.attachments, session.user.id);
  if (attachments === null) {
    return NextResponse.json(
      { error: "Вложения не прошли проверку — прикрепите файлы заново" },
      { status: 400 },
    );
  }
  if (!parsed.data.message && attachments.length === 0) {
    return NextResponse.json({ error: "Введите текст ответа" }, { status: 400 });
  }

  // Вся доставка (колокольчик + Telegram + почта) живёт в общем модуле:
  // тот же путь используется, когда владелец отвечает реплаем из бота.
  try {
    const result = await applyFeedbackReply({
      reportId: id,
      message: parsed.data.message,
      attachments,
      respondedById: session.user.id,
      respondedByName:
        session.user.name ?? session.user.email ?? "Администратор",
    });

    return NextResponse.json({
      ok: true,
      channels: result.channels,
      notified: Object.values(result.channels).some(Boolean),
      responseMessage: result.responseMessage,
      respondedAt: result.respondedAt,
      respondedByName: result.respondedByName,
    });
  } catch (error) {
    if (error instanceof FeedbackReplyError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }
    console.error("[feedback-reply] route failed:", error);
    return NextResponse.json(
      { error: "Не удалось отправить ответ" },
      { status: 500 },
    );
  }
}
