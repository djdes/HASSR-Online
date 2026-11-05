import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRoot } from "@/lib/auth-helpers";
import {
  GglAuthError,
  GglCallError,
  GglIsolationError,
} from "@/lib/seo/gogetlinks-client.server";
import {
  GglChatError,
  getAndRefreshGglThread,
  replyToGglThread,
} from "@/lib/seo/gogetlinks-chat.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const replyBodySchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, "Введите текст сообщения")
    .max(8000, "Сообщение слишком длинное (максимум 8000 символов)"),
  idempotencyKey: z
    .string()
    .trim()
    .min(1, "Укажите ключ идемпотентности (idempotencyKey)")
    .max(160),
});

function handleRouteError(err: unknown, fallbackMessage: string): NextResponse {
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
  console.error("[ggl-thread-detail] unexpected error:", err);
  return NextResponse.json(
    { error: err instanceof Error ? err.message : fallbackMessage },
    { status: 500 },
  );
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  await requireRoot();
  const { id } = await context.params;
  if (!id?.trim()) {
    return NextResponse.json({ error: "Не указан идентификатор диалога" }, { status: 400 });
  }

  const url = new URL(request.url);
  const refresh = url.searchParams.get("refresh") !== "false";

  try {
    const result = await getAndRefreshGglThread(id, { refresh });
    return NextResponse.json(result);
  } catch (err) {
    return handleRouteError(err, "Не удалось загрузить переписку с вебмастером");
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = await requireRoot();
  const { id } = await context.params;
  if (!id?.trim()) {
    return NextResponse.json({ error: "Не указан идентификатор диалога" }, { status: 400 });
  }

  const rawBody = await request.json().catch(() => null);
  const parsed = replyBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Некорректные данные сообщения" },
      { status: 400 },
    );
  }

  try {
    const message = await replyToGglThread({
      threadId: id,
      body: parsed.data.body,
      idempotencyKey: parsed.data.idempotencyKey,
      user: {
        id: session.user.id,
        name: session.user.name ?? session.user.email ?? "root",
      },
    });
    return NextResponse.json({ message });
  } catch (err) {
    return handleRouteError(err, "Не удалось отправить ответ вебмастеру в GoGetLinks");
  }
}
