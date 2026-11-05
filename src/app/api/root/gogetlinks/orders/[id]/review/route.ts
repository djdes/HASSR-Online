import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRoot } from "@/lib/auth-helpers";
import {
  GglAuthError,
  GglCallError,
  GglIsolationError,
} from "@/lib/seo/gogetlinks-client.server";
import { GglChatError, reviewGglPlacement } from "@/lib/seo/gogetlinks-chat.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const reviewBodySchema = z
  .object({
    action: z.enum(["accept", "request_revision"]),
    comment: z
      .string()
      .trim()
      .max(4000, "Комментарий слишком длинный (максимум 4000 символов)")
      .optional(),
    idempotencyKey: z
      .string()
      .trim()
      .min(1, "Укажите ключ идемпотентности (idempotencyKey)")
      .max(160),
  })
  .refine(
    (val) =>
      val.action !== "request_revision" || Boolean(val.comment && val.comment.trim().length >= 5),
    {
      path: ["comment"],
      message: "Укажите причину возврата на доработку (минимум 5 символов)",
    },
  );

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = await requireRoot();
  const { id } = await context.params;
  if (!id?.trim()) {
    return NextResponse.json({ error: "Не указан идентификатор заявки" }, { status: 400 });
  }

  const rawBody = await request.json().catch(() => null);
  const parsed = reviewBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Некорректные параметры проверки размещения" },
      { status: 400 },
    );
  }

  try {
    const order = await reviewGglPlacement({
      orderId: id,
      action: parsed.data.action,
      comment: parsed.data.comment,
      idempotencyKey: parsed.data.idempotencyKey,
      user: {
        id: session.user.id,
        name: session.user.name ?? session.user.email ?? "root",
      },
    });
    return NextResponse.json({ order });
  } catch (err) {
    if (err instanceof GglChatError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof GglIsolationError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    if (err instanceof GglAuthError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    if (err instanceof GglCallError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    console.error("[ggl-order-review] unexpected error:", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Не удалось выполнить действие проверки размещения в GoGetLinks",
      },
      { status: 500 },
    );
  }
}
