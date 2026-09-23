"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";

/**
 * Лист журнала: картинка страницы печатной формы. Касание — лист на весь
 * экран в натуральную ширину (листается пальцем и масштабируется щипком),
 * Esc или крестик — назад. Без JS картинка просто открывается ссылкой.
 */
export function SheetImage({
  src,
  alt,
  caption,
}: {
  src: string;
  alt: string;
  caption: string;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <figure className="flex flex-col gap-2" data-sheet>
      <a
        href={src}
        onClick={(e) => {
          e.preventDefault();
          setOpen(true);
        }}
        className="group block cursor-zoom-in border border-[#d5d8de] bg-white shadow-[0_1px_0_rgba(20,24,33,0.05),0_22px_44px_-30px_rgba(20,24,33,0.55)] transition-shadow duration-200 hover:shadow-[0_1px_0_rgba(20,24,33,0.05),0_26px_50px_-26px_rgba(20,24,33,0.6)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1f3a8a]/40"
        aria-label={`${caption} — открыть крупно`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- лист из токен-защищённого API, next/image здесь только мешает */}
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          className="block aspect-[297/210] w-full bg-white object-contain"
        />
      </a>
      <figcaption className="text-center text-[12px] tabular-nums text-[#8a8f9c]">{caption}</figcaption>

      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={caption}
          className="fixed inset-0 z-50 flex flex-col bg-[#141821]/92"
        >
          <div className="flex shrink-0 items-center justify-between gap-3 px-4 py-3 text-white">
            <span className="text-[14px]">{caption}</span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="inline-flex size-10 items-center justify-center rounded-full bg-white/10 transition-colors duration-150 hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
              aria-label="Закрыть"
            >
              <X className="size-5" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto overscroll-contain px-3 pb-6" style={{ touchAction: "pan-x pan-y pinch-zoom" }}>
            {/* eslint-disable-next-line @next/next/no-img-element -- см. выше */}
            <img src={src} alt={alt} className="mx-auto block w-[1600px] max-w-none bg-white md:w-full md:max-w-[1600px]" />
          </div>
        </div>
      ) : null}
    </figure>
  );
}
