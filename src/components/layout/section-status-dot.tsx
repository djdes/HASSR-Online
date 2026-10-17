"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import type { PpkNavStatus } from "@/components/layout/use-section-statuses";

/** Точка статуса пункта меню раздела: заполнен / начат / пусто; справочным и без данных — ничего. */
export function SectionStatusDot({
  status,
  className,
}: {
  status: PpkNavStatus | undefined;
  className?: string;
}) {
  const t = useTranslations("navigation.shell.status");
  if (status !== "done" && status !== "started" && status !== "empty") return null;
  return (
    <span
      role="img"
      aria-label={t(status)}
      title={t(status)}
      className={cn(
        "ml-auto size-2 shrink-0 rounded-full",
        status === "done" && "bg-[#1f9d55]",
        status === "started" && "bg-[#f5b301]",
        status === "empty" && "border-[1.5px] border-[#dcdfed]",
        className,
      )}
    />
  );
}
