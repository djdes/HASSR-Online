import { cn } from "@/lib/utils";

/** Полоса прогресса «заполнено X из Y». */
export function PpkProgressBar({
  done,
  total,
  label,
  className,
}: {
  done: number;
  total: number;
  label: string;
  className?: string;
}) {
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={done}
      className={cn("h-2 overflow-hidden rounded-full bg-[#eef1ff]", className)}
    >
      <div
        className="h-full rounded-full bg-[#5566f6] transition-[width] duration-200"
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}
