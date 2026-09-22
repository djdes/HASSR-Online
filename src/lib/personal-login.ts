import crypto from "node:crypto";
import QRCode from "qrcode";

import { db } from "@/lib/db";

/**
 * Личный QR-вход (2026-09-22): QR ведёт на `/q/<токен>`, человек вводит
 * свой PIN и попадает в кабинет. В базе — только хэш токена; у человека
 * одна действующая ссылка, перевыпуск отзывает старую. Без PIN токен
 * бесполезен: потерянная карточка сама по себе доступа не даёт.
 */
const APP_URL = (process.env.NEXTAUTH_URL || "https://wesetup.ru").replace(/\/+$/, "");

export function hashPersonalToken(raw: string): string {
  return crypto.createHash("sha256").update(`personal-login:${raw}`).digest("hex");
}

export function personalLoginUrl(raw: string): string {
  return `${APP_URL}/q/${raw}`;
}

export async function personalLoginQrSvg(url: string): Promise<string> {
  return QRCode.toString(url, { type: "svg", errorCorrectionLevel: "M", margin: 1, width: 480 });
}

/** Новый токен: старые этого человека отзываются. Возвращает «сырой» токен (показывается один раз). */
export async function issuePersonalLoginToken(params: { userId: string; organizationId: string; createdById: string }): Promise<string> {
  const raw = crypto.randomBytes(24).toString("base64url");
  await db.$transaction([
    db.personalLoginToken.updateMany({ where: { userId: params.userId, revokedAt: null }, data: { revokedAt: new Date() } }),
    db.personalLoginToken.create({
      data: { userId: params.userId, organizationId: params.organizationId, tokenHash: hashPersonalToken(raw), createdById: params.createdById },
    }),
  ]);
  return raw;
}

export async function revokePersonalLoginTokens(userId: string): Promise<number> {
  const result = await db.personalLoginToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  return result.count;
}

export async function activePersonalLogin(userId: string) {
  return db.personalLoginToken.findFirst({
    where: { userId, revokedAt: null },
    orderBy: { createdAt: "desc" },
    select: { id: true, createdAt: true, lastUsedAt: true },
  });
}

/** Токен → сотрудник (активный, не в архиве). null — ссылка отозвана или неверна. */
export async function resolvePersonalLoginToken(raw: string) {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(raw)) return null;
  const row = await db.personalLoginToken.findUnique({ where: { tokenHash: hashPersonalToken(raw) }, select: { id: true, userId: true, organizationId: true, revokedAt: true } });
  if (!row || row.revokedAt) return null;
  const user = await db.user.findFirst({
    where: { id: row.userId, organizationId: row.organizationId, isActive: true, archivedAt: null },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      isRoot: true,
      permissionPreset: true,
      organizationId: true,
      qrPinHash: true,
      organization: { select: { name: true } },
    },
  });
  return user ? { tokenId: row.id, user } : null;
}
