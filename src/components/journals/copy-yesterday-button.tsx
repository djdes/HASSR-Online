"use client";

import { useJournalControls } from "@/components/journals/journal-controls-provider";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { humanizeFetchError } from "@/lib/humanize-fetch-error";

type Result = {
  copied: number;
  kept: number;
  yesterdayKey: string;
  todayKey: string;
  message?: string;
};

/**
 * One-click «clone yesterday's grid into today» for any
 * JournalDocumentEntry-based daily journal. Two modes:
 *
 *   - Default (first tap): only fills employees who don't have today's
 *     row yet. Safe — never clobbers fresh input.
 *   - «Перезаписать сегодня»: if the default leaves `kept > 0`, the
 *     button re-opens a confirm dialog offering the overwrite.
 */
/**
 * Headless-версия «Скопировать вчерашнее» — используется пунктом меню «⋯».
 * Возвращает обработчик и JSX подтверждающего диалога, который надо
 * отрендерить ВНЕ DropdownMenuContent (иначе он размонтируется вместе с меню).
 */
export function useCopyYesterdayAction(documentId: string) {
  const t = useTranslations("journalUi.copyYesterday");
  const tCopy = useTranslations("journalControls.dishPool");
  const { controls } = useJournalControls();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirmOverwrite, setConfirmOverwrite] = useState<number | null>(null);

  async function run(overwrite: boolean) {
    if (busy) return;
    setBusy(true);
    try {
      const response = await fetch(
        `/api/journal-documents/${documentId}/copy-yesterday`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ overwrite }),
        }
      );
      const data = (await response.json().catch(() => null)) as
        | Result
        | { error: string }
        | null;
      if (!response.ok) {
        toast.error(
          (data && "error" in data && data.error) || tCopy("copyFailed")
        );
        return;
      }
      const result = data as Result;
      if (result.copied === 0 && result.kept === 0) {
        toast.info(result.message ?? t("noYesterday"));
        return;
      }
      if (overwrite || result.kept === 0) {
        const parts = [t("addedPart", { count: result.copied })];
        if (result.kept > 0) parts.push(t("keptPart", { count: result.kept }));
        toast.success(
          t("copiedSummary", {
            date: result.yesterdayKey,
            parts: parts.join(" · "),
          })
        );
        setConfirmOverwrite(null);
        router.refresh();
        return;
      }
      // Default run with something already filled → offer overwrite.
      setConfirmOverwrite(result.kept);
      if (result.copied > 0) {
        toast.success(
          t("addedAndKept", { copied: result.copied, kept: result.kept })
        );
        router.refresh();
      }
    } catch (err) {
      toast.error(humanizeFetchError(err, t("networkError")));
    } finally {
      setBusy(false);
    }
  }

  const dialog = (
    <>
      <Dialog
        open={confirmOverwrite !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmOverwrite(null);
        }}
      >
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>{t("overwriteTitle")}</DialogTitle>
            <DialogDescription>
              {t("overwriteDescription", { count: confirmOverwrite ?? 0 })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => setConfirmOverwrite(null)}
            >
              {t("keep")}
            </Button>
            <Button
              type="button"
              disabled={busy}
              onClick={() => void run(true)}
              className="bg-[#5566f6] text-white hover:bg-[#4a5bf0]"
            >
              {busy ? "…" : t("overwrite")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );

  return { run, busy, dialog, hidden: controls.specialMode };
}

export function CopyYesterdayButton({ documentId }: { documentId: string }) {
  const t = useTranslations("journalUi.copyYesterday");
  const tStaff = useTranslations("journalWidgets.staff");
  const { run, busy, dialog, hidden } = useCopyYesterdayAction(documentId);
  if (hidden) return null;
  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => run(false)}
        disabled={busy}
        title={t("buttonHint")}
        className="h-10 rounded-lg border-0 bg-[#5566f6]/[0.04] px-4 text-[15px] text-[#5566f6] shadow-none hover:bg-[#5566f6]/[0.09]"
      >
        {busy ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Copy className="size-4" />
        )}
        {tStaff("copyYesterday")}
      </Button>
      {dialog}
    </>
  );
}
