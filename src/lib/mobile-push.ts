import crypto from "node:crypto";

/**
 * Push в приложение WeSetup через Firebase Cloud Messaging HTTP v1.
 *
 * Ключ сервисного аккаунта Firebase — JSON целиком в переменной
 * `FIREBASE_SERVICE_ACCOUNT_JSON` на сервере. Без неё отправка молча
 * выключена: колокольчик, веб-push и Telegram работают как раньше.
 *
 * Как и веб-push (`web-push.ts`), это подсказка, а не бизнес-операция:
 * сбой Firebase не должен отменить или замедлить действие, из которого
 * push вызван. Поэтому вызывающий код зовёт `sendMobilePushInBackground`
 * — без await и с перехватом любых ошибок.
 *
 * `db` подключаем лениво: чистые функции ниже читают тесты без базы.
 */

type ServiceAccount = { project_id: string; client_email: string; private_key: string };

export type MobilePushMessage = {
  title: string;
  body: string;
  /** Куда вести по нажатию. Только свой адрес, см. `normalizePushUrl`. */
  url?: string | null;
  /**
   * Тег: уведомление с тем же тегом заменяет прежнее в шторке Android
   * и собирается в одну стопку на iOS.
   */
  tag?: string;
};

const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
/** Не держим запрос дольше этого, даже в фоне. */
const REQUEST_TIMEOUT_MS = 10_000;

function serviceAccount(): ServiceAccount | null {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) return null;
  try {
    const sa = JSON.parse(raw) as Partial<ServiceAccount>;
    if (!sa.project_id || !sa.client_email || !sa.private_key) return null;
    return {
      project_id: sa.project_id,
      client_email: sa.client_email,
      // В .env ключ иногда оказывается с буквальными `\n` вместо переносов.
      private_key: sa.private_key.replace(/\\n/g, "\n"),
    };
  } catch {
    console.error("[mobile-push] FIREBASE_SERVICE_ACCOUNT_JSON — не JSON");
    return null;
  }
}

export function isMobilePushConfigured(): boolean {
  return serviceAccount() !== null;
}

let cachedToken: { value: string; expiresAt: number; email: string } | null = null;
let pendingToken: Promise<string> | null = null;

/**
 * OAuth-токен Google по ключу сервисного аккаунта: подписанный RS256
 * JWT меняем на access token (grant `jwt-bearer`). Токен живёт час —
 * держим в памяти и обновляем за минуту до конца.
 */
async function accessToken(sa: ServiceAccount): Promise<string> {
  if (
    cachedToken &&
    cachedToken.email === sa.client_email &&
    cachedToken.expiresAt > Date.now() + 60_000
  ) {
    return cachedToken.value;
  }
  if (pendingToken) return pendingToken;
  pendingToken = (async () => {
    const now = Math.floor(Date.now() / 1000);
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({
      iss: sa.client_email,
      scope: FCM_SCOPE,
      aud: GOOGLE_TOKEN_URL,
      iat: now,
      exp: now + 3600,
    })}`;
    const signature = crypto
      .createSign("RSA-SHA256")
      .update(unsigned)
      .sign(sa.private_key)
      .toString("base64url");
    const res = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: `${unsigned}.${signature}`,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`[mobile-push] Google OAuth ${res.status}`);
    const json = (await res.json()) as { access_token: string; expires_in?: number };
    cachedToken = {
      value: json.access_token,
      expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
      email: sa.client_email,
    };
    return json.access_token;
  })();
  try {
    return await pendingToken;
  } finally {
    pendingToken = null;
  }
}

/** Свои адреса, кроме боевого домена: адрес этого сервера из окружения. */
function ownHostsFromEnv(): string[] {
  const hosts: string[] = [];
  for (const raw of [process.env.NEXTAUTH_URL, process.env.MINI_APP_BASE_URL]) {
    if (!raw) continue;
    try {
      hosts.push(new URL(raw).host.toLowerCase());
    } catch {
      /* битый адрес в окружении — просто не считаем его своим */
    }
  }
  return hosts;
}

/**
 * Ссылка из уведомления → путь внутри сайта.
 *
 * Абсолютный адрес своего домена превращаем в путь; чужой домен,
 * `//host`, `javascript:`, обработчики `/api/*` и прочее непонятное
 * ведём на главный экран `/mini` — оттуда сайт сам разведёт человека по
 * правам. Экран, куда у человека нет прав, тоже разруливает сайт (он
 * уводит на главный), а не приложение.
 */
export function normalizePushUrl(
  href: string | null | undefined,
  extraHosts: string[] = ownHostsFromEnv()
): string {
  const HOME = "/mini";
  if (!href) return HOME;
  let path = href.trim();
  if (!path) return HOME;
  if (/^https?:\/\//i.test(path)) {
    let url: URL;
    try {
      url = new URL(path);
    } catch {
      return HOME;
    }
    const own = new Set([
      "wesetup.ru",
      "www.wesetup.ru",
      ...extraHosts.map((host) => host.toLowerCase()),
    ]);
    if (!own.has(url.host.toLowerCase())) return HOME;
    path = `${url.pathname}${url.search}${url.hash}`;
  }
  // Управляющие символы и обратный слэш: `/\evil.example` браузер
  // понимает как `//evil.example`.
  if (/[\u0000-\u001f\\]/.test(path)) return HOME;
  if (!path.startsWith("/") || path.startsWith("//")) return HOME;
  const pathname = path.split(/[?#]/)[0];
  if (pathname === "/api" || pathname.startsWith("/api/")) return HOME;
  return path;
}

/**
 * Ключ устройства больше не действует — запись удаляем.
 *
 * По документации FCM: `UNREGISTERED` (приложение удалили, ключ истёк)
 * и `SENDER_ID_MISMATCH` (ключ другого проекта Firebase). Код
 * `INVALID_ARGUMENT` бывает и от ошибки в нашем же сообщении — тогда
 * стирать все телефоны нельзя; считаем ключ мёртвым, только если FCM
 * прямо жалуется на registration token.
 */
export function isDeadTokenError(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const err = (body as {
    error?: { status?: string; message?: string; details?: Array<{ errorCode?: string }> };
  }).error;
  if (!err || typeof err !== "object") return false;
  const codes = Array.isArray(err.details) ? err.details.map((d) => d?.errorCode) : [];
  if (codes.includes("UNREGISTERED") || codes.includes("SENDER_ID_MISMATCH")) return true;
  const invalidArgument =
    codes.includes("INVALID_ARGUMENT") || err.status === "INVALID_ARGUMENT";
  return invalidArgument && /registration token/i.test(err.message ?? "");
}

/** Текст сообщения бота (HTML Telegram) → короткий текст для шторки. */
export function pushTextFromTelegramHtml(html: string): string {
  const text = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/gi, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > 180 ? `${text.slice(0, 179)}…` : text;
}

export type FcmMessage = {
  token: string;
  notification: { title: string; body: string };
  data: { url: string };
  android: { priority: "high"; notification?: { tag: string } };
  apns: { payload: { aps: { sound: string; "thread-id"?: string } } };
};

/**
 * Тело `message` для `projects/{id}/messages:send`.
 *
 * Ссылка — в `data.url` (значения `data` в FCM только строки): по ней
 * приложение открывает экран при нажатии на уведомление.
 */
export function buildFcmMessage(token: string, msg: MobilePushMessage): FcmMessage {
  const tag = msg.tag?.trim();
  return {
    token,
    notification: { title: msg.title, body: msg.body },
    data: { url: normalizePushUrl(msg.url) },
    android: tag ? { priority: "high", notification: { tag } } : { priority: "high" },
    apns: {
      payload: { aps: tag ? { sound: "default", "thread-id": tag } : { sound: "default" } },
    },
  };
}

/** Окно, в котором копия сообщения бота молчит после push колокольчика. */
const BOT_AFTER_BELL_MS = 20_000;

/**
 * Одно событие часто рождает и уведомление в колокольчике, и личное
 * сообщение бота (запрос PIN, ответ на обращение). Push колокольчика
 * уже ушёл — второй, про то же самое, только будил бы человека дважды.
 */
export function shouldSkipBotPush(lastBellPushAt: number | undefined, now: number): boolean {
  return lastBellPushAt !== undefined && now - lastBellPushAt < BOT_AFTER_BELL_MS;
}

const lastBellPushAt = new Map<string, number>();

/**
 * Отправить push на все телефоны человека с включёнными уведомлениями.
 * Мёртвые ключи удаляет, остальным считает сбои. Бросает только при
 * сбое базы или авторизации в Google — из обычного кода зовите
 * `sendMobilePushInBackground`.
 */
export async function sendMobilePushToUser(
  userId: string,
  msg: MobilePushMessage
): Promise<{ sent: number; removed: number }> {
  const sa = serviceAccount();
  if (!sa) return { sent: 0, removed: 0 };
  const { db } = await import("@/lib/db");
  const devices = await db.mobileDevice.findMany({
    where: { userId, pushEnabled: true },
    select: { id: true, token: true },
  });
  if (devices.length === 0) return { sent: 0, removed: 0 };
  const bearer = await accessToken(sa);
  const endpoint = `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(sa.project_id)}/messages:send`;
  let sent = 0;
  let removed = 0;
  await Promise.all(
    devices.map(async (device) => {
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
          body: JSON.stringify({ message: buildFcmMessage(device.token, msg) }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        if (res.ok) {
          sent++;
          await db.mobileDevice
            .update({
              where: { id: device.id },
              data: { failureCount: 0, lastSeenAt: new Date() },
            })
            .catch(() => null);
          return;
        }
        const body = await res.json().catch(() => null);
        if (isDeadTokenError(body)) {
          removed++;
          await db.mobileDevice.delete({ where: { id: device.id } }).catch(() => null);
          return;
        }
        // Токен Google отозвали раньше срока — следующий вызов возьмёт новый.
        if (res.status === 401) cachedToken = null;
        console.error("[mobile-push] FCM", res.status, JSON.stringify(body)?.slice(0, 300));
      } catch (error) {
        console.error("[mobile-push] FCM request failed", error);
      }
      await db.mobileDevice
        .update({ where: { id: device.id }, data: { failureCount: { increment: 1 } } })
        .catch(() => null);
    })
  );
  return { sent, removed };
}

/**
 * Push в фоне: не ждём и не бросаем. `source` — откуда событие:
 * `bell` — уведомление колокольчика, `bot` — копия личного сообщения
 * бота (см. `shouldSkipBotPush`).
 */
export function sendMobilePushInBackground(
  userId: string,
  msg: MobilePushMessage,
  source: "bell" | "bot"
): void {
  if (!isMobilePushConfigured()) return;
  const now = Date.now();
  if (source === "bell") {
    lastBellPushAt.set(userId, now);
    // Память не растёт бесконечно: старые отметки больше не нужны.
    if (lastBellPushAt.size > 5000) {
      for (const [id, at] of lastBellPushAt) {
        if (now - at >= BOT_AFTER_BELL_MS) lastBellPushAt.delete(id);
      }
    }
  } else if (shouldSkipBotPush(lastBellPushAt.get(userId), now)) {
    return;
  }
  void sendMobilePushToUser(userId, msg).catch((error) =>
    console.error("[mobile-push] send failed", error)
  );
}
