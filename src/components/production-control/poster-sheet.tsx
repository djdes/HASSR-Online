import type { CSSProperties, ReactNode } from "react";

import { PrintBrandFrame } from "@/components/print/print-brand-frame";
import { PosterArt } from "@/components/production-control/poster-art";
import type { PrintBrand } from "@/lib/print-brand";
import type { Poster, PosterBlock } from "@/lib/ppk/posters";

/**
 * Лист плаката A4 в фирменной рамке (2026-10-27). Серверный компонент, без
 * хуков: страница собирает его на сервере.
 *
 * Как цвет доживает до бумаги (печать кабинета делает текст чёрным, а фоны
 * прозрачными, `app-theme.css`): линии — `border` с явным цветом; номера,
 * значки и кружки — SVG со `style={{ fill, stroke }}` из переменных
 * `--pb-*`; цветной фон — только у элементов с `data-print-keep-bg`. В «Ч/б»
 * переменные становятся чёрными и белыми, смысл несут значки ✓ / ✗ и текст.
 *
 * `preview` — тот же лист, уменьшенный в 0,3 раза, для карточки списка.
 */

/** Сторона мини-листа: A4 в пикселях × масштаб. */
export const POSTER_PREVIEW_SCALE = 0.3;
const SHEET_W = 794;
const SHEET_H = 1123;
export const POSTER_PREVIEW_SIZE = {
  width: Math.round(SHEET_W * POSTER_PREVIEW_SCALE),
  height: Math.round(SHEET_H * POSTER_PREVIEW_SCALE),
} as const;

/** Цвета разделочного инвентаря для кружков в таблице маркировки. */
const BOARD_COLOR: Record<string, string> = {
  красный: "#d93a3a",
  жёлтый: "#f2c230",
  синий: "#3a7bd9",
  зелёный: "#3fa05a",
  коричневый: "#8a5a3a",
  белый: "#ffffff",
};

const SIZES = {
  normal: { body: 17, small: 14, gap: 20, cell: 16, pad: 9 },
  compact: { body: 14, small: 12.5, gap: 14, cell: 13.5, pad: 5.5 },
  dense: { body: 12.5, small: 11.5, gap: 10, cell: 12.5, pad: 3.5 },
} as const;
type Sizes = (typeof SIZES)[keyof typeof SIZES];

const CARD_BORDER = "1px solid #c9cde0";
const EXACT: CSSProperties = { printColorAdjust: "exact", WebkitPrintColorAdjust: "exact" } as CSSProperties;
const KEEP_BG = { "data-print-keep-bg": "" } as const;

// ---------------------------------------------------------------- значки (SVG)

function NumberBadge({ n, size = 26 }: { n: number; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" aria-hidden className="shrink-0">
      <circle cx="14" cy="14" r="13" style={{ fill: "var(--pb-secondary)" }} />
      <text
        x="14"
        y="14"
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={n >= 10 ? 13 : 15}
        fontWeight={700}
        fontFamily="inherit"
        style={{ fill: "var(--pb-on-secondary)" }}
      >
        {n}
      </text>
    </svg>
  );
}

function Dot({ size = 10 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 10 10" aria-hidden className="shrink-0">
      <circle cx="5" cy="5" r="4.5" style={{ fill: "var(--pb-secondary)" }} />
    </svg>
  );
}

/** ✓ — заливка, ✗ — контур: различаются формой, а не цветом. */
function MarkIcon({ kind, size = 18 }: { kind: "do" | "dont"; size?: number }) {
  return kind === "do" ? (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden className="shrink-0">
      <circle cx="12" cy="12" r="11" style={{ fill: "var(--pb-secondary)" }} />
      <path
        d="M6.5 12.5l3.8 3.8 7.2-8"
        fill="none"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ stroke: "var(--pb-on-secondary)" }}
      />
    </svg>
  ) : (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden className="shrink-0">
      <circle cx="12" cy="12" r="10.5" fill="#fff" strokeWidth="2" style={{ stroke: "var(--pb-secondary-ink)" }} />
      <path
        d="M8 8l8 8M16 8l-8 8"
        fill="none"
        strokeWidth="2.6"
        strokeLinecap="round"
        style={{ stroke: "var(--pb-secondary-ink)" }}
      />
    </svg>
  );
}

function WarnIcon({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden className="shrink-0">
      <path
        d="M12 2.8L22 20.5H2z"
        strokeWidth="2"
        strokeLinejoin="round"
        style={{ fill: "var(--pb-primary)", stroke: "var(--pb-primary)" }}
      />
      <path d="M12 9.2v5.6" fill="none" strokeWidth="2.4" strokeLinecap="round" style={{ stroke: "var(--pb-on-primary)" }} />
      <circle cx="12" cy="17.6" r="1.35" style={{ fill: "var(--pb-on-primary)" }} />
    </svg>
  );
}

function InfoIcon({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden className="shrink-0">
      <circle cx="12" cy="12" r="10.5" style={{ fill: "var(--pb-secondary)" }} />
      <path d="M12 10.8v6" fill="none" strokeWidth="2.4" strokeLinecap="round" style={{ stroke: "var(--pb-on-secondary)" }} />
      <circle cx="12" cy="7.4" r="1.4" style={{ fill: "var(--pb-on-secondary)" }} />
    </svg>
  );
}

function Swatch({ color, mono }: { color: string; mono: boolean }) {
  const fill = mono ? "#ffffff" : (BOARD_COLOR[color] ?? "#ffffff");
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden className="shrink-0">
      <circle cx="8" cy="8" r="6.8" strokeWidth="1.4" style={{ fill, stroke: "#0b1024" }} />
    </svg>
  );
}

// ---------------------------------------------------------------- блоки

function Art({ name, className = "h-full w-full" }: { name: Parameters<typeof PosterArt>[0]["name"]; className?: string }) {
  return <PosterArt name={name} className={className} />;
}

function defaultColumns(count: number): 2 | 3 | 4 | 5 {
  if (count <= 4) return 2;
  if (count <= 6) return 3;
  if (count <= 8) return 4;
  return 5;
}

const ART_HEIGHT = { 2: 220, 3: 160, 4: 130, 5: 118 } as const;
const STEP_FONT = { 2: 17, 3: 15, 4: 14, 5: 13.5 } as const;

function StepsBlock({ block }: { block: Extract<PosterBlock, { type: "steps" }> }) {
  const columns = block.columns ?? defaultColumns(block.items.length);
  const numbered = block.numbered !== false;
  return (
    <ol className="grid list-none p-0" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap: columns >= 4 ? 8 : 12 }}>
      {block.items.map((item, index) => (
        <li
          key={item.text}
          className="relative flex flex-col overflow-hidden"
          style={{ border: CARD_BORDER, borderRadius: 12, breakInside: "avoid" }}
        >
          {item.art ? (
            <div className="flex items-center justify-center p-1.5" style={{ height: ART_HEIGHT[columns] + 12, borderBottom: CARD_BORDER }}>
              <Art name={item.art} />
            </div>
          ) : null}
          {numbered ? (
            <span className="absolute left-1.5 top-1.5">
              <NumberBadge n={index + 1} size={columns >= 4 ? 24 : 28} />
            </span>
          ) : null}
          <p className="m-0 flex-1 p-2 leading-[1.3]" style={{ fontSize: STEP_FONT[columns] }}>
            {item.text}
          </p>
        </li>
      ))}
    </ol>
  );
}

function ListBlock({ block, sizes }: { block: Extract<PosterBlock, { type: "list" }>; sizes: Sizes }) {
  const withArt = block.items.some((item) => item.art);
  const list = (
    <ul className="m-0 flex min-w-0 flex-1 list-none flex-col p-0" style={{ gap: sizes.gap - 2 }}>
      {block.items.map((item, index) => (
        <li key={item.text} className="flex items-center gap-3" style={{ breakInside: "avoid" }}>
          {withArt ? (
            <span
              className="flex shrink-0 items-center justify-center"
              style={sizes.body >= SIZES.normal.body ? { width: 96, height: 72 } : { width: 72, height: 54 }}
            >
              {item.art ? <Art name={item.art} /> : null}
            </span>
          ) : null}
          <span className="flex shrink-0 items-center justify-center" style={{ width: 26 }}>
            {block.numbered ? <NumberBadge n={index + 1} /> : <Dot />}
          </span>
          <span className="min-w-0 flex-1 leading-[1.35]" style={{ fontSize: sizes.body + 1 }}>
            {item.text}
          </span>
        </li>
      ))}
    </ul>
  );
  if (!block.art) return list;
  return (
    <div className="flex items-start gap-5">
      {list}
      <div className="w-[190px] shrink-0" style={{ border: CARD_BORDER, borderRadius: 14, padding: 8 }}>
        <div style={{ height: 140 }}>
          <Art name={block.art} />
        </div>
      </div>
    </div>
  );
}

function DoDontBlock({ block, sizes }: { block: Extract<PosterBlock, { type: "doDont" }>; sizes: Sizes }) {
  const column = (kind: "do" | "dont", title: string, art: typeof block.doArt, items: string[]) => (
    <div
      className="flex flex-1 flex-col overflow-hidden"
      style={{
        border: `${kind === "do" ? 2 : 2}px ${kind === "do" ? "solid" : "dashed"} var(--pb-primary-ink)`,
        borderRadius: 14,
      }}
    >
      <div
        {...KEEP_BG}
        className="flex items-center gap-2 px-3 py-2 font-semibold"
        style={{ background: "var(--pb-bg)", fontSize: sizes.body + 3, ...EXACT }}
      >
        <MarkIcon kind={kind} size={22} />
        <span>{title}</span>
      </div>
      <div className="mx-auto w-full px-3 pt-2" style={{ height: 250 }}>
        <Art name={art} />
      </div>
      <ul className="m-0 flex list-none flex-col gap-2 p-3">
        {items.map((text) => (
          <li key={text} className="flex items-center gap-2 leading-tight" style={{ fontSize: sizes.body + 1 }}>
            <MarkIcon kind={kind} size={18} />
            <span>{text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
  return (
    <div className="flex gap-4">
      {column("do", block.doTitle, block.doArt, block.do)}
      {column("dont", block.dontTitle, block.dontArt, block.dont)}
    </div>
  );
}

function TableBlock({
  block,
  sizes,
  mono,
}: {
  block: Extract<PosterBlock, { type: "table" }>;
  sizes: Sizes;
  mono: boolean;
}) {
  return (
    <div style={{ breakInside: "avoid" }}>
      {block.title ? (
        <div className="mb-1.5 font-semibold" style={{ fontSize: sizes.body + 1 }}>
          {block.title}
        </div>
      ) : null}
      <table className="w-full border-collapse" style={{ fontSize: sizes.cell }}>
        <thead>
          <tr>
            {block.head.map((head) => (
              <th
                key={head}
                {...KEEP_BG}
                className="px-2.5 text-left font-semibold leading-tight"
                style={{
                  background: "var(--pb-bg)",
                  borderTop: "1.5px solid var(--pb-primary-ink)",
                  borderBottom: "1.5px solid var(--pb-primary-ink)",
                  paddingTop: sizes.pad + 1,
                  paddingBottom: sizes.pad + 1,
                  ...EXACT,
                }}
              >
                {head}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row) => (
            <tr key={row.join("|")} style={{ breakInside: "avoid" }}>
              {row.map((cell, index) => (
                <td
                  key={`${index}-${cell}`}
                  className={`px-2.5 align-middle leading-tight ${index === 0 ? "font-semibold" : ""}`}
                  style={{ borderBottom: "1px solid #c9cde0", paddingTop: sizes.pad, paddingBottom: sizes.pad }}
                >
                  {block.swatchColumn === index ? (
                    <span className="inline-flex items-center gap-2">
                      <Swatch color={cell} mono={mono} />
                      {cell}
                    </span>
                  ) : (
                    cell
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CalloutBox({
  tone,
  children,
  art,
  sizes,
}: {
  tone: "warn" | "info";
  children: ReactNode;
  art?: Parameters<typeof PosterArt>[0]["name"];
  sizes: Sizes;
}) {
  return (
    <div
      {...KEEP_BG}
      className="flex items-center gap-3 px-4 py-3"
      style={{
        background: "var(--pb-bg)",
        borderLeft: `6px solid ${tone === "warn" ? "var(--pb-primary-ink)" : "var(--pb-secondary-ink)"}`,
        borderTop: "1px solid #c9cde0",
        borderRight: "1px solid #c9cde0",
        borderBottom: "1px solid #c9cde0",
        borderRadius: 10,
        breakInside: "avoid",
        ...EXACT,
      }}
    >
      {tone === "warn" ? <WarnIcon /> : art ? null : <InfoIcon />}
      {art ? (
        <span className="h-[60px] w-[80px] shrink-0">
          <Art name={art} />
        </span>
      ) : null}
      <div className={`min-w-0 flex-1 leading-[1.4] ${tone === "warn" ? "font-bold" : "font-medium"}`} style={{ fontSize: sizes.body + 1 }}>
        {children}
      </div>
    </div>
  );
}

const LABEL_FIELDS = [
  { name: "Продукт", value: "Бульон говяжий" },
  { name: "Изготовлено", value: "27.10 09:30" },
  { name: "Годен до", value: "28.10 09:30" },
  { name: "Ответственный", value: "Иванова А., повар" },
] as const;

/** Образец этикетки 58×40 мм — чёрная рамка, шапка «логотип слева — сайт справа». */
function LabelSampleBlock({
  block,
  brand,
  sizes,
}: {
  block: Extract<PosterBlock, { type: "labelSample" }>;
  brand: PrintBrand;
  sizes: Sizes;
}) {
  return (
    <div className="flex items-center gap-5">
      <div
        className="shrink-0 bg-white text-black"
        style={{ width: 334, height: 230, border: "3px solid #000", borderRadius: 12, padding: "8px 10px 10px", display: "flex", flexDirection: "column" }}
      >
        <div className="flex items-center justify-between gap-2 pb-1" style={{ borderBottom: "2px solid #000" }}>
          {brand.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- логотип организации, любой домен
            <img src={brand.logoUrl} alt="" className="block h-[22px] w-auto max-w-[110px] object-contain object-left" />
          ) : (
            <span className="truncate text-[11px] font-bold">{brand.orgName}</span>
          )}
          <span className="shrink-0 text-[10px] font-semibold">{brand.site}</span>
        </div>
        <div className="mt-1.5 flex flex-1 flex-col justify-around">
          {LABEL_FIELDS.map((field, index) => (
            <div key={field.name} className="flex items-center gap-2">
              <NumberBadge n={index + 1} size={18} />
              <div className="min-w-0 flex-1" style={{ borderBottom: "1px solid #000" }}>
                <span className="text-[9px] font-semibold uppercase tracking-wide">{field.name}</span>
                <div className="truncate text-[12px] font-medium leading-tight">{field.value}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
      <ol className="m-0 flex min-w-0 flex-1 list-none flex-col gap-2.5 p-0">
        {block.callouts.map((callout, index) => (
          <li key={callout.field} className="flex items-start gap-2.5" style={{ breakInside: "avoid" }}>
            <NumberBadge n={index + 1} size={22} />
            <span className="leading-[1.35]" style={{ fontSize: sizes.body }}>
              <b>{callout.field}</b> — {callout.text}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function JournalQrBlock({
  block,
  qrSvg,
  sizes,
}: {
  block: Extract<PosterBlock, { type: "journalQr" }>;
  qrSvg: string | null;
  sizes: Sizes;
}) {
  return (
    <div className="flex items-center gap-4" style={{ breakInside: "avoid" }}>
      <div className="min-w-0 flex-1">
        <CalloutBox tone="info" sizes={sizes}>
          {block.caption}
        </CalloutBox>
      </div>
      {qrSvg ? (
        <div className="w-[130px] shrink-0 [&>svg]:block [&>svg]:h-auto [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: qrSvg }} />
      ) : null}
    </div>
  );
}

function renderBlock(block: PosterBlock, index: number, ctx: { brand: PrintBrand; sizes: Sizes; qrSvg: string | null }) {
  const { brand, sizes, qrSvg } = ctx;
  switch (block.type) {
    case "steps":
      return <StepsBlock key={index} block={block} />;
    case "list":
      return <ListBlock key={index} block={block} sizes={sizes} />;
    case "doDont":
      return <DoDontBlock key={index} block={block} sizes={sizes} />;
    case "table":
      return <TableBlock key={index} block={block} sizes={sizes} mono={brand.mono} />;
    case "callout":
      return (
        <CalloutBox key={index} tone={block.tone} art={block.art} sizes={sizes}>
          {block.text}
        </CalloutBox>
      );
    case "text":
      return (
        <div key={index} className="flex flex-col gap-2">
          {block.paragraphs.map((text) => (
            <p key={text} className="m-0 leading-[1.45]" style={{ fontSize: sizes.body + 1 }}>
              {text}
            </p>
          ))}
        </div>
      );
    case "labelSample":
      return <LabelSampleBlock key={index} block={block} brand={brand} sizes={sizes} />;
    case "journalQr":
      return <JournalQrBlock key={index} block={block} qrSvg={qrSvg} sizes={sizes} />;
  }
}

/**
 * Лист плаката. `qrSvg` — QR на журнал для блока `journalQr` (готовит страница;
 * нет журнала или это мини-лист — null, остаётся подпись).
 */
export function PosterSheet({
  poster,
  brand,
  size = "print",
  qrSvg = null,
}: {
  poster: Poster;
  brand: PrintBrand;
  size?: "print" | "preview";
  qrSvg?: string | null;
}) {
  const sizes = SIZES[poster.density ?? "normal"];
  const titleSize = poster.title.length > 48 ? 24 : poster.title.length > 30 ? 28 : 33;

  const sheet = (
    <PrintBrandFrame brand={brand} className={size === "preview" ? "h-full" : ""}>
      <div className="flex flex-col" style={{ gap: sizes.gap }}>
        <div>
          <h2 className="m-0 font-semibold leading-[1.12] tracking-[-0.025em]" style={{ fontSize: titleSize }}>
            {poster.title}
          </h2>
          <svg width="56" height="5" viewBox="0 0 56 5" aria-hidden className="mt-2 block">
            <rect width="56" height="5" rx="2.5" style={{ fill: "var(--pb-primary)" }} />
          </svg>
          {poster.subtitle ? (
            <p className="m-0 mt-2 font-medium leading-snug text-[#3c4053]" style={{ fontSize: sizes.body + 1 }}>
              {poster.subtitle}
            </p>
          ) : null}
        </div>
        {poster.blocks.map((block, index) => renderBlock(block, index, { brand, sizes, qrSvg }))}
      </div>
    </PrintBrandFrame>
  );

  if (size === "print") return sheet;
  return (
    <div className="relative overflow-hidden" style={POSTER_PREVIEW_SIZE} aria-hidden>
      <div
        className="pointer-events-none absolute left-0 top-0 origin-top-left"
        style={{ width: SHEET_W, height: SHEET_H, transform: `scale(${POSTER_PREVIEW_SCALE})` }}
      >
        {sheet}
      </div>
    </div>
  );
}
