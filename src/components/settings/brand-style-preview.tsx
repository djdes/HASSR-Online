"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import QRCode from "qrcode";
import { PrintBrandFrame } from "@/components/print/print-brand-frame";
import { isSquareishLogo, orgMonogram, qrFrameColor, type PrintBrand } from "@/lib/print-brand";

/*
 * Живой предпросмотр фирменного стиля печати: плакат A4, QR-наклейка и
 * этикетка 58×40 мм. Рисуется на клиенте из тех же функций, что и печать
 * (`print-brand.ts`), поэтому меняется ещё до сохранения.
 */

const DEMO_QR_TEXT = "https://wesetup.ru/q/demo";

/** Знак WeSetup для центра QR, когда логотип организации выключен. */
function WesetupMark({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="8" fill="#5566f6" />
      <path d="M7 11l4 11 5-9 5 9 4-11" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Логотип годится в центр QR, только если он почти квадратный: меряем после загрузки. */
function useImageSquareish(url: string | null): boolean {
  const [state, setState] = useState<{ url: string; ok: boolean } | null>(null);
  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    const image = new window.Image();
    image.onload = () => {
      if (!cancelled) setState({ url, ok: isSquareishLogo(image.naturalWidth, image.naturalHeight) });
    };
    image.onerror = () => {
      if (!cancelled) setState({ url, ok: false });
    };
    image.src = url;
    return () => {
      cancelled = true;
    };
  }, [url]);
  return Boolean(url && state && state.url === url && state.ok);
}

export function PosterPreview({ brand, orgName }: { brand: PrintBrand; orgName: string }) {
  const t = useTranslations("settingsManagement.organizationProfile.brandingPage");
  const c = brand.colors;
  const steps = [t("sampleStep1"), t("sampleStep2"), t("sampleStep3")];
  return (
    <div className="mx-auto aspect-[210/297] w-[190px] bg-white shadow-[0_6px_18px_-12px_rgba(11,16,36,0.45)]" data-preview="poster">
      <PrintBrandFrame brand={{ ...brand, orgName }} compact>
        <div className="mt-1 text-[8px] font-bold leading-tight" style={{ color: c.text }}>
          {t("samplePosterTitle")}
        </div>
        <ol className="mt-2 space-y-1.5">
          {steps.map((step, index) => (
            <li key={step} className="flex items-center gap-1.5 text-[6px] leading-tight">
              <span
                className="flex size-3.5 shrink-0 items-center justify-center rounded-full text-[6.5px] font-bold"
                style={{ background: c.secondary, color: c.secondaryOnFill }}
              >
                {index + 1}
              </span>
              {step}
            </li>
          ))}
        </ol>
        <div
          className="mt-2.5 rounded-md px-1.5 py-1.5 text-[6px] leading-tight"
          style={{ background: c.background, border: `0.5px solid ${c.primaryInk}` }}
        >
          {t("sampleBlock")}
        </div>
      </PrintBrandFrame>
    </div>
  );
}

export function QrStickerPreview({ brand, orgName }: { brand: PrintBrand; orgName: string }) {
  const t = useTranslations("settingsManagement.organizationProfile.brandingPage");
  const qr = useMemo(() => QRCode.create(DEMO_QR_TEXT, { errorCorrectionLevel: "H" }), []);
  const logoSquare = useImageSquareish(brand.logoUrl);
  const frame = qrFrameColor(brand);
  const size = qr.modules.size;
  const quiet = 2;
  const total = size + quiet * 2;
  let path = "";
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      if (qr.modules.get(row, col)) path += `M${col + quiet} ${row + quiet}h1v1h-1z`;
    }
  }
  // Центр — как на печати (`brand-qr-center.server.ts`): значок → почти квадратный
  // логотип → буква названия; ни значка, ни логотипа или переключатель выключен —
  // знак WeSetup.
  const hasOwnMark = Boolean(brand.qrIconUrl || brand.logoUrl);
  const centerImage = brand.qr.centerLogo ? (brand.qrIconUrl ?? (logoSquare ? brand.logoUrl : null)) : null;
  const centerLetter = brand.qr.centerLogo && hasOwnMark && !centerImage;
  const wesetupMark = !brand.qr.centerLogo || !hasOwnMark;
  return (
    <div
      className="mx-auto w-[150px] overflow-hidden bg-white"
      style={{ border: `3px solid ${frame}`, borderRadius: 14 }}
      data-preview="qr"
    >
      <div className="relative p-1.5">
        <svg viewBox={`0 0 ${total} ${total}`} className="block w-full" shapeRendering="crispEdges" aria-hidden>
          <rect width={total} height={total} fill="#fff" />
          <path d={path} fill="#000" />
        </svg>
        <div className="absolute left-1/2 top-1/2 flex size-[19%] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-md bg-white p-[2px]">
          {centerImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={centerImage} alt="" className="size-full object-contain" referrerPolicy="no-referrer" />
          ) : centerLetter ? (
            <span
              className="flex size-full items-center justify-center rounded-full text-[11px] font-bold leading-none"
              style={{ background: frame, color: "#fff" }}
            >
              {orgMonogram(orgName)}
            </span>
          ) : wesetupMark ? (
            <WesetupMark size={20} />
          ) : null}
        </div>
      </div>
      <div className="py-1 text-center text-[10px] font-semibold tracking-wide text-white" style={{ background: frame }}>
        {t("qrScan")}
      </div>
    </div>
  );
}

export function LabelPreview({ brand }: { brand: PrintBrand }) {
  const t = useTranslations("settingsManagement.organizationProfile.brandingPage");
  return (
    <div
      className="mx-auto flex h-[160px] w-[232px] flex-col bg-white p-2.5 text-black"
      style={{ border: "2px solid #000", borderRadius: 10 }}
      data-preview="label"
    >
      <div className="flex items-center justify-between gap-2 border-b border-black pb-1">
        {brand.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={brand.logoUrl}
            alt=""
            className="block h-6 max-w-[90px] object-contain object-left"
            style={{ filter: "grayscale(1) contrast(1.4)" }}
            referrerPolicy="no-referrer"
          />
        ) : (
          <span className="truncate text-[9px] font-semibold">{brand.orgName}</span>
        )}
        <span className="shrink-0 text-[9px] font-semibold">{brand.site}</span>
      </div>
      <div className="mt-1.5 text-[13px] font-bold leading-tight">{t("labelName")}</div>
      <div className="mt-1 space-y-0.5 text-[10px] leading-tight">
        <div>{t("labelMade")}</div>
        <div>{t("labelUntil")}</div>
        <div>{t("labelResp")}</div>
      </div>
    </div>
  );
}
