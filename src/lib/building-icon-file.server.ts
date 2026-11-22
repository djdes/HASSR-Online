/**
 * Свой значок объекта: хранение файла и выбор значка (2026-11-22). Адреса и
 * библиотека — `lib/building-icons.ts`, проверка файла — та же, что у
 * логотипа организации (`prepareOrgLogo`: PNG по заголовку или очищенный SVG).
 */

import { db } from "@/lib/db";
import { buildingIconUrl, type BuildingIconKey } from "@/lib/building-icons";

/** Сохранить свой файл и направить на него `Building.icon`. */
export async function setBuildingIconFile(
  organizationId: string,
  buildingId: string,
  file: { bytes: Uint8Array; mime: string },
): Promise<string> {
  // Prisma Bytes хочет Uint8Array поверх ArrayBuffer — копия отвязывает от Blob.
  const bytes = Uint8Array.from(file.bytes);
  const row = await db.buildingIconFile.upsert({
    where: { buildingId },
    create: { buildingId, bytes, mime: file.mime },
    update: { bytes, mime: file.mime, version: { increment: 1 } },
    select: { version: true },
  });
  const url = buildingIconUrl(organizationId, buildingId, row.version);
  await db.building.update({ where: { id: buildingId }, data: { icon: url } });
  return url;
}

/**
 * Типовой значок (или `null` — по виду объекта). Свой файл больше не нужен —
 * удаляем, чтобы по старому адресу не висела картинка.
 */
export async function setBuildingLibraryIcon(buildingId: string, icon: BuildingIconKey | null): Promise<void> {
  await db.$transaction([
    db.buildingIconFile.deleteMany({ where: { buildingId } }),
    db.building.update({ where: { id: buildingId }, data: { icon } }),
  ]);
}

/** Файл значка — только если объект и правда этой организации. */
export async function readBuildingIconFile(
  organizationId: string,
  buildingId: string,
): Promise<{ bytes: Uint8Array; mime: string } | null> {
  const row = await db.buildingIconFile.findFirst({
    where: { buildingId, building: { organizationId } },
    select: { bytes: true, mime: true },
  });
  return row ? { bytes: new Uint8Array(row.bytes), mime: row.mime } : null;
}
