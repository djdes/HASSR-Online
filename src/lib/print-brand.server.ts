/**
 * Загрузка фирменного стиля печати организации (`print-brand.ts`).
 * Один `select` — без байтов логотипа и значка.
 */

import { db } from "@/lib/db";
import {
  DEFAULT_PRINT_BRAND_SOURCE,
  resolvePrintBrand,
  type PrintBrand,
  type PrintBrandSource,
} from "@/lib/print-brand";

export const PRINT_BRAND_SELECT = {
  name: true,
  logoUrl: true,
  qrIconUrl: true,
  brandColor: true,
  brandColor2: true,
  brandColor3: true,
  website: true,
  qrBrandFrame: true,
  qrCenterLogo: true,
} as const;

export async function loadPrintBrandSource(organizationId: string): Promise<PrintBrandSource> {
  const org = await db.organization.findUnique({
    where: { id: organizationId },
    select: PRINT_BRAND_SELECT,
  });
  return org ?? DEFAULT_PRINT_BRAND_SOURCE;
}

export async function loadPrintBrand(
  organizationId: string,
  options: { mono?: boolean } = {},
): Promise<PrintBrand> {
  return resolvePrintBrand(await loadPrintBrandSource(organizationId), options);
}
