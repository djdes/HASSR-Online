"use client";

import { useState } from "react";
import { Maximize2 } from "lucide-react";

import { KB_SHOTS, type KbShot, type KbShotMark } from "@/content/kb/shots";
import { cn } from "@/lib/utils";

/**
 * Снимок экрана с пронумерованными метками — как в PDF-презентации:
 * номер в кружке у области на снимке и легенда «номер — что это» под ним.
 * Наведение на пункт легенды подсвечивает область, и наоборот.
 */
function Badge({ mark, active }: { mark: KbShotMark; active: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex size-6 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold tabular-nums text-white shadow-[0_4px_12px_-4px_rgba(11,16,36,0.45)] ring-2 ring-white transition-transform",
        mark.warn ? "bg-[#d2453d]" : "bg-[#5566f6]",
        active && "scale-110",
      )}
    >
      {mark.n}
    </span>
  );
}

function ShotImage({ shot, active, setActive, className }: { shot: KbShot; active: number | null; setActive: (n: number | null) => void; className?: string }) {
  return (
    <div className={cn("relative", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element -- статичные webp из public/kb, размеры заданы */}
      <img src={shot.src} width={shot.w} height={shot.h} alt={shot.caption ?? shot.marks.map((mark) => mark.title).join(", ")} loading="lazy" decoding="async" className="block h-auto w-full" />
      {shot.marks.map((mark) => (
        <span
          key={mark.n}
          onMouseEnter={() => setActive(mark.n)}
          onMouseLeave={() => setActive(null)}
          className={cn(
            "absolute rounded-[10px] border-2 transition-colors",
            mark.warn ? "border-[#d2453d]/70" : "border-[#5566f6]/70",
            active === mark.n ? (mark.warn ? "bg-[#d2453d]/10" : "bg-[#5566f6]/10") : "bg-transparent",
          )}
          style={{ left: `${mark.x}%`, top: `${mark.y}%`, width: `${mark.w}%`, height: `${mark.h}%` }}
        >
          <span className="absolute -left-2.5 -top-2.5">
            <Badge mark={mark} active={active === mark.n} />
          </span>
        </span>
      ))}
    </div>
  );
}

function Legend({ marks, active, setActive }: { marks: KbShotMark[]; active: number | null; setActive: (n: number | null) => void }) {
  if (!marks.length) return null;
  return (
    <ol className="grid gap-x-6 gap-y-3 border-t border-[#ececf4] bg-[#fafbff] px-4 py-4 sm:grid-cols-2 sm:px-5">
      {marks.map((mark) => (
        <li key={mark.n} className="flex gap-3" onMouseEnter={() => setActive(mark.n)} onMouseLeave={() => setActive(null)}>
          <Badge mark={mark} active={active === mark.n} />
          <div className="min-w-0">
            <div className={cn("text-[14px] font-semibold leading-snug", mark.warn ? "text-[#a13a32]" : "text-[#0b1024]")}>{mark.title}</div>
            <div className="mt-0.5 text-[13.5px] leading-[1.5] text-[#6f7282]">{mark.text}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}

export function KbShotFigure({ id, title }: { id: string; title?: string }) {
  const shot = KB_SHOTS[id];
  const [active, setActive] = useState<number | null>(null);
  if (!shot) return null;
  return (
    <figure className="my-6 overflow-hidden rounded-3xl border border-[#ececf4] bg-white shadow-[0_16px_40px_-28px_rgba(11,16,36,0.35)]">
      <div className="flex items-center gap-1.5 border-b border-[#ececf4] bg-[#fafbff] px-4 py-2.5">
        <span className="size-2.5 rounded-full bg-[#ececf4]" />
        <span className="size-2.5 rounded-full bg-[#ececf4]" />
        <span className="size-2.5 rounded-full bg-[#ececf4]" />
        <span className="ml-3 min-w-0 flex-1 truncate text-[12px] text-[#9b9fb3]">wesetup.ru{shot.url?.replace(/\/documents\/[^/]+$/, "/documents/…") ?? ""}</span>
        <a href={shot.src} target="_blank" rel="noopener" aria-label="Открыть снимок целиком" className="rounded-lg p-1 text-[#9b9fb3] transition-colors hover:bg-[#eef1ff] hover:text-[#3848c7]">
          <Maximize2 className="size-3.5" />
        </a>
      </div>
      <ShotImage shot={shot} active={active} setActive={setActive} />
      <Legend marks={shot.marks} active={active} setActive={setActive} />
      {title ? <figcaption className="border-t border-[#ececf4] px-4 py-3 text-[13px] text-[#6f7282] sm:px-5">{title}</figcaption> : null}
    </figure>
  );
}

/** Экраны телефона рядом: подпись под каждым, метки — общей легендой. */
export function KbPhones({ ids }: { ids: string[] }) {
  const [active, setActive] = useState<number | null>(null);
  const shots = ids.map((id) => KB_SHOTS[id]).filter((shot): shot is KbShot => Boolean(shot));
  const marks = shots.flatMap((shot) => shot.marks);
  return (
    <figure className="my-6 overflow-hidden rounded-3xl border border-[#ececf4] bg-[#fafbff]">
      <div className={cn("grid gap-4 p-4 sm:p-6", shots.length === 1 ? "mx-auto max-w-[300px]" : shots.length === 2 ? "grid-cols-2 sm:mx-auto sm:max-w-[560px]" : "grid-cols-2 lg:grid-cols-4")}>
        {shots.map((shot, index) => (
          <div key={shot.id} className="min-w-0">
            <div className="overflow-hidden rounded-[22px] border-[5px] border-[#0b1024] bg-white shadow-[0_20px_40px_-24px_rgba(11,16,36,0.55)]">
              <ShotImage shot={shot} active={active} setActive={setActive} />
            </div>
            {shot.caption ? (
              <figcaption className="mt-3 text-center">
                <div className="text-[13.5px] font-semibold leading-snug text-[#0b1024]">
                  {shots.length > 1 ? <span className="mr-1 text-[#5566f6] tabular-nums">{index + 1}.</span> : null}
                  {shot.caption}
                </div>
                {shot.sub ? <div className="mt-0.5 text-[12.5px] leading-snug text-[#6f7282]">{shot.sub}</div> : null}
              </figcaption>
            ) : null}
          </div>
        ))}
      </div>
      <Legend marks={marks} active={active} setActive={setActive} />
    </figure>
  );
}
