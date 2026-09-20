"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { ClipboardList, FileText, Printer, QrCode, Refrigerator, Sticker, Warehouse } from "lucide-react";

import { PageHeader, PageHeaderStat } from "@/components/ui/page-header";
import type { QrFillKind, QrPoster, QrPosterLayout } from "@/lib/qr-fill-types";
import { cn } from "@/lib/utils";

export type { QrPoster } from "@/lib/qr-fill-types";

const STEPS = [
  "Наведите камеру телефона на код.",
  "Выберите своё имя и введите показания.",
  "Нажмите «Сохранить» — запись попадёт в журнал за сегодня.",
];
const JOURNAL_STEPS = [
  "Наведите камеру телефона на код.",
  "Выберите себя (и журнал, если плакат общий).",
  "Ответьте на вопросы формы и нажмите «Сохранить».",
];

function buildHref(params: {
  kind: QrFillKind;
  layout: QrPosterLayout;
  documentId: string | null;
  selectedIds: string[] | null;
}): string {
  const search = new URLSearchParams();
  search.set("kind", params.kind === "room" ? "rooms" : params.kind === "journal" ? "journals" : "equipment");
  if (params.layout === "sheet") search.set("layout", "sheet");
  if (params.documentId) search.set("doc", params.documentId);
  if (params.selectedIds && params.selectedIds.length > 0) search.set("ids", params.selectedIds.join(","));
  return `/settings/qr-posters?${search.toString()}`;
}

/**
 * Две раскладки одной страницы:
 *   • poster — плакат на лист A4 (крупный код, инструкция из трёх шагов);
 *   • sheet  — наклейки сеткой, ~12 на лист: для дверцы холодильника или
 *     таблички у входа. Сюда ведёт кнопка «QR-коды» из выделения строк
 *     журнала (`ids=`) и «Наклейка» из диалога строки (`autoprint=1`).
 */
export function QrPostersClient({
  kind,
  layout,
  posters,
  origin,
  documentTitle,
  documentId,
  selectedIds,
  autoprint,
}: {
  kind: QrFillKind;
  layout: QrPosterLayout;
  posters: QrPoster[];
  origin: string;
  documentTitle: string | null;
  documentId: string | null;
  /** `ids=` из адреса — печать только выбранных объектов. */
  selectedIds: string[] | null;
  /** Открыть диалог печати сразу после загрузки (`autoprint=1`). */
  autoprint: boolean;
}) {
  const printedRef = useRef(false);
  useEffect(() => {
    if (!autoprint || printedRef.current || posters.length === 0) return;
    printedRef.current = true;
    // Даём SVG отрисоваться; иначе Chrome печатает пустые рамки.
    const timer = window.setTimeout(() => window.print(), 250);
    return () => window.clearTimeout(timer);
  }, [autoprint, posters.length]);

  const kindTabs = [
    { kind: "room" as const, label: "Склады и помещения", icon: Warehouse },
    { kind: "equipment" as const, label: "Холодильники и оборудование", icon: Refrigerator },
    { kind: "journal" as const, label: "Журналы: запись с телефона", icon: ClipboardList },
  ];
  const layoutTabs = [
    { layout: "poster" as const, label: "Плакат на лист", icon: FileText, hint: "Один объект на лист A4 — на дверь или стену" },
    { layout: "sheet" as const, label: "Наклейки на лист", icon: Sticker, hint: "Много маленьких кодов на одном листе A4 — вырезать и наклеить" },
  ];

  const scopeLabel = documentTitle
    ? `объектов документа «${documentTitle}»`
    : selectedIds
      ? "выбранных объектов"
      : kind === "room"
        ? "каждого склада"
        : kind === "journal"
          ? "каждого журнала"
          : "каждого холодильника";

  return (
    <div className="space-y-5 print:space-y-0">
      <div className="space-y-5 print:hidden">
        <PageHeader
          title={layout === "sheet" ? "QR-наклейки" : "QR-плакаты"}
          description={
            layout === "sheet"
              ? `Наклейки с QR-кодом для ${scopeLabel} — несколько на одном листе A4. Сотрудник сканирует код и вносит показание без входа в кабинет.`
              : `Плакат A4 с QR-кодом для ${scopeLabel}. Сотрудник сканирует код и вносит показание без входа в кабинет.`
          }
          actions={
            <>
              {selectedIds ? (
                <PageHeaderStat>Выбрано: {posters.length}</PageHeaderStat>
              ) : null}
              <button
                type="button"
                onClick={() => window.print()}
                disabled={posters.length === 0}
                className="inline-flex h-11 items-center gap-2 rounded-2xl bg-[#5566f6] px-5 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors duration-150 hover:bg-[#4a5bf0] disabled:bg-[#c8cbe0] disabled:shadow-none"
              >
                <Printer className="size-4" />
                Распечатать
              </button>
            </>
          }
        />

        <div className="flex flex-wrap items-center gap-2">
          {documentId || selectedIds
            ? null
            : kindTabs.map((tab) => {
                const Icon = tab.icon;
                const active = tab.kind === kind;
                return (
                  <Link
                    key={tab.kind}
                    href={buildHref({ kind: tab.kind, layout, documentId, selectedIds })}
                    className={cn(
                      "inline-flex h-10 items-center gap-2 rounded-2xl border px-4 text-[14px] font-medium transition-colors duration-150",
                      active
                        ? "border-[#5566f6] bg-[#eef1ff] text-[#3848c7]"
                        : "border-[#dcdfed] bg-white text-[#0b1024] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
                    )}
                  >
                    <Icon className="size-4 text-[#5566f6]" />
                    {tab.label}
                  </Link>
                );
              })}
          <div
            role="tablist"
            aria-label="Раскладка печати"
            className="ml-auto inline-flex rounded-2xl border border-[#dcdfed] bg-white p-1"
          >
            {layoutTabs.map((tab) => {
              const Icon = tab.icon;
              const active = tab.layout === layout;
              return (
                <Link
                  key={tab.layout}
                  role="tab"
                  aria-selected={active}
                  title={tab.hint}
                  href={buildHref({ kind, layout: tab.layout, documentId, selectedIds })}
                  className={cn(
                    "inline-flex h-8 items-center gap-1.5 rounded-xl px-3 text-[13px] font-medium transition-colors duration-150",
                    active
                      ? "bg-[#eef1ff] text-[#3848c7]"
                      : "text-[#6f7282] hover:bg-[#f5f6ff] hover:text-[#0b1024]"
                  )}
                >
                  <Icon className="size-4" />
                  {tab.label}
                </Link>
              );
            })}
          </div>
        </div>

        <div className="rounded-2xl border border-[#ececf4] bg-[#fafbff] p-4 text-[13px] leading-[1.55] text-[#3c4053]">
          <b className="font-semibold text-[#0b1024]">Как это работает.</b>{" "}
          {kind === "journal"
            ? "Плакат «Все журналы» — на стену у входа в цех: сотрудник сканирует, выбирает журнал и себя, отвечает на два-три вопроса. Плакат отдельного журнала ведёт сразу в него."
            : layout === "sheet"
              ? "Распечатайте лист, вырежьте наклейки и приклейте на дверцу холодильника или у входа в помещение."
              : "Распечатайте плакаты и повесьте у входа в помещение или на дверцу холодильника."}{" "}
          {kind === "journal"
            ? "Кто может записывать — в «Настройки → Соответствие»: любой из списка, по PIN или только после входа."
            : "Показание ложится в активный журнал за сегодня — в ближайший срок контроля. Если на сегодня журнала нет, телефон попросит сначала создать документ."} Коды бессрочные: распечатали один раз — и они работают, пока
          объект есть в справочнике.
          <span className="mt-1 block text-[12px] text-[#9b9fb3]">Домен ссылок: {origin.replace(/^https?:\/\//, "")}</span>
        </div>
      </div>

      {posters.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-6 py-14 text-center print:hidden">
          <div className="text-[15px] font-medium text-[#0b1024]">
            {documentTitle
              ? kind === "room"
                ? "В документе нет помещений из «Точек и помещений»"
                : "В документе нет оборудования из «Оборудования»"
              : selectedIds
                ? "Выбранные объекты не найдены"
                : kind === "room"
                  ? "Помещений пока нет"
                  : kind === "journal"
                    ? "Нет журналов с активным документом на сегодня"
                    : "Оборудования пока нет"}
          </div>
          <p className="mx-auto mt-1.5 max-w-[420px] text-[13px] text-[#6f7282]">
            {documentTitle ? (
              // Плакаты открыты из журнала: список ограничен строками документа,
              // а объекты в справочнике при этом могут быть.
              <>
                Плакаты открыты из документа «{documentTitle}»: показываются только его строки, связанные со
                справочником, а таких нет. Добавьте объект в документ из справочника или{" "}
                <Link
                  href={buildHref({ kind, layout, documentId: null, selectedIds: null })}
                  className="font-medium text-[#3848c7] underline underline-offset-2"
                >
                  {kind === "room" ? "откройте плакаты всех помещений" : "откройте плакаты всего оборудования"}
                </Link>
                .
              </>
            ) : selectedIds ? (
              <>
                Возможно, объекты удалены из справочника.{" "}
                <Link
                  href={buildHref({ kind, layout, documentId: null, selectedIds: null })}
                  className="font-medium text-[#3848c7] underline underline-offset-2"
                >
                  Показать все
                </Link>
                .
              </>
            ) : kind === "room" ? (
              <>
                Добавьте склады и цеха в{" "}
                <Link href="/settings/buildings" className="font-medium text-[#3848c7] underline underline-offset-2">
                  «Точки и помещения»
                </Link>
                — плакаты появятся здесь.
              </>
            ) : (
              <>
                Добавьте холодильники в{" "}
                <Link href="/settings/equipment" className="font-medium text-[#3848c7] underline underline-offset-2">
                  «Оборудование»
                </Link>
                — плакаты появятся здесь.
              </>
            )}
          </p>
        </div>
      ) : layout === "sheet" ? (
        <div className="qr-sheet-grid grid gap-4 sm:grid-cols-2 md:grid-cols-3">
          {posters.map((poster) => {
            return (
              <article
                key={poster.id}
                data-qr-poster=""
                data-qr-url={poster.url}
                data-qr-kind={poster.kind}
                data-qr-id={poster.id}
                className="qr-sticker flex flex-col items-center rounded-2xl border border-[#ececf4] bg-white p-4 text-center shadow-[0_0_0_1px_rgba(240,240,250,0.45)]"
              >
                <div
                  className="qr-box w-full max-w-[160px] rounded-xl border border-[#ececf4] bg-white p-1.5"
                  // SVG собран на сервере библиотекой qrcode — безопасно встраивать.
                  dangerouslySetInnerHTML={{ __html: poster.svg }}
                />
                <div className="qr-sticker-title mt-2.5 text-[15px] font-semibold leading-tight text-[#0b1024]">
                  {poster.title}
                </div>
                <div className="qr-sticker-subtitle mt-0.5 text-[12px] text-[#6f7282]">{poster.subtitle}</div>
                {poster.norms.length > 0 ? (
                  <div className="qr-sticker-norm mt-1 text-[12px] font-medium text-[#3848c7]">
                    Норма: {poster.norms.join(", ")}
                  </div>
                ) : null}
                <div className="qr-sticker-hint mt-2 text-[10.5px] text-[#9b9fb3]">
                  Сканируйте камерой телефона
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="qr-posters-grid grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {posters.map((poster) => {
            return (
              <article
                key={poster.id}
                data-qr-poster=""
                data-qr-url={poster.url}
                data-qr-kind={poster.kind}
                data-qr-id={poster.id}
                className="qr-poster flex flex-col items-center rounded-3xl border border-[#ececf4] bg-white p-6 text-center shadow-[0_0_0_1px_rgba(240,240,250,0.45)]"
              >
                <div className="qr-poster-eyebrow inline-flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
                  <QrCode className="size-3.5 text-[#5566f6]" />
                  {poster.kind === "room" ? "Температура и влажность" : poster.kind === "journal" ? "Заполнить с телефона" : "Температура"}
                </div>
                <h2 className="qr-poster-title mt-2 text-[22px] font-semibold leading-tight tracking-[-0.02em] text-[#0b1024]">
                  {poster.title}
                </h2>
                <div className="qr-poster-subtitle mt-1 text-[13px] text-[#6f7282]">
                  {poster.subtitle}
                  {poster.norms.length > 0 ? ` · норма ${poster.norms.join(", ")}` : ""}
                </div>
                <div
                  className="qr-box mx-auto mt-4 w-full max-w-[220px] rounded-2xl border border-[#ececf4] bg-white p-2"
                  // SVG собран на сервере библиотекой qrcode — безопасно встраивать.
                  dangerouslySetInnerHTML={{ __html: poster.svg }}
                />
                <ol className="qr-poster-steps mt-4 w-full space-y-1 text-left text-[13px] leading-[1.5] text-[#3c4053]">
                  {(poster.kind === "journal" ? JOURNAL_STEPS : STEPS).map((step, index) => (
                    <li key={step} className="flex gap-2">
                      <span className="font-semibold tabular-nums text-[#3848c7]">{index + 1}.</span>
                      <span>{step}</span>
                    </li>
                  ))}
                </ol>
              </article>
            );
          })}
        </div>
      )}

      <style>{`
        .qr-box svg { display: block; width: 100%; height: auto; }
        @media print {
          html, body { background: #fff !important; }
          header, nav, footer, .screen-only { display: none !important; }
          main { padding: 0 !important; }

          /* Плакат: один объект на лист A4. */
          .qr-posters-grid { display: block !important; }
          /* Без min-height во всю высоту листа: iOS Safari печатает со своими
             полями, и «лист» с шагами уезжал на вторую страницу. Контент
             ~200mm — помещается на A4 при любых полях. */
          .qr-poster {
            box-sizing: border-box;
            max-height: 255mm;
            overflow: hidden;
            justify-content: flex-start;
            padding-top: 8mm !important;
            border: 0 !important;
            border-radius: 0 !important;
            box-shadow: none !important;
            padding: 0 !important;
            break-inside: avoid;
            page-break-inside: avoid;
            break-after: page;
            page-break-after: always;
          }
          .qr-poster:last-child { break-after: auto; page-break-after: auto; }
          .qr-poster-eyebrow { font-size: 12pt; }
          .qr-poster-title { font-size: 26pt; margin-top: 5mm; }
          .qr-poster-subtitle { font-size: 13pt; margin-top: 2mm; }
          .qr-poster .qr-box { width: 100mm !important; max-width: none !important; border: 0 !important; margin-top: 8mm; }
          .qr-poster-steps { font-size: 13pt; width: 150mm; max-width: 100%; margin-top: 8mm; }

          /* Наклейки: сетка 3 × 4 на листе A4 (12 штук), рамка под ножницы. */
          .qr-sheet-grid {
            display: grid !important;
            grid-template-columns: repeat(3, 1fr) !important;
            gap: 4mm !important;
          }
          .qr-sticker {
            box-sizing: border-box;
            height: 62mm;
            justify-content: center;
            border: 0.3mm dashed #9b9fb3 !important;
            border-radius: 3mm !important;
            box-shadow: none !important;
            padding: 3mm !important;
            break-inside: avoid;
            page-break-inside: avoid;
          }
          .qr-sticker .qr-box { width: 34mm !important; max-width: none !important; border: 0 !important; padding: 0 !important; }
          .qr-sticker-title { font-size: 11pt; margin-top: 2mm; }
          .qr-sticker-subtitle { font-size: 8.5pt; }
          .qr-sticker-norm { font-size: 8.5pt; }
          .qr-sticker-hint { font-size: 7pt; margin-top: 1.5mm; }
        }
        @media print { @page { size: A4 portrait; margin: 12mm; } }
      `}</style>
    </div>
  );
}
