import { db } from "@/lib/db";
import { LOGIN_METHOD_LABEL, describeUserAgent, deviceKey, maskIp, type LoginMethod } from "@/lib/login-device";
import { FORMAT_LOCALES, type Locale } from "@/i18n/locales";

/**
 * Отметка о входе: IP и время последнего логина на пользователе плюс
 * строка в журнале входов (`LoginEvent`) — для страницы «Безопасность»
 * и для письма о входе с нового устройства.
 *
 * Вызывается из всех точек входа (свой /api/auth/login, NextAuth
 * credentials, Telegram, вход по телефону, QR, мгновенная регистрация).
 * Ошибка записи НИКОГДА не должна ронять сам вход — упавший апдейт
 * стоит одной неточной строки, а брошенное исключение стоит человеку
 * доступа к кабинету.
 */
export const LOGIN_HISTORY_KEEP = 200;

export async function recordLogin(
  userId: string,
  ip: string | null,
  context: { userAgent?: string | null; method?: LoginMethod } = {},
  at: Date = new Date(),
): Promise<void> {
  try {
    await db.user.update({
      where: { id: userId },
      data: { lastLoginIp: ip, lastLoginAt: at },
    });
  } catch (error) {
    console.error("recordLogin failed", error);
  }
  try {
    const key = deviceKey(context.userAgent);
    const [seenBefore, everLoggedIn] = await Promise.all([
      db.loginEvent.findFirst({ where: { userId, deviceKey: key }, select: { id: true } }),
      db.loginEvent.findFirst({ where: { userId }, select: { id: true } }),
    ]);
    // Первый вход вообще — устройство новое по определению, но письмо
    // «вход с нового устройства» человек, который только что вошёл,
    // сочтёт спамом. Новизна считается только после первого входа.
    const isNewDevice = !seenBefore && Boolean(everLoggedIn);
    await db.loginEvent.create({
      data: {
        userId,
        at,
        ip,
        userAgent: context.userAgent?.slice(0, 500) ?? null,
        device: describeUserAgent(context.userAgent),
        deviceKey: key,
        method: context.method ?? "password",
        isNewDevice,
      },
    });
    if (isNewDevice) {
      void notifyNewDevice(userId, { at, ip, userAgent: context.userAgent ?? null, method: context.method ?? "password" }).catch(
        (error) => console.error("[login-trace] new-device notify failed", error)
      );
    }
  } catch (error) {
    console.error("recordLogin event failed", error);
  }
}

/** Письмо и Telegram — best-effort, после ответа на вход. */
async function notifyNewDevice(
  userId: string,
  login: { at: Date; ip: string | null; userAgent: string | null; method: LoginMethod }
): Promise<void> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { email: true, name: true, telegramChatId: true, organizationId: true, locale: true },
  });
  if (!user) return;
  const device = describeUserAgent(login.userAgent);
  const locale: Locale = user.locale === "en" || user.locale === "uz" ? user.locale : "ru";
  const when = new Intl.DateTimeFormat(FORMAT_LOCALES[locale], {
    timeZone: "Europe/Moscow",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(login.at);
  const [{ sendNewDeviceLoginEmail }, { notifyEmployee }] = await Promise.all([
    import("@/lib/email"),
    import("@/lib/telegram"),
  ]);
  if (user.email && !user.email.endsWith(".local")) {
    await sendNewDeviceLoginEmail({
      to: user.email,
      name: user.name,
      when,
      device,
      ip: maskIp(login.ip),
      method: login.method,
      organizationId: user.organizationId,
      locale,
    }).catch((error) => console.error("[login-trace] email failed", error));
  }
  if (user.telegramChatId) {
    await notifyEmployee(
      userId,
      [
        "🔐 Вход в WeSetup с нового устройства",
        `${device} · ${when} МСК · IP ${maskIp(login.ip)}`,
        `Способ: ${LOGIN_METHOD_LABEL[login.method]}.`,
        "Это не вы? Откройте «Настройки → Безопасность» и нажмите «Завершить все сессии», затем смените пароль.",
      ].join("\n")
    ).catch((error) => console.error("[login-trace] telegram failed", error));
  }
}
