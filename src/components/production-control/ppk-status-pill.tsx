import { getTranslations } from "next-intl/server";
import { cn } from "@/lib/utils";
import type { PpkStatus } from "@/lib/ppk/status";

/** Пилюля статуса блока; у справочных блоков не показывается. */
export async function PpkStatusPill({ status, className }: { status: PpkStatus; className?: string }) {
  if (status === "info") return null;
  const t = await getTranslations("navigation.shell.status");
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-[12px] font-semibold",
        status === "done" && "bg-[#ecfdf5] text-[#116b2a]",
        status === "started" && "bg-[#fff7e6] text-[#8a5a00]",
        status === "empty" && "bg-[#f5f6ff] text-[#3848c7]",
        className,
      )}
    >
      {t(status)}
    </span>
  );
}
