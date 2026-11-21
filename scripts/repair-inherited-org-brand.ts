/**
 * Починка унаследованного фирменного стиля (2026-11-21): организации,
 * созданные «как текущая» до исправления, получили логотип донора (адрес его
 * файла или копию файла) и его основной цвет — в «Фирменном стиле» и в меню у
 * них стиль другой организации («во всех организациях — доброе кафе»).
 *
 * Что считается унаследованным — `src/lib/inherited-org-brand.ts`: только то,
 * чего в организации никто не задавал и что повторяет более старую организацию
 * того же аккаунта. Логотип убирается так же, как кнопкой «Удалить» (файл и
 * адрес), цвет сбрасывается; в журнал действий организации пишется
 * `organization.brand.inherited_removed` с прежними значениями.
 *
 * Только показать:  npx tsx scripts/repair-inherited-org-brand.ts
 * Исправить:        npx tsx scripts/repair-inherited-org-brand.ts --apply
 *
 * Запускать вскоре после выкладки: обычные записи журнала действий живут 90
 * дней, а по ним видно, что логотип или цвет человек задал сам.
 */
import "dotenv/config";
import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { removeOrgLogo } from "@/lib/org-logo";
import { findInheritedBrand, type BrandOrgRow, type InheritedLogo } from "@/lib/inherited-org-brand";

const LOGO_REASON: Record<InheritedLogo, string> = {
  "shared-file": "адрес файла другой организации",
  "copied-file": "копия файла донора",
  "copied-link": "ссылка донора",
};

/** Файлы логотипов читаем порциями: каждый до 500 КБ. */
const FILE_CHUNK = 50;

function changedKeys(details: unknown): string[] {
  const changed = (details as { changed?: unknown } | null)?.changed;
  return changed && typeof changed === "object" && !Array.isArray(changed) ? Object.keys(changed) : [];
}

async function main() {
  const apply = process.argv.includes("--apply");

  const orgs = await db.organization.findMany({
    where: { accountId: { not: null } },
    select: { id: true, name: true, accountId: true, createdAt: true, logoUrl: true, brandColor: true },
  });
  // Сравниваются организации одного аккаунта — одиночек дальше не читаем.
  const perAccount = new Map<string, number>();
  for (const org of orgs) perAccount.set(org.accountId!, (perAccount.get(org.accountId!) ?? 0) + 1);
  const candidates = orgs.filter((org) => (perAccount.get(org.accountId!) ?? 0) > 1);
  const ids = candidates.map((org) => org.id);

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
      where: { organizationId: { in: ids }, action: "organization.logo.upload" },
      select: { organizationId: true },
    }),
    db.auditLog.findMany({
      where: { organizationId: { in: ids }, action: "organization.settings.update" },
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
  const fixes = findInheritedBrand(rows);
  const byId = new Map(rows.map((row) => [row.id, row]));

  console.log(
    `Организаций в аккаунтах с несколькими организациями: ${rows.length}; с унаследованным фирменным стилем: ${fixes.length}` +
      (apply ? "" : " (только показ, --apply — исправить)"),
  );
  for (const fix of fixes) {
    const row = byId.get(fix.organizationId)!;
    const parts = [
      ...(fix.logo ? [`логотип — ${LOGO_REASON[fix.logo]}`] : []),
      ...(fix.brandColor ? [`цвет ${row.brandColor}`] : []),
    ];
    console.log(`  ${fix.organizationId} «${fix.name}» (аккаунт ${fix.accountId}): ${parts.join(", ")}`);
    if (!apply) continue;

    if (fix.logo) await removeOrgLogo(fix.organizationId);
    if (fix.brandColor) await db.organization.update({ where: { id: fix.organizationId }, data: { brandColor: null } });
    await db.auditLog.create({
      data: {
        organizationId: fix.organizationId,
        userId: null,
        userName: "repair-inherited-org-brand",
        action: "organization.brand.inherited_removed",
        entity: "organization",
        entityId: fix.organizationId,
        details: {
          logo: fix.logo,
          logoUrl: fix.logo ? row.logoUrl : null,
          brandColor: fix.brandColor ? row.brandColor : null,
        },
      },
    });
    console.log(`    убрано`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
