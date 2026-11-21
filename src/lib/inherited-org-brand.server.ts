/**
 * Унаследованный фирменный стиль — работа с базой (2026-11-21): собрать
 * организации аккаунтов, где их несколько, решить, что досталось от донора
 * (`findInheritedBrand`), и убрать это. Общий для ручного скрипта
 * `scripts/repair-inherited-org-brand.ts` и разового шага выкладки
 * `prisma/seed-repair-inherited-org-brand-2026-11.ts`.
 */

import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { removeOrgLogo } from "@/lib/org-logo";
import { findInheritedBrand, type BrandOrgRow, type InheritedBrand } from "@/lib/inherited-org-brand";

/** Запись в журнал действий организации, у которой убрали унаследованное. */
export const INHERITED_BRAND_REMOVED_ACTION = "organization.brand.inherited_removed";

/** Файлы логотипов читаем порциями: каждый до 500 КБ. */
const FILE_CHUNK = 50;

export type InheritedBrandFix = InheritedBrand & {
  /** Прежние значения — в журнал действий, чтобы было видно, что убрано. */
  logoUrl: string | null;
  brandColorValue: string | null;
};

function changedKeys(details: unknown): string[] {
  const changed = (details as { changed?: unknown } | null)?.changed;
  return changed && typeof changed === "object" && !Array.isArray(changed) ? Object.keys(changed) : [];
}

export async function findInheritedBrandInDb({ now = new Date() }: { now?: Date } = {}): Promise<{
  checked: number;
  rows: BrandOrgRow[];
  fixes: InheritedBrandFix[];
}> {
  // Все организации: общий файл другой организации убирается у любой, а
  // перепись (`brandCensus`) смотрит на всех.
  const candidates = await db.organization.findMany({
    select: { id: true, name: true, accountId: true, createdAt: true, logoUrl: true, brandColor: true },
  });
  const withFile = await db.organizationLogo.findMany({ select: { organizationId: true } });
  const ids = withFile.map((row) => row.organizationId);
  // Журнал действий — только тех, у кого есть что проверять.
  const auditIds = [
    ...new Set([...ids, ...candidates.filter((org) => org.logoUrl || org.brandColor).map((org) => org.id)]),
  ];

  const files = new Map<string, NonNullable<BrandOrgRow["logoFile"]>>();
  for (let start = 0; start < ids.length; start += FILE_CHUNK) {
    const chunk = await db.organizationLogo.findMany({
      where: { organizationId: { in: ids.slice(start, start + FILE_CHUNK) } },
      select: { organizationId: true, bytes: true, version: true, updatedAt: true },
    });
    for (const file of chunk) {
      files.set(file.organizationId, {
        hash: createHash("sha256").update(file.bytes).digest("hex"),
        version: file.version,
        updatedAt: file.updatedAt,
      });
    }
  }

  const [uploads, settings] = await Promise.all([
    db.auditLog.findMany({
      where: { organizationId: { in: auditIds }, action: "organization.logo.upload" },
      select: { organizationId: true },
    }),
    db.auditLog.findMany({
      where: { organizationId: { in: auditIds }, action: "organization.settings.update" },
      select: { organizationId: true, details: true },
    }),
  ]);
  const uploaded = new Set(uploads.map((row) => row.organizationId));
  const setLogoUrl = new Set<string>();
  const setBrandColor = new Set<string>();
  for (const row of settings) {
    const keys = changedKeys(row.details);
    if (keys.includes("logoUrl")) setLogoUrl.add(row.organizationId);
    if (keys.includes("brandColor")) setBrandColor.add(row.organizationId);
  }

  const rows: BrandOrgRow[] = candidates.map((org) => ({
    ...org,
    logoFile: files.get(org.id) ?? null,
    setByPerson: { logoUpload: uploaded.has(org.id), logoUrl: setLogoUrl.has(org.id), brandColor: setBrandColor.has(org.id) },
  }));
  const byId = new Map(rows.map((row) => [row.id, row]));
  const fixes = findInheritedBrand(rows, { now }).map((fix) => ({
    ...fix,
    logoUrl: byId.get(fix.organizationId)?.logoUrl ?? null,
    brandColorValue: byId.get(fix.organizationId)?.brandColor ?? null,
  }));
  return { checked: rows.length, rows, fixes };
}

/**
 * Убрать унаследованное у одной организации: логотип — как кнопкой «Удалить»
 * (файл и адрес), основной цвет — сброс; в журнал действий — прежние значения.
 */
export async function removeInheritedBrand(fix: InheritedBrandFix, actor: string): Promise<void> {
  if (fix.logo) await removeOrgLogo(fix.organizationId);
  if (fix.brandColor) await db.organization.update({ where: { id: fix.organizationId }, data: { brandColor: null } });
  await db.auditLog.create({
    data: {
      organizationId: fix.organizationId,
      userId: null,
      userName: actor,
      action: INHERITED_BRAND_REMOVED_ACTION,
      entity: "organization",
      entityId: fix.organizationId,
      details: {
        logo: fix.logo,
        logoUrl: fix.logo ? fix.logoUrl : null,
        brandColor: fix.brandColor ? fix.brandColorValue : null,
      },
    },
  });
}
