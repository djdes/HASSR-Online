import type { ReactNode } from "react";
import { QrLanguageChoice } from "./qr-language-choice";
import { MaxConnectButton } from "@/components/max/max-connect-button";
import {
  QrHeaderMark,
  qrAccentRootProps,
  qrControlBackground,
  qrHeaderBackground,
} from "@/components/qr-fill/qr-header-brand";
import type { QrPageBrand } from "@/lib/qr-page-brand";

/**
 * Каркас QR-страницы — такой же, как у HTML-формы журналов: узкая тёмная
 * шапка в две строки (организация, название журнала) и колонка контента
 * во всю ширину телефона.
 *
 * `brand` (2026-11-21): логотип и цвет компании из «Фирменного стиля» —
 * шапка в её цвете, логотип вместо значка QR, основные кнопки в том же цвете.
 * Нет — прежняя шапка WeSetup.
 */
export function QrPageShell({
  orgName,
  title,
  brand = null,
  children,
}: {
  orgName: string;
  title: string;
  brand?: QrPageBrand | null;
  children: ReactNode;
}) {
  const root = qrAccentRootProps(brand);
  return (
    <main
      className="min-h-screen bg-[#fafbff] text-[18px] leading-[1.5] text-[#0b1024]"
      data-qr-brand={root["data-qr-brand"]}
      data-partner-accent={root["data-partner-accent"]}
      style={root.style}
    >
      <header
        className="text-white"
        style={{
          background: qrHeaderBackground(brand),
          ["--qr-control-bg" as string]: qrControlBackground(brand),
          // В приложении WeSetup страница под вырезом экрана (viewport-fit=cover):
          // тёмная шапка уходит под строку состояния, текст — ниже неё.
          // В браузере и Telegram отступ 0.
          paddingTop: "var(--safe-area-inset-top, env(safe-area-inset-top, 0px))",
        }}
      >
        <div className="mx-auto flex max-w-[36rem] items-center gap-2.5 px-4 py-3.5">
          <QrHeaderMark logoUrl={brand?.logoUrl ?? null} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[11.5px] font-semibold uppercase tracking-[0.12em] text-white/65" title={orgName}>
              {orgName}
            </div>
            {/* Логотип забирает место у названия: длинное слово — переносом по слогам, а не обрезкой. */}
            <h1 className="mt-px line-clamp-2 text-[19px] font-semibold leading-[1.25] tracking-[-0.01em] hyphens-auto [overflow-wrap:anywhere]">
              {title}
            </h1>
          </div>
          <QrLanguageChoice />
          <MaxConnectButton dark />
        </div>
      </header>
      <div
        className="mx-auto max-w-[36rem] px-4 pt-3.5"
        style={{ paddingBottom: "calc(24px + var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px)))" }}
      >
        {children}
      </div>
    </main>
  );
}
