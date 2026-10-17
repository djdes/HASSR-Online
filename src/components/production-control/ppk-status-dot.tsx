import { getTranslations } from "next-intl/server";
import { cn } from "@/lib/utils";
import type { PpkStatus } from "@/lib/ppk/status";

/** Точка статуса блока, как в оглавлении: заполнен / начат / пусто; справочным блокам — ничего. */
export async function PpkStatusDot({ status, className }: { status: PpkStatus; className?: string }) {
  if (status === "info") return null;
  const t = await getTranslations("navigation.shell.status");
  return (
    <span
      role="img"
      aria-label={t(status)}
      title={t(status)}
      className={cn(
        "size-2 shrink-0 rounded-full",
        status === "done" && "bg-[#1f9d55]",
        status === "started" && "bg-[#f5b301]",
        status === "empty" && "border-[1.5px] border-[#dcdfed]",
        className,
      )}
    />
  );
}
