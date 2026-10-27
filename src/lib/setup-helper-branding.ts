import { createHash } from "node:crypto";

import { db } from "@/lib/db";
import { pdfLogoFromFile } from "@/lib/pdf-logo";
import { loadPrintBrand } from "@/lib/print-brand.server";

/**
 * Фирменная шапка этикеток «Сетапа помощника» (2026-10-27).
 *
 * Принтер термальный: одна точка — чёрная или белая. Логотип организации
 * растеризуется здесь, на сервере, в 1-битную картинку с дизерингом
 * Флойда — Стейнберга, и приложение печатает её как есть (без порога, который
 * превращает полутона в кашу). Берётся только загруженный в кабинете файл
 * (`OrganizationLogo`); внешние ссылки не читаются (SSRF).
 */

/** 203 dpi = 8 точек/мм. Логотип в шапке — 5 мм, ровно под коробку в шаблонах. */
export const LABEL_LOGO_HEIGHT_DOTS = 40;
/** Предел ширины: 30 мм. */
export const LABEL_LOGO_MAX_WIDTH_DOTS = 240;

export type HelperBrandingLogo = { widthDots: number; heightDots: number; png: string };

export type HelperBranding = {
  version: string;
  orgName: string;
  site: string;
  logo: HelperBrandingLogo | null;
};

/**
 * Версия оформления: меняется, когда поменялся логотип, сайт или название,
 * — по ней приложение решает, скачивать ли шапку заново.
 */
export function brandingVersion(parts: { logoVersion: number | null; site: string; orgName: string }): string {
  return createHash("sha256")
    .update(`${parts.logoVersion ?? 0}|${parts.site}|${parts.orgName}`)
    .digest("hex")
    .slice(0, 16);
}

/**
 * RGBA → чёрно-белый RGBA (0 или 255) дизерингом Флойда — Стейнберга.
 * Прозрачность кладётся на белый. Чистая функция: вход не меняется.
 */
export function ditherFloydSteinberg(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
): Uint8Array {
  const lum = new Float32Array(width * height);
  for (let i = 0; i < width * height; i += 1) {
    const a = rgba[i * 4 + 3] / 255;
    const y = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
    lum[i] = y * a + 255 * (1 - a);
  }
  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      const old = lum[i];
      const value = old < 128 ? 0 : 255;
      const error = old - value;
      if (x + 1 < width) lum[i + 1] += (error * 7) / 16;
      if (y + 1 < height) {
        if (x > 0) lum[i + width - 1] += (error * 3) / 16;
        lum[i + width] += (error * 5) / 16;
        if (x + 1 < width) lum[i + width + 1] += (error * 1) / 16;
      }
      const o = i * 4;
      out[o] = value;
      out[o + 1] = value;
      out[o + 2] = value;
      out[o + 3] = 255;
    }
  }
  return out;
}

/** Размер логотипа на этикетке: высота 40 точек, ширина по пропорциям, не шире 240. */
export function labelLogoSize(sourceWidth: number, sourceHeight: number): { width: number; height: number } {
  if (!(sourceWidth > 0) || !(sourceHeight > 0)) return { width: 0, height: 0 };
  let height = LABEL_LOGO_HEIGHT_DOTS;
  let width = Math.round((sourceWidth * height) / sourceHeight);
  if (width > LABEL_LOGO_MAX_WIDTH_DOTS) {
    width = LABEL_LOGO_MAX_WIDTH_DOTS;
    height = Math.max(1, Math.round((sourceHeight * width) / sourceWidth));
  }
  return { width: Math.max(1, width), height };
}

/** Файл логотипа → 1-битный PNG для этикетки. Битый файл → null (шапка с названием). */
export async function rasterizeLabelLogo(file: {
  bytes: Uint8Array;
  mime: string;
}): Promise<HelperBrandingLogo | null> {
  const source = await pdfLogoFromFile(file);
  if (!source) return null;
  try {
    const { createCanvas, loadImage } = await import("@napi-rs/canvas");
    const image = await loadImage(Buffer.from(source.data));
    const size = labelLogoSize(image.width, image.height);
    if (!size.width) return null;
    const canvas = createCanvas(size.width, size.height);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, size.width, size.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(image, 0, 0, size.width, size.height);
    const pixels = ctx.getImageData(0, 0, size.width, size.height);
    const mono = ditherFloydSteinberg(pixels.data, size.width, size.height);
    const target = ctx.getImageData(0, 0, size.width, size.height);
    target.data.set(mono);
    ctx.putImageData(target, 0, 0);
    return {
      widthDots: size.width,
      heightDots: size.height,
      png: canvas.toBuffer("image/png").toString("base64"),
    };
  } catch (error) {
    console.warn("[setup-helper-branding] logo rasterize failed", error instanceof Error ? error.message : error);
    return null;
  }
}

/** Версия оформления организации — дёшево, без растеризации (для ответа на вход). */
export async function loadHelperBrandingVersion(organizationId: string): Promise<string> {
  const [brand, logo] = await Promise.all([
    loadPrintBrand(organizationId),
    db.organizationLogo.findUnique({ where: { organizationId }, select: { version: true } }),
  ]);
  return brandingVersion({ logoVersion: logo?.version ?? null, site: brand.site, orgName: brand.orgName });
}

export async function loadHelperBranding(organizationId: string): Promise<HelperBranding> {
  const [brand, row] = await Promise.all([
    loadPrintBrand(organizationId),
    db.organizationLogo.findUnique({
      where: { organizationId },
      select: { bytes: true, mime: true, version: true },
    }),
  ]);
  const logo = row ? await rasterizeLabelLogo({ bytes: new Uint8Array(row.bytes), mime: row.mime }) : null;
  return {
    version: brandingVersion({ logoVersion: row?.version ?? null, site: brand.site, orgName: brand.orgName }),
    orgName: brand.orgName,
    site: brand.site,
    logo,
  };
}
