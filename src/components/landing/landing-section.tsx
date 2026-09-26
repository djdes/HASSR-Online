import type { ReactNode } from "react";

/**
 * Общая сетка секций главной (спека landing-pack-2026-09).
 *
 * Раньше у каждой секции были свои отступы: у одной `py-20`, у соседней
 * только `pb-20`, у каруселей — во всю ширину экрана. На телефоне из-за
 * этого блоки стояли вразнобой: между QR-роликом и следующей секцией
 * было 160 px, между остальными — 80, карусели уходили за край. Теперь
 * одна колонка 1200 px с полями 16/24 px и один ритм: 64 px между блоками
 * на телефоне (32 + 32) и 96 px на десктопе.
 */
export const LANDING_SECTION_CLASS = "mx-auto max-w-[1200px] px-4 py-8 sm:px-6 sm:py-12";

/** Заголовок секции: H2 и, если нужно, одна строка пояснения. Без надстрочных «ярлыков». */
export function LandingSectionHeader({ title, lead }: { title: ReactNode; lead?: ReactNode }) {
  return (
    <div className="mb-6 max-w-[760px] sm:mb-10">
      <h2 className="text-[clamp(1.625rem,2.2vw+1rem,2.25rem)] font-semibold leading-tight tracking-[-0.02em] text-[#0b1024]">
        {title}
      </h2>
      {lead ? <p className="mt-3 text-[16px] leading-[1.6] text-[#3c4053]">{lead}</p> : null}
    </div>
  );
}
