/**
 * Логотип организации — наверху сайдбара кабинета (2026-10-16).
 *
 * Раньше логотип задавался только ссылкой на чужой сервер, и почти никто
 * его не ставил. Теперь файл загружается прямо в кабинете; проверка файла
 * и адрес — `lib/org-logo-file.ts`.
 */

import { db } from "@/lib/db";
import { orgLogoUrl } from "@/lib/org-logo-file";

/** Сохранить логотип и направить на него `Organization.logoUrl`. */
export async function setOrgLogo(
  organizationId: string,
  logo: { bytes: Uint8Array; mime: string },
): Promise<string> {
  // Prisma Bytes хочет Uint8Array поверх ArrayBuffer — копия отвязывает от Blob.
  const bytes = Uint8Array.from(logo.bytes);
  const row = await db.organizationLogo.upsert({
    where: { organizationId },
    create: { organizationId, bytes, mime: logo.mime },
    update: { bytes, mime: logo.mime, version: { increment: 1 } },
    select: { version: true },
  });
  const url = orgLogoUrl(organizationId, row.version);
  await db.organization.update({ where: { id: organizationId }, data: { logoUrl: url } });
  return url;
}

/**
 * Скопировать загруженный логотип другой организации себе (2026-11-01):
 * своя копия файла и свой адрес. Без копии новая организация «как
 * текущая» ссылалась на файл донора, и смена логотипа там меняла его
 * здесь. У донора нет файла — null, ничего не меняем.
 */
export async function copyOrgLogo(fromOrganizationId: string, toOrganizationId: string): Promise<string | null> {
  const source = await readOrgLogo(fromOrganizationId);
  return source ? setOrgLogo(toOrganizationId, source) : null;
}

/** Убрать логотип: и загруженный файл, и ссылку — кнопка «Удалить» одна. */
export async function removeOrgLogo(organizationId: string): Promise<void> {
  await db.organizationLogo.deleteMany({ where: { organizationId } });
  await db.organization.update({ where: { id: organizationId }, data: { logoUrl: null } });
}

export async function readOrgLogo(
  organizationId: string,
): Promise<{ bytes: Uint8Array; mime: string } | null> {
  const row = await db.organizationLogo.findUnique({
    where: { organizationId },
    select: { bytes: true, mime: true },
  });
  return row ? { bytes: new Uint8Array(row.bytes), mime: row.mime } : null;
}
