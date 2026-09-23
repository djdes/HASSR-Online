"use client";

import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

import { isJournalObjectQrCode } from "@/lib/journal-qr-target";
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
 *   • у SVG явные размеры в мм — масштаб печати не «ужимает» код;
 *   • внутри нет header/footer/nav/aside/table: общий печатный CSS
 *     (`globals.css`, `@media print`) их прячет и перекрашивает.
 * Цвета — свои классы с явными значениями: тёмная тема кабинета
 * перекрашивает `bg-white`/`text-[#…]`, а на бумаге нужно чёрное по белому.
 */

const STEPS_JOURNAL = ["Наведите камеру телефона на код.", "Выберите себя в списке.", "Заполните форму и нажмите «Сохранить»."];
const STEPS_HUB = ["Наведите камеру телефона на код.", "Выберите журнал и себя.", "Заполните форму и нажмите «Сохранить»."];
const STEPS_VERIFY = ["Наведите камеру телефона на код.", "Выберите себя — ответственного за смену.", "Отметьте каждому «Допущен» или «Отстранён»."];
const STEPS_OBJECT_JOURNAL = ["Наведите камеру телефона на код — увидите, что сегодня уже записано.", "Чтобы внести показание, отсканируйте наклейку на самом объекте."];
const STEPS_OBJECT = ["Наведите камеру телефона на код.", "Выберите своё имя и введите показание.", "Нажмите «Сохранить» — запись попадёт в журнал за сегодня."];

function stepsFor(poster: QrPoster): string[] {
  if (poster.kind !== "journal") return STEPS_OBJECT;
  if (poster.id.includes("@verify")) return STEPS_VERIFY;
  if (poster.journalCode === "all") return STEPS_HUB;
  if (isJournalObjectQrCode(poster.journalCode) && !poster.documentId) return STEPS_OBJECT_JOURNAL;
  return STEPS_JOURNAL;
}

function eyebrowFor(poster: QrPoster): string {
  if (poster.kind === "room") return "Температура и влажность";
  if (poster.kind === "equipment") return "Температура";
  if (isJournalObjectQrCode(poster.journalCode) && !poster.documentId) return "Статус за сегодня";
  return "Заполнить с телефона";
}

function validityLine(poster: QrPoster): string | null {
  if (!poster.validUntil) return null;
  const until = formatQrValidUntil(poster.validUntil);
  return until === "бессрочно" ? "Код этого документа" : `Действует до ${until} включительно`;
}

/** SVG с явными размерами в мм (библиотека qrcode ставит width/height в px). */
function sizedSvg(svg: string, mm: number): string {
  return svg.replace(/<svg([^>]*?)\swidth="[^"]*"\s+height="[^"]*"/, `<svg$1 width="${mm}mm" height="${mm}mm"`);
}

function Code({ poster, mm, className }: { poster: QrPoster; mm: number; className: string }) {
  return (
    <div
      className={className}
      data-qr-print-code=""
      data-qr-print-url={poster.url}
      data-qr-print-mm={mm}
      // SVG собран на сервере библиотекой qrcode — безопасно встраивать.
      dangerouslySetInnerHTML={{ __html: sizedSvg(poster.svg, mm) }}
    />
  );
}

function PosterA4({ poster }: { poster: QrPoster }) {
  const detail = posterDetailLine(poster);
  const validity = validityLine(poster);
  return (
    <div className="qrp-a4">
      <div className="qrp-eyebrow">{eyebrowFor(poster)}</div>
      <div className="qrp-a4-title">{poster.title}</div>
      <div className="qrp-org">{poster.orgName}</div>
      {detail ? <div className="qrp-detail">{detail}</div> : null}
      <Code poster={poster} mm={105} className="qrp-a4-code" />
      <ol className="qrp-steps qrp-a4-steps">
        {stepsFor(poster).map((step, index) => (
          <li key={step}>
            <b>{index + 1}.</b> {step}
          </li>
        ))}
      </ol>
      {validity ? <div className="qrp-valid">{validity}</div> : null}
    </div>
  );
}

function PosterA5({ poster }: { poster: QrPoster }) {
  const detail = posterDetailLine(poster);
  const validity = validityLine(poster);
  return (
    <div className="qrp-a5">
      <Code poster={poster} mm={78} className="qrp-a5-code" />
      <div className="qrp-a5-text">
        <div className="qrp-eyebrow">{eyebrowFor(poster)}</div>
        <div className="qrp-a5-title">{poster.title}</div>
        <div className="qrp-org">{poster.orgName}</div>
        {detail ? <div className="qrp-detail">{detail}</div> : null}
        <ol className="qrp-steps qrp-a5-steps">
          {stepsFor(poster).map((step, index) => (
            <li key={step}>
              <b>{index + 1}.</b> {step}
            </li>
          ))}
        </ol>
        {validity ? <div className="qrp-valid">{validity}</div> : null}
      </div>
    </div>
  );
}

function Sticker({ poster }: { poster: QrPoster }) {
  const detail = posterDetailLine(poster);
  const validity = validityLine(poster);
  return (
    <div className="qrp-sticker">
      <Code poster={poster} mm={34} className="qrp-sticker-code" />
      <div className="qrp-sticker-title">{poster.title}</div>
      <div className="qrp-sticker-org">{poster.orgName}</div>
      {detail ? <div className="qrp-sticker-detail">{detail}</div> : null}
      {validity ? <div className="qrp-sticker-detail">{validity}</div> : null}
    </div>
  );
}

function Sheet({ page, posters }: { page: QrPrintPage; posters: Map<string, QrPoster> }) {
  const list = page.keys.map((key) => posters.get(key)).filter((poster): poster is QrPoster => Boolean(poster));
  const format: QrPrintFormat = page.format;
  return (
    <div className={`qrp-sheet qrp-sheet-${format}`} data-qr-sheet={format}>
      {format === "a4" ? list.map((poster) => <PosterA4 key={poster.id} poster={poster} />) : null}
      {format === "a5" ? list.map((poster) => <PosterA5 key={poster.id} poster={poster} />) : null}
      {format === "sticker" ? (
        <div className="qrp-sticker-grid">
          {list.map((poster) => (
            <Sticker key={poster.id} poster={poster} />
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

export function QrPrintSheets({ pages, posters }: { pages: QrPrintPage[]; posters: Map<string, QrPoster> }) {
  const hydrated = useHydrated();
  if (!hydrated) return null;
  const target = document.body;
  return createPortal(
    <div className="qrp-root" data-qr-print-root="" aria-hidden>
      {/* Стиль — первым: у последнего ЛИСТА должен быть `:last-child`. */}
      <style>{PRINT_CSS}</style>
      {pages.map((page, index) => (
        <Sheet key={`${page.format}-${index}`} page={page} posters={posters} />
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

  .qrp-eyebrow { font-size: 10.5pt; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: #333 !important; }
  .qrp-org { font-size: 12pt; margin-top: 1.5mm; }
  .qrp-detail { font-size: 11pt; margin-top: 1mm; font-weight: 600; }
  .qrp-steps { list-style: none; margin: 0; padding: 0; }
  .qrp-steps li { margin-top: 1.6mm; }
  .qrp-valid { margin-top: 4mm; font-size: 11pt; font-weight: 600; border: 0.3mm solid #000; padding: 1.5mm 3mm; display: inline-block; }

  .qrp-a4 { height: 250mm; display: flex; flex-direction: column; align-items: center; text-align: center; padding-top: 6mm; }
  .qrp-a4-title { font-size: 24pt; font-weight: 700; line-height: 1.15; margin-top: 4mm; max-width: 175mm; }
  .qrp-a4-code { margin-top: 8mm; }
  .qrp-a4-steps { font-size: 13pt; margin-top: 8mm; width: 150mm; text-align: left; }

  .qrp-a5 { height: 125mm; display: flex; align-items: center; gap: 8mm; padding: 0 4mm; }
  .qrp-a5 + .qrp-a5 { border-top: 0.3mm dashed #666 !important; }
  .qrp-a5-text { min-width: 0; flex: 1; }
  .qrp-a5-title { font-size: 17pt; font-weight: 700; line-height: 1.15; margin-top: 2mm; }
  .qrp-a5-steps { font-size: 10.5pt; margin-top: 4mm; }
  .qrp-a5 .qrp-valid { font-size: 9.5pt; margin-top: 3mm; }

  .qrp-sticker-grid { display: grid; grid-template-columns: repeat(3, 1fr); grid-template-rows: repeat(4, 60mm); gap: 3mm; height: 249mm; }
  .qrp-sticker {
    display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center;
    border: 0.3mm dashed #777 !important; padding: 2.5mm; overflow: hidden;
  }
  .qrp-sticker-title { font-size: 10pt; font-weight: 700; line-height: 1.15; margin-top: 2mm; max-height: 2.4em; overflow: hidden; }
  .qrp-sticker-org { font-size: 7.5pt; margin-top: 0.8mm; }
  .qrp-sticker-detail { font-size: 7.5pt; font-weight: 600; margin-top: 0.5mm; }
}
`;
