"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { BadgeCheck } from "lucide-react";
import { CL_BUTTON_PRIMARY } from "@/components/checklists/checklist-page-ui";

/**
 * Полоса над проверкой: «Принять результат» для проверяющего по назначению
 * (или руководителя) либо отметка «Результат принят: кто, когда».
 */
export function ChecklistReviewBar({
  inspectionId,
  canReview,
  reviewedAtLabel,
  reviewedByName,
}: {
  inspectionId: string;
  canReview: boolean;
  /** Когда принят — уже отформатировано на сервере (без расхождения при гидратации). */
  reviewedAtLabel: string | null;
  reviewedByName: string | null;
}) {
  const t = useTranslations("checklistPages.review");
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function review() {
    setBusy(true);
    try {
      const response = await fetch(`/api/checklists/inspections/${inspectionId}/review`, { method: "POST" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || t("failed"));
      toast.success(t("done"));
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("failed"));
    } finally {
      setBusy(false);
    }
  }

  if (reviewedAtLabel) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-[#c8ecd5] bg-[#ecfdf5] px-4 py-3 text-[14px] font-medium text-[#116b2a] print:hidden" data-review-bar="reviewed">
        <BadgeCheck className="size-5 shrink-0" />
        {t("reviewed", { name: reviewedByName || "—", date: reviewedAtLabel })}
      </div>
    );
  }
  if (!canReview) return null;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-[#5566f6]/30 bg-[#f5f6ff] px-4 py-3 print:hidden" data-review-bar="pending">
      <div className="min-w-0 flex-1 basis-[220px] text-[14px] leading-[1.5] text-[#0b1024]">
        <div className="font-semibold">{t("title")}</div>
        <div className="text-[13px] text-[#6f7282]">{t("hint")}</div>
      </div>
      <button type="button" className={CL_BUTTON_PRIMARY} onClick={() => void review()} disabled={busy} data-action="review">
        <BadgeCheck className="size-4" />
        {busy ? t("saving") : t("action")}
      </button>
    </div>
  );
}
