import type { CSSProperties } from "react";
import { QrCode } from "lucide-react";
import type { QrPageBrand } from "@/lib/qr-page-brand";

/*
 * Шапка страницы, которую сотрудник открывает по QR-наклейке (2026-11-21):
 * в цвете компании и с её логотипом, если они заданы в «Фирменном стиле»,
 * иначе — прежняя тёмная шапка WeSetup. Общая для настоящих страниц
 * (`QrPageShell`) и предпросмотра «Телефон сотрудника» в «Фирменном стиле».
 */

export const WESETUP_QR_HEADER_BACKGROUND =
  "radial-gradient(circle at 8% 0%, rgba(85,102,246,.55), transparent 55%), radial-gradient(circle at 100% 100%, rgba(122,92,255,.4), transparent 55%), #0b1024";

/**
 * Сплошной фон элементов управления в шапке (выбор языка): нативный список
 * берёт его цвет, поэтому не полупрозрачный — тон темнее шапки.
 */
export function qrControlBackground(brand: QrPageBrand | null | undefined): string {
  return brand?.accentHover ?? "#252b59";
}

/** Фон шапки: цвет компании (уже затемнён до читаемости белого текста) или WeSetup. */
export function qrHeaderBackground(brand: QrPageBrand | null | undefined): string {
  if (!brand?.accent) return WESETUP_QR_HEADER_BACKGROUND;
  return `radial-gradient(circle at 8% 0%, rgba(255,255,255,.18), transparent 55%), linear-gradient(135deg, ${brand.accent}, ${brand.accentHover ?? brand.accent})`;
}

/**
 * Атрибуты корня страницы: акцент компании перекрашивает основные кнопки и
 * выделения теми же правилами, что акцент партнёра в кабинете (`app-theme.css`).
 */
export function qrAccentRootProps(brand: QrPageBrand | null | undefined): {
  "data-qr-brand"?: "";
  "data-partner-accent"?: "";
  style?: CSSProperties;
} {
  if (!brand) return {};
  if (!brand.accent) return { "data-qr-brand": "" };
  return {
    "data-qr-brand": "",
    "data-partner-accent": "",
    style: { "--brand-accent": brand.accent, "--brand-accent-hover": brand.accentHover ?? brand.accent } as CSSProperties,
  };
}

/** Знак слева в шапке: логотип компании на белой плашке или значок QR. */
export function QrHeaderMark({ logoUrl, small = false }: { logoUrl: string | null; small?: boolean }) {
  if (logoUrl) {
    return (
      <span
        className={
          small
            ? "flex h-7 max-w-[72px] shrink-0 items-center justify-center rounded-lg bg-white px-1"
            : "flex h-10 max-w-[88px] shrink-0 items-center justify-center rounded-xl bg-white px-1.5 shadow-[0_1px_2px_rgba(0,0,0,0.12)]"
        }
        data-qr-logo
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={logoUrl}
          alt=""
          className={small ? "max-h-5 w-auto max-w-full object-contain" : "max-h-8 w-auto max-w-full object-contain"}
          referrerPolicy="no-referrer"
        />
      </span>
    );
  }
  return (
    <div
      className={
        small
          ? "flex size-7 shrink-0 items-center justify-center rounded-lg bg-white/10 shadow-[inset_0_0_0_1px_rgba(255,255,255,.2)]"
          : "flex size-9 shrink-0 items-center justify-center rounded-xl bg-white/10 shadow-[inset_0_0_0_1px_rgba(255,255,255,.2)]"
      }
    >
      <QrCode className={small ? "size-3.5" : "size-[18px]"} />
    </div>
  );
}
