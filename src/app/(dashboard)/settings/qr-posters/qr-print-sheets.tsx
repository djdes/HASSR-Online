"use client";

import { useSyncExternalStore, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";

import { BRAND_QR_CAPTION_ASPECT } from "@/lib/brand-qr-shared";
import { isJournalObjectQrCode } from "@/lib/journal-qr-target";
import { PRINT_LOGO_MM, printBrandCssVars, type PrintBrand } from "@/lib/print-brand";
import { formatQrValidUntil, posterDetailLine, type QrPoster, type QrPrintFormat } from "@/lib/qr-fill-types";
import type { QrPrintPage } from "@/lib/qr-print-layout";

/**
 * Печатное дерево страницы QR-кодов: ТОЛЬКО выбранные карточки, уже
 * разложенные по листам (`composeQrPrintPages`).
 *
 * Почему так, а не печать экранной сетки:
 *   • листы — прямые потомки блочного корня, а корень — прямой потомок
 *     `<body>` (портал): `break-after` не работает у flex/grid-предков,
 *     а обёртки кабинета именно такие;
 *   • у последнего листа `break-after: auto` — иначе в конце пустой лист;
 *   • высота листа 250 мм: iOS Safari игнорирует поля `@page` и печатает
 *     со своими, лист в 277 мм уезжал на вторую страницу;
 *   • у SVG явные размеры в мм — масштаб печати не «ужимает» код (у
 *     наклейки — наибольший, что влезает над текстом, 29–36 мм по ширине);
 *   • внутри нет header/footer/nav/aside/table: общий печатный CSS
 *     (`globals.css`, `@media print`) их прячет и перекрашивает.
 * Цвета — свои классы с явными значениями: тёмная тема кабинета
 * перекрашивает `bg-white`/`text-[#…]`, а на бумаге нужно чёрное по белому.
 *
 * Фирменный стиль (2026-10-27, `print-brand.ts`): у каждого листа шапка —
 * логотип организации слева, сайт справа (логотип вдвое крупнее прежнего:
 * A4 24 мм, A5 20 мм, наклейка 5,2 мм); плакат A4/A5 и табличка — в рамке
 * основного цвета. Цвет только в `border-color` и в SVG (печать кабинета
 * обнуляет фоны, а `currentColor` в ней чёрный); режим «Ч/б» — все цвета
 * чёрные. Без логотипа в шапке — название организации.
 */

type SheetTranslator = ReturnType<typeof useTranslations<"settingsUi.qrPrintSheets">>;

function stepsFor(poster: QrPoster, t: SheetTranslator): string[] {
  if (poster.kind !== "journal") {
    if (poster.equipmentKind === "uv") return [t("scanCode"), t("uvChooseName"), t("uvTurnOff")];
    if (poster.equipmentKind === "fryer") return [t("scanCode"), t("fryerChooseName"), t("fryerEnd")];
    return [t("scanCode"), t("chooseNameEnterReading"), t("pressSave")];
  }
  if (poster.id.includes("@verify")) {
    return [t("scanCode"), t("chooseResponsible"), t("markEach")];
  }
  if (poster.journalCode === "all") {
    return [t("scanCode"), t("chooseJournalAndYou"), t("fillForm")];
  }
  if (isJournalObjectQrCode(poster.journalCode) && !poster.documentId) {
    return [t("scanSeeToday"), t("scanObjectSticker")];
  }
  return [t("scanCode"), t("chooseYourself"), t("fillForm")];
}

function eyebrowFor(poster: QrPoster, t: SheetTranslator): string {
  if (poster.kind === "room") return t("eyebrowRoom");
  if (poster.kind === "equipment") {
    // У лампы и фритюрницы температуру не вносят — «Температура» сверху сбивала.
    if (poster.equipmentKind === "uv") return t("eyebrowUv");
    if (poster.equipmentKind === "fryer") return t("eyebrowFryer");
    return t("eyebrowEquipment");
  }
  if (isJournalObjectQrCode(poster.journalCode) && !poster.documentId) return t("eyebrowStatus");
  return t("eyebrowFill");
}

function validityLine(poster: QrPoster, t: SheetTranslator): string | null {
  if (!poster.validUntil) return null;
  const until = formatQrValidUntil(poster.validUntil);
  // Сравнение — с константой из lib/qr-fill-types, не отображаемый текст.
  return until === "бессрочно" ? t("documentCode") : t("validUntil", { until });
}

const SVG_SIZE = /<svg([^>]*?)\swidth="[^"]*"\s+height="[^"]*"/;

/**
 * SVG с явными размерами в мм (помощник `brand-qr.ts` ставит width/height
 * в px): ширина `mm`, высота — по пропорции `viewBox` (у фирменного QR под
 * кодом полоса «Отсканировать», плитка выше квадрата).
 */
function sizedSvg(svg: string, mm: number): string {
  const box = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg);
  const height = box ? (mm * Number(box[2])) / Number(box[1]) : mm;
  return svg.replace(SVG_SIZE, `<svg$1 width="${mm}mm" height="${height.toFixed(2)}mm"`);
}

/**
 * `fluid` — без размеров: наклейка занимает высоту, что осталась над
 * текстом (CSS `.qrp-sticker-code`), а `mm` — наибольшая ширина.
 */
function Code({ poster, mm, className, fluid = false }: { poster: QrPoster; mm: number; className: string; fluid?: boolean }) {
  return (
    <div
      className={className}
      data-qr-print-code=""
      data-qr-print-url={poster.url}
      data-qr-print-mm={mm}
      // SVG собран на сервере (brand-qr.ts) из нашего адреса — безопасно встраивать.
      dangerouslySetInnerHTML={{ __html: fluid ? poster.svg.replace(SVG_SIZE, "<svg$1") : sizedSvg(poster.svg, mm) }}
    />
  );
}

/** Шапка листа: логотип слева (без него — название организации), сайт справа. */
function Header({ brand, size }: { brand: PrintBrand; size: keyof typeof PRINT_LOGO_MM }) {
  const logo = PRINT_LOGO_MM[size];
  return (
    <div className={`qrp-head qrp-head-${size}`} data-qr-print-head="">
      {brand.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- логотип организации, любой адрес
        <img src={brand.logoUrl} alt="" className="qrp-logo" style={{ height: `${logo.height}mm`, maxWidth: `${logo.maxWidth}mm` }} />
      ) : (
        <span className="qrp-head-name">{brand.orgName}</span>
      )}
      <span className="qrp-site">{brand.site}</span>
    </div>
  );
}

function PosterA4({ poster, brand }: { poster: QrPoster; brand: PrintBrand }) {
  const t = useTranslations("settingsUi.qrPrintSheets");
  const detail = posterDetailLine(poster);
  const validity = validityLine(poster, t);
  return (
    <div className="qrp-a4 qrp-frame">
      <Header brand={brand} size="a4" />
      <div className="qrp-eyebrow">{eyebrowFor(poster, t)}</div>
      <div className="qrp-a4-title">{poster.title}</div>
      <div className="qrp-org">{poster.orgName}</div>
      {detail ? <div className="qrp-detail">{detail}</div> : null}
      <Code poster={poster} mm={100} className="qrp-a4-code" />
      <ol className="qrp-steps qrp-a4-steps">
        {stepsFor(poster, t).map((step, index) => (
          <li key={step}>
            <b>{index + 1}.</b> {step}
          </li>
        ))}
      </ol>
      {validity ? <div className="qrp-valid">{validity}</div> : null}
    </div>
  );
}

function PosterA5({ poster, brand }: { poster: QrPoster; brand: PrintBrand }) {
  const t = useTranslations("settingsUi.qrPrintSheets");
  const detail = posterDetailLine(poster);
  const validity = validityLine(poster, t);
  return (
    <div className="qrp-a5">
      {/* Рамка — внутри ячейки: пунктир реза между A5 остаётся снаружи рамок. */}
      <div className="qrp-a5-frame qrp-frame">
        <Header brand={brand} size="a5" />
        <div className="qrp-a5-body">
          <Code poster={poster} mm={72} className="qrp-a5-code" />
          <div className="qrp-a5-text">
            <div className="qrp-eyebrow">{eyebrowFor(poster, t)}</div>
            <div className="qrp-a5-title">{poster.title}</div>
            <div className="qrp-org">{poster.orgName}</div>
            {detail ? <div className="qrp-detail">{detail}</div> : null}
            <ol className="qrp-steps qrp-a5-steps">
              {stepsFor(poster, t).map((step, index) => (
                <li key={step}>
                  <b>{index + 1}.</b> {step}
                </li>
              ))}
            </ol>
            {validity ? <div className="qrp-valid">{validity}</div> : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function Sticker({ poster, brand }: { poster: QrPoster; brand: PrintBrand }) {
  const t = useTranslations("settingsUi.qrPrintSheets");
  const detail = posterDetailLine(poster);
  const validity = validityLine(poster, t);
  return (
    <div className="qrp-sticker">
      <Header brand={brand} size="sticker" />
      <Code poster={poster} mm={36} className="qrp-sticker-code" fluid />
      <div className="qrp-sticker-title">{poster.title}</div>
      <div className="qrp-sticker-org">{poster.orgName}</div>
      {detail ? <div className="qrp-sticker-detail">{detail}</div> : null}
      {validity ? <div className="qrp-sticker-detail">{validity}</div> : null}
    </div>
  );
}

/** Табличка на холодильник или морозильник: слово, режим, номер, цех и QR для записи температуры. */
function Plate({ poster, brand }: { poster: QrPoster; brand: PrintBrand }) {
  const t = useTranslations("settingsUi.qrPrintSheets");
  const plate = poster.plate;
  if (!plate) return null;
  return (
    <div className="qrp-plate" data-qr-print-plate="">
      <div className="qrp-plate-frame qrp-frame">
        <Header brand={brand} size="plate" />
        <div className="qrp-plate-word">{plate.word}</div>
        <div className="qrp-plate-label">{t("plateRegimeLabel")}</div>
        <div className="qrp-plate-regime">{plate.regime}</div>
        <Code poster={poster} mm={46} className="qrp-plate-code" />
        <div className="qrp-plate-foot">
          <span className="qrp-plate-no">{`№ ${plate.number}`}</span>
          <span className="qrp-plate-area">{plate.area}</span>
        </div>
      </div>
    </div>
  );
}

function Sheet({ page, posters, brand }: { page: QrPrintPage; posters: Map<string, QrPoster>; brand: PrintBrand }) {
  const list = page.keys.map((key) => posters.get(key)).filter((poster): poster is QrPoster => Boolean(poster));
  const format: QrPrintFormat = page.format;
  return (
    <div className={`qrp-sheet qrp-sheet-${format}`} data-qr-sheet={format}>
      {format === "a4" ? list.map((poster) => <PosterA4 key={poster.id} poster={poster} brand={brand} />) : null}
      {format === "a5" ? list.map((poster) => <PosterA5 key={poster.id} poster={poster} brand={brand} />) : null}
      {format === "plate" ? (
        <div className="qrp-plate-grid">
          {list.map((poster) => (
            <Plate key={poster.id} poster={poster} brand={brand} />
          ))}
        </div>
      ) : null}
      {format === "sticker" ? (
        <div className="qrp-sticker-grid">
          {list.map((poster) => (
            <Sticker key={poster.id} poster={poster} brand={brand} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

const noopSubscribe = () => () => {};
/** true после гидратации (на сервере и при гидратации — false): портал только в браузере. */
export function useHydrated(): boolean {
  return useSyncExternalStore(noopSubscribe, () => true, () => false);
}

export function QrPrintSheets({
  pages,
  posters,
  brand,
}: {
  pages: QrPrintPage[];
  posters: Map<string, QrPoster>;
  /** Фирменный стиль организации (`loadPrintBrand`): логотип, сайт, цвета, «Ч/б». */
  brand: PrintBrand;
}) {
  const hydrated = useHydrated();
  if (!hydrated) return null;
  const target = document.body;
  const style = printBrandCssVars(brand.colors) as CSSProperties;
  return createPortal(
    <div className="qrp-root" data-qr-print-root="" data-print-mono={brand.mono ? "1" : undefined} aria-hidden style={style}>
      {/* Стиль — первым: у последнего ЛИСТА должен быть `:last-child`. */}
      <style>{PRINT_CSS}</style>
      {pages.map((page, index) => (
        <Sheet key={`${page.format}-${index}`} page={page} posters={posters} brand={brand} />
      ))}
    </div>,
    target
  );
}

const PRINT_CSS = `
.qrp-root { display: none; }
@page { size: A4 portrait; margin: 10mm; }
@media print {
  html, body { background: #fff !important; margin: 0 !important; padding: 0 !important; }
  body > *:not(.qrp-root) { display: none !important; }
  .qrp-root { display: block !important; color: #000; background: #fff; font-family: inherit; }
  .qrp-root * { box-sizing: border-box; color: #000 !important; background: transparent !important; border-radius: 0 !important; }
  .qrp-sheet {
    display: block; position: relative; width: 190mm; height: 250mm; overflow: hidden; margin: 0;
    break-after: page; page-break-after: always; break-inside: avoid; page-break-inside: avoid;
  }
  .qrp-sheet:last-child, .qrp-sheet:last-of-type { break-after: auto; page-break-after: auto; }
  .qrp-root svg { display: block; }
  .qrp-root img { display: block; }

  /* Цвет — только border-color и SVG: фоны печать кабинета обнуляет. В «Ч/б» все переменные чёрные. */
  .qrp-root .qrp-frame { border: 1.2mm solid var(--pb-primary) !important; border-radius: 5mm !important; }
  .qrp-root .qrp-eyebrow { font-size: 10.5pt; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: var(--pb-primary-ink) !important; }
  .qrp-org { font-size: 12pt; margin-top: 1.5mm; }
  .qrp-detail { font-size: 11pt; margin-top: 1mm; font-weight: 600; }
  .qrp-steps { list-style: none; margin: 0; padding: 0; }
  .qrp-steps li { margin-top: 1.6mm; }
  .qrp-root .qrp-steps li b { color: var(--pb-primary-ink) !important; }
  .qrp-root .qrp-valid { margin-top: 4mm; font-size: 11pt; font-weight: 600; border: 0.3mm solid var(--pb-primary-ink) !important; padding: 1.5mm 3mm; display: inline-block; }

  /* Шапка: логотип слева, сайт справа, линия основного цвета. */
  .qrp-root .qrp-head { display: flex; align-items: center; justify-content: space-between; gap: 5mm; width: 100%; padding-bottom: 2.5mm; border-bottom: 0.6mm solid var(--pb-primary-ink) !important; }
  .qrp-logo { width: auto; object-fit: contain; object-position: left center; flex: 0 1 auto; min-width: 0; }
  .qrp-head-name { min-width: 0; font-size: 13pt; font-weight: 700; line-height: 1.15; }
  .qrp-root .qrp-site { flex-shrink: 0; font-size: 12pt; font-weight: 600; letter-spacing: -0.01em; color: var(--pb-primary-ink) !important; }

  .qrp-a4 { height: 250mm; display: flex; flex-direction: column; align-items: center; text-align: center; padding: 6mm 8mm; }
  .qrp-a4 .qrp-eyebrow { margin-top: 5mm; }
  .qrp-a4-title { font-size: 24pt; font-weight: 700; line-height: 1.15; margin-top: 3mm; max-width: 170mm; }
  .qrp-a4-code { margin-top: 6mm; }
  .qrp-a4-steps { font-size: 13pt; margin-top: 6mm; width: 150mm; text-align: left; }

  .qrp-a5 { height: 125mm; padding: 2mm; }
  .qrp-a5 + .qrp-a5 { border-top: 0.3mm dashed #666 !important; }
  .qrp-root .qrp-a5-frame { height: 100%; padding: 4mm 5mm; border-width: 0.9mm !important; border-radius: 4mm !important; display: flex; flex-direction: column; }
  .qrp-a5-body { flex: 1; min-height: 0; display: flex; align-items: center; gap: 6mm; }
  .qrp-a5-text { min-width: 0; flex: 1; }
  .qrp-a5-title { font-size: 16pt; font-weight: 700; line-height: 1.15; margin-top: 2mm; }
  .qrp-a5-steps { font-size: 10pt; margin-top: 3mm; }
  .qrp-a5 .qrp-valid { font-size: 9.5pt; margin-top: 3mm; }

  .qrp-sticker-grid { display: grid; grid-template-columns: repeat(3, 1fr); grid-template-rows: repeat(4, 60mm); gap: 3mm; height: 249mm; }
  .qrp-sticker {
    display: flex; flex-direction: column; align-items: center; justify-content: flex-start; text-align: center;
    border: 0.3mm dashed #777 !important; padding: 2mm 2.5mm; overflow: hidden;
  }
  .qrp-root .qrp-sticker .qrp-head { padding-bottom: 1mm; border-bottom-width: 0.35mm !important; gap: 2mm; }
  .qrp-sticker .qrp-head-name { font-size: 7pt; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .qrp-root .qrp-sticker .qrp-site { font-size: 6.5pt; }
  /* Код наклейки — всё, что осталось под шапкой и над текстом: от 25 до 36 мм
     по ширине (высота плитки = ширина × пропорция с полосой). Текст под кодом —
     не больше пяти строк: название — две, организация, период/документ и
     срок — по одной (длинные обрезаются многоточием). */
  .qrp-sticker-code {
    flex: 1 1 0; min-height: ${(25 * BRAND_QR_CAPTION_ASPECT).toFixed(2)}mm; max-height: ${(36 * BRAND_QR_CAPTION_ASPECT).toFixed(2)}mm;
    width: 100%; display: flex; justify-content: center; margin-top: 1mm;
  }
  .qrp-sticker-code svg { height: 100%; width: auto; }
  .qrp-sticker-title { font-size: 10pt; font-weight: 700; line-height: 1.1; margin-top: 1.2mm; max-height: 2.2em; overflow: hidden; }
  .qrp-sticker-org { font-size: 7.5pt; line-height: 1.15; margin-top: 0.6mm; }
  .qrp-sticker-detail { font-size: 7.5pt; font-weight: 600; line-height: 1.15; margin-top: 0.3mm; }
  .qrp-sticker-org, .qrp-sticker-detail { max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

  /* Табличка на оборудование: 4 на лист (2 × 2), каждая в толстой скруглённой рамке. */
  .qrp-plate-grid { display: grid; grid-template-columns: repeat(2, 95mm); grid-template-rows: repeat(2, 125mm); height: 250mm; }
  .qrp-plate { padding: 2mm; height: 125mm; }
  .qrp-root .qrp-plate-frame { height: 100%; padding: 4mm 5mm; display: flex; flex-direction: column; align-items: center; text-align: center; border-width: 2.2mm !important; border-radius: 6mm !important; }
  .qrp-root .qrp-plate .qrp-head { gap: 3mm; padding-bottom: 2mm; }
  .qrp-plate .qrp-head-name { font-size: 10pt; }
  .qrp-root .qrp-plate .qrp-site { font-size: 10pt; }
  .qrp-root .qrp-plate-word { margin-top: 3mm; font-size: 38pt; font-weight: 800; line-height: 1; letter-spacing: 0.04em; color: var(--pb-primary-ink) !important; }
  .qrp-plate-label { margin-top: 2mm; font-size: 8.5pt; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; }
  .qrp-plate-regime { margin-top: 0.5mm; font-size: 20pt; font-weight: 700; line-height: 1.1; white-space: nowrap; }
  .qrp-plate-code { margin-top: 3mm; }
  .qrp-plate-foot { margin-top: auto; width: 100%; display: flex; align-items: center; justify-content: center; gap: 3mm; padding-top: 2mm; }
  .qrp-root .qrp-plate-no { font-size: 17pt; font-weight: 800; border: 0.7mm solid var(--pb-primary) !important; border-radius: 3mm !important; padding: 0.5mm 3mm; white-space: nowrap; }
  .qrp-plate-area { min-width: 0; font-size: 13pt; font-weight: 700; line-height: 1.1; max-height: 2.3em; overflow: hidden; }
}
`;
