import crypto from "node:crypto";
import bcrypt from "bcryptjs";

import { getServerSession } from "@/lib/server-session";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { ORG_ROSTER_WHERE, ORG_SIGNER_WHERE } from "@/lib/journal-roster";
import { isManagementRole } from "@/lib/user-roles";
import { decryptSecret, encryptSecret, isIntegrationCryptoConfigured } from "@/lib/integration-crypto";

/**
 * Кто заполняет QR-форму — общая проверка для журналов, холодильников и
 * помещений по режиму организации `qrFillMode`:
 *   • public — сотрудник из списка (как было);
 *   • pin    — сотрудник + личный PIN (bcrypt, 5 ошибок → блок на 15 мин);
 *   • auth   — сессия кабинета; линейный сотрудник только от своего имени,
 *              руководитель — от имени любого.
 */

export type QrFillMode = "public" | "pin" | "auth";
export const PIN_MAX_FAILURES = 5;
export const PIN_LOCK_MS = 15 * 60 * 1000;

export function normalizeQrFillMode(raw: unknown): QrFillMode {
  return raw === "pin" || raw === "auth" ? raw : "public";
}

export type QrFillActorResult =
  | { ok: true; employee: { id: string; name: string; role: string | null } }
  | { ok: false; status: number; error: string };

export async function resolveQrFillActor(params: {
  mode: QrFillMode;
  organizationId: string;
  employeeId: string;
  pin?: string | null;
  /** Бракеражи: членов сторонней комиссии тоже ищем. */
  includeCommission?: boolean;
}): Promise<QrFillActorResult> {
  const employee = await db.user.findFirst({
    where: { id: params.employeeId, organizationId: params.organizationId, ...(params.includeCommission ? ORG_SIGNER_WHERE : ORG_ROSTER_WHERE) },
    select: { id: true, name: true, role: true, qrPinHash: true, qrPinFailedCount: true, qrPinLockedUntil: true },
  });
  if (!employee) return { ok: false, status: 404, error: "Сотрудник не найден" };

  if (params.mode === "auth") {
    const session = await getServerSession(authOptions);
    if (!session) return { ok: false, status: 401, error: "Нужно войти в кабинет" };
    const actor = await db.user.findUnique({ where: { id: session.user.id }, select: { organizationId: true, role: true } });
    if (!actor || actor.organizationId !== params.organizationId) {
      return { ok: false, status: 403, error: "Вы вошли под аккаунтом другой организации" };
    }
    if (session.user.id !== employee.id && !isManagementRole(actor.role) && session.user.isRoot !== true) {
      return { ok: false, status: 403, error: "Записать можно только от своего имени" };
    }
    return { ok: true, employee: { id: employee.id, name: employee.name, role: employee.role } };
  }

  // PIN спрашиваем всегда, когда он у сотрудника задан — и в публичном режиме:
  // один и тот же код на QR-формах, страницах объектов и общем планшете.
  const pinRequired = params.mode === "pin" || (params.mode === "public" && Boolean(employee.qrPinHash));
  if (pinRequired) {
    if (!employee.qrPinHash) {
      return { ok: false, status: 403, error: "У сотрудника не задан PIN. Попросите руководителя задать его в карточке сотрудника." };
    }
    if (employee.qrPinLockedUntil && employee.qrPinLockedUntil.getTime() > Date.now()) {
      const minutes = Math.ceil((employee.qrPinLockedUntil.getTime() - Date.now()) / 60_000);
      return { ok: false, status: 423, error: `PIN заблокирован после ошибок. Попробуйте через ${minutes} мин.` };
    }
    const pin = (params.pin ?? "").trim();
    const valid = /^\d{4,6}$/.test(pin) && (await bcrypt.compare(pin, employee.qrPinHash));
    if (!valid) {
      const failed = employee.qrPinFailedCount + 1;
      await db.user.update({
        where: { id: employee.id },
        data: {
          qrPinFailedCount: failed >= PIN_MAX_FAILURES ? 0 : failed,
          qrPinLockedUntil: failed >= PIN_MAX_FAILURES ? new Date(Date.now() + PIN_LOCK_MS) : null,
        },
      });
      return {
        ok: false,
        status: 401,
        error:
          failed >= PIN_MAX_FAILURES
            ? "Неверный PIN 5 раз — вход заблокирован на 15 минут."
            : `Неверный PIN. Осталось попыток: ${PIN_MAX_FAILURES - failed}.`,
      };
    }
    if (employee.qrPinFailedCount > 0 || employee.qrPinLockedUntil) {
      await db.user.update({ where: { id: employee.id }, data: { qrPinFailedCount: 0, qrPinLockedUntil: null } });
    }
  }
  return { ok: true, employee: { id: employee.id, name: employee.name, role: employee.role } };
}

/** Сотрудник сессии для страниц QR в режиме `auth` (null — сессии нет). */
export async function sessionEmployeeForQr(organizationId: string): Promise<
  | { ok: true; employee: { id: string; name: string; positionTitle: string | null; canPickOthers: boolean } }
  | { ok: false; reason: "no-session" | "other-org" }
> {
  const session = await getServerSession(authOptions);
  if (!session) return { ok: false, reason: "no-session" };
  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, name: true, positionTitle: true, role: true, organizationId: true },
  });
  if (!user || user.organizationId !== organizationId) return { ok: false, reason: "other-org" };
  return {
    ok: true,
    employee: {
      id: user.id,
      name: user.name,
      positionTitle: user.positionTitle ?? null,
      canPickOthers: isManagementRole(user.role) || session.user.isRoot === true,
    },
  };
}

/**
 * Автогенерация 4-значного ПИН: система выдаёт код, руководитель его не
 * придумывает. Отсеиваем тривиальные (одинаковые цифры, `1234`, `0000`),
 * чтобы результат гарантированно проходил `setEmployeeQrPin`.
 */
export function generateEmployeeQrPin(): string {
  for (;;) {
    const pin = String(crypto.randomInt(0, 10_000)).padStart(4, "0");
    if (/^(\d)\1+$/.test(pin)) continue;
    if (pin === "1234" || pin === "0123") continue;
    return pin;
  }
}

/** Установить/снять PIN. Возвращает ошибку валидации или null. */
export async function setEmployeeQrPin(userId: string, pin: string | null): Promise<string | null> {
  if (pin === null || pin === "") {
    await db.user.update({ where: { id: userId }, data: { qrPinHash: null, qrPinEncrypted: null, qrPinFailedCount: 0, qrPinLockedUntil: null } });
    return null;
  }
  if (!/^\d{4,6}$/.test(pin)) return "PIN — от 4 до 6 цифр";
  if (/^(\d)\1+$/.test(pin) || pin === "1234" || pin === "123456") return "Слишком простой PIN — выберите другой";
  const hash = await bcrypt.hash(pin, 10);
  const qrPinEncrypted = isIntegrationCryptoConfigured() ? encryptSecret(pin) : null;
  await db.user.update({ where: { id: userId }, data: { qrPinHash: hash, qrPinEncrypted, qrPinFailedCount: 0, qrPinLockedUntil: null } });
  return null;
}

/** Показать PIN руководителю: null — не задан или задан до того, как код стали хранить для показа. */
export async function revealEmployeeQrPin(userId: string): Promise<string | null> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { qrPinHash: true, qrPinEncrypted: true } });
  if (!user?.qrPinHash || !user.qrPinEncrypted || !isIntegrationCryptoConfigured()) return null;
  try {
    return decryptSecret(user.qrPinEncrypted);
  } catch {
    return null;
  }
}
