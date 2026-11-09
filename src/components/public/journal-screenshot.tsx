"use client";

import { useState } from "react";

/**
 * Renders a screenshot of the authenticated journal page if it was
 * captured by scripts/capture-screenshots.ts. When the live UI screenshot
 * is not present on disk, falls back to the rendered sample sheet
 * (`/journal-samples/<code>.png`) so public journal pages never show an
 * empty broken placeholder.
 */
export function JournalScreenshot({
  code,
  label,
  pendingLabel = "Скриншот будет готов после ближайшего автоматического обхода",
}: {
  code: string;
  label: string;
  pendingLabel?: string;
}) {
  const [stage, setStage] = useState<"screenshot" | "sample" | "failed">("sample");

  if (stage === "failed") {
    return (
      <div className="flex aspect-[16/10] w-full items-center justify-center rounded-2xl border border-dashed border-[#dcdfed] bg-[#fafbff] text-center text-[12px] text-[#9b9fb3]">
        {pendingLabel}
      </div>
    );
  }

  if (stage === "sample") {
    return (
      <div className="overflow-hidden rounded-2xl border border-[#ececf4] bg-white shadow-[0_16px_40px_-24px_rgba(11,16,36,0.18)]">
        <div className="flex items-center justify-between border-b border-[#ececf4] bg-[#fafbff] px-4 py-2.5 text-[12px] text-[#6f7282]">
          <div className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-full bg-[#e2e4f0]" />
            <span className="size-2.5 rounded-full bg-[#e2e4f0]" />
            <span className="size-2.5 rounded-full bg-[#e2e4f0]" />
            <span className="ml-2 font-mono text-[11px] text-[#6f7282]">
              wesetup.ru/journals/{code}
            </span>
          </div>
          <span className="rounded-full bg-[#ecfdf5] px-2.5 py-0.5 text-[11px] font-medium text-[#116b2a]">
            СанПиН · ХАССП
          </span>
        </div>
        <picture>
          <source
            media="(max-width: 640px)"
            srcSet={`/journal-samples/${code}.webp`}
            type="image/webp"
          />
          <img
            src={`/journal-samples/${code}.png`}
            alt={label}
            loading="lazy"
            onError={() => setStage("failed")}
            className="aspect-[1228/862] w-full bg-white object-contain object-top p-2 sm:p-4"
          />
        </picture>
      </div>
    );
  }

  return (
    <picture>
      <source
        media="(max-width: 640px)"
        srcSet={`/screenshots/mobile/journals-${code}.png`}
      />
      <source
        media="(max-width: 1023px)"
        srcSet={`/screenshots/tablet/journals-${code}.png`}
      />
      <img
        src={`/screenshots/desktop/journals-${code}.png`}
        alt={label}
        loading="lazy"
        onError={() => setStage("sample")}
        className="aspect-[16/10] w-full rounded-2xl border border-[#ececf4] bg-white object-cover object-top shadow-[0_16px_40px_-24px_rgba(11,16,36,0.18)]"
      />
    </picture>
  );
}
