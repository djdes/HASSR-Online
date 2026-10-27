import { ArrowLeftRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Ярлык «Замена до 05.11» у сотрудника на временной точке (2026-10-27).
 * Без хуков — рисуется и на серверных страницах (точка), и в клиентских
 * списках («Сотрудники»). Подсказка в `title` — где он и когда вернётся.
 */
export function SubstituteBadge({ label, title, className }: { label: string; title?: string; className?: string }) {
  return (
    <span
      title={title}
      data-substitute-badge
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full bg-[#eef1ff] px-2 py-0.5 text-[11px] font-medium leading-4 text-[#3848c7]",
        className,
      )}
    >
      <ArrowLeftRight className="size-3 shrink-0" aria-hidden />
      {label}
    </span>
  );
}
