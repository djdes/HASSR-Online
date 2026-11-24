"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { LayoutList } from "lucide-react";
import { PPK_OVERVIEW_COOKIE } from "@/lib/ppk/overview-view";

/**
 * «Прежний вид» / «Новый вид» обзора ППК (2026-11-24, владелец: «возможность в
 * будущем отказаться»): выбор запоминается в cookie на год; страница
 * собирается заново на сервере в выбранном виде.
 */
export function PpkViewToggle({ classic }: { classic: boolean }) {
  const t = useTranslations("productionControl.overviewV2");
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => {
        document.cookie = `${PPK_OVERVIEW_COOKIE}=${classic ? "new" : "classic"}; path=/; max-age=31536000; samesite=lax`;
        router.refresh();
      }}
      title={t("viewHint")}
      className="inline-flex h-11 items-center gap-2 rounded-2xl px-3 text-[13.5px] font-medium text-[#3848c7] transition-colors duration-150 hover:bg-[var(--app-veil)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
      data-ppk-view-toggle={classic ? "classic" : "new"}
    >
      <LayoutList className="size-4" aria-hidden />
      {classic ? t("viewNew") : t("viewClassic")}
    </button>
  );
}
