"use client";

import { ExternalLink, Info, Infinity as InfinityIcon, MapPin } from "lucide-react";

import { formatQrValidUntil, type QrPosterItem, type QrPrintFormat } from "@/lib/qr-fill-types";
import { cn } from "@/lib/utils";

import { QrFormatSwitch } from "./qr-format-switch";

/**
 * Карточки страницы QR-кодов. Три вида — по группе:
 *   • main   — крупная карточка с превью, индиго-рамка (НЕ золото: золото
 *     только у кнопки «QR-точка контроля»);
 *   • extra  — компактная строка документа, формат появляется после галки;
 *   • object — наклейка на объект, сеткой.
 *
 * Атрибуты `data-qr-poster/-id/-url/-kind` читают e2e — не переименовывать.
 */

type CardProps = {
  item: QrPosterItem;
  selected: boolean;
  format: QrPrintFormat;
  onToggle: (selected: boolean) => void;
  onFormat: (format: QrPrintFormat) => void;
};

function dataAttrs(item: QrPosterItem, selected: boolean, format: QrPrintFormat) {
  return {
    "data-qr-poster": "",
    "data-qr-id": item.poster.id,
    "data-qr-url": item.poster.url,
    "data-qr-kind": item.poster.kind,
    "data-qr-group": item.group,
    "data-qr-selected": selected ? "true" : "false",
    "data-qr-format": format,
  } as const;
}

const CHECKBOX_CLASS =
  "size-5 shrink-0 cursor-pointer rounded-md accent-[#5566f6] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 disabled:cursor-not-allowed";

function CheckLink({ url, compact = false }: { url: string; compact?: boolean }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      title="Открыть ссылку из QR-кода в новой вкладке — проверить, что форма открывается"
      aria-label={compact ? "Проверить ссылку" : undefined}
      data-qr-check=""
      className={cn(
        "inline-flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-2xl text-[13.5px] font-medium text-[#3848c7] transition-colors duration-150 hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15",
        compact ? "w-11" : "px-3"
      )}
    >
      <ExternalLink className="size-4" aria-hidden />
      {compact ? null : "Проверить ссылку"}
    </a>
  );
}

function Notice({ notice }: { notice?: string | null }) {
  if (!notice) return null;
  return (
    <p data-qr-notice="" className="mt-2 flex items-start gap-1.5 text-[12.5px] leading-[1.45] text-[#3848c7]">
      <Info className="mt-px size-3.5 shrink-0" aria-hidden />
      <span>{notice}</span>
    </p>
  );
}

function QrPreview({ svg, className }: { svg: string; className?: string }) {
  return (
    <div
      aria-hidden
      className={cn("qr-box shrink-0 rounded-2xl border border-[#ececf4] bg-white p-1.5", className)}
      // SVG собран на сервере (brand-qr.ts) из нашего адреса — безопасно встраивать.
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

/** Основной QR журнала: отмечен по умолчанию, бессрочный. */
export function QrMainCard({ item, selected, format, onToggle, onFormat }: CardProps) {
  const inputId = `qr-${item.key}`;
  return (
    <article
      {...dataAttrs(item, selected, format)}
      className={cn(
        "flex min-w-0 flex-col rounded-3xl border bg-white p-4 transition-[border-color,box-shadow] duration-200 sm:p-5",
        selected
          ? "border-[#5566f6] shadow-[0_0_0_4px_rgba(85,102,246,0.10),0_16px_40px_-28px_rgba(85,102,246,0.55)]"
          : "border-[#dcdfed]"
      )}
    >
      <label htmlFor={inputId} className="flex min-h-11 cursor-pointer items-center gap-3">
        <input
          id={inputId}
          type="checkbox"
          checked={selected}
          onChange={(event) => onToggle(event.target.checked)}
          className={CHECKBOX_CLASS}
        />
        <span className="min-w-0 flex-1 text-[16px] font-semibold leading-snug tracking-[-0.01em] text-[#0b1024]">
          {item.label}
        </span>
      </label>
      <div className="mt-3 flex gap-4">
        <QrPreview svg={item.poster.svg} className="w-[96px] sm:w-[112px]" />
        <div className="min-w-0 flex-1">
          <span className="inline-flex items-center gap-1 rounded-full bg-[#eef1ff] px-2.5 py-1 text-[12px] font-medium text-[#3848c7]">
            <InfinityIcon className="size-3.5" aria-hidden />
            Бессрочный
          </span>
          {item.sublabel ? (
            <p className="mt-2 flex items-center gap-1 text-[12.5px] font-medium text-[#3c4053]">
              <MapPin className="size-3.5 shrink-0 text-[#5566f6]" aria-hidden />
              <span className="min-w-0 truncate">{item.sublabel}</span>
            </p>
          ) : null}
          <p className="mt-2 text-[13px] leading-[1.5] text-[#6f7282]">{item.caption}</p>
          <Notice notice={item.poster.notice} />
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <QrFormatSwitch value={format} onChange={onFormat} label={`Формат: ${item.label}`} />
        <CheckLink url={item.poster.url} />
      </div>
    </article>
  );
}

/** Строка дополнительного QR (или QR журнала на общем экране): компактно, формат — после галки. */
export function QrCompactRow({ item, selected, format, onToggle, onFormat }: CardProps) {
  const inputId = `qr-${item.key}`;
  const validUntil = item.poster.validUntil ?? null;
  return (
    <article
      {...dataAttrs(item, selected, format)}
      data-qr-expired={item.expired ? "true" : undefined}
      className={cn(
        "min-w-0 rounded-2xl border px-3 transition-colors duration-150 sm:px-4",
        selected ? "border-[#5566f6]/45 bg-[#fafbff]" : "border-[#ececf4] bg-white",
        item.highlighted && !selected && "border-[#5566f6]/30",
        item.expired && "bg-[#fafbff]"
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <label
          htmlFor={inputId}
          className={cn("flex min-h-11 min-w-0 flex-1 items-center gap-3 py-1.5", item.expired ? "cursor-not-allowed" : "cursor-pointer")}
        >
          <input
            id={inputId}
            type="checkbox"
            checked={selected}
            disabled={item.expired}
            onChange={(event) => onToggle(event.target.checked)}
            className={CHECKBOX_CLASS}
          />
          <span className="min-w-0 flex-1">
            <span className={cn("line-clamp-2 block text-[14px] font-medium leading-snug [overflow-wrap:anywhere]", item.expired ? "text-[#9b9fb3]" : "text-[#0b1024]")}>
              {item.label}
            </span>
            {item.sublabel ? <span className="block truncate text-[12px] text-[#6f7282]">{item.sublabel}</span> : null}
          </span>
        </label>
        {validUntil ? (
          item.expired ? (
            <span className="shrink-0 rounded-full bg-[#fff4f2] px-2.5 py-1 text-[12px] font-medium text-[#a13a32]">срок истёк</span>
          ) : (
            <span
              title="Код перестанет работать на следующий день после этой даты"
              className="shrink-0 whitespace-nowrap rounded-full bg-[#f5f6ff] px-2.5 py-1 text-[12px] font-medium tabular-nums text-[#3848c7]"
            >
              {formatQrValidUntil(validUntil) === "бессрочно" ? "бессрочно" : `до ${formatQrValidUntil(validUntil)}`}
            </span>
          )
        ) : null}
        {item.expired ? null : <CheckLink url={item.poster.url} compact />}
      </div>
      {selected ? (
        <div className="flex flex-wrap items-center gap-2 pb-2.5 sm:pl-8">
          <QrFormatSwitch value={format} onChange={onFormat} label={`Формат: ${item.label}`} />
          {item.poster.notice ? <Notice notice={item.poster.notice} /> : null}
        </div>
      ) : null}
    </article>
  );
}

/** Наклейка на объект: холодильник, помещение, лампа. */
export function QrObjectCard({ item, selected, format, onToggle, onFormat }: CardProps) {
  const inputId = `qr-${item.key}`;
  return (
    <article
      {...dataAttrs(item, selected, format)}
      className={cn(
        "flex min-w-0 flex-col rounded-2xl border bg-white p-3 transition-[border-color,box-shadow] duration-200 sm:p-4",
        selected ? "border-[#5566f6]/60 shadow-[0_0_0_3px_rgba(85,102,246,0.08)]" : "border-[#ececf4]"
      )}
    >
      <label htmlFor={inputId} className="flex min-h-11 cursor-pointer items-center gap-3">
        <input
          id={inputId}
          type="checkbox"
          checked={selected}
          onChange={(event) => onToggle(event.target.checked)}
          className={CHECKBOX_CLASS}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14.5px] font-semibold text-[#0b1024]">{item.label}</span>
          {item.sublabel ? <span className="block truncate text-[12.5px] font-medium text-[#3848c7]">{item.sublabel}</span> : null}
        </span>
      </label>
      <div className="mt-2 flex items-center gap-3">
        <QrPreview svg={item.poster.svg} className="w-[72px] rounded-xl p-1" />
        <p className="min-w-0 flex-1 text-[12.5px] leading-[1.45] text-[#6f7282]">{item.caption}</p>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-1">
        <QrFormatSwitch value={format} onChange={onFormat} label={`Формат: ${item.label}`} />
        <CheckLink url={item.poster.url} compact />
      </div>
    </article>
  );
}
