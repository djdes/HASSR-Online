/**
 * Рамка печатного листа A4 в фирменном стиле (2026-10-27): плакаты, лист
 * проверяющего, политика ХАССП. Шапка — логотип организации слева, сайт
 * справа; подвал — название организации и сайт. Серверный компонент без
 * хуков. Цвета — `PrintBrand` (`src/lib/print-brand.ts`).
 *
 * Цвет рамки и линии шапки задан `border-color` — в печати кабинета он не
 * сбрасывается и печатается даже с выключенной «печатью фона».
 */

import type { CSSProperties, ReactNode } from "react";

import { PRINT_LOGO_MM, printBrandCssVars, type PrintBrand } from "@/lib/print-brand";

/** Логотип слева, сайт справа. Без логотипа — название организации. */
export function PrintBrandHeader({
  brand,
  logoHeightMm = PRINT_LOGO_MM.a4.height,
  logoMaxWidthMm = PRINT_LOGO_MM.a4.maxWidth,
  compact = false,
}: {
  brand: PrintBrand;
  logoHeightMm?: number;
  logoMaxWidthMm?: number;
  /** Уменьшенная копия (карточка предпросмотра). */
  compact?: boolean;
}) {
  const scale = compact ? 0.25 : 1;
  return (
    // div, не <header>: печать кабинета прячет все header.
    <div
      data-print-brand-header
      className="flex items-center justify-between gap-4"
      style={{
        borderBottom: `${compact ? 0.5 : 2}px solid ${brand.colors.primaryInk}`,
        paddingBottom: compact ? 3 : "3mm",
      }}
    >
      {brand.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- логотип организации, любой домен
        <img
          src={brand.logoUrl}
          alt={brand.orgName}
          className="block object-contain object-left"
          style={{
            height: `${logoHeightMm * scale}mm`,
            maxWidth: `${logoMaxWidthMm * scale}mm`,
            width: "auto",
          }}
        />
      ) : (
        <span
          className="font-semibold leading-tight"
          style={{ color: brand.colors.text, fontSize: compact ? 7 : "15pt" }}
        >
          {brand.orgName}
        </span>
      )}
      <span
        className="shrink-0 font-semibold tracking-[-0.01em]"
        style={{ color: brand.colors.primaryInk, fontSize: compact ? 6 : "12pt" }}
      >
        {brand.site}
      </span>
    </div>
  );
}

/** Подвал листа: название организации · сайт. */
export function PrintBrandFooter({ brand, compact = false }: { brand: PrintBrand; compact?: boolean }) {
  return (
    <div
      data-print-brand-footer
      className="flex items-center justify-between gap-4"
      style={{
        borderTop: `${compact ? 0.5 : 1}px solid ${brand.colors.primaryInk}`,
        paddingTop: compact ? 2 : "2.5mm",
        color: brand.colors.text,
        fontSize: compact ? 5 : "9pt",
      }}
    >
      <span>{brand.orgName}</span>
      <span>{brand.site}</span>
    </div>
  );
}

/**
 * Лист A4 в рамке: рамка основного цвета со скруглёнными углами, внутри
 * шапка, содержимое и подвал. `compact` — карточка-превью (тот же лист,
 * уменьшенный), без минимальной высоты A4.
 */
export function PrintBrandFrame({
  brand,
  children,
  compact = false,
  footer = true,
  className = "",
}: {
  brand: PrintBrand;
  children: ReactNode;
  compact?: boolean;
  footer?: boolean;
  className?: string;
}) {
  const style: CSSProperties = {
    ...(printBrandCssVars(brand.colors) as CSSProperties),
    border: `${compact ? "1px" : "1.2mm"} solid ${brand.colors.primary}`,
    borderRadius: compact ? 6 : "5mm",
    color: brand.colors.text,
  };
  return (
    <article
      data-print-brand-frame
      data-print-mono={brand.mono ? "1" : undefined}
      className={`mx-auto flex flex-col bg-white ${
        compact ? "h-full gap-1.5 p-2" : "min-h-[1050px] max-w-[794px] gap-[5mm] p-[8mm] print:min-h-[273mm] print:max-w-none"
      } ${className}`}
      style={style}
    >
      <PrintBrandHeader brand={brand} compact={compact} />
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      {footer ? <PrintBrandFooter brand={brand} compact={compact} /> : null}
    </article>
  );
}
