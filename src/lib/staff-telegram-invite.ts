import { brandQrPngDataUrl } from "@/lib/brand-qr";
import { db } from "@/lib/db";
import {
  botInviteExpiresAt,
  generateBotInviteRaw,
  hashBotInviteToken,
} from "@/lib/bot-invite-tokens";
import { upsertNotification } from "@/lib/notifications";
import { sendTelegramInviteLinkMessage } from "@/lib/telegram";

export type StaffTelegramInviteMode = "invite" | "rebind";

type StaffInviteEmployee = {
  id: string;
  name: string;
  organizationId: string;
  archivedAt: Date | null;
  telegramChatId: string | null;
};

type NotificationPayload = {
  organizationId: string;
  userId: string;
  kind: string;
  dedupeKey: string;
  title: string;
  linkHref: string;
  linkLabel: string;
  items: Array<{ id: string; label: string; hint?: string }>;
};

type TelegramMessagePayload = {
  chatId: string;
  userId: string;
  employeeName: string;
  inviteUrl: string;
};

type StaffTelegramInviteDeps = {
  findEmployeeById: (args: {
    employeeId: string;
    organizationId: string;
  }) => Promise<StaffInviteEmployee | null>;
  replaceInviteToken: (args: {
    employeeId: string;
    organizationId: string;
  }) => Promise<{ rawToken: string; expiresAt: Date }>;
  makeQrDataUrl: (inviteUrl: string) => Promise<string>;
  upsertSiteNotification: (payload: NotificationPayload) => Promise<void>;
  hasRecentRebindTelegramMessage: (payload: {
    userId: string;
    chatId: string;
  }) => Promise<boolean>;
  sendTelegramDeepLinkMessage: (
    payload: TelegramMessagePayload
  ) => Promise<void>;
};

export class StaffTelegramInviteError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "StaffTelegramInviteError";
    this.status = status;
  }
}

export function buildTelegramBotChatUrl(botUsername: string): string {
  const username = botUsername.replace(/^@/, "").trim();
  if (!username) {
    throw new StaffTelegramInviteError(
      "TELEGRAM_BOT_USERNAME не настроен на сервере",
      500
    );
  }
  return `https://t.me/${username}`;
}

export function buildTelegramInviteUrl(
  botUsername: string,
  rawToken: string
): string {
  return `${buildTelegramBotChatUrl(botUsername)}?start=${encodeURIComponent(rawToken)}`;
}

function defaultDeps(): StaffTelegramInviteDeps {
  return {
    async findEmployeeById({ employeeId, organizationId }) {
      return db.user.findFirst({
        where: { id: employeeId, organizationId },
        select: {
          id: true,
          name: true,
          organizationId: true,
          archivedAt: true,
          telegramChatId: true,
        },
      });
    },
    async replaceInviteToken({ employeeId, organizationId }) {
      const rawToken = generateBotInviteRaw();
      const expiresAt = botInviteExpiresAt();
      const tokenHash = hashBotInviteToken(rawToken);

      await db.$transaction(async (tx) => {
        await tx.botInviteToken.deleteMany({ where: { userId: employeeId } });
        await tx.botInviteToken.create({
          data: {
            userId: employeeId,
            organizationId,
            tokenHash,
            expiresAt,
          },
        });
      });

      return { rawToken, expiresAt };
    },
    async makeQrDataUrl(inviteUrl) {
      // Фирменный QR; ×2 к размеру в окне (220 px) — чётко на ретине.
      return brandQrPngDataUrl(inviteUrl, { width: 440 });
    },
    async upsertSiteNotification(payload) {
      await upsertNotification(payload);
    },
    async hasRecentRebindTelegramMessage({ userId, chatId }) {
      const since = new Date(Date.now() - 15_000);
      const existing = await db.telegramLog.findFirst({
        where: {
          userId,
          chatId,
          createdAt: { gte: since },
          status: { in: ["queued", "sent", "rate_limited"] },
          body: { startsWith: "Руководитель обновил привязку Telegram" },
        },
        select: { id: true },
      });
      return Boolean(existing);
    },
    async sendTelegramDeepLinkMessage(payload) {
      await sendTelegramInviteLinkMessage({
        chatId: payload.chatId,
        userId: payload.userId,
        employeeName: payload.employeeName,
        inviteUrl: payload.inviteUrl,
      });
    },
  };
}

export async function issueStaffTelegramInvite(
  args: {
    employeeId: string;
    organizationId: string;
    mode: StaffTelegramInviteMode;
    botUsername: string;
  },
  overrides?: Partial<StaffTelegramInviteDeps>
) {
  const deps = { ...defaultDeps(), ...overrides };
  const target = await deps.findEmployeeById({
    employeeId: args.employeeId,
    organizationId: args.organizationId,
  });

  if (!target) {
    throw new StaffTelegramInviteError("Сотрудник не найден", 404);
  }
  if (target.archivedAt) {
    throw new StaffTelegramInviteError(
      "Нельзя пригласить архивного сотрудника",
      409
    );
  }

  const botUrl = buildTelegramBotChatUrl(args.botUsername);
  const { rawToken, expiresAt } = await deps.replaceInviteToken({
    employeeId: target.id,
    organizationId: args.organizationId,
  });
  const inviteUrl = buildTelegramInviteUrl(args.botUsername, rawToken);
  const qrPngDataUrl = await deps.makeQrDataUrl(inviteUrl);

  await deps.upsertSiteNotification({
    organizationId: args.organizationId,
    userId: target.id,
    kind: "staff.telegram-invite",
    dedupeKey: `staff.telegram-invite:${target.id}`,
    title:
      args.mode === "rebind"
        ? "Руководитель обновил привязку Telegram"
        : "Вам отправили приглашение в Telegram",
    linkHref: inviteUrl,
    linkLabel: "Открыть Telegram",
    items: [
      {
        id: target.id,
        label:
          args.mode === "rebind"
            ? "Откройте ссылку, чтобы перепривязать Telegram к аккаунту"
            : "Откройте ссылку, чтобы привязать Telegram к аккаунту",
        hint: "Ссылка действует 7 дней",
      },
    ],
  });

  if (args.mode === "rebind" && target.telegramChatId) {
    const hasRecentMessage = await deps.hasRecentRebindTelegramMessage({
      userId: target.id,
      chatId: target.telegramChatId,
    });
    if (!hasRecentMessage) {
      await deps.sendTelegramDeepLinkMessage({
        chatId: target.telegramChatId,
        userId: target.id,
        employeeName: target.name,
        inviteUrl,
      });
    }
  }

  return {
    user: {
      id: target.id,
      name: target.name,
      telegramLinked: Boolean(target.telegramChatId),
      botUrl,
    },
    inviteUrl,
    qrPngDataUrl,
    expiresAt: expiresAt.toISOString(),
  };
}
