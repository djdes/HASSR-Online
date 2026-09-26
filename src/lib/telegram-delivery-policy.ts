export type TelegramDeliveryMetadata = {
  organizationId?: string | null;
  kind?: string | null;
  dedupeKey?: string | null;
};

export type TelegramDeliveryPolicyOptions = {
  skipOnRerun?: boolean;
  now?: Date;
  lookbackMs?: number;
};

type TelegramDeliveryLookupArgs = {
  userId: string;
  organizationId: string | null;
  allowLegacyOrganizationlessMatch: boolean;
  kind: string;
  dedupeKey: string;
  since: Date;
  statuses: string[];
};

type TelegramDeliveryPolicyDeps = {
  findRecentDelivery: (
    args: TelegramDeliveryLookupArgs
  ) => Promise<{ id: string } | null>;
};

const DEFAULT_LOOKBACK_MS = 36 * 60 * 60 * 1000;

/**
 * Статус строки TelegramLog «сообщение ушло только push в приложение».
 *
 * У сотрудника без Telegram строки лога не было, и повтор крона с
 * `skipOnRerun` не видел прошлой доставки — push уходил снова и снова.
 * Такая строка пишется с пустым `chatId`; отправщики Telegram её не
 * берут (отложенные ищут только `deferred`), в Telegram она не уходит.
 */
export const PUSH_ONLY_STATUS = "push_only";

const RERUN_SKIP_STATUSES = ["queued", "sent", "rate_limited", PUSH_ONLY_STATUS] as const;

function normalizeNullableText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed || null;
}

function normalizeDeliveryMetadata(
  delivery: TelegramDeliveryMetadata | null | undefined
): { organizationId: string | null; kind: string; dedupeKey: string } | null {
  const organizationId = normalizeNullableText(delivery?.organizationId);
  const kind = normalizeNullableText(delivery?.kind);
  const dedupeKey = normalizeNullableText(delivery?.dedupeKey);

  if (!kind || !dedupeKey) {
    return null;
  }

  return { organizationId, kind, dedupeKey };
}

function defaultDeps(): TelegramDeliveryPolicyDeps {
  return {
    async findRecentDelivery(args) {
      const { db } = await import("./db");
      return db.telegramLog.findFirst({
        where: {
          userId: args.userId,
          ...(args.organizationId
            ? {
                OR: [
                  { organizationId: args.organizationId },
                  ...(args.allowLegacyOrganizationlessMatch
                    ? [{ organizationId: null }]
                    : []),
                ],
              }
            : {}),
          kind: args.kind,
          dedupeKey: args.dedupeKey,
          status: { in: args.statuses },
          createdAt: { gte: args.since },
        },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
    },
  };
}

export async function shouldSkipTelegramDelivery(
  args: {
    userId?: string | null;
    delivery?: TelegramDeliveryMetadata | null;
    now?: Date;
    lookbackMs?: number;
  },
  overrides?: Partial<TelegramDeliveryPolicyDeps>
): Promise<boolean> {
  const userId = normalizeNullableText(args.userId);
  const delivery = normalizeDeliveryMetadata(args.delivery);

  if (!userId || !delivery) {
    return false;
  }

  const now = args.now ?? new Date();
  const lookbackMs = args.lookbackMs ?? DEFAULT_LOOKBACK_MS;
  const deps = { ...defaultDeps(), ...overrides };
  const existing = await deps.findRecentDelivery({
    userId,
    organizationId: delivery.organizationId,
    allowLegacyOrganizationlessMatch: delivery.organizationId !== null,
    kind: delivery.kind,
    dedupeKey: delivery.dedupeKey,
    since: new Date(now.getTime() - lookbackMs),
    statuses: [...RERUN_SKIP_STATUSES],
  });

  return Boolean(existing);
}

export type PushOnlyDeliveryRow = {
  userId: string;
  organizationId: string | null;
  kind: string;
  dedupeKey: string;
  body: string;
  status: typeof PUSH_ONLY_STATUS;
};

type PushOnlyDeliveryDeps = {
  /** Есть ли у человека телефон с включёнными уведомлениями. */
  hasPushDevice: (userId: string) => Promise<boolean>;
  recordPushOnly: (row: PushOnlyDeliveryRow) => Promise<void>;
};

function defaultPushOnlyDeps(): PushOnlyDeliveryDeps {
  return {
    async hasPushDevice(userId) {
      const { db } = await import("./db");
      const device = await db.mobileDevice.findFirst({
        where: { userId, pushEnabled: true },
        select: { id: true },
      });
      return Boolean(device);
    },
    async recordPushOnly(row) {
      const { db } = await import("./db");
      await db.telegramLog.create({
        data: {
          chatId: "",
          body: row.body,
          userId: row.userId,
          organizationId: row.organizationId,
          kind: row.kind,
          dedupeKey: row.dedupeKey,
          status: row.status,
          attempts: 0,
          sentAt: new Date(),
        },
      });
    },
  };
}

/**
 * Записать, что сообщение ушло только push'ем, — для проверки повтора.
 *
 * Пишем, только когда запись кому-то нужна: у человека нет Telegram
 * (иначе строку пишет сама отправка в Telegram), вызов просит
 * \`skipOnRerun\` и несёт \`kind\` + \`dedupeKey\`, и push было куда
 * отправить. Возвращает true, если строка записана.
 */
export async function recordPushOnlyDelivery(
  args: {
    userId: string;
    hasTelegram: boolean;
    body: string;
    delivery?: TelegramDeliveryMetadata | null;
    policy?: TelegramDeliveryPolicyOptions;
  },
  overrides?: Partial<PushOnlyDeliveryDeps>
): Promise<boolean> {
  if (args.hasTelegram || !args.policy?.skipOnRerun) return false;
  const userId = normalizeNullableText(args.userId);
  const delivery = normalizeDeliveryMetadata(args.delivery);
  if (!userId || !delivery) return false;
  const deps = { ...defaultPushOnlyDeps(), ...overrides };
  if (!(await deps.hasPushDevice(userId))) return false;
  await deps.recordPushOnly({
    userId,
    organizationId: delivery.organizationId,
    kind: delivery.kind,
    dedupeKey: delivery.dedupeKey,
    body: args.body,
    status: PUSH_ONLY_STATUS,
  });
  return true;
}
