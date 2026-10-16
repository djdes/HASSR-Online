import Link from "next/link";
import { ArrowRight, type LucideIcon } from "lucide-react";

const PALETTE = {
  red: {
    card: "border-[#ffd2cd] bg-[#fff4f2]",
    ring: "bg-[#ffe1dc] text-[#d2453d]",
    fg: "text-[#d2453d]",
  },
  amber: {
    card: "border-[#ffe2a0] bg-[#fff8eb]",
    ring: "bg-[#ffe9b0] text-[#b25f00]",
    fg: "text-[#b25f00]",
  },
  orange: {
    card: "border-[#ffd1a8] bg-[#fff2e5]",
    ring: "bg-[#ffe0c2] text-[#c2510a]",
    fg: "text-[#c2510a]",
  },
  indigo: {
    card: "border-[#c7ccea] bg-[#eef1ff]",
    ring: "bg-[#dadfff] text-[#5566f6]",
    fg: "text-[#5566f6]",
  },
} as const;

/** Плашка-тревога «число + что это» со ссылкой туда, где это чинят. */
export function AlertPill({
  href,
  tone,
  icon: Icon,
  value,
  label,
}: {
  href: string;
  tone: keyof typeof PALETTE;
  icon: LucideIcon;
  value: number;
  label: string;
}) {
  const c = PALETTE[tone];
  return (
    <Link
      href={href}
      className={`group flex items-center gap-3 rounded-2xl border px-4 py-3 transition-all hover:-translate-y-0.5 hover:shadow-[0_8px_24px_-12px_rgba(11,16,36,0.15)] ${c.card}`}
    >
      <span className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${c.ring}`}>
        <Icon className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className={`text-[20px] font-semibold tabular-nums ${c.fg}`}>{value}</div>
        <div className={`text-[12px] leading-tight opacity-85 ${c.fg}`}>{label}</div>
      </div>
      <ArrowRight
        className={`size-4 shrink-0 opacity-60 transition-transform group-hover:translate-x-0.5 ${c.fg}`}
      />
    </Link>
  );
}
