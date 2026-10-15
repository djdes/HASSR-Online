"use client";

import { useState } from "react";

/**
 * Renders a screenshot of the authenticated journal page if it was
 * captured by scripts/capture-screenshots.ts. The image lives at
 * `/screenshots/<viewport>/journals-<code>.png` on prod, so this
 * component is a server-serves-whatever-is-there `<img>` with a
 * graceful skeleton fallback when the file is missing (404) or still
 * being captured for the first time.
 *
 * Client component because onError is a runtime property.
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
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div className="flex aspect-[16/10] w-full items-center justify-center rounded-2xl border border-dashed border-[#dcdfed] bg-[#fafbff] text-center text-[12px] text-[#9b9fb3]">
        {pendingLabel}
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
        onError={() => setFailed(true)}
        className="aspect-[16/10] w-full rounded-2xl border border-[#ececf4] bg-white object-cover object-top shadow-[0_16px_40px_-24px_rgba(11,16,36,0.18)]"
      />
    </picture>
  );
}
