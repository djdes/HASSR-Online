/**
 * Онлайн-чат поддержки: ветки, реплики и доставка.
 *
 * Одна ветка на организацию (`org:<orgId>`), одна на гостя сайта
 * (`guest:<uuid>`). Старые личные ветки (`<userId>`) «усыновляются»:
 * при первом обращении организации ключ переписывается на org-ключ, и
 * история никуда не девается.
 *
 * Кто отвечает клиенту — партнёр или WeSetup — решается в момент
 * сообщения по активной привязке `PartnerClient`. Ничего не храним:
 * привязали организацию к партнёру — следующая реплика уйдёт ему,
 * отвязали — снова в WeSetup.
 *
 * Все входы (виджеты, свайп-реплай бота, партнёрский кабинет, ROOT,
 * рассылка) ходят через `postClientMessage` / `postOperatorMessage`,
 * чтобы счётчики непрочитанного и уведомления считались в одном месте.
 */

import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { publishToOrganization, publishToUser, publishToUsers } from "@/lib/live-events";
import { sendFeedbackAdminEmail } from "@/lib/email";
import { notifyManagement } from "@/lib/notifications";
import { platformOrgId } from "@/lib/partners/partner-hint";
import { sendPartnerChatMessageEmail } from "@/lib/partners/emails";
import { getPlatformAdminEmail, notifyPlatformAdmin } from "@/lib/platform-admin";
import {
  emailAttachmentPayload,
  parseStoredAttachments,
  sendAttachmentsToPlatformAdmins,
  validateSignedAttachments,
} from "@/lib/support-attachments";
import type { SupportAttachmentMeta } from "@/lib/support-attachments-shared";
import {
  SUPPORT_CHAT_MAX_LENGTH,
  SUPPORT_CHAT_MIN_LENGTH,
  composeOperatorReplyTelegram,
  composePartnerHandoffAdminMessage,
  composeSupportChatAdminMessage,
  composeSupportChatPartnerMessage,
} from "@/lib/support-chat";
import {
  GUEST_KEY_PREFIX,
  ORG_KEY_PREFIX,
  orgThreadKey,
  previewOf,
  threadKindOf,
} from "@/lib/support-threads-shared";
import {
  escapeTelegramHtml,
  notifyEmployee,
  notifyOrganization,
} from "@/lib/telegram";

const APP_URL = process.env.NEXTAUTH_URL || "https://wesetup.ru";

export class SupportThreadError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 403 | 404 = 400
  ) {
    super(message);
    this.name = "SupportThreadError";
  }
}

export const THREAD_SELECT = {
  id: true,
  key: true,
  organizationId: true,
  organizationName: true,
  userEmail: true,
  userName: true,
  phone: true,
  unreadForClient: true,
  unreadForStaff: true,
} satisfies Prisma.SupportThreadSelect;

export type ThreadRow = Prisma.SupportThreadGetPayload<{
  select: typeof THREAD_SELECT;
}>;

export const MESSAGE_SELECT = {
  id: true,
  author: true,
  body: true,
  operatorName: true,
  authorName: true,
  partnerId: true,
  attachments: true,
  createdAt: true,
} satisfies Prisma.SupportMessageSelect;

type MessageRow = Prisma.SupportMessageGetPayload<{
  select: typeof MESSAGE_SELECT;
}>;

export type MessageDto = Omit<MessageRow, "attachments"> & {
  attachments: SupportAttachmentMeta[];
};

export function toMessageDto(row: MessageRow): MessageDto {
  return { ...row, attachments: parseStoredAttachments(row.attachments) };
}

export type ThreadSnapshot = {
  organizationName: string | null;
  userEmail: string | null;
  userName: string | null;
  phone: string | null;
};

// ---------------------------------------------------------------------------
// Владелец ветки
// ---------------------------------------------------------------------------

export type ThreadPartner = {
  partnerId: string;
  brandName: string;
  contactEmail: string;
};

/** Активный партнёр организации — прямой индексированный запрос, без кэша брендинга. */
export async function getActivePartnerForOrg(
  organizationId: string
): Promise<ThreadPartner | null> {
  const link = await db.partnerClient.findFirst({
    // Скрытый партнёр чатов клиента не ведёт — отвечает поддержка WeSetup.
    where: { organizationId, detachedAt: null, partner: { status: "active", hideFromClients: false } },
    select: {
      partnerId: true,
      partner: {
        select: {
          companyName: true,
          contactEmail: true,
          branding: { select: { brandName: true } },
        },
      },
    },
  });
  if (!link) return null;
  return {
    partnerId: link.partnerId,
    brandName: link.partner.branding?.brandName || link.partner.companyName,
    contactEmail: link.partner.contactEmail,
  };
}

/** Для списка веток в админке: организация → партнёр, одним запросом. */
export async function getPartnerThreadOwnership(
  organizationIds: string[]
): Promise<Map<string, { partnerId: string; brandName: string }>> {
  const ids = Array.from(new Set(organizationIds.filter(Boolean)));
  const out = new Map<string, { partnerId: string; brandName: string }>();
  if (ids.length === 0) return out;
  const links = await db.partnerClient.findMany({
    where: {
      organizationId: { in: ids },
      detachedAt: null,
      partner: { status: "active", hideFromClients: false },
    },
    select: {
      organizationId: true,
      partnerId: true,
      partner: {
        select: { companyName: true, branding: { select: { brandName: true } } },
      },
    },
  });
  for (const link of links) {
    out.set(link.organizationId, {
      partnerId: link.partnerId,
      brandName: link.partner.branding?.brandName || link.partner.companyName,
    });
  }
  return out;
}

/** Организации партнёра с активной привязкой. */
export async function listPartnerOrgIds(partnerId: string): Promise<string[]> {
  const links = await db.partnerClient.findMany({
    where: { partnerId, detachedAt: null, partner: { hideFromClients: false } },
    select: { organizationId: true },
  });
  return links.map((l) => l.organizationId);
}

// ---------------------------------------------------------------------------
// Ветки организаций
// ---------------------------------------------------------------------------

async function findLegacyThread(organizationId: string) {
  return db.supportThread.findFirst({
    where: {
      organizationId,
      NOT: [
        { key: { startsWith: ORG_KEY_PREFIX } },
        { key: { startsWith: GUEST_KEY_PREFIX } },
      ],
    },
    orderBy: { lastMessageAt: "desc" },
    select: THREAD_SELECT,
  });
}

/**
 * Ветка организации. `adopt` — переписать ключ самой свежей legacy-ветки
 * этой организации, если org-ветки ещё нет (остальные legacy-ветки
 * остаются архивом, ROOT их видит). Пустую ветку не создаёт.
 */
export async function findOrgThread(
  organizationId: string,
  opts?: { adopt?: boolean }
): Promise<ThreadRow | null> {
  const key = orgThreadKey(organizationId);
  const hit = await db.supportThread.findUnique({
    where: { key },
    select: THREAD_SELECT,
  });
  if (hit || !opts?.adopt) return hit;
  const legacy = await findLegacyThread(organizationId);
  if (!legacy) return null;
  try {
    return await db.supportThread.update({
      where: { id: legacy.id },
      data: { key },
      select: THREAD_SELECT,
    });
  } catch (error) {
    // Две вкладки одновременно: ключ уже занят соседом — берём его ветку.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return db.supportThread.findUnique({ where: { key }, select: THREAD_SELECT });
    }
    throw error;
  }
}

export async function getOrCreateOrgThread(
  organizationId: string,
  snapshot: ThreadSnapshot
): Promise<ThreadRow> {
  const adopted = await findOrgThread(organizationId, { adopt: true });
  if (adopted) return adopted;
  const key = orgThreadKey(organizationId);
  try {
    return await db.supportThread.create({
      data: { key, organizationId, ...snapshot, lastMessageAt: new Date() },
      select: THREAD_SELECT,
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const again = await db.supportThread.findUnique({
        where: { key },
        select: THREAD_SELECT,
      });
      if (again) return again;
    }
    throw error;
  }
}

/**
 * Куда писать ответ оператора. Реплика в старую личную ветку с известной
 * организацией уходит в ветку организации — иначе клиент, который теперь
 * читает `org:<id>`, ответа не увидит. Работает и для свайп-реплаев на
 * старые якоря `#chat_<legacyId>`.
 */
export async function resolveReplyTarget(
  threadId: string
): Promise<{ thread: ThreadRow; redirected: boolean }> {
  const thread = await db.supportThread.findUnique({
    where: { id: threadId },
    select: THREAD_SELECT,
  });
  if (!thread) throw new SupportThreadError("Ветка не найдена", 404);
  if (threadKindOf(thread.key) === "legacy" && thread.organizationId) {
    const target = await getOrCreateOrgThread(thread.organizationId, {
      organizationName: thread.organizationName,
      userEmail: thread.userEmail,
      userName: thread.userName,
      phone: thread.phone,
    });
    return { thread: target, redirected: target.id !== thread.id };
  }
  return { thread, redirected: false };
}

// ---------------------------------------------------------------------------
// Реплики клиента
// ---------------------------------------------------------------------------

export type ClientAuthor = { userId: string | null; name: string | null };

export async function postClientMessage(args: {
  threadId: string;
  body: string;
  attachments: SupportAttachmentMeta[];
  author: ClientAuthor;
  /** Свежие контакты автора — оператору нужны актуальные. */
  snapshot?: Partial<ThreadSnapshot>;
}): Promise<{ thread: ThreadRow; message: MessageDto; previousMessages: number }> {
  const previousMessages = await db.supportMessage.count({
    where: { threadId: args.threadId },
  });
  const [thread, message] = await db.$transaction([
    db.supportThread.update({
      where: { id: args.threadId },
      data: {
        ...(args.snapshot ?? {}),
        lastMessageAt: new Date(),
        unreadForStaff: { increment: 1 },
      },
      select: THREAD_SELECT,
    }),
    db.supportMessage.create({
      data: {
        threadId: args.threadId,
        author: "client",
        body: args.body,
        authorUserId: args.author.userId,
        authorName: args.author.name,
        ...(args.attachments.length > 0 ? { attachments: args.attachments } : {}),
      },
      select: MESSAGE_SELECT,
    }),
  ]);
  // Оператору — по живому потоку сразу, не дожидаясь Telegram и почты
  // из deliverClientMessage: админка обновится, пока письмо ещё идёт.
  void publishSupportToOperators(thread, { kind: "message" }).catch((error) =>
    console.error("[support-threads] live publish failed:", error)
  );
  return { thread, message: toMessageDto(message), previousMessages };
}

/**
 * Доставка реплики клиента тому, кто отвечает. Каналы независимы: упавший
 * Telegram не отменяет письмо. Вызывать из `after()` — клиент ждать не должен.
 */
export async function deliverClientMessage(ctx: {
  thread: ThreadRow;
  message: MessageDto;
  previousMessages: number;
}): Promise<void> {
  const { thread, message } = ctx;
  const attachmentsNote =
    message.attachments.length > 0
      ? `\n📎 ${message.attachments.map((a) => a.filename).join(", ")}`
      : "";
  const bodyText = (message.body || "(вложение без текста)") + attachmentsNote;

  // Колокольчик ROOT: письмо и Telegram уходят ниже, а в самой админке о
  // новом сообщении раньше узнавали, только обновив страницу. Одно
  // уведомление на ветку — новые реплики дописываются в него.
  await notifyManagement({
    organizationId: platformOrgId(),
    kind: "support.message",
    dedupeKey: `support.message:${thread.id}`,
    title: `Сообщение в чате: ${
      thread.organizationName ?? message.authorName ?? thread.userName ?? "гость с сайта"
    }`,
    linkHref: "/root/feedback",
    linkLabel: "Открыть переписку",
    items: [
      {
        id: message.id,
        label: previewOf(message.body, message.attachments.length, 140) || "📎 Вложение",
      },
    ],
  }).catch((error) => console.error("[support-threads] root notification failed:", error));

  const partner = thread.organizationId
    ? await getActivePartnerForOrg(thread.organizationId).catch(() => null)
    : null;

  if (partner) {
    const members = await db.partnerUser.findMany({
      where: { partnerId: partner.partnerId },
      select: { userId: true },
    });
    const partnerText = composeSupportChatPartnerMessage({
      threadId: thread.id,
      body: bodyText,
      organizationName: thread.organizationName,
      authorName: message.authorName,
      escape: escapeTelegramHtml,
      appUrl: APP_URL,
    });
    await Promise.all([
      ...members.map((m) =>
        notifyEmployee(m.userId, partnerText).catch((error) =>
          console.error("[support-threads] partner telegram failed:", error)
        )
      ),
      // Письмо всегда: участники партнёра могут быть без Telegram или ещё не активированы.
      sendPartnerChatMessageEmail({
        to: partner.contactEmail,
        organizationName: thread.organizationName ?? "Организация",
        authorName: message.authorName,
        preview: bodyText,
        threadId: thread.id,
      }).catch((error) =>
        console.error("[support-threads] partner email failed:", error)
      ),
      // Админу — тихо: отвечает партнёр, но в админке видно, что ветка ждёт.
      notifyPlatformAdmin(
        composePartnerHandoffAdminMessage({
          threadId: thread.id,
          body: bodyText,
          organizationName: thread.organizationName,
          brandName: partner.brandName,
          authorName: message.authorName,
          escape: escapeTelegramHtml,
          appUrl: APP_URL,
        }),
        { kind: "support-chat-partner" }
      ),
    ]);
    return;
  }

  const adminText = composeSupportChatAdminMessage({
    threadId: thread.id,
    body: bodyText,
    userName: message.authorName ?? thread.userName,
    userEmail: thread.userEmail,
    organizationName: thread.organizationName,
    phone: thread.phone,
    previousMessages: ctx.previousMessages,
    escape: escapeTelegramHtml,
    appUrl: APP_URL,
  });
  const emailAtts = emailAttachmentPayload(message.attachments);
  await Promise.all([
    notifyPlatformAdmin(adminText, { kind: "support-chat" }),
    sendAttachmentsToPlatformAdmins(
      message.attachments,
      `Вложения к чату #chat_${thread.id}`,
      "support-chat"
    ),
    (async () => {
      const adminEmail = getPlatformAdminEmail();
      if (!adminEmail) return false;
      return sendFeedbackAdminEmail({
        to: adminEmail,
        type: "support",
        message: message.body || "(вложение без текста)",
        userName: message.authorName ?? thread.userName,
        userEmail: thread.userEmail,
        organizationName: thread.organizationName,
        phone: thread.phone,
        submittedAt: message.createdAt,
        attachmentLinks: emailAtts.links,
        attachments: emailAtts.files,
      });
    })().catch((error) =>
      console.error("[support-threads] admin email failed:", error)
    ),
  ]);
}

// ---------------------------------------------------------------------------
// Реплики оператора (WeSetup или партнёр)
// ---------------------------------------------------------------------------

export type OperatorIdentity = {
  kind: "admin" | "partner";
  /** Подпись в чате клиента: «Поддержка WeSetup», «<бренд> · Иван». */
  name: string;
  userId: string | null;
  partnerId: string | null;
};

export async function postOperatorMessage(args: {
  threadId: string;
  body: string;
  attachments: SupportAttachmentMeta[];
  operator: OperatorIdentity;
  broadcastId?: string | null;
}): Promise<{ thread: ThreadRow; message: MessageDto }> {
  const [thread, message] = await db.$transaction([
    db.supportThread.update({
      where: { id: args.threadId },
      data: {
        lastMessageAt: new Date(),
        unreadForStaff: 0,
        unreadForClient: { increment: 1 },
      },
      select: THREAD_SELECT,
    }),
    db.supportMessage.create({
      data: {
        threadId: args.threadId,
        author: "operator",
        body: args.body,
        operatorName: args.operator.name,
        authorUserId: args.operator.userId,
        authorName: args.operator.name,
        partnerId: args.operator.partnerId,
        broadcastId: args.broadcastId ?? null,
        ...(args.attachments.length > 0 ? { attachments: args.attachments } : {}),
      },
      select: MESSAGE_SELECT,
    }),
  ]);
  // Клиенту — по живому потоку: чат перечитает переписку, не дожидаясь опроса.
  publishSupportToClient(thread, { kind: "message" });
  return { thread, message: toMessageDto(message) };
}

/**
 * Доставка ответа оператора организации: Telegram руководству и
 * колокольчик. Гость сайта увидит ответ в виджете сам (poll статуса).
 */
export async function deliverOperatorMessage(ctx: {
  thread: ThreadRow;
  message: MessageDto;
  operator: OperatorIdentity;
}): Promise<{ telegram: boolean; inApp: boolean }> {
  const result = { telegram: false, inApp: false };
  const orgId = ctx.thread.organizationId;
  if (!orgId || threadKindOf(ctx.thread.key) !== "org") return result;

  const label =
    ctx.operator.kind === "partner"
      ? `Сообщение от консультанта ${ctx.operator.name}`
      : "Ответ поддержки WeSetup";
  const preview = previewOf(ctx.message.body, ctx.message.attachments.length, 140);

  try {
    await notifyOrganization(
      orgId,
      composeOperatorReplyTelegram({
        operatorLabel: label,
        body: ctx.message.body || "📎 Вложение",
        escape: escapeTelegramHtml,
        appUrl: APP_URL,
      })
    );
    result.telegram = true;
  } catch (error) {
    console.error("[support-threads] org telegram failed:", error);
  }
  try {
    await notifyManagement({
      organizationId: orgId,
      kind: "support.reply",
      dedupeKey: `support.reply:${ctx.thread.id}`,
      title: label,
      linkHref: "/dashboard?support=chat",
      linkLabel: "Открыть чат",
      items: [{ id: ctx.message.id, label: preview || "📎 Вложение" }],
    });
    result.inApp = true;
  } catch (error) {
    console.error("[support-threads] in-app notification failed:", error);
  }
  return result;
}

/**
 * Тело реплики оператора из партнёрского кабинета или админки: текст до
 * лимита чата, вложения — только подписанные на этого же пользователя.
 */
export function parseOperatorInput(
  raw: unknown,
  uploaderKey: string
): { ok: true; body: string; attachments: SupportAttachmentMeta[] } | { ok: false; error: string } {
  const parsed = operatorInputSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Некорректное сообщение" };
  }
  const attachments = validateSignedAttachments(parsed.data.attachments, uploaderKey);
  if (attachments === null) {
    return { ok: false, error: "Вложения не прошли проверку — прикрепите файлы заново" };
  }
  if (parsed.data.message.length < SUPPORT_CHAT_MIN_LENGTH && attachments.length === 0) {
    return { ok: false, error: "Сообщение слишком короткое" };
  }
  return { ok: true, body: parsed.data.message, attachments };
}

const operatorInputSchema = z.object({
  message: z
    .string()
    .trim()
    .max(SUPPORT_CHAT_MAX_LENGTH, "Сообщение слишком длинное")
    .default(""),
  attachments: z.unknown().optional(),
});

/** Клиент открыл чат — непрочитанное гасим, лишнюю запись не делаем. */
export async function markReadByClient(threadId: string): Promise<void> {
  await db.supportThread.updateMany({
    where: { id: threadId, unreadForClient: { gt: 0 } },
    data: { unreadForClient: 0 },
  });
}

/** Последняя реплика ветки для endpoint'ов `/status`. */
export async function latestMessageOf(threadId: string) {
  const row = await db.supportMessage.findFirst({
    where: { threadId },
    orderBy: { createdAt: "desc" },
    select: MESSAGE_SELECT,
  });
  if (!row) return null;
  return {
    id: row.id,
    author: row.author === "operator" ? ("operator" as const) : ("client" as const),
    preview: previewOf(row.body, parseStoredAttachments(row.attachments).length),
    operatorName: row.operatorName,
    createdAt: row.createdAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Живые события чата (см. lib/live-events.ts): «сообщение» и «печатает»
// ---------------------------------------------------------------------------

type SupportLiveEvent = { kind: "message" | "typing"; data?: Record<string, unknown> };

let rootUserIdsCache: { at: number; ids: string[] } | null = null;
const ROOT_IDS_TTL_MS = 60_000;

async function listRootUserIds(): Promise<string[]> {
  if (rootUserIdsCache && Date.now() - rootUserIdsCache.at < ROOT_IDS_TTL_MS) {
    return rootUserIdsCache.ids;
  }
  const rows = await db.user.findMany({
    where: { isRoot: true, isActive: true },
    select: { id: true },
  });
  rootUserIdsCache = { at: Date.now(), ids: rows.map((row) => row.id) };
  return rootUserIdsCache.ids;
}

/**
 * Тем, кто отвечает: ROOT в админке и участникам партнёра, если ветка
 * партнёрская. Адресуем по userId, а не по организации: ROOT может в
 * этот момент смотреть чужую организацию (impersonate), и подписка его
 * вкладки числится за ней.
 */
export async function publishSupportToOperators(
  thread: Pick<ThreadRow, "id" | "organizationId">,
  event: SupportLiveEvent
): Promise<void> {
  const ids = new Set(await listRootUserIds());
  if (thread.organizationId) {
    const partner = await getActivePartnerForOrg(thread.organizationId).catch(() => null);
    if (partner) {
      const members = await db.partnerUser.findMany({
        where: { partnerId: partner.partnerId },
        select: { userId: true },
      });
      for (const member of members) ids.add(member.userId);
    }
  }
  publishToUsers(ids, {
    type: "support",
    kind: event.kind,
    data: { threadId: thread.id, ...(event.data ?? {}) },
  });
}

/**
 * Клиенту: всем вкладкам организации; legacy-ветка по userId — этому
 * человеку. Гость с сайта поток не открывает — ему остаётся опрос.
 */
export function publishSupportToClient(
  thread: Pick<ThreadRow, "id" | "key" | "organizationId">,
  event: SupportLiveEvent
): void {
  const payload = {
    type: "support" as const,
    kind: event.kind,
    data: { threadId: thread.id, ...(event.data ?? {}) },
  };
  const kind = threadKindOf(thread.key);
  if (kind === "org" && thread.organizationId) {
    publishToOrganization(thread.organizationId, payload);
  } else if (kind === "legacy") {
    publishToUser(thread.key, payload);
  }
}
