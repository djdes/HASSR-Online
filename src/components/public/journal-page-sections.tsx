import Link from "@/components/i18n/localized-link";
import { ArrowRight, Building2, CirclePlay, Gavel, ListChecks, Table2 } from "lucide-react";

import type { JournalPageContent } from "@/content/journal-page-content";

/**
 * Блоки страницы журнала (спека journal-page-engagement-2026-11): образец
 * заполнения строками, видео, тематические разделы, штрафы, «для кого» и
 * финальный призыв. Серверные компоненты без своего состояния; подписи —
 * готовыми строками от страницы (она переводит их сама).
 */

const CARD = "rounded-3xl border border-[#ececf4] bg-white p-5 sm:p-7";
const HEADING = "flex items-center gap-2 text-[13px] font-semibold uppercase tracking-[0.14em] text-[#3848c7]";

export function JournalSampleTable({ sample, heading }: { sample: NonNullable<JournalPageContent["sample"]>; heading: string }) {
  return (
    <div className={CARD} data-testid="journal-sample-rows">
      <h2 className={HEADING}>
        <Table2 className="size-4" />
        {heading}
      </h2>
      <p className="mt-3 text-[15px] leading-[1.6] text-[#3c4053]">{sample.caption}</p>
      <div className="mt-4 overflow-x-auto rounded-2xl border border-[#ececf4]">
        <table className="w-full min-w-[640px] border-collapse text-left text-[13px]">
          <thead className="bg-[#fafbff] text-[#6f7282]">
            <tr>
              {sample.columns.map((column) => (
                <th key={column} scope="col" className="border-b border-[#ececf4] px-3 py-2 font-medium">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="text-[#0b1024]">
            {sample.rows.map((row, index) => (
              <tr key={index} className="border-b border-[#ececf4] last:border-0">
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex} className="px-3 py-2 align-top tabular-nums">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function JournalTextSections({ sections }: { sections: JournalPageContent["sections"] }) {
  if (!sections?.length) return null;
  return (
    <>
      {sections.map((section) => (
        <div key={section.heading} className={CARD} data-testid="journal-text-section">
          <h2 className="text-[20px] font-semibold tracking-[-0.01em] text-[#0b1024]">{section.heading}</h2>
          {section.paragraphs?.map((paragraph) => (
            <p key={paragraph.slice(0, 40)} className="mt-3 text-[15px] leading-[1.7] text-[#3c4053]">
              {paragraph}
            </p>
          ))}
          {section.bullets?.length ? (
            <ul className="mt-3 space-y-2">
              {section.bullets.map((bullet) => (
                <li key={bullet.slice(0, 40)} className="flex gap-2.5 text-[15px] leading-[1.6] text-[#3c4053]">
                  <ListChecks aria-hidden="true" className="mt-1 size-4 shrink-0 text-[#5566f6]" />
                  <span>{bullet}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ))}
    </>
  );
}

export function JournalFines({ fines, heading }: { fines: NonNullable<JournalPageContent["fines"]>; heading: string }) {
  return (
    // Тона «warn» из app-theme.css: у них есть ночные значения (розовые
    // #fdf2f7/#f2c1d9 ночная тема не перекрашивала — текст терялся).
    <div className="rounded-3xl border border-[#ffd2cd] bg-[#fff4f2] p-5 sm:p-7" data-testid="journal-fines">
      <h2 className="flex items-center gap-2 text-[13px] font-semibold uppercase tracking-[0.14em] text-[#a13a32]">
        <Gavel className="size-4" />
        {heading}
      </h2>
      <p className="mt-3 text-[15px] leading-[1.6] text-[#3c4053]">{fines.intro}</p>
      <ul className="mt-3 space-y-2">
        {fines.items.map((item) => (
          <li key={item.slice(0, 40)} className="text-[15px] leading-[1.6] text-[#0b1024]">
            {item}
          </li>
        ))}
      </ul>
      {fines.note ? <p className="mt-3 text-[13px] leading-[1.55] text-[#6f7282]">{fines.note}</p> : null}
    </div>
  );
}

export function JournalVideo({ heading, lead }: { heading: string; lead: string }) {
  return (
    <div className={CARD} data-testid="journal-video">
      <h2 className={HEADING}>
        <CirclePlay className="size-4" />
        {heading}
      </h2>
      <p className="mt-3 text-[15px] leading-[1.6] text-[#3c4053]">{lead}</p>
      <video
        className="mt-4 aspect-video w-full rounded-2xl bg-[#0b1024]"
        controls
        preload="none"
        playsInline
        poster="/landing/video/qr-tour-ru.jpg"
      >
        <source src="/landing/video/qr-tour-ru.mp4" type="video/mp4" />
        <track kind="captions" src="/landing/video/qr-tour-ru.vtt" srcLang="ru" label="Русский" default />
      </video>
    </div>
  );
}

export function JournalAudienceChips({ heading, niches }: { heading: string; niches: Array<{ slug: string; label: string }> }) {
  if (!niches.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="journal-audience">
      <span className="mr-1 inline-flex items-center gap-1.5 text-[13px] font-medium text-[#6f7282]">
        <Building2 aria-hidden="true" className="size-4" />
        {heading}
      </span>
      {niches.map((niche) => (
        <Link
          key={niche.slug}
          href={`/${niche.slug}`}
          className="rounded-full border border-[#dcdfed] bg-white px-3 py-1.5 text-[13px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
        >
          {niche.label}
        </Link>
      ))}
    </div>
  );
}

export function JournalFinalCta({
  title,
  body,
  tryLabel,
  tryHref,
  download,
}: {
  title: string;
  body: string;
  tryLabel: string;
  tryHref: string;
  download: React.ReactNode;
}) {
  return (
    <section className="mx-auto max-w-[1200px] px-4 pb-12 sm:px-6" data-testid="journal-final-cta">
      <div className="relative overflow-hidden rounded-3xl bg-[#0b1024] px-6 py-10 text-white sm:px-10 sm:py-12">
        <div className="pointer-events-none absolute -right-24 -top-24 size-[320px] rounded-full bg-[#5566f6] opacity-35 blur-[110px]" />
        <div className="relative max-w-[720px]">
          <h2 className="text-[26px] font-semibold leading-[1.15] tracking-[-0.02em] sm:text-[32px]">{title}</h2>
          <p className="mt-3 text-[16px] leading-[1.6] text-white/75">{body}</p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Link
              href={tryHref}
              className="inline-flex h-12 items-center gap-2 rounded-2xl bg-[#5566f6] px-5 text-[15px] font-medium text-white shadow-[0_12px_36px_-12px_rgba(85,102,246,0.65)] transition-colors hover:bg-[#4a5bf0]"
            >
              {tryLabel}
              <ArrowRight className="size-4" />
            </Link>
            {download}
          </div>
        </div>
      </div>
    </section>
  );
}
