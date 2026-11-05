import Link from "next/link";
import { Activity, Link2, SearchCheck } from "lucide-react";

export type SeoSubnavTab = "health" | "positions" | "links";

export interface SeoSubnavProps {
  active: SeoSubnavTab;
  linksBadgeCount?: number;
}

const ACTIVE_PILL_CLASS =
  "inline-flex items-center gap-2 rounded-2xl bg-[#eef1ff] px-4 py-2 text-[13.5px] font-medium text-[#3848c7]";

const INACTIVE_PILL_CLASS =
  "inline-flex items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 py-2 text-[13.5px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]";

export function SeoSubnav({ active, linksBadgeCount = 0 }: SeoSubnavProps) {
  const badge = linksBadgeCount > 0 ? (
    <span
      className={`inline-flex min-w-[20px] items-center justify-center rounded-full px-1.5 py-0.5 text-[11px] font-semibold leading-none ${
        active === "links"
          ? "bg-[#3848c7] text-white"
          : "bg-[#5566f6] text-white"
      }`}
      title="Непрочитанные диалоги с вебмастерами + готовые к подтверждению слоты"
    >
      {linksBadgeCount > 99 ? "99+" : linksBadgeCount}
    </span>
  ) : null;

  return (
    <nav aria-label="Разделы SEO" className="flex flex-wrap items-center gap-1.5">
      {active === "health" ? (
        <span aria-current="page" className={ACTIVE_PILL_CLASS}>
          <SearchCheck className="size-4" />
          Здоровье
        </span>
      ) : (
        <Link href="/root/seo" className={INACTIVE_PILL_CLASS}>
          <SearchCheck className="size-4 text-[#5566f6]" />
          Здоровье
        </Link>
      )}

      {active === "positions" ? (
        <span aria-current="page" className={ACTIVE_PILL_CLASS}>
          <Activity className="size-4" />
          Позиции
        </span>
      ) : (
        <Link href="/root/seo/positions" className={INACTIVE_PILL_CLASS}>
          <Activity className="size-4 text-[#5566f6]" />
          Позиции
        </Link>
      )}

      {active === "links" ? (
        <span aria-current="page" className={ACTIVE_PILL_CLASS}>
          <Link2 className="size-4" />
          Ссылки
          {badge}
        </span>
      ) : (
        <Link href="/root/seo/links" className={INACTIVE_PILL_CLASS}>
          <Link2 className="size-4 text-[#5566f6]" />
          Ссылки
          {badge}
        </Link>
      )}
    </nav>
  );
}
