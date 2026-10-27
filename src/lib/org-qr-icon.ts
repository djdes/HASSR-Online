/**
 * Значок организации для центра QR-кодов (2026-10-27). Хранится отдельно от
 * логотипа: логотип обычно широкий, а в центр QR нужен квадрат. Проверка
 * файла — та же, что у логотипа (`lib/org-logo-file.ts`).
 */

import { db } from "@/lib/db";
import { orgQrIconUrl } from "@/lib/org-logo-file";

/** Сохранить значок и направить на него `Organization.qrIconUrl`. */
export async function setOrgQrIcon(
  organizationId: string,
  icon: { bytes: Uint8Array; mime: string },
): Promise<string> {
  // Prisma Bytes хочет Uint8Array поверх ArrayBuffer — копия отвязывает от Blob.
  const bytes = Uint8Array.from(icon.bytes);
  const row = await db.organizationQrIcon.upsert({
    where: { organizationId },
    create: { organizationId, bytes, mime: icon.mime },
    update: { bytes, mime: icon.mime, version: { increment: 1 } },
    select: { version: true },
  });
  const url = orgQrIconUrl(organizationId, row.version);
  await db.organization.update({ where: { id: organizationId }, data: { qrIconUrl: url } });
  return url;
}

/** Убрать значок: в центр QR снова пойдёт логотип или буква названия. */
export async function removeOrgQrIcon(organizationId: string): Promise<void> {
  await db.organizationQrIcon.deleteMany({ where: { organizationId } });
  await db.organization.update({ where: { id: organizationId }, data: { qrIconUrl: null } });
}

export async function readOrgQrIcon(
  organizationId: string,
): Promise<{ bytes: Uint8Array; mime: string } | null> {
  const row = await db.organizationQrIcon.findUnique({
    where: { organizationId },
    select: { bytes: true, mime: true },
  });
  return row ? { bytes: new Uint8Array(row.bytes), mime: row.mime } : null;
}
