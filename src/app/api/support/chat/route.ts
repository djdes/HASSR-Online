import { NextResponse, after } from "next/server";
import { z } from "zod";
import { getActiveOrgId, requireAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import {
  SUPPORT_CHAT_HISTORY_LIMIT,
  SUPPORT_CHAT_MAX_LENGTH,
  SUPPORT_CHAT_MIN_LENGTH,
} from "@/lib/support-chat";
import { validateSignedAttachments } from "@/lib/support-attachments";
import {
  MESSAGE_SELECT,
  deliverClientMessage,
  findOrgThread,
  getOrCreateOrgThread,
  markReadByClient,
  postClientMessage,
  toMessageDto,
} from "@/lib/support-threads";

/**
 * Онлайн-чат с поддержкой — ветка активной организации.
 *
 * GET — вся история ветки организации (её же видят оператор и партнёр).
 *       `?markRead=1` — клиент смотрит на переписку, гасим непрочитанное.
 * POST — реплика клиента: пишем в БД, доставку (партнёру или админу)
 *        выносим за ответ.
 *
 * Ветку заводим лениво, только на первой реплике: пустые ветки в админке
 * не нужны, а просто открытый виджет обращением не является.
 */

const messageSchema = z.object({
  // Пустой текст допустим, когда есть вложения («просто скинул скрин») —
  // проверка «текст или файл» ниже, после валидации вложений.
  message: z
    .string()
    .trim()
    .max(SUPPORT_CHAT_MAX_LENGTH, "Сообщение слишком длинное")
    .default(""),
  attachments: z.unknown().optional(),
});

async function loadProfile(userId: string, organizationId: string) {
  const [user, organization] = await Promise.all([
    db.user.findUnique({
      where: { id: userId },
      select: { name: true, email: true, phone: true },
    }),
    db.organization.findUnique({
      where: { id: organizationId },
      select: { name: true },
    }),
  ]);
  return { user, organization };
}

export async function GET(request: Request) {
  const session = await requireAuth();
  const orgId = getActiveOrgId(session);
  const markRead = new URL(request.url).searchParams.get("markRead") === "1";

  const thread = await findOrgThread(orgId, { adopt: true });
  if (thread && markRead && thread.unreadForClient > 0) {
    await markReadByClient(thread.id);
  }

  const messages = thread
    ? await db.supportMessage.findMany({
        where: { threadId: thread.id },
        // Последние N реплик, а не первые: длинная ветка не должна
        // прятать свежий ответ за лимитом истории.
        orderBy: { createdAt: "desc" },
        take: SUPPORT_CHAT_HISTORY_LIMIT,
        select: MESSAGE_SELECT,
      }).then((rows) => rows.reverse())
    : [];

  const { user, organization } = await loadProfile(session.user.id, orgId);

  return NextResponse.json({
    threadId: thread?.id ?? null,
    unreadForClient: markRead ? 0 : (thread?.unreadForClient ?? 0),
    messages: messages.map(toMessageDto),
    // Шапку виджета («под кем авторизован») рисуем из тех же данных,
    // что уходят оператору — расхождений между «кем я вижусь» и «кого
    // видит поддержка» быть не должно.
    identity: {
      organizationName: organization?.name ?? null,
      email: user?.email ?? null,
      phone: user?.phone ?? null,
      name: user?.name ?? null,
    },
  });
}

export async function POST(request: Request) {
  const session = await requireAuth();
  const userId = session.user.id;
  const orgId = getActiveOrgId(session);

  // Партнёр внутри кабинета клиента писал бы сам себе: у него для этого
  // есть /partner/chats.
  if (session.user.partnerAccess) {
    return NextResponse.json(
      { error: "Консультант пишет клиенту из партнёрского кабинета", code: "partner_mode" },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = messageSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Некорректное сообщение" },
      { status: 400 }
    );
  }

  // Вложения: только загруженные этим же пользователем (HMAC-подпись мет).
  const attachments = validateSignedAttachments(parsed.data.attachments, userId);
  if (attachments === null) {
    return NextResponse.json(
      { error: "Вложения не прошли проверку — прикрепите файлы заново" },
      { status: 400 }
    );
  }
  if (parsed.data.message.length < SUPPORT_CHAT_MIN_LENGTH && attachments.length === 0) {
    return NextResponse.json(
      { error: "Сообщение слишком короткое" },
      { status: 400 }
    );
  }

  const { user, organization } = await loadProfile(userId, orgId);
  const snapshot = {
    organizationName: organization?.name ?? null,
    userEmail: user?.email ?? null,
    userName: user?.name ?? null,
    phone: user?.phone ?? null,
  };

  const thread = await getOrCreateOrgThread(orgId, snapshot);
  const posted = await postClientMessage({
    threadId: thread.id,
    body: parsed.data.message,
    attachments,
    author: { userId, name: user?.name ?? null },
    snapshot,
  });

  // Доставку выносим за ответ: клиент не должен ждать Telegram и SMTP,
  // а упавший канал не должен терять уже сохранённую реплику.
  after(() =>
    deliverClientMessage({ ...posted, request }).catch((error) =>
      console.error("[support-chat] delivery failed:", error)
    )
  );

  return NextResponse.json({ threadId: thread.id, message: posted.message });
}
