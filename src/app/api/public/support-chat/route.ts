import { NextResponse, after } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  SUPPORT_CHAT_HISTORY_LIMIT,
  SUPPORT_CHAT_MAX_LENGTH,
  SUPPORT_CHAT_MIN_LENGTH,
} from "@/lib/support-chat";
import { clientIp } from "@/lib/client-ip";
import {
  GUEST_ID_PATTERN,
  guestThreadKey,
  normalizeContact,
  publicContactLimiter,
} from "@/lib/public-support";
import { validateSignedAttachments } from "@/lib/support-attachments";
import {
  MESSAGE_SELECT,
  THREAD_SELECT,
  deliverClientMessage,
  markReadByClient,
  postClientMessage,
  toMessageDto,
} from "@/lib/support-threads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Онлайн-чат для гостя лендинга.
 *
 * Ветка та же самая, что у авторизованных (`SupportThread`) — оператор
 * отвечает одинаково и не различает, откуда пришёл человек. Отличается
 * только ключ: вместо организации пишем `guest:<uuid>`, где uuid лежит у
 * гостя в localStorage. Аккаунта у него нет, а переписку при возвращении
 * показать надо.
 *
 * uuid — единственный ключ к ветке, поэтому он случайный и длинный.
 * Угадать чужую переписку перебором нереально, а знать свою достаточно
 * самому браузеру.
 */

const postSchema = z.object({
  guestId: z.string().regex(GUEST_ID_PATTERN, "Некорректный идентификатор"),
  // Пустой текст допустим при вложениях — проверка «текст или файл» ниже.
  message: z
    .string()
    .trim()
    .max(SUPPORT_CHAT_MAX_LENGTH, "Сообщение слишком длинное")
    .default(""),
  email: z.string().trim().max(200).optional().or(z.literal("")),
  phone: z.string().trim().max(40).optional().or(z.literal("")),
  company: z.string().max(200).optional().or(z.literal("")),
  attachments: z.unknown().optional(),
});

export async function GET(request: Request) {
  const url = new URL(request.url);
  const guestId = url.searchParams.get("guestId") ?? "";
  if (!GUEST_ID_PATTERN.test(guestId)) {
    return NextResponse.json({ threadId: null, unreadForClient: 0, messages: [] });
  }
  const markRead = url.searchParams.get("markRead") === "1";

  const thread = await db.supportThread.findUnique({
    where: { key: guestThreadKey(guestId) },
    select: THREAD_SELECT,
  });
  if (thread && markRead && thread.unreadForClient > 0) {
    await markReadByClient(thread.id);
  }

  const messages = thread
    ? await db.supportMessage.findMany({
        where: { threadId: thread.id },
        orderBy: { createdAt: "desc" },
        take: SUPPORT_CHAT_HISTORY_LIMIT,
        select: MESSAGE_SELECT,
      }).then((rows) => rows.reverse())
    : [];

  return NextResponse.json({
    threadId: thread?.id ?? null,
    unreadForClient: markRead ? 0 : (thread?.unreadForClient ?? 0),
    messages: messages.map(toMessageDto),
    contact: { email: thread?.userEmail ?? null, phone: thread?.phone ?? null },
  });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Некорректное сообщение", code: "invalid_request" },
      { status: 400 }
    );
  }
  if (parsed.data.company) return NextResponse.json({ ok: true });

  const key = guestThreadKey(parsed.data.guestId);

  // Вложения: подписаны на этот же guest-key при загрузке.
  const attachments = validateSignedAttachments(parsed.data.attachments, key);
  if (attachments === null) {
    return NextResponse.json(
      { error: "Вложения не прошли проверку — прикрепите файлы заново", code: "invalid_attachments" },
      { status: 400 }
    );
  }
  if (parsed.data.message.length < SUPPORT_CHAT_MIN_LENGTH && attachments.length === 0) {
    return NextResponse.json(
      { error: "Сообщение слишком короткое", code: "message_too_short" },
      { status: 400 }
    );
  }
  const existing = await db.supportThread.findUnique({
    where: { key },
    select: { id: true, userEmail: true, phone: true },
  });

  // Контакты спрашиваем один раз — на первой реплике. Дальше они уже в
  // ветке, и переспрашивать в каждом сообщении незачем.
  const given = normalizeContact(parsed.data);
  const email = given.email ?? existing?.userEmail ?? null;
  const phone = given.phone ?? existing?.phone ?? null;
  if (!email && !phone) {
    return NextResponse.json(
      { error: "Оставьте телефон или почту — иначе некуда ответить", code: "missing_contact" },
      { status: 400 }
    );
  }
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: "Проверьте адрес почты", code: "invalid_email" }, { status: 400 });
  }

  const ip = clientIp(request) ?? "unknown";
  if (!publicContactLimiter.consume(`chat:${ip}`)) {
    return NextResponse.json(
      { error: "Слишком много сообщений подряд. Попробуйте через 10 минут", code: "rate_limited" },
      { status: 429 }
    );
  }

  const thread =
    existing ??
    (await db.supportThread.create({
      data: {
        key,
        userEmail: email,
        userName: "Гость с сайта",
        phone,
        lastMessageAt: new Date(),
      },
      select: { id: true },
    }));

  const posted = await postClientMessage({
    threadId: thread.id,
    body: parsed.data.message,
    attachments,
    author: { userId: null, name: "Гость с сайта" },
    snapshot: { userEmail: email, phone },
  });

  after(() =>
    deliverClientMessage(posted).catch((error) =>
      console.error("[public-support-chat] delivery failed:", error)
    )
  );

  return NextResponse.json({ ok: true, message: posted.message });
}
