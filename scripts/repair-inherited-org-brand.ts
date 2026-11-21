/**
 * Починка унаследованного фирменного стиля (2026-11-21): организации,
 * созданные «как текущая» до исправления, получили логотип донора (адрес его
 * файла или копию файла) и его основной цвет — в «Фирменном стиле» и в меню у
 * них стиль другой организации («во всех организациях — доброе кафе»).
 *
 * Что считается унаследованным — `src/lib/inherited-org-brand.ts`: только то,
 * чего в организации никто не задавал и что повторяет более старую организацию
 * того же аккаунта, и адрес файла другой организации у любой. Логотип
 * убирается так же, как кнопкой «Удалить» (файл и
 * адрес), цвет сбрасывается; в журнал действий организации пишется
 * `organization.brand.inherited_removed` с прежними значениями.
 *
 * На проде один раз запускается сам на выкладке
 * (`prisma/seed-repair-inherited-org-brand-2026-11.ts`). Вручную:
 *   Только показать:  npx tsx scripts/repair-inherited-org-brand.ts
 *   Исправить:        npx tsx scripts/repair-inherited-org-brand.ts --apply
 *
 * Запускать вскоре после выкладки: обычные записи журнала действий живут 90
 * дней, а по ним видно, что логотип или цвет человек задал сам.
 */
import "dotenv/config";
import { db } from "@/lib/db";
import { findInheritedBrandInDb, removeInheritedBrand } from "@/lib/inherited-org-brand.server";
import type { InheritedLogo } from "@/lib/inherited-org-brand";

const LOGO_REASON: Record<InheritedLogo, string> = {
  "shared-file": "адрес файла другой организации",
  "copied-file": "копия файла донора",
  "copied-link": "ссылка донора",
};

async function main() {
  const apply = process.argv.includes("--apply");
  const { checked, fixes } = await findInheritedBrandInDb();

  console.log(
    `Проверено организаций: ${checked}; с унаследованным фирменным стилем: ${fixes.length}` +
      (apply ? "" : " (только показ, --apply — исправить)"),
  );
  for (const fix of fixes) {
    const parts = [
      ...(fix.logo ? [`логотип — ${LOGO_REASON[fix.logo]}`] : []),
      ...(fix.brandColor ? [`цвет ${fix.brandColorValue}`] : []),
    ];
    console.log(`  ${fix.organizationId} «${fix.name}» (аккаунт ${fix.accountId ?? "—"}): ${parts.join(", ")}`);
    if (!apply) continue;
    await removeInheritedBrand(fix, "repair-inherited-org-brand");
    console.log(`    убрано`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
