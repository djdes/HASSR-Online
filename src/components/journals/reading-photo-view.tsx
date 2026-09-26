"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { Camera } from "lucide-react";

import { PhotoLightbox } from "@/components/shared/photo-lightbox";
import { cn } from "@/lib/utils";

/**
 * Фото замера в документе журнала (холодильники, склады) — рядом со
 * значением: снимок дисплея, прикреплённый в QR-форме кнопкой «Фото».
 * Нажатие открывает снимок крупно (щипок и двойное касание — приблизить).
 *
 *   • `cell` — значок в углу ячейки таблицы (ячейка должна быть `relative`);
 *   • `thumb` — миниатюра 48 px рядом с полем в карточках на телефоне.
 *
 * В печать не попадает: бумажный бланк остаётся бланком.
 */
export function ReadingPhotoView({
  url,
  caption,
  variant = "thumb",
  className,
}: {
  url: string;
  /** Подпись под снимком: что, когда и какое значение записано. */
  caption: string;
  variant?: "cell" | "thumb";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {variant === "cell" ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          title={`Фото замера — ${caption}`}
          aria-label={`Фото замера: ${caption}`}
          data-testid="reading-photo-cell"
          className={cn(
            "flex size-[18px] items-center justify-center rounded-full bg-[#eef1ff] text-[#3848c7] ring-1 ring-white transition-colors duration-150 hover:bg-[#5566f6] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5566f6]/40 print:hidden",
            className
          )}
        >
          <Camera className="size-[11px]" />
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          title={`Фото замера — ${caption}`}
          aria-label={`Фото замера: ${caption}`}
          data-testid="reading-photo-thumb"
          className={cn(
            "relative size-12 shrink-0 overflow-hidden rounded-2xl border border-[#dcdfed] bg-[#fafbff] transition-colors duration-150 hover:border-[#5566f6]/60 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 print:hidden",
            className
          )}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- снимок из каталога загрузок, не статика */}
          <img src={url} alt="" loading="lazy" className="size-full object-cover" />
          <span className="absolute bottom-0.5 right-0.5 flex size-4 items-center justify-center rounded-full bg-white/90 text-[#3848c7]">
            <Camera className="size-2.5" />
          </span>
        </button>
      )}
      {/* В портал: страница документа сдвинута `translate`-ом, и fixed-окно
          внутри неё встало бы не по экрану, а по контейнеру. */}
      {open
        ? createPortal(
            <PhotoLightbox url={url} filename="Фото замера" caption={caption} onClose={() => setOpen(false)} />,
            document.body
          )
        : null}
    </>
  );
}
