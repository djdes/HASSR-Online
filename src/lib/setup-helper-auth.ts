import { db } from "@/lib/db";
import type { VerifiedUser } from "@/lib/credentials";
import { readBearerToken } from "@/lib/print-agent-auth";
import {
  generateHelperToken,
  hashHelperToken,
  helperAccessError,
  type HelperClientInfo,
} from "@/lib/setup-helper";

/**
 * Вход и ключи приложения «Сетап помощник».
 *
 * Схема та же, что у «Онлайн принтера»: почта и пароль один раз уходят на
 * сервер, в ответ — долгоживущий ключ. Телефон хранит его зашифрованным и
 * больше пароль не спрашивает, в том числе без интернета. Ключ открывает
 * только API приложения, а не весь кабинет, и отзывается с сайта.
 */

export type HelperLoginPayload = {
  token: string;
  deviceId: string;
  user: { name: string; email: string };
  organization: { name: string };
};

/**
 * Выдать ключ телефону. Плейнтекст ключа отдаётся ровно здесь и больше
 * нигде; в БД — только хеш.
 */
export async function issueHelperDevice(
  user: VerifiedUser,
  client: HelperClientInfo,
): Promise<HelperLoginPayload> {
  const raw = generateHelperToken();

  // Повторный вход на том же телефоне (выход был без сети или человек
  // переустановил приложение без очистки) не должен оставлять в списке
  // телефонов «призрака» с рабочим ключом.
  if (client.installationId) {
    await db.setupHelperDevice.updateMany({
      where: { userId: user.id, installationId: client.installationId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  const device = await db.setupHelperDevice.create({
    data: {
      organizationId: user.organizationId,
      userId: user.id,
      name: client.deviceName,
      tokenHash: hashHelperToken(raw),
      installationId: client.installationId,
      appVersion: client.appVersion,
      lastSeenAt: new Date(),
    },
    select: { id: true },
  });

  return {
    token: raw,
    deviceId: device.id,
    user: { name: user.name, email: user.email },
    organization: { name: user.organization.name },
  };
}

export type AuthedHelperDevice = {
  id: string;
  organizationId: string;
  userId: string;
};

/**
 * Телефон по ключу из заголовка `Authorization: Bearer`. Отозванный ключ,
 * ключ уволенного (отключённого) сотрудника и ключ человека, которого
 * перевели из руководства в повара, не проходят — правило то же, что при
 * входе (`helperAccessError`).
 *
 * Организацию берём из строки телефона — клиент её не передаёт вообще,
 * поэтому событие одного заведения не может попасть в другое.
 */
export async function authenticateHelperDevice(request: Request): Promise<AuthedHelperDevice | null> {
  const raw = readBearerToken(request);
  if (!raw) return null;

  const device = await db.setupHelperDevice.findUnique({
    where: { tokenHash: hashHelperToken(raw) },
    select: { id: true, organizationId: true, userId: true, revokedAt: true },
  });
  if (!device || device.revokedAt) return null;

  const user = await db.user.findUnique({
    where: { id: device.userId },
    select: { isActive: true, archivedAt: true, role: true, isRoot: true },
  });
  if (!user || !user.isActive || user.archivedAt || helperAccessError(user)) return null;

  return { id: device.id, organizationId: device.organizationId, userId: device.userId };
}

/** Адрес клиента за nginx — для лимита попыток и журнала входов. */
export function clientIp(request: Request): string | null {
  const xff = request.headers.get("x-forwarded-for") ?? "";
  return xff.split(",")[0].trim() || request.headers.get("x-real-ip") || null;
}
