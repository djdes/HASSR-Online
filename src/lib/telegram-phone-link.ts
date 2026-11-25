import type { VerifiedUser } from "@/lib/credentials";
import { db } from "@/lib/db";
import { normalizePhone } from "@/lib/phone";

export type LinkTelegramByPhoneResult =
  | { ok: true; status: "linked" | "already_linked"; user: VerifiedUser }
  | {
      ok: false;
      status:
        | "invalid_phone"
        | "not_found"
        | "ambiguous"
        | "telegram_already_linked_other"
        | "user_already_linked_other_tg";
    };

export type PhoneLinkDb = {
  user: {
    findFirst: (args: unknown) => Promise<VerifiedUser | null>;
    findMany: (args: unknown) => Promise<VerifiedUser[]>;
    update: (args: unknown) => Promise<unknown>;
  };
};

/**
 * Link a Telegram chat ID to an active, non-archived user matched by a
 * Telegram-verified phone number.
 *
 * Refuses ambiguous multi-user phone matches and never silently hijacks a
 * Telegram chat ID or user record bound to another account.
 */
export async function linkTelegramByVerifiedPhone(
  args: { chatId: string; rawPhone: string },
  client: PhoneLinkDb = db as unknown as PhoneLinkDb
): Promise<LinkTelegramByPhoneResult> {
  const normalized = normalizePhone(args.rawPhone);
  if (!normalized) {
    return { ok: false, status: "invalid_phone" };
  }

  const existingByChat = await client.user.findFirst({
    where: {
      telegramChatId: args.chatId,
      isActive: true,
      archivedAt: null,
    },
    include: { organization: true },
  });

  const candidates = await client.user.findMany({
    where: {
      phone: normalized,
      isActive: true,
      archivedAt: null,
    },
    include: { organization: true },
    take: 5,
  });

  if (candidates.length === 0) {
    return { ok: false, status: "not_found" };
  }

  if (candidates.length > 1) {
    if (existingByChat && candidates.some((c) => c.id === existingByChat.id)) {
      return { ok: true, status: "already_linked", user: existingByChat };
    }
    return { ok: false, status: "ambiguous" };
  }

  const candidate = candidates[0];
  if (existingByChat && existingByChat.id !== candidate.id) {
    return { ok: false, status: "telegram_already_linked_other" };
  }
  if (candidate.telegramChatId && candidate.telegramChatId !== args.chatId) {
    return { ok: false, status: "user_already_linked_other_tg" };
  }
  if (candidate.telegramChatId === args.chatId) {
    return { ok: true, status: "already_linked", user: candidate };
  }

  await client.user.update({
    where: { id: candidate.id },
    data: { telegramChatId: args.chatId },
  });

  return {
    ok: true,
    status: "linked",
    user: { ...candidate, telegramChatId: args.chatId },
  };
}

export type LinkTelegramToAuthUserResult =
  | {
      ok: true;
      status: "linked" | "already_linked";
      phoneSaved?: string | null;
    }
  | {
      ok: false;
      status: "not_found" | "conflict" | "user_already_linked_other_tg";
    };

export type AuthLinkUserRecord = {
  id: string;
  organizationId: string;
  telegramChatId: string | null;
  phone: string | null;
};

export type AuthLinkDb = {
  user: {
    findFirst: (args: unknown) => Promise<{ id: string } | null>;
    findUnique: (args: unknown) => Promise<AuthLinkUserRecord | null>;
    update: (args: unknown) => Promise<unknown>;
  };
};

/**
 * Link a verified Telegram chat ID to an already-authenticated user.
 * Optionally persists a verified phone number when the user has no phone set
 * and no other non-archived user in the same organization uses that number.
 */
export async function linkTelegramToAuthenticatedUser(
  args: { userId: string; chatId: string; verifiedPhone?: string },
  client: AuthLinkDb = db as unknown as AuthLinkDb
): Promise<LinkTelegramToAuthUserResult> {
  const collision = await client.user.findFirst({
    where: {
      telegramChatId: args.chatId,
      id: { not: args.userId },
    },
    select: { id: true },
  });
  if (collision) {
    return { ok: false, status: "conflict" };
  }

  const user = await client.user.findUnique({
    where: { id: args.userId },
    select: {
      id: true,
      organizationId: true,
      telegramChatId: true,
      phone: true,
    },
  });
  if (!user) {
    return { ok: false, status: "not_found" };
  }

  if (user.telegramChatId === args.chatId) {
    return { ok: true, status: "already_linked", phoneSaved: null };
  }
  if (user.telegramChatId && user.telegramChatId !== args.chatId) {
    return { ok: false, status: "user_already_linked_other_tg" };
  }

  let phoneSaved: string | null = null;
  const normalized = args.verifiedPhone
    ? normalizePhone(args.verifiedPhone)
    : null;
  if (normalized && !user.phone) {
    const phoneOwner = await client.user.findFirst({
      where: {
        organizationId: user.organizationId,
        phone: normalized,
        archivedAt: null,
        id: { not: user.id },
      },
      select: { id: true },
    });
    if (!phoneOwner) {
      phoneSaved = normalized;
    }
  }

  await client.user.update({
    where: { id: user.id },
    data: {
      telegramChatId: args.chatId,
      ...(phoneSaved ? { phone: phoneSaved } : {}),
    },
  });

  return { ok: true, status: "linked", phoneSaved };
}
