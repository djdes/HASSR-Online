/**
 * Телефоны с приложением WeSetup, куда уходят push (см. `mobile-push.ts`).
 *
 * Ключ устройства (`token`) выдаёт Firebase конкретной установке
 * приложения, и он уникален глобально. Вошёл на телефоне другой
 * сотрудник — запись переезжает на него: прошлый владелец телефона не
 * должен получать чужие задачи (так же устроена `WebPushSubscription`).
 *
 * `db` подключаем лениво: чистую проверку ввода читают тесты без базы.
 */

export type DevicePlatform = "ios" | "android";

/** Ключ Firebase: буквы, цифры и `_-:.`, обычно 150–250 символов. */
const TOKEN_RE = /^[A-Za-z0-9_\-:.]{20,4096}$/;

export function validateDeviceToken(
  raw: unknown
): { ok: true; token: string } | { ok: false; error: string } {
  const token = typeof raw === "string" ? raw.trim() : "";
  if (!TOKEN_RE.test(token)) {
    return { ok: false, error: "Некорректный ключ устройства" };
  }
  return { ok: true, token };
}

export function validateDeviceInput(
  body: unknown
):
  | { ok: true; token: string; platform: DevicePlatform }
  | { ok: false; error: string } {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "Пустой запрос" };
  }
  const { token, platform } = body as { token?: unknown; platform?: unknown };
  const checked = validateDeviceToken(token);
  if (!checked.ok) return checked;
  if (platform !== "ios" && platform !== "android") {
    return { ok: false, error: "Некорректная платформа" };
  }
  return { ok: true, token: checked.token, platform };
}

/** Регистрация или перенос устройства на вошедшего сотрудника (upsert по ключу). */
export async function registerMobileDevice(input: {
  userId: string;
  organizationId: string;
  token: string;
  platform: DevicePlatform;
  appVersion: string;
}): Promise<void> {
  const { db } = await import("@/lib/db");
  // Приложение повторяет регистрацию на каждом запуске — выключенный в
  // профиле переключатель при этом сохраняем. Сбрасываем его, только
  // когда телефон перешёл к другому человеку: его выбор был не про нас.
  const existing = await db.mobileDevice.findUnique({
    where: { token: input.token },
    select: { userId: true },
  });
  const movedToAnotherUser = existing !== null && existing.userId !== input.userId;
  await db.mobileDevice.upsert({
    where: { token: input.token },
    create: {
      userId: input.userId,
      organizationId: input.organizationId,
      token: input.token,
      platform: input.platform,
      appVersion: input.appVersion,
    },
    update: {
      userId: input.userId,
      organizationId: input.organizationId,
      platform: input.platform,
      appVersion: input.appVersion,
      failureCount: 0,
      lastSeenAt: new Date(),
      ...(movedToAnotherUser ? { pushEnabled: true } : {}),
    },
  });
}

/**
 * Отвязать устройство при выходе. Только своё: чужой ключ (телефон уже
 * переехал на другого) не трогаем.
 */
export async function removeMobileDevice(userId: string, token: string): Promise<number> {
  const { db } = await import("@/lib/db");
  const res = await db.mobileDevice.deleteMany({ where: { userId, token } });
  return res.count;
}
