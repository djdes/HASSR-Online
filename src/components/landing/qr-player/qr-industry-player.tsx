"use client";

import { useTranslations } from "next-intl";
import { useRef, useState, type KeyboardEvent } from "react";
import { BedDouble, Clock3, Stethoscope, UtensilsCrossed, type LucideIcon } from "lucide-react";

import { DEFAULT_QR_INDUSTRY, INTERACTIVE_QR_INDUSTRY, QR_INDUSTRIES, type QrIndustry } from "./industries";
import { QrMediaButtons, QrPlayer, STAGE_SURFACE_STYLE, type QrPresentation } from "./qr-player";
import type { QrMatrix } from "./qr-sticker";
import type { SceneDay } from "./scene";
import type { NarratedVideo } from "./video-lightbox";

/**
 * Блок QR на главной с вкладками вида деятельности (правки 20.11.2026):
 * «Общепит» (по умолчанию), «Медицинский центр», «Отель». У каждого вида
 * свои видео со звуком и PDF (`media`). Ролик со сценой и главами снят для
 * общепита; у остальных на месте сцены — плашка «в разработке» с возвратом
 * к общепиту. Плеер общепита при переключении не размонтируется, а прячется:
 * вне экрана он сам встаёт на паузу, а вернувшись, зритель видит ту же главу.
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
  const interactive = active === INTERACTIVE_QR_INDUSTRY;

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
                selected ? "shadow-[0_8px_24px_-12px_rgba(0,0,0,0.6)]" : "text-white/75 hover:bg-white/[0.08] hover:text-white"
              }`}
              // Цвета выбранной вкладки — стилем, как у вкладок глав: тёмная
              // тема публичных страниц перекрашивает `bg-white`.
              style={selected ? { background: "#ffffff", color: "#0b1024" } : undefined}
            >
              <Icon className={`hidden size-4 shrink-0 min-[400px]:block ${selected ? "text-[#5566f6]" : "text-[#8b97ff]"}`} aria-hidden="true" />
              {/* На телефоне — короткая подпись: три вкладки в одну строку. */}
              <span className="truncate sm:hidden">{t(`${industry}.short`)}</span>
              <span className="hidden truncate sm:inline">{t(`${industry}.label`)}</span>
            </button>
          );
        })}
      </div>

      <div id={PANEL_ID} role="tabpanel" aria-labelledby={tabId(active)}>
        <div hidden={!interactive}>
          <QrPlayer
            qr={qr}
            today={today}
            video={media[INTERACTIVE_QR_INDUSTRY].video}
            presentation={media[INTERACTIVE_QR_INDUSTRY].presentation}
          />
        </div>
        {interactive ? null : (
          <IndustryPending industry={active} media={media[active]} onBack={() => select(INTERACTIVE_QR_INDUSTRY, true)} />
        )}
      </div>
    </div>
  );
}

/** Ролика для вида деятельности ещё нет: на месте сцены — «в разработке». */
function IndustryPending({
  industry,
  media,
  onBack,
}: {
  industry: QrIndustry;
  media: QrIndustryMedia;
  onBack: () => void;
}) {
  const t = useTranslations("qrPlayer.industries");
  const Icon = INDUSTRY_ICONS[industry];
  const BackIcon = INDUSTRY_ICONS[INTERACTIVE_QR_INDUSTRY];
  return (
    <div data-qr-industry-pending={industry}>
      <div
        className="flex aspect-[4/5] w-full flex-col items-center justify-center overflow-hidden rounded-2xl px-6 text-center md:aspect-video"
        style={STAGE_SURFACE_STYLE}
      >
        <span className="flex size-14 items-center justify-center rounded-2xl bg-white/[0.08] ring-1 ring-inset ring-white/15">
          <Icon className="size-7 text-[#8b97ff]" aria-hidden="true" />
        </span>
        <span className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-[rgba(255,210,122,0.14)] px-3 py-1 text-[12px] font-semibold uppercase tracking-[0.08em] text-[#ffd27a]">
          <Clock3 className="size-3.5" aria-hidden="true" />
          {t("pendingBadge")}
        </span>
        <p className="mt-3 max-w-[440px] text-[20px] font-semibold leading-tight tracking-[-0.01em] text-white sm:text-[24px]">
          {t(`${industry}.pending`)}
        </p>
        <p className="mt-2 max-w-[440px] text-[14px] leading-[1.5] text-white/70 sm:text-[15px]">{t("pendingText")}</p>
        <button
          type="button"
          onClick={onBack}
          data-qr-industry-back=""
          className="mt-5 inline-flex h-11 items-center gap-2 rounded-full bg-[#5566f6] px-5 text-[15px] font-medium text-white shadow-[0_12px_32px_-14px_rgba(85,102,246,0.9)] transition-colors duration-150 hover:bg-[#4a5bf0] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#8b97ff]/50"
        >
          <BackIcon className="size-4" aria-hidden="true" />
          {t("pendingBack")}
        </button>
      </div>
      <QrMediaButtons video={media.video} presentation={media.presentation} />
    </div>
  );
}
