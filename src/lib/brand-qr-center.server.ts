/**
 * Центр фирменного QR организации (server-only, 2026-10-27; решение D5):
 *   1. включено «Логотип в центре QR» — иначе знак WeSetup;
 *   2. загруженный значок QR (`OrganizationQrIcon`) → он;
 *   3. иначе свой загруженный логотип, если он почти квадратный → он;
 *   4. иначе у организации есть логотип (любой формы) → первая буква названия
 *      в круге основного цвета (в «Ч/б» — чёрном);
 *   5. логотипа нет совсем → знак WeSetup.
 * Внешние ссылки на логотип сервер не скачивает (SSRF): только свои файлы.
 */

import type { BrandQrCenter, BrandQrOptions } from "@/lib/brand-qr";
import { db } from "@/lib/db";
import { readOrgLogo } from "@/lib/org-logo";
import { isOwnUploadedLogo, pdfLogoFromFile, type PdfLogo } from "@/lib/pdf-logo";
import { isSquareishLogo, orgMonogram, qrFrameColor, type PrintBrand } from "@/lib/print-brand";

/** Сторона PNG значка в центре, px: хватает для печати 20 мм и не раздувает SVG. */
const CENTER_PNG_SIDE = 256;

async function shrinkToCenterPng(logo: PdfLogo): Promise<Uint8Array | null> {
  const longest = Math.max(logo.width, logo.height);
  if (longest <= CENTER_PNG_SIDE) return logo.data;
  try {
    const { createCanvas, loadImage } = await import("@napi-rs/canvas");
    const image = await loadImage(Buffer.from(logo.data));
    const scale = CENTER_PNG_SIDE / longest;
    const width = Math.max(1, Math.round(logo.width * scale));
    const height = Math.max(1, Math.round(logo.height * scale));
    const canvas = createCanvas(width, height);
    canvas.getContext("2d").drawImage(image, 0, 0, width, height);
    return new Uint8Array(canvas.toBuffer("image/png"));
  } catch (error) {
    console.warn("[brand-qr-center] shrink failed", error instanceof Error ? error.message : error);
    return null;
  }
}

async function centerFromFile(file: { bytes: Uint8Array; mime: string }, squareOnly: boolean): Promise<BrandQrCenter | null> {
  const logo = await pdfLogoFromFile(file);
  if (!logo) return null;
  if (squareOnly && !isSquareishLogo(logo.width, logo.height)) return null;
  const png = await shrinkToCenterPng(logo);
  return png ? { kind: "image", png } : null;
}

export async function resolveQrCenter(organizationId: string, brand: PrintBrand): Promise<BrandQrCenter> {
  if (!brand.qr.centerLogo) return { kind: "mark" };
  try {
    const icon = await db.organizationQrIcon.findUnique({
      where: { organizationId },
      select: { bytes: true, mime: true },
    });
    if (icon) {
      const center = await centerFromFile({ bytes: new Uint8Array(icon.bytes), mime: icon.mime }, false);
      if (center) return center;
    }
    const hasOwnLogo = isOwnUploadedLogo(organizationId, brand.logoUrl);
    if (hasOwnLogo) {
      const file = await readOrgLogo(organizationId);
      if (file) {
        const center = await centerFromFile(file, true);
        if (center) return center;
      }
    }
    if (brand.logoUrl) {
      return { kind: "letter", letter: orgMonogram(brand.orgName), color: brand.mono ? "#000000" : brand.colors.primary };
    }
  } catch (error) {
    console.warn("[brand-qr-center] resolve failed", error instanceof Error ? error.message : error);
  }
  return { kind: "mark" };
}

/** Готовые параметры для `brandQrSvg` / `brandQrPng`: цвет рамки и центр организации. */
export async function brandQrOptionsFor(organizationId: string, brand: PrintBrand): Promise<BrandQrOptions> {
  return { frameColor: qrFrameColor(brand), center: await resolveQrCenter(organizationId, brand) };
}
