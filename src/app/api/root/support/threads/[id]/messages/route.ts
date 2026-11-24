import { NextResponse } from "next/server";
import { requireRoot } from "@/lib/auth-helpers";
import { supportOperatorLimiter } from "@/lib/rate-limit";
import {
  SupportThreadError,
  deliverOperatorMessage,
  parseOperatorInput,
  postOperatorMessage,
  resolveReplyTarget,
} from "@/lib/support-threads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Ответ ROOT в ветку из админки. Доставку ждём и возвращаем — как в ответе
 * на обращение: «отправлено» должно значить «доставлено», а не «записано».
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireRoot();
  const { id } = await ctx.params;
  const input = parseOperatorInput(await request.json().catch(() => null), session.user.id);
  if (!input.ok) return NextResponse.json({ error: input.error }, { status: 400 });
  if (!supportOperatorLimiter.consume(session.user.id)) {
    return NextResponse.json({ error: "Слишком много сообщений подряд" }, { status: 429 });
  }

  try {
    const target = await resolveReplyTarget(id);
    const operator = {
      kind: "admin" as const,
      name: "Поддержка WeSetup",
      userId: session.user.id,
      partnerId: null,
    };
    const posted = await postOperatorMessage({
      threadId: target.thread.id,
      body: input.body,
      attachments: input.attachments,
      operator,
      // Цитата: на какое сообщение клиента отвечаем (2026-11-23).
      replyToId: input.replyToId,
    });
    const delivered = await deliverOperatorMessage({ ...posted, operator });
    return NextResponse.json({
      threadId: target.thread.id,
      redirected: target.redirected,
      message: posted.message,
      delivered,
    });
  } catch (error) {
    if (error instanceof SupportThreadError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[root-support] reply failed:", error);
    return NextResponse.json({ error: "Не удалось отправить ответ" }, { status: 500 });
  }
}
