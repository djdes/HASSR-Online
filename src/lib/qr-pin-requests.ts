import bcrypt from "bcryptjs";

import { db } from "@/lib/db";
import { encryptSecret, isIntegrationCryptoConfigured } from "@/lib/integration-crypto";
import { getDbRoleValuesWithLegacy, MANAGEMENT_ROLES } from "@/lib/user-roles";
import { upsertNotification } from "@/lib/notifications";
import { notifyEmployee } from "@/lib/telegram";
import { setEmployeeQrPinHash } from "@/lib/qr-fill-actor";
import {
  isPinRequestActionable,
  pinRequestExpiresAt,
  pinRequestKindLabel,
  validatePinRequestInput,
  type PinRequestKind,
} from "@/lib/qr-pin-requests-core";

/**
 * Запросы PIN с QR-страниц: «Запросить доступ» (PIN ещё нет) и «Запросить
 * смену PIN». Сотрудник сам придумывает PIN, руководитель одобряет в
 * «Сотрудниках» — тогда PIN начинает работать. До решения храним только
 * bcrypt-хэш (и шифрованную копию для «Показать PIN»), после — стираем.
 */

export const PIN_REQUESTS_HREF = "/settings/users?pinRequests=1#pin-requests";

/** Кому сигнал: ответственный по журналу (если он руководитель) + все руководители. */
async function resolvePinRequestApprovers(params: {
  organizationId: string;
  documentId?: string | null;
}): Promise<string[]> {
  const managerRoles = getDbRoleValuesWithLegacy(MANAGEMENT_ROLES);
  const managers = await db.user.findMany({
    where: { organizationId: params.organizationId, isActive: true, archivedAt: null, role: { in: managerRoles } },
    select: { id: true },
  });
  const ids = new Set(managers.map((user) => user.id));
  if (params.documentId) {
    const document = await db.journalDocument.findUnique({
      where: { id: params.documentId },
      select: { organizationId: true, responsibleUserId: true },
    });
    // Ответственный по журналу получает сигнал, даже если он не в списке
    // руководителей: одобрить сможет руководитель, но журнал — его зона.
    if (document?.organizationId === params.organizationId && document.responsibleUserId) {
      ids.add(document.responsibleUserId);
    }
  }
  return Array.from(ids);
}

export async function createQrPinRequest(params: {
  organizationId: string;
  userId: string;
  kind: PinRequestKind;
  pin: string;
  repeat: string;
  source: "journal-fill" | "room-fill" | "equipment-fill";
  journalCode?: string | null;
  documentId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const invalid = validatePinRequestInput({ pin: params.pin, repeat: params.repeat });
  if (invalid) return { ok: false, error: invalid };
  const user = await db.user.findFirst({
    where: { id: params.userId, organizationId: params.organizationId, isActive: true, archivedAt: null },
    select: { id: true, name: true },
  });
  if (!user) return { ok: false, error: "Сотрудник не найден" };

  const pinHash = await bcrypt.hash(params.pin, 10);
  const pinEncrypted = isIntegrationCryptoConfigured() ? encryptSecret(params.pin) : null;
  const created = await db.$transaction(async (tx) => {
    // Одна ожидающая заявка на сотрудника и вид: новая заменяет прежнюю.
    await tx.qrPinRequest.updateMany({
      where: { organizationId: params.organizationId, userId: user.id, kind: params.kind, status: "pending" },
      data: { status: "superseded", pinHash: null, pinEncrypted: null },
    });
    return tx.qrPinRequest.create({
      data: {
        organizationId: params.organizationId,
        userId: user.id,
        kind: params.kind,
        pinHash,
        pinEncrypted,
        source: params.source,
        journalCode: params.journalCode ?? null,
        documentId: params.documentId ?? null,
        ip: params.ip ? params.ip.slice(0, 64) : null,
        userAgent: params.userAgent ? params.userAgent.slice(0, 300) : null,
        expiresAt: pinRequestExpiresAt(),
      },
      select: { id: true },
    });
  });

  await notifyPinRequest({
    organizationId: params.organizationId,
    requestId: created.id,
    employeeName: user.name,
    kind: params.kind,
    documentId: params.documentId ?? null,
  }).catch((error) => console.error("[qr-pin-request] notify failed", error));

  return { ok: true, id: created.id };
}

async function notifyPinRequest(params: {
  organizationId: string;
  requestId: string;
  employeeName: string;
  kind: PinRequestKind;
  documentId: string | null;
}): Promise<void> {
  const approvers = await resolvePinRequestApprovers({ organizationId: params.organizationId, documentId: params.documentId });
  const label = `${params.employeeName} — ${pinRequestKindLabel(params.kind).toLowerCase()}`;
  await Promise.all(
    approvers.map(async (userId) => {
      await upsertNotification({
        organizationId: params.organizationId,
        userId,
        kind: "qr_pin_request",
        // Одно уведомление «Запросы PIN» на организацию, по пункту на запрос.
        dedupeKey: `qr-pin-requests:${params.organizationId}`,
        title: "Запросы PIN от сотрудников",
        linkHref: PIN_REQUESTS_HREF,
        linkLabel: "Рассмотреть",
        items: [{ id: params.requestId, label, hint: "с QR-страницы", href: PIN_REQUESTS_HREF }],
      });
      await notifyEmployee(
        userId,
        `🔑 ${params.employeeName} просит ${params.kind === "change" ? "сменить PIN" : "выдать PIN"} для QR-журналов. Одобрите или отклоните в разделе «Сотрудники».`,
        { label: "Открыть запросы", miniAppUrl: "/mini/staff" }
      ).catch(() => undefined);
    })
  );
}

export type PinRequestListItem = {
  id: string;
  userId: string;
  userName: string;
  positionTitle: string | null;
  kind: PinRequestKind;
  journalCode: string | null;
  source: string;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  expiresAt: string;
};

export async function listPendingQrPinRequests(organizationId: string): Promise<PinRequestListItem[]> {
  const now = new Date();
  const requests = await db.qrPinRequest.findMany({
    where: { organizationId, status: "pending", expiresAt: { gte: now } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  if (requests.length === 0) return [];
  const users = await db.user.findMany({
    where: { id: { in: requests.map((request) => request.userId) }, organizationId },
    select: { id: true, name: true, positionTitle: true, jobPosition: { select: { name: true } } },
  });
  const byId = new Map(users.map((user) => [user.id, user]));
  return requests
    .filter((request) => byId.has(request.userId))
    .map((request) => {
      const user = byId.get(request.userId)!;
      return {
        id: request.id,
        userId: request.userId,
        userName: user.name,
        positionTitle: user.jobPosition?.name ?? user.positionTitle ?? null,
        kind: request.kind === "change" ? "change" : "issue",
        journalCode: request.journalCode,
        source: request.source,
        ip: request.ip,
        userAgent: request.userAgent,
        createdAt: request.createdAt.toISOString(),
        expiresAt: request.expiresAt.toISOString(),
      };
    });
}

/** Последний запрос сотрудника за неделю — статус на QR-странице. */
export async function latestQrPinRequestFor(params: { organizationId: string; userId: string }) {
  return db.qrPinRequest.findFirst({
    where: {
      organizationId: params.organizationId,
      userId: params.userId,
      status: { in: ["pending", "approved", "rejected"] },
      createdAt: { gte: new Date(Date.now() - 7 * 24 * 3600 * 1000) },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, kind: true, status: true, decisionNote: true, createdAt: true, decidedAt: true },
  });
}

export async function decideQrPinRequest(params: {
  organizationId: string;
  requestId: string;
  decidedById: string;
  approve: boolean;
  note?: string | null;
}): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const request = await db.qrPinRequest.findUnique({ where: { id: params.requestId } });
  if (!request || request.organizationId !== params.organizationId) {
    return { ok: false, status: 404, error: "Запрос не найден" };
  }
  if (!isPinRequestActionable(request)) {
    return { ok: false, status: 409, error: "Запрос уже решён или устарел" };
  }
  if (params.approve) {
    if (!request.pinHash) return { ok: false, status: 409, error: "Запрос устарел — попросите отправить заново" };
    await setEmployeeQrPinHash(request.userId, { hash: request.pinHash, encrypted: request.pinEncrypted });
  }
  await db.qrPinRequest.update({
    where: { id: request.id },
    data: {
      status: params.approve ? "approved" : "rejected",
      pinHash: null,
      pinEncrypted: null,
      decidedById: params.decidedById,
      decidedAt: new Date(),
      decisionNote: params.note ? params.note.trim().slice(0, 300) || null : null,
    },
  });
  // Сотруднику — в Telegram, если он привязан; на QR-странице статус виден и так.
  const text = params.approve
    ? request.kind === "change"
      ? "✅ Руководитель одобрил ваш новый PIN. Теперь входите в QR-журналы с ним."
      : "✅ Руководитель одобрил ваш PIN. Теперь им можно подтверждать записи в QR-журналах."
    : `Руководитель отклонил запрос на PIN${params.note ? `: ${params.note}` : ""}.`;
  await notifyEmployee(request.userId, text).catch(() => undefined);
  return { ok: true };
}
