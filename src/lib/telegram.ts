import { Bot, InputFile } from "grammy";
import { isUrgentKind, parseQuietHours, quietUntil } from "@/lib/quiet-hours";

import { createTelegramFetch } from "@/lib/telegram-fetch";
import { Agent, ProxyAgent, setGlobalDispatcher } from "undici";
import crypto from "node:crypto";
import { escapeHtml } from "@/lib/html-escape";
import {
  DEFERRED_STATUS,
  flushDeferredDeliveries,
  PUSH_ONLY_STATUS,
  routeEmployeeDelivery,
  shouldSkipTelegramDelivery,
  type TelegramDeliveryMetadata,
  type TelegramDeliveryPolicyOptions,
} from "@/lib/telegram-delivery-policy";
import { buildTelegramWebAppKeyboard } from "@/lib/telegram-web-app";
import { getDbRoleValuesWithLegacy, MANAGEMENT_ROLES } from "@/lib/user-roles";

// Initialize bot (only if token is set).
//
// `TELEGRAM_API_ROOT` — optional reverse proxy URL for regions where the
// primary api.telegram.org is fully blocked (Cloudflare Worker, self-hosted
// tdlib/telegram-bot-api, etc). Forwarded to grammy as apiRoot.
//
// `TELEGRAM_FORCE_IP` — IPv4 that still routes to Telegram's API edge when
// DNS returns a blocked IP (e.g. Roskomnadzor selectively nulls some of
// 149.154.160.0/20 but leaves 149.154.167.220 reachable). We install an
// undici Agent that overrides only api.telegram.org's DNS lookup; TLS SNI
// stays "api.telegram.org", so the certificate still validates.
const token = process.env.TELEGRAM_BOT_TOKEN;
const apiRoot = process.env.TELEGRAM_API_ROOT?.replace(/\/+$/, "") || undefined;
const forceIp = process.env.TELEGRAM_FORCE_IP?.trim() || undefined;
// Keep this proxy scoped to Telegram requests; other integrations stay direct.
const proxyUrl = process.env.TELEGRAM_PROXY_URL?.trim() || undefined;
const proxyAgent = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;

// Grammy doesn't forward undici's `dispatcher` option through its
// baseFetchConfig. setGlobalDispatcher is the only reliable way to hook
// into Node's global fetch used by grammy. It affects every fetch() call in
// the process, but the lookup override only fires for hostname ===
// "api.telegram.org"; all other hostnames fall back to system DNS unchanged.
if (forceIp && !proxyAgent) {
  setGlobalDispatcher(
    new Agent({
      connect: {
        lookup: ((
          hostname: string,
          options: object,
          callback: (
            err: NodeJS.ErrnoException | null,
            addresses: { address: string; family: number }[]
          ) => void
        ) => {
          if (hostname === "api.telegram.org") {
            callback(null, [{ address: forceIp, family: 4 }]);
            return;
          }
          import("node:dns").then(({ lookup }) => {
            lookup(hostname, { ...options, all: true }, callback);
          });
        }) as unknown as undefined,
      },
    })
  );
}

// grammY uses its own fetch; configure the same scoped transport for all calls.
const tgFetch = forceIp || proxyAgent ? createTelegramFetch(proxyAgent) : undefined;

const bot = token
  ? new Bot(token, {
      client: {
        ...(apiRoot ? { apiRoot } : {}),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...(tgFetch ? { fetch: tgFetch as any } : {}),
      },
    })
  : null;

/**
 * Escape user-provided text before interpolating into a Telegram HTML message.
 * Telegram `parse_mode: "HTML"` supports <b>, <i>, <a>, <code>, <pre> — any
 * other `<` / `>` / `&` in user data must be escaped, otherwise attackers can
 * inject phishing <a href> links, forged tags or break message parsing.
 *
 * Re-exported for use in API routes that build Telegram message bodies.
 */
export const escapeTelegramHtml = escapeHtml;

/**
 * Personalize Telegram-сообщение — заменяет {name}, {timeOfDay},
 * {dayOfWeek}, {greeting} в тексте на реальные значения. Не трогает
 * текст без placeholder'ов. Снижает reminder fatigue: «Иван, утренняя
 * гигиена» вместо генерического «у вас задача».
 *
 * Placeholder'ы:
 *  • `{name}` — первое слово из `ctx.name`, HTML-escape'нуто (parse_mode
 *    HTML); если имя пустое — слово «сотрудник».
 *  • `{timeOfDay}` — «ночью» / «утром» / «днём» / «вечером».
 *  • `{dayOfWeek}` — название дня недели в винительном падеже («понедельник»,
 *    «среду», «пятницу»…). Подходит для «в {dayOfWeek}».
 *  • `{greeting}` — корректное приветствие по часу с правильным родом:
 *    «Доброе утро» / «Добрый день» / «Добрый вечер» / «Доброй ночи».
 *
 * Использование: callers могут просто включать {name} в template
 * и не думать о том как достать имя — notifyEmployee сделает за них.
 *
 * Вторым аргументом можно передать `now` — нужно для тестов с
 * детерминированным временем; в проде по умолчанию берётся `new Date()`.
 */
export function personalizeMessage(
  text: string,
  ctx: { name?: string | null; now?: Date }
): string {
  if (!text.includes("{")) return text;
  const now = ctx.now ?? new Date();
  const hour = now.getHours();
  const timeOfDay =
    hour < 6
      ? "ночью"
      : hour < 12
        ? "утром"
        : hour < 18
          ? "днём"
          : "вечером";
  const greeting =
    hour < 6
      ? "Доброй ночи"
      : hour < 12
        ? "Доброе утро"
        : hour < 18
          ? "Добрый день"
          : "Добрый вечер";
  const days = [
    "воскресенье",
    "понедельник",
    "вторник",
    "среду",
    "четверг",
    "пятницу",
    "субботу",
  ];
  const dayOfWeek = days[now.getDay()];
  const firstName = (ctx.name ?? "").trim().split(/\s+/)[0] ?? "";
  // HTML-escape only the user-provided field. Greeting/timeOfDay/dayOfWeek
  // are static literals and safe to interpolate without escaping.
  const safeName = escapeHtml(firstName || "сотрудник");
  return text
    .replace(/\{name\}/g, safeName)
    .replace(/\{timeOfDay\}/g, timeOfDay)
    .replace(/\{dayOfWeek\}/g, dayOfWeek)
    .replace(/\{greeting\}/g, greeting);
}

const MAX_RETRIES = 3;
const RETRY_HARD_CAP_SECONDS = 30;

type GrammyRetryError = {
  error_code?: number;
  parameters?: { retry_after?: number };
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractRetryAfterSeconds(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const candidate = error as GrammyRetryError;
  if (candidate.error_code !== 429) return null;
  const ra = candidate.parameters?.retry_after;
  if (typeof ra !== "number" || !Number.isFinite(ra) || ra <= 0) return null;
  return Math.min(ra, RETRY_HARD_CAP_SECONDS);
}

/**
 * Признак временного сбоя, который стоит повторить.
 *
 * Сеть до api.telegram.org рвётся регулярно — grammy отдаёт HttpError
 * «Network request for 'sendMessage' failed!». Раньше повтор делался
 * ТОЛЬКО при 429, и такое сообщение терялось с первой попытки: на проде
 * так пропадало каждое третье админ-уведомление, включая сообщения из
 * онлайн-чата. 5xx на стороне Telegram — та же история.
 */
export function isTransientTelegramError(error: unknown): boolean {
  const code = extractErrorCode(error);
  if (typeof code === "number") return code >= 500;
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  return /network|fetch failed|socket|timeout|ECONN|EAI_AGAIN|ETIMEDOUT/i.test(
    message
  );
}

/**
 * Пауза перед следующей попыткой, мс. `null` — повторять не нужно.
 *
 * 429 уважает `retry_after` Telegram'а, временный сбой — экспонента
 * 1с → 2с → 4с. Дальше `MAX_RETRIES` всё равно оборвёт.
 */
export function retryDelayMs(error: unknown, attempt: number): number | null {
  const retryAfter = extractRetryAfterSeconds(error);
  if (retryAfter !== null) return retryAfter * 1000;
  if (isTransientTelegramError(error)) {
    return Math.min(2 ** (attempt - 1) * 1000, RETRY_HARD_CAP_SECONDS * 1000);
  }
  return null;
}

function extractErrorCode(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const candidate = error as GrammyRetryError;
  return typeof candidate.error_code === "number" ? candidate.error_code : null;
}

/**
 * Structured-log helper для observability. PM2 / journalctl / Loki легко
 * фильтрует по тегу `tag=tg-send` и парсит JSON, в отличие от free-form
 * `console.error`. Расширение TelegramLog в БД (latencyMs, retryCount,
 * errorCode отдельные колонки) требует schema migration, поэтому пока
 * структурируем только лог-выход — этого достаточно для диагностики
 * 429/5xx без cross-thread coordination.
 */
function logTelegramSend(payload: {
  level: "info" | "warn" | "error";
  outcome: "sent" | "rate_limited" | "failed";
  logId: string;
  attempts: number;
  latencyMs: number;
  errorCode: number | null;
  errorMessage: string | null;
}): void {
  const fn =
    payload.level === "error"
      ? console.error
      : payload.level === "warn"
        ? console.warn
        : console.log;
  fn(
    JSON.stringify({
      tag: "tg-send",
      ts: new Date().toISOString(),
      ...payload,
    })
  );
}

/**
 * Execute a Telegram API send with retry logic and log update.
 * DRY helper used by sendTelegramMessage, notifyEmployee, etc.
 */
async function executeTelegramSend(
  logId: string,
  sendFn: () => Promise<unknown>,
  errorLabel: string
): Promise<boolean> {
  const { db } = await import("./db");
  let attempt = 0;
  let lastError: unknown = null;
  const startedAt = Date.now();

  while (attempt < MAX_RETRIES) {
    attempt += 1;
    try {
      await sendFn();
      await db.telegramLog.update({
        where: { id: logId },
        data: { status: "sent", attempts: attempt, sentAt: new Date() },
      });
      logTelegramSend({
        level: "info",
        outcome: "sent",
        logId,
        attempts: attempt,
        latencyMs: Date.now() - startedAt,
        errorCode: null,
        errorMessage: null,
      });
      return true;
    } catch (error) {
      lastError = error;
      const delay = retryDelayMs(error, attempt);
      if (delay === null || attempt >= MAX_RETRIES) break;
      await sleep(delay);
    }
  }

  const rateLimited = extractRetryAfterSeconds(lastError) !== null;
  const errorText =
    lastError instanceof Error
      ? lastError.message
      : typeof lastError === "string"
        ? lastError
        : JSON.stringify(lastError);
  await db.telegramLog.update({
    where: { id: logId },
    data: {
      status: rateLimited ? "rate_limited" : "failed",
      error: errorText?.slice(0, 500) ?? "unknown",
      attempts: attempt,
    },
  });
  logTelegramSend({
    level: "error",
    outcome: rateLimited ? "rate_limited" : "failed",
    logId,
    attempts: attempt,
    latencyMs: Date.now() - startedAt,
    errorCode: extractErrorCode(lastError),
    errorMessage: errorText?.slice(0, 300) ?? null,
  });
  console.error(`${errorLabel}:`, lastError);
  return false;
}

type TelegramSendOptions = {
  userId?: string | null;
  delivery?: TelegramDeliveryMetadata | null;
  policy?: TelegramDeliveryPolicyOptions;
  /**
   * Optional inline keyboard — typically a `web_app` button produced by
   * `buildTelegramWebAppKeyboard()` so the message opens the Mini App
   * inside Telegram instead of an external browser.
   */
  reply_markup?: unknown;
};

function normalizeTelegramDeliveryMetadata(
  delivery: TelegramDeliveryMetadata | null | undefined
): {
  organizationId: string | null;
  kind: string | null;
  dedupeKey: string | null;
} {
  const organizationId = delivery?.organizationId?.trim();
  const kind = delivery?.kind?.trim();
  const dedupeKey = delivery?.dedupeKey?.trim();

  return {
    organizationId: organizationId || null,
    kind: kind || null,
    dedupeKey: dedupeKey || null,
  };
}

async function shouldSkipTelegramSendOnRerun(
  opts: TelegramSendOptions | undefined
): Promise<boolean> {
  if (!opts?.policy?.skipOnRerun) {
    return false;
  }

  return shouldSkipTelegramDelivery({
    userId: opts.userId ?? null,
    delivery: opts.delivery,
    now: opts.policy.now,
    lookbackMs: opts.policy.lookbackMs,
  });
}

/**
 * Send a Telegram message and log every attempt to TelegramLog.
 *
 * Retry policy: on HTTP 429 we honour Telegram's `retry_after` (capped at
 * 30s) up to 3 attempts. Other errors are logged as `failed` immediately.
 * Persistent 429s end as `rate_limited`. Caller context (userId) is
 * optional — cron jobs that fan out to many users pass it so the log is
 * per-user.
 *
 * Возвращает true, если сообщение реально ушло. Служебные уведомления
 * (`notifyPlatformAdmin`, обратная связь) по этому флагу проставляют
 * статус доставки; старые fire-and-forget вызовы просто игнорируют
 * результат — сигнатура для них совместима.
 */
export async function sendTelegramMessage(
  chatId: string,
  text: string,
  opts?: TelegramSendOptions
): Promise<boolean> {
  const { db } = await import("./db");
  if (await shouldSkipTelegramSendOnRerun(opts)) {
    return false;
  }
  const delivery = normalizeTelegramDeliveryMetadata(opts?.delivery);
  // Тихие часы: не-срочное для конкретного человека откладываем до конца окна.
  if (opts?.userId && !isUrgentKind(delivery.kind)) {
    const until = await quietUntilForUser(opts.userId);
    if (until) {
      await db.telegramLog.create({
        data: { chatId, body: text, userId: opts.userId, organizationId: delivery.organizationId, kind: delivery.kind, dedupeKey: delivery.dedupeKey, status: "deferred", deliverAfter: until, attempts: 0 },
      });
      return false;
    }
  }
  const log = await db.telegramLog.create({
    data: {
      chatId,
      body: text,
      userId: opts?.userId ?? null,
      organizationId: delivery.organizationId,
      kind: delivery.kind,
      dedupeKey: delivery.dedupeKey,
      status: "queued",
      attempts: 0,
    },
  });

  if (!bot) {
    await db.telegramLog.update({
      where: { id: log.id },
      data: { status: "failed", error: "bot not configured" },
    });
    return false;
  }

  return executeTelegramSend(
    log.id,
    () =>
      bot.api.sendMessage(chatId, text, {
        parse_mode: "HTML",
        ...(opts?.reply_markup
          ? {
              reply_markup: opts.reply_markup as Parameters<
                typeof bot.api.sendMessage
              >[2] extends { reply_markup?: infer T }
                ? T
                : never,
            }
          : {}),
      }),
    "Telegram send error"
  );
}

/**
 * Отправка файла (фото/документа) в чат — вложения поддержки.
 *
 * Файл читается с локального диска (`InputFile`), а не по URL: Telegram
 * скачивает URL-фото только до 5 МБ, а наш лимит вложений — 50 МБ, что
 * совпадает с потолком upload'а Bot API. Той же retry/TelegramLog-механикой,
 * что и сообщения: в логе видно queued/sent/failed.
 */
export async function sendTelegramAttachment(
  chatId: string,
  args: {
    filePath: string;
    filename: string;
    mimeType: string;
    /** HTML-caption (уже экранированный вызывающим). */
    caption?: string;
  },
  opts?: TelegramSendOptions
): Promise<boolean> {
  const { db } = await import("./db");
  const delivery = normalizeTelegramDeliveryMetadata(opts?.delivery);
  const log = await db.telegramLog.create({
    data: {
      chatId,
      body: `[attachment] ${args.filename}${args.caption ? `\n${args.caption}` : ""}`,
      userId: opts?.userId ?? null,
      organizationId: delivery.organizationId,
      kind: delivery.kind,
      dedupeKey: delivery.dedupeKey,
      status: "queued",
      attempts: 0,
    },
  });

  if (!bot) {
    await db.telegramLog.update({
      where: { id: log.id },
      data: { status: "failed", error: "bot not configured" },
    });
    return false;
  }

  const input = new InputFile(args.filePath, args.filename);
  const isPhoto =
    args.mimeType.startsWith("image/") &&
    // Telegram сжимает photo и не принимает слишком большие; gif/heic —
    // документом, чтобы не потерять оригинал.
    ["image/jpeg", "image/png", "image/webp"].includes(args.mimeType);

  return executeTelegramSend(
    log.id,
    () =>
      isPhoto
        ? bot.api.sendPhoto(chatId, input, {
            caption: args.caption,
            parse_mode: "HTML",
          })
        : bot.api.sendDocument(chatId, input, {
            caption: args.caption,
            parse_mode: "HTML",
          }),
    "Telegram attachment send error"
  );
}

export type NotificationType = "temperature" | "deviations" | "compliance" | "expiry";

/**
 * DM a specific employee with an optional Mini App button.
 *
 * Unlike `notifyOrganization` (which fans out to management roles on
 * temperature/deviation events), this one is targeted: cron jobs use it
 * for per-worker morning digests and per-worker pre-deadline reminders.
 * Returns silently if the user has no `telegramChatId` on file — callers
 * aren't expected to filter the list themselves.
 */
export async function notifyEmployee(
  userId: string,
  text: string,
  action?: { label: string; miniAppUrl: string },
  opts?: Omit<TelegramSendOptions, "userId"> & {
    /**
     * Если true — добавляем inline-кнопку «🔕 Отложить 1ч» рядом с
     * web_app кнопкой действия. Пользователь нажмёт → callback handler
     * `notif:snooze:60` запишет `notificationPrefs.snoozedUntil = now+60м`.
     * Все последующие notifyEmployee'ы для этого пользователя в окне
     * snooze будут молча пропущены (skipBecauseSnoozed). Используется
     * на cron-push'ах (mini-digest, shift-watcher) — для срочных
     * сообщений (нарушение температуры, инцидент) snooze не предлагаем.
     */
    addSnoozeButton?: boolean;
    /**
     * Если true — добавляем inline-кнопку «🔄 Обновить» с callback_data
     * `digest:refresh`. Пользователь нажмёт → handler пересчитывает
     * текущий список open-obligations и edit'ит исходное сообщение.
     * Полезно для mini-digest: после заполнения журнала повар видит
     * обновлённый список (одной задачей меньше) не открывая Mini App.
     */
    addRefreshButton?: boolean;
    /**
     * false — не слать push в приложение WeSetup. Передают там, где то же
     * событие уже создаёт уведомление в колокольчике этому человеку
     * (`upsertNotification` сам шлёт push): одно событие — один push.
     */
    appPush?: boolean;
  }
): Promise<void> {
  const { db } = await import("./db");
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      telegramChatId: true,
      isActive: true,
      notificationPrefs: true,
    },
  });
  if (!user || !user.isActive) {
    return;
  }
  // Без Telegram человеку может прийти только push в приложение WeSetup.
  // Если и его отправить некуда — дальше делать нечего.
  const { isMobilePushConfigured } = await import("./mobile-push");
  if (!user.telegramChatId && (opts?.appPush === false || !isMobilePushConfigured())) {
    return;
  }

  // Проверяем активный snooze. notificationPrefs — JSON, может содержать
  // snoozedUntil как ISO-строку или null/undefined. Если timestamp в
  // будущем — скипаем send (тихо, без логов: это ожидаемое поведение,
  // не ошибка).
  const prefs = (user.notificationPrefs ?? null) as
    | { snoozedUntil?: string | number | null }
    | null;
  const snoozedUntilRaw = prefs?.snoozedUntil ?? null;
  if (snoozedUntilRaw) {
    const snoozedUntil = new Date(snoozedUntilRaw);
    if (Number.isFinite(snoozedUntil.getTime()) && snoozedUntil > new Date()) {
      return;
    }
  }

  // Persoналиize: подставляем {name}, {timeOfDay}, {dayOfWeek},
  // {greeting} в text. Callers могут пропустить — без placeholder'ов
  // helper ничего не делает.
  text = personalizeMessage(text, {
    name: user.name,
    now: opts?.policy?.now,
  });

  if (
    await shouldSkipTelegramSendOnRerun({
      userId: user.id,
      delivery: opts?.delivery,
      policy: opts?.policy,
    })
  ) {
    return;
  }

  const delivery = normalizeTelegramDeliveryMetadata(opts?.delivery);
  const quietUntilAt = isUrgentKind(delivery.kind) ? null : await quietUntilForUser(user.id);

  // Тот же текст — push в приложение WeSetup (в фоне, без ожидания).
  // После проверок «активен», snooze и повтора, но до проверки Telegram:
  // сотрудник без Telegram тоже должен узнать о задаче. В тихие часы
  // ночью не будим ни push, ни Telegram: обе доставки откладываются
  // строками `deferred` и уходят утром (`sendDeferredTelegramLogs`).
  const route = await routeEmployeeDelivery({
    userId: user.id,
    telegramChatId: user.telegramChatId,
    text,
    url: action?.miniAppUrl ?? null,
    appPush: opts?.appPush,
    quietUntilAt,
    delivery: opts?.delivery,
    policy: opts?.policy,
  });
  if (route.telegram !== "send" || !user.telegramChatId) {
    return;
  }
  const log = await db.telegramLog.create({
    data: {
      chatId: user.telegramChatId,
      body: text,
      userId: user.id,
      organizationId: delivery.organizationId,
      kind: delivery.kind,
      dedupeKey: delivery.dedupeKey,
      status: "queued",
      attempts: 0,
    },
  });

  if (!bot) {
    await db.telegramLog.update({
      where: { id: log.id },
      data: { status: "failed", error: "bot not configured" },
    });
    return;
  }

  // Если caller просит snooze-кнопку — комбинируем web_app + callback в
  // одной inline-keyboard. buildTelegramWebAppKeyboard возвращает
  // структуру { inline_keyboard: [[{text, web_app:{url}}]] }; мы её
  // расширяем второй строкой `notif:snooze:60`.
  const replyMarkup = ((): unknown | undefined => {
    if (!action && !opts?.addSnoozeButton && !opts?.addRefreshButton) {
      return undefined;
    }
    const rows: Array<Array<Record<string, unknown>>> = [];
    if (action) {
      rows.push([
        { text: action.label, web_app: { url: action.miniAppUrl } },
      ]);
    }
    // Refresh + Snooze в одной строке, чтобы не плодить высокие
    // keyboard'ы. Refresh — primary positive action; Snooze — soft.
    const utilityRow: Array<Record<string, unknown>> = [];
    if (opts?.addRefreshButton) {
      utilityRow.push({
        text: "🔄 Обновить",
        callback_data: "digest:refresh",
      });
    }
    if (opts?.addSnoozeButton) {
      utilityRow.push({
        text: "🔕 Отложить на 1 час",
        callback_data: "notif:snooze:60",
      });
    }
    if (utilityRow.length > 0) rows.push(utilityRow);
    return { inline_keyboard: rows };
  })();

  type SendMessageReplyMarkup = Parameters<
    typeof bot.api.sendMessage
  >[2] extends { reply_markup?: infer T }
    ? T
    : never;

  await executeTelegramSend(
    log.id,
    () =>
      bot.api.sendMessage(user.telegramChatId!, text, {
        parse_mode: "HTML",
        ...(replyMarkup
          ? { reply_markup: replyMarkup as SendMessageReplyMarkup }
          : {}),
      }),
    "Telegram employee notification error"
  );
}

/**
 * Send a direct deep-link invite message to an already linked Telegram chat.
 *
 * Used when a manager requests a rebind for an employee who already has
 * `telegramChatId`: the employee gets the same fresh invite link in Telegram
 * itself, in addition to the in-app site notification.
 */
export async function sendTelegramInviteLinkMessage(args: {
  chatId: string;
  userId: string;
  employeeName: string;
  inviteUrl: string;
  delivery?: TelegramDeliveryMetadata | null;
  policy?: TelegramDeliveryPolicyOptions;
}): Promise<void> {
  const { db } = await import("./db");
  const text = [
    `Руководитель обновил привязку Telegram для сотрудника ${escapeTelegramHtml(args.employeeName)}.`,
    "Откройте кнопку ниже, чтобы подтвердить перепривязку.",
  ].join("\n\n");

  if (
    await shouldSkipTelegramSendOnRerun({
      userId: args.userId,
      delivery: args.delivery,
      policy: args.policy,
    })
  ) {
    return;
  }

  const delivery = normalizeTelegramDeliveryMetadata(args.delivery);
  const log = await db.telegramLog.create({
    data: {
      chatId: args.chatId,
      body: text,
      userId: args.userId,
      organizationId: delivery.organizationId,
      kind: delivery.kind,
      dedupeKey: delivery.dedupeKey,
      status: "queued",
      attempts: 0,
    },
  });

  if (!bot) {
    await db.telegramLog.update({
      where: { id: log.id },
      data: { status: "failed", error: "bot not configured" },
    });
    return;
  }

  const replyMarkup = {
    inline_keyboard: [
      [
        {
          text: "Перепривязать Telegram",
          url: args.inviteUrl,
        },
      ],
    ],
  };

  await executeTelegramSend(
    log.id,
    () =>
      bot.api.sendMessage(args.chatId, text, {
        parse_mode: "HTML",
        reply_markup: replyMarkup,
      }),
    "Telegram invite link message error"
  );
}

// Send notification to all owners/technologists of an organization
export async function notifyOrganization(
  organizationId: string,
  message: string,
  roles: string[] = ["owner", "technologist"],
  type?: NotificationType,
  action?: { label: string; miniAppUrl: string },
  opts?: {
    /**
     * false — без push в приложение: то же событие уже создаёт
     * уведомление в колокольчике руководителям (`notifyManagement`),
     * и push уходит оттуда. Одно событие — один push.
     */
    appPush?: boolean;
  }
): Promise<void> {
  // Import db here to avoid circular deps
  const { db } = await import("./db");
  const { telegramConsultantFooter } = await import("./partners/branding");

  const dbRoles =
    roles[0] === "owner" || roles[0] === "manager"
      ? getDbRoleValuesWithLegacy(MANAGEMENT_ROLES)
      : roles;

  // White-label: у клиентов партнёра под уведомлением руководству стоит
  // подпись «Ваш консультант: <бренд>, <контакт>». Пустая строка, если
  // партнёра нет или клиент скрыл брендинг.
  const consultantFooter = await telegramConsultantFooter(organizationId);

  const mobilePush = await import("./mobile-push");
  // Push в приложение: руководитель, который пользуется только
  // приложением, без Telegram, тоже должен узнать о тревоге. Сводки и
  // отчёты push'ем не шлём — правило в `organizationAlertPush`.
  const alertPush =
    opts?.appPush !== false && mobilePush.isMobilePushConfigured()
      ? mobilePush.organizationAlertPush(message, type)
      : null;

  const users = await db.user.findMany({
    where: {
      organizationId,
      role: { in: dbRoles },
      ...(alertPush
        ? {
            OR: [
              { telegramChatId: { not: null } },
              { mobileDevices: { some: { pushEnabled: true } } },
            ],
          }
        : { telegramChatId: { not: null } }),
      isActive: true,
    },
    select: {
      id: true,
      name: true,
      telegramChatId: true,
      notificationPrefs: true,
    },
  });

  // Filter by notification preference if type is specified
  const filtered = type
    ? users.filter((u) => {
        if (!u.notificationPrefs) return true; // null = all enabled
        const prefs = u.notificationPrefs as Record<string, boolean>;
        return prefs[type] !== false;
      })
    : users;

  const replyMarkup = action
    ? buildTelegramWebAppKeyboard({
        label: action.label,
        url: action.miniAppUrl,
      })
    : undefined;

  if (alertPush) {
    // Как в notifyEmployee: «Отложить» глушит и push; в тихие часы
    // push молчит, кроме срочного (температура, отклонения — см.
    // `isUrgentKind`). Где то же событие шлёт push колокольчика,
    // вызывающий передаёт `appPush: false`.
    const now = new Date();
    const urgent = isUrgentKind(type ?? null);
    await Promise.allSettled(
      filtered.map(async (u) => {
        if (mobilePush.isNotificationSnoozed(u.notificationPrefs, now)) return;
        if (!urgent && (await quietUntilForUser(u.id))) return;
        const personal = mobilePush.organizationAlertPush(
          personalizeMessage(message, { name: u.name }),
          type
        );
        if (!personal) return;
        mobilePush.sendMobilePushInBackground(
          u.id,
          { ...personal, url: action?.miniAppUrl ?? null },
          "bot"
        );
      })
    );
  }

  await Promise.allSettled(
    filtered
      .filter((u) => u.telegramChatId)
      .map((u) =>
        // Persoналиize per-user: каждый менеджер видит своё имя и
        // приветствие. Без placeholder'ов в `message` — `personalizeMessage`
        // отдаёт текст без изменений, так что callers без шаблонов
        // не страдают.
        sendTelegramMessage(
          u.telegramChatId!,
          personalizeMessage(message, { name: u.name }) + consultantFooter,
          {
            userId: u.id ?? null,
            reply_markup: replyMarkup,
          }
        )
      )
  );
}

// --- Telegram account link tokens ---
//
// Tokens are issued when a user visits /settings/notifications. They encode
// { userId, exp } and are signed with HMAC-SHA256 so that only our server
// can produce a valid token. Tokens expire after 15 minutes, preventing
// hijack via leaked browser history, screen sharing or log capture.

const LINK_TOKEN_TTL_MS = 15 * 60 * 1000;

function getLinkTokenSecret(): string {
  // Prefer a dedicated secret; fall back to NEXTAUTH_SECRET which is always
  // required in production (see auth.ts).
  const secret =
    process.env.TELEGRAM_LINK_TOKEN_SECRET ||
    process.env.TELEGRAM_WEBHOOK_SECRET ||
    process.env.NEXTAUTH_SECRET;
  if (!secret) {
    throw new Error(
      "Telegram link token secret is not configured (set TELEGRAM_LINK_TOKEN_SECRET or NEXTAUTH_SECRET)"
    );
  }
  return secret;
}

function hmacBase64Url(payload: string): string {
  return crypto
    .createHmac("sha256", getLinkTokenSecret())
    .update(payload)
    .digest("base64url");
}

export function generateLinkToken(userId: string): string {
  const exp = Date.now() + LINK_TOKEN_TTL_MS;
  const payload = `${userId}:${exp}`;
  const sig = hmacBase64Url(payload);
  return Buffer.from(`${payload}:${sig}`).toString("base64url");
}

export function parseLinkToken(
  token: string
): { userId: string } | null {
  try {
    const decoded = Buffer.from(token, "base64url").toString("utf8");
    const idx1 = decoded.indexOf(":");
    const idx2 = decoded.indexOf(":", idx1 + 1);
    if (idx1 < 0 || idx2 < 0) return null;

    const userId = decoded.slice(0, idx1);
    const expStr = decoded.slice(idx1 + 1, idx2);
    const sig = decoded.slice(idx2 + 1);
    if (!userId || !expStr || !sig) return null;

    const exp = Number(expStr);
    if (!Number.isFinite(exp) || Date.now() > exp) return null;

    const expected = hmacBase64Url(`${userId}:${expStr}`);
    const sigBuf = Buffer.from(sig, "base64url");
    const expectedBuf = Buffer.from(expected, "base64url");
    if (sigBuf.length !== expectedBuf.length) return null;
    if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;

    return { userId };
  } catch {
    return null;
  }
}

/** Конец тихих часов для пользователя (по его настройкам и поясу организации), null — не тихо. */
async function quietUntilForUser(userId: string): Promise<Date | null> {
  const { db } = await import("./db");
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { notificationPrefs: true, organization: { select: { timezone: true } } },
  });
  if (!user) return null;
  const prefs = (user.notificationPrefs ?? null) as { quietHours?: unknown } | null;
  const quiet = parseQuietHours(prefs?.quietHours);
  if (!quiet) return null;
  return quietUntil(new Date(), user.organization?.timezone ?? "Europe/Moscow", quiet);
}

/**
 * Крон: отправить отложенные тихими часами сообщения, чьё время пришло.
 * Строка с `chatId` уходит в Telegram; с пустым `chatId` — это push в
 * приложение WeSetup (сотрудник без Telegram или push к отложенному
 * сообщению бота), правила — в `flushDeferredDeliveries`.
 */
export async function sendDeferredTelegramLogs(now: Date = new Date()): Promise<{ sent: number; failed: number }> {
  const { db } = await import("./db");
  const { sendMobilePushInBackground } = await import("./mobile-push");
  return flushDeferredDeliveries(now, {
    findDue: (dueBy) =>
      db.telegramLog.findMany({
        where: { status: DEFERRED_STATUS, deliverAfter: { lte: dueBy } },
        orderBy: { deliverAfter: "asc" },
        take: 100,
        select: { id: true, chatId: true, body: true, userId: true },
      }),
    async sendTelegram(log) {
      if (!bot) {
        await db.telegramLog.update({ where: { id: log.id }, data: { status: "failed", error: "bot not configured" } });
        return false;
      }
      return executeTelegramSend(log.id, () => bot.api.sendMessage(log.chatId, log.body, { parse_mode: "HTML" }), "deferred");
    },
    startPush: (userId, msg) => sendMobilePushInBackground(userId, msg, "bot"),
    async markPushed(id, at) {
      await db.telegramLog.update({ where: { id }, data: { status: PUSH_ONLY_STATUS, sentAt: at } });
    },
    async markFailed(id, error) {
      await db.telegramLog.update({ where: { id }, data: { status: "failed", error } });
    },
  });
}
