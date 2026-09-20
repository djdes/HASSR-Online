/**
 * Простой in-memory rate-limit. Для production-нагрузок (несколько
 * нод) нужен Redis, но пока WeSetup — single-PM2-процесс, in-memory
 * хватает.
 *
 * Использование:
 *   const rl = createRateLimiter({ tokensPerInterval: 10, intervalMs: 60_000 });
 *   if (!rl.consume(key)) → 429
 *
 * Счётчики автоматически очищаются — каждые `intervalMs * 2` ms старые
 * ключи удаляются (sweep при доступе).
 */

type Bucket = {
  tokens: number;
  resetAt: number;
};

export type RateLimiter = {
  /** Возвращает true если запрос разрешён, иначе false. */
  consume(key: string): boolean;
  /** Вернуть попытку: успешное действие не должно съедать лимит. */
  refund(key: string): void;
  /** Сколько секунд до сброса счётчика. */
  remainingMs(key: string): number;
};

export function createRateLimiter(opts: {
  tokensPerInterval: number;
  intervalMs: number;
}): RateLimiter {
  const buckets = new Map<string, Bucket>();

  function sweep(now: number) {
    // Дёшево — пробежать раз в N запросов и удалить устаревшие.
    if (buckets.size < 1000) return;
    for (const [k, b] of buckets) {
      if (b.resetAt < now) buckets.delete(k);
    }
  }

  return {
    consume(key: string): boolean {
      const now = Date.now();
      sweep(now);
      let b = buckets.get(key);
      if (!b || b.resetAt < now) {
        b = { tokens: opts.tokensPerInterval, resetAt: now + opts.intervalMs };
        buckets.set(key, b);
      }
      if (b.tokens <= 0) return false;
      b.tokens -= 1;
      return true;
    },
    refund(key: string): void {
      const b = buckets.get(key);
      if (!b || b.resetAt < Date.now()) return;
      b.tokens = Math.min(opts.tokensPerInterval, b.tokens + 1);
    },
    remainingMs(key: string): number {
      const b = buckets.get(key);
      if (!b) return 0;
      return Math.max(0, b.resetAt - Date.now());
    },
  };
}

/** Singletons для основных endpoints. Создаются раз на инстанс. */
export const aiChatRateLimiter = createRateLimiter({
  tokensPerInterval: 10,
  intervalMs: 60_000,
});

export const aiHeavyRateLimiter = createRateLimiter({
  tokensPerInterval: 5,
  intervalMs: 60_000,
});

/**
 * Ввод показаний по QR без входа (`/room-fill`, `/equipment-fill`): 30
 * записей в минуту на пару «адрес + объект». Смене хватает с запасом, а
 * утёкшая ссылка не превращается в поток мусорных строк.
 */
export const qrFillRateLimiter = createRateLimiter({
  tokensPerInterval: 30,
  intervalMs: 60_000,
});

export const loginRateLimiter = createRateLimiter({
  // 5 попыток за 5 минут на IP — защита от brute-force.
  tokensPerInterval: 5,
  intervalMs: 5 * 60 * 1000,
});

/**
 * Защита от flood'а Telegram-webhook'а. Telegram retry'ит неудачные
 * webhook'и агрессивно (до ~24h, экспоненциально), и если бот случайно
 * упал и ответил 5xx, мы можем получить тысячи retry'ев в минуту.
 * Также защищает от атак: кто-то узнал URL webhook'а и DDOS'ит.
 *
 * 60 запросов в минуту с одного source-IP — достаточно для нормального
 * Telegram ingestion (даже у активной организации update rate < 10/sec),
 * но обрезает любой flood.
 */
export const telegramWebhookRateLimiter = createRateLimiter({
  tokensPerInterval: 60,
  intervalMs: 60_000,
});

/**
 * Защита от disk-fill DoS в /api/mini/attachments. Любой авторизованный
 * сотрудник мог бы pump'ить 5MB-файлы пока сервер не упрётся в место.
 * 60 загрузок в день на пользователя — щедро для нормальной работы
 * (повар обычно делает 5-15 photo-evidence за смену), но обрезает
 * флуд.
 */
export const miniAttachmentRateLimiter = createRateLimiter({
  tokensPerInterval: 60,
  intervalMs: 24 * 60 * 60 * 1000,
});

/**
 * Вложения поддержки (чат с оператором + обратная связь). Файлы до 50 МБ,
 * поэтому лимит жёстче журнальных фото: 30 загрузок в час на отправителя
 * (userId или guest-id) — живому человеку хватает с запасом, disk-fill
 * флуд обрезается. Для гостей дополнительно действует лимит по IP в
 * самом маршруте.
 */
export const supportUploadRateLimiter = createRateLimiter({
  tokensPerInterval: 30,
  intervalMs: 60 * 60 * 1000,
});

/**
 * Защита от флуда bot-callback'ов. Кто-то жмёт «следующая страница»
 * 100 раз/сек или autoclicker'ом флудит «Отложить» — каждый callback
 * запускает DB-resolve. 30 callback/min на пару (chatId, prefix) —
 * щедро для нормального UX (нужно чтобы заведующая могла быстро
 * пролистать список 30 шаблонов), но обрезает abuse.
 */
export const botCallbackRateLimiter = createRateLimiter({
  tokensPerInterval: 30,
  intervalMs: 60_000,
});

/**
 * Произвольные сообщения боту («поддержка»). Каждое создаёт строку в
 * FeedbackReport и дёргает Telegram + SMTP админа, поэтому без лимита
 * один спамер забивает и таблицу, и почту владельца.
 *
 * 5 сообщений в минуту на отправителя: живой человек за раз пишет
 * один-два абзаца и ждёт ответа, а флудер упирается в потолок сразу.
 */
export const botSupportRateLimiter = createRateLimiter({
  tokensPerInterval: 5,
  intervalMs: 60_000,
});

/**
 * Bulk-assign-today фан-аут: тяжёлая операция, синхронно дёргает TF
 * API десятки раз. 3 запуска / 5 минут на org достаточно для штатного
 * использования; защита от случайного двойного клика и от CSRF-loop'а.
 */
export const bulkAssignRateLimiter = createRateLimiter({
  tokensPerInterval: 3,
  intervalMs: 5 * 60 * 1000,
});

/**
 * Опасные действия: удаление документов, пересоздание, full cleanup.
 * 2 раза в час на org — этого достаточно для нормального workflow,
 * блокирует случайный двойной запуск и автоматизированный wipe.
 */
export const destructiveOpsRateLimiter = createRateLimiter({
  tokensPerInterval: 2,
  intervalMs: 60 * 60 * 1000,
});

/**
 * /api/auth/register/request — отправка email-кода. Без лимита
 * атакующий может (1) DoS'ить наш SMTP-провайдер, (2) спамить
 * жертв письмами с кодом, (3) раздуть таблицу EmailVerification.
 *
 * 5 запросов / 10 минут на IP — нормальному пользователю хватит на
 * 2-3 retry'я если первый код потерялся. Боту не хватит для спама.
 */
/**
 * Публичные образцы журналов. Роут без сессии и генерирует PDF/DOCX —
 * то есть тратит CPU на каждый запрос. 20 файлов в минуту с одного
 * адреса хватает живому человеку и не даёт скачивать их пачкой в цикле.
 */
export const journalSampleRateLimiter = createRateLimiter({
  tokensPerInterval: 20,
  intervalMs: 60_000,
});

/**
 * Заявки на платные услуги. Форма на /uslugi открыта без авторизации,
 * поэтому лимит жёсткий: три заявки в десять минут на IP. Живому
 * клиенту хватает одной, а спамеру этого мало, чтобы завалить админский
 * Telegram.
 */
export const serviceRequestRateLimiter = createRateLimiter({
  tokensPerInterval: 3,
  intervalMs: 10 * 60 * 1000,
});

export const registrationCodeRateLimiter = createRateLimiter({
  tokensPerInterval: 5,
  intervalMs: 10 * 60 * 1000,
});

/**
 * /api/auth/register/confirm — попытка ввода 6-значного кода. В
 * EmailVerification.attempts стоит counter ≤5, но он non-atomic
 * (read-then-update) — concurrent POST'ы могли проскочить. Плюс
 * каждая попытка тянет bcrypt-сравнение ~70мс — атакующий
 * параллельно прогревает CPU. Per-IP лимит закрывает обе дыры.
 *
 * 10 попыток / 5 минут / IP — у легитимного юзера хватит на пару
 * мисспрингов кода, бот не успеет перебрать 6-значное пространство
 * (1M комбинаций / 10 = 100K * 5 мин = недели).
 */
export const registrationConfirmRateLimiter = createRateLimiter({
  tokensPerInterval: 10,
  intervalMs: 5 * 60 * 1000,
});

/**
 * Public ИНН-lookup через DaData. Нашему DaData-аккаунту даёт 10K
 * запросов/день. Без rate-limit'а атакующий может заскриптовать loop
 * и за час съесть всю квоту → wizard регистрации новых компаний
 * перестаёт работать у legitimate юзеров.
 *
 * 30 запросов / минуту с одного IP — типичному юзеру хватит для
 * нескольких ИНН в wizard'е, бот за минуту съест 30 а не 30к.
 */
export const innLookupRateLimiter = createRateLimiter({
  tokensPerInterval: 30,
  intervalMs: 60 * 1000,
});

/** Ответы оператора в онлайн-чат (партнёр, ROOT): по userId. */
export const supportOperatorLimiter = createRateLimiter({
  tokensPerInterval: 60,
  intervalMs: 10 * 60_000,
});

/** Рассылка ROOT «всем организациям»: не чаще раза в 10 минут. */
export const supportBroadcastLimiter = createRateLimiter({
  tokensPerInterval: 1,
  intervalMs: 10 * 60_000,
});
