"use client";

import { useTranslations } from "next-intl";
import { useRef, useState, type KeyboardEvent } from "react";
import { BedDouble, Stethoscope, UtensilsCrossed, type LucideIcon } from "lucide-react";

import { DEFAULT_QR_INDUSTRY, INDUSTRY_CHAPTERS, QR_INDUSTRIES, type QrIndustry } from "./industries";
import { QrPlayer, type QrPresentation } from "./qr-player";
import type { QrMatrix } from "./qr-sticker";
import type { SceneDay } from "./scene";
import type { NarratedVideo } from "./video-lightbox";

/**
 * Блок QR на главной с вкладками вида деятельности (правки 20–21.11.2026):
 * «Общепит» (по умолчанию), «Медицинский центр», «Отель». У каждого вида
 * свой ролик — набор глав (`INDUSTRY_CHAPTERS`) — и свои видео со звуком и
 * PDF (`media`). Плеер один: при смене вида он пересоздаётся с начала ролика.
 */

export type QrIndustryMedia = { video: NarratedVideo | null; presentation: QrPresentation | null };

const INDUSTRY_ICONS = {
  food: UtensilsCrossed,
  medical: Stethoscope,
  hotel: BedDouble,
} as const satisfies Record<QrIndustry, LucideIcon>;

const tabId = (industry: QrIndustry) => `qr-industry-tab-${industry}`;
const PANEL_ID = "qr-industry-panel";

export function QrIndustryPlayer({
  qr,
  today,
  media,
}: {
  qr: QrMatrix;
  today: SceneDay;
  media: Record<QrIndustry, QrIndustryMedia>;
}) {
  const t = useTranslations("qrPlayer.industries");
  const [active, setActive] = useState<QrIndustry>(DEFAULT_QR_INDUSTRY);
  const tabsRef = useRef<HTMLDivElement>(null);

  const select = (industry: QrIndustry, focus = false) => {
    setActive(industry);
    if (focus) tabsRef.current?.querySelector<HTMLButtonElement>(`#${tabId(industry)}`)?.focus();
  };

  // Стрелки, Home и End — как у обычных вкладок.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = QR_INDUSTRIES.indexOf(active);
    const last = QR_INDUSTRIES.length - 1;
    const next =
      event.key === "ArrowRight" ? (index + 1) % QR_INDUSTRIES.length
      : event.key === "ArrowLeft" ? (index + last) % QR_INDUSTRIES.length
      : event.key === "Home" ? 0
      : event.key === "End" ? last
      : null;
    if (next === null) return;
    event.preventDefault();
    select(QR_INDUSTRIES[next], true);
  };

  return (
    <div data-qr-industries="" data-qr-industry-active={active}>
      <div
        ref={tabsRef}
        role="tablist"
        aria-label={t("label")}
        onKeyDown={onKeyDown}
        // Строка из трёх равных вкладок на `flex`: сетку в три колонки общее
        // правило телефона перестраивает в две.
        className="mb-3 flex gap-1 rounded-2xl bg-white/[0.06] p-1 ring-1 ring-inset ring-white/10"
      >
        {QR_INDUSTRIES.map((industry) => {
          const Icon = INDUSTRY_ICONS[industry];
          const selected = industry === active;
          return (
            <button
              key={industry}
              id={tabId(industry)}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={PANEL_ID}
              tabIndex={selected ? 0 : -1}
              onClick={() => select(industry)}
              data-qr-industry={industry}
              className={`flex h-11 min-w-0 flex-1 basis-0 items-center justify-center gap-1.5 rounded-xl px-1.5 text-[14px] font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#8b97ff]/50 sm:gap-2 sm:px-3 sm:text-[15px] ${
                selected ? "landing-light-chip shadow-[0_8px_24px_-12px_rgba(0,0,0,0.6)]" : "text-white/75 hover:bg-white/[0.08] hover:text-white"
              }`}
              // Белая вкладка с тёмным текстом в обеих темах — `landing-light-chip`
              // (app-theme.css): тёмная тема перекрашивает и `bg-white`, и
              // встроенный `color: #0b1024`.
            >
              <Icon className={`hidden size-4 shrink-0 min-[400px]:block ${selected ? "text-[#5566f6]" : "text-[#8b97ff]"}`} aria-hidden="true" />
              {/* На телефоне — короткая подпись: три вкладки в одну строку. */}
              <span className="truncate sm:hidden">{t(`${industry}.short`)}</span>
              <span className="hidden truncate sm:inline">{t(`${industry}.label`)}</span>
            </button>
          );
        })}
      </div>

      <div id={PANEL_ID} role="tabpanel" aria-labelledby={tabId(active)} data-qr-industry-panel={active}>
        <QrPlayer
          key={active}
          qr={qr}
          today={today}
          chapterIds={INDUSTRY_CHAPTERS[active]}
          video={media[active].video}
          presentation={media[active].presentation}
        />
      </div>
    </div>
  );
}
