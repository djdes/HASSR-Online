/**
 * Починка общего логотипа (2026-11-01): организации, созданные «как текущая»
 * до исправления, ссылаются на файл логотипа другой организации — смена
 * логотипа там меняет его и у них. Скрипт даёт каждой свою копию файла и
 * свой адрес; у донора файла нет — логотип снимается (как «Удалить»).
 *
 * Только показать:  npx tsx scripts/repair-shared-org-logos.ts
 * Исправить:        npx tsx scripts/repair-shared-org-logos.ts --apply
 */
import { db } from "@/lib/db";
import { copyOrgLogo } from "@/lib/org-logo";
import { orgLogoAssetOwner } from "@/lib/org-logo-file";

async function main() {
  const apply = process.argv.includes("--apply");
  const orgs = await db.organization.findMany({
    where: { logoUrl: { startsWith: "/api/org-assets/" } },
    select: { id: true, name: true, logoUrl: true },
  });
  const shared = orgs.filter((org) => {
    const owner = orgLogoAssetOwner(org.logoUrl);
    return owner !== null && owner !== org.id;
  });
  console.log(`Организаций с чужим файлом логотипа: ${shared.length}${apply ? "" : " (только показ, --apply — исправить)"}`);
  for (const org of shared) {
    const owner = orgLogoAssetOwner(org.logoUrl)!;
    if (!apply) {
      console.log(`  ${org.id} «${org.name}» → файл организации ${owner}`);
      continue;
    }
    const url = await copyOrgLogo(owner, org.id);
    if (!url) await db.organization.update({ where: { id: org.id }, data: { logoUrl: null } });
    console.log(`  ${org.id} «${org.name}»: ${url ? `своя копия ${url}` : "у донора нет файла — логотип снят"}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
