import {
  isMobilePushConfigured,
  pushTextFromTelegramHtml,
  sendMobilePushInBackground,
} from "./mobile-push";

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
 * Этот же статус получает отложенный тихими часами push (`deferred` с
 * пустым `chatId`), когда утром он отправлен.
 */
export const PUSH_ONLY_STATUS = "push_only";

/**
 * Отложено тихими часами (`deliverAfter`). Утром уйдёт — повтор крона
 * ночью не должен откладывать ту же доставку второй раз.
 */
export const DEFERRED_STATUS = "deferred";

const RERUN_SKIP_STATUSES = [
  "queued",
  "sent",
  "rate_limited",
  PUSH_ONLY_STATUS,
  DEFERRED_STATUS,
] as const;

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

/**
 * Отложенная тихими часами строка TelegramLog.
 *
 * `chatId` пустой — это push в приложение WeSetup, а не сообщение в
 * Telegram: сотрудник без Telegram (или push к сообщению бота, которое
 * отложено отдельной строкой) получит его утром.
 */
export type DeferredDeliveryRow = {
  chatId: string;
  body: string;
  userId: string;
  organizationId: string | null;
  kind: string | null;
  dedupeKey: string | null;
  status: typeof DEFERRED_STATUS;
  deliverAfter: Date;
};

export type AppPushMessage = { title: string; body: string; url: string | null };

type EmployeeDeliveryDeps = PushOnlyDeliveryDeps & {
  isPushConfigured: () => boolean;
  /** Начать push в фоне; true — отправка действительно начата. */
  startPush: (userId: string, msg: AppPushMessage) => boolean;
  createDeferred: (row: DeferredDeliveryRow) => Promise<void>;
};

function defaultEmployeeDeliveryDeps(): EmployeeDeliveryDeps {
  return {
    ...defaultPushOnlyDeps(),
    isPushConfigured: isMobilePushConfigured,
    startPush: (userId, msg) => sendMobilePushInBackground(userId, msg, "bot"),
    async createDeferred(row) {
      const { db } = await import("./db");
      await db.telegramLog.create({ data: { ...row, attempts: 0 } });
    },
  };
}

export type EmployeeDeliveryOutcome = {
  /** sent — push начат; deferred — записан на утро; skipped — push нет. */
  push: "sent" | "deferred" | "skipped";
  /** send — отправить в Telegram сейчас; deferred — отложено; none — Telegram нет. */
  telegram: "send" | "deferred" | "none";
};

/**
 * Каналы личного сообщения сотруднику (`notifyEmployee`) после проверок
 * «активен», snooze и повтора крона.
 *
 * Днём: push в приложение (если `appPush` не выключен) и Telegram. Без
 * Telegram начатый push записывается строкой `push_only` для проверки
 * повтора — только если он действительно начат.
 *
 * В тихие часы (`quietUntilAt`) ночью ничего не будит: Telegram
 * откладывается строкой `deferred` с `chatId`, push — отдельной строкой
 * `deferred` с пустым `chatId`, если push есть куда отправить (Firebase
 * настроен и у человека есть телефон с включёнными уведомлениями).
 * Утром `flushDeferredDeliveries` отправит обе. Без обоих каналов строк
 * нет.
 *
 * `appPush: false` — событие уже прислало push колокольчика этому же
 * человеку; второй push про то же самое не нужен.
 */
export async function routeEmployeeDelivery(
  args: {
    userId: string;
    telegramChatId: string | null;
    /** Текст сообщения бота (HTML Telegram). */
    text: string;
    url?: string | null;
    appPush?: boolean;
    quietUntilAt: Date | null;
    delivery?: TelegramDeliveryMetadata | null;
    policy?: TelegramDeliveryPolicyOptions;
  },
  overrides?: Partial<EmployeeDeliveryDeps>
): Promise<EmployeeDeliveryOutcome> {
  const deps = { ...defaultEmployeeDeliveryDeps(), ...overrides };
  const pushBody = args.appPush === false ? "" : pushTextFromTelegramHtml(args.text);
  const meta = {
    organizationId: normalizeNullableText(args.delivery?.organizationId),
    kind: normalizeNullableText(args.delivery?.kind),
    dedupeKey: normalizeNullableText(args.delivery?.dedupeKey),
  };

  if (args.quietUntilAt) {
    let push: EmployeeDeliveryOutcome["push"] = "skipped";
    if (pushBody && deps.isPushConfigured() && (await deps.hasPushDevice(args.userId))) {
      await deps.createDeferred({
        chatId: "",
        body: args.text,
        userId: args.userId,
        ...meta,
        status: DEFERRED_STATUS,
        deliverAfter: args.quietUntilAt,
      });
      push = "deferred";
    }
    let telegram: EmployeeDeliveryOutcome["telegram"] = "none";
    if (args.telegramChatId) {
      await deps.createDeferred({
        chatId: args.telegramChatId,
        body: args.text,
        userId: args.userId,
        ...meta,
        status: DEFERRED_STATUS,
        deliverAfter: args.quietUntilAt,
      });
      telegram = "deferred";
    }
    return { push, telegram };
  }

  let push: EmployeeDeliveryOutcome["push"] = "skipped";
  if (pushBody && deps.startPush(args.userId, { title: "WeSetup", body: pushBody, url: args.url ?? null })) {
    push = "sent";
    if (!args.telegramChatId) {
      // Без Telegram строки в TelegramLog нет, и повтор крона с
      // `skipOnRerun` прислал бы тот же push снова.
      await recordPushOnlyDelivery(
        {
          userId: args.userId,
          hasTelegram: false,
          body: args.text,
          delivery: args.delivery,
          policy: args.policy,
        },
        { hasPushDevice: deps.hasPushDevice, recordPushOnly: deps.recordPushOnly }
      ).catch((error) => console.error("[telegram] push_only log failed", error));
    }
  }
  return { push, telegram: args.telegramChatId ? "send" : "none" };
}

export type DueDeferredRow = { id: string; chatId: string; body: string; userId: string | null };

export type FlushDeferredDeps = {
  findDue: (now: Date) => Promise<DueDeferredRow[]>;
  /** Отправить в Telegram и отметить строку (как обычная отправка). */
  sendTelegram: (row: DueDeferredRow) => Promise<boolean>;
  startPush: (userId: string, msg: AppPushMessage) => boolean;
  markPushed: (id: string, at: Date) => Promise<void>;
  markFailed: (id: string, error: string) => Promise<void>;
};

/**
 * Утро после тихих часов: отправить отложенные строки, чьё время пришло.
 * С `chatId` — в Telegram, как раньше. С пустым `chatId` — push в
 * приложение; строка становится `push_only` (её видит проверка повтора)
 * или `failed`, если push не начат.
 */
export async function flushDeferredDeliveries(
  now: Date,
  deps: FlushDeferredDeps
): Promise<{ sent: number; failed: number }> {
  const due = await deps.findDue(now);
  let sent = 0;
  let failed = 0;
  for (const row of due) {
    if (row.chatId) {
      if (await deps.sendTelegram(row)) sent += 1;
      else failed += 1;
      continue;
    }
    const body = pushTextFromTelegramHtml(row.body);
    const started =
      Boolean(row.userId && body) &&
      deps.startPush(row.userId as string, { title: "WeSetup", body, url: null });
    if (started) {
      await deps.markPushed(row.id, now);
      sent += 1;
    } else {
      await deps.markFailed(row.id, "push not sent");
      failed += 1;
    }
  }
  return { sent, failed };
}
