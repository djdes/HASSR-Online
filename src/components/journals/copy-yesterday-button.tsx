"use client";

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
          (data && "error" in data && data.error) || "Не удалось скопировать"
        );
        return;
      }
      const result = data as Result;
      if (result.copied === 0 && result.kept === 0) {
        toast.info(result.message ?? "Вчера записей не было");
        return;
      }
      if (overwrite || result.kept === 0) {
        const parts = [`добавлено ${result.copied}`];
        if (result.kept > 0) parts.push(`оставлено ${result.kept}`);
        toast.success(`Скопировано из ${result.yesterdayKey} · ${parts.join(" · ")}`);
        setConfirmOverwrite(null);
        router.refresh();
        return;
      }
      // Default run with something already filled → offer overwrite.
      setConfirmOverwrite(result.kept);
      if (result.copied > 0) {
        toast.success(
          `Добавлено строк: ${result.copied}. Оставлено уже заполненных: ${result.kept}.`
        );
        router.refresh();
      }
    } catch (err) {
      toast.error(humanizeFetchError(err, "Ошибка сети"));
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
            <DialogTitle>Перезаписать сегодняшние строки?</DialogTitle>
            <DialogDescription>
              На сегодня уже заполнено строк: {confirmOverwrite}. Если
              нажмёте «Перезаписать», они заменятся вчерашними значениями.
              Это нельзя отменить.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => setConfirmOverwrite(null)}
            >
              Оставить как есть
            </Button>
            <Button
              type="button"
              disabled={busy}
              onClick={() => void run(true)}
              className="bg-[#5566f6] text-white hover:bg-[#4a5bf0]"
            >
              {busy ? "…" : "Перезаписать"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );

  return { run, busy, dialog };
}

export function CopyYesterdayButton({ documentId }: { documentId: string }) {
  const { run, busy, dialog } = useCopyYesterdayAction(documentId);
  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => run(false)}
        disabled={busy}
        title="Создать сегодняшние строки по вчерашним значениям — удобно, когда ничего не поменялось."
        className="h-10 rounded-lg border-0 bg-[#5566f6]/[0.04] px-4 text-[15px] text-[#5566f6] shadow-none hover:bg-[#5566f6]/[0.09]"
      >
        {busy ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Copy className="size-4" />
        )}
        Скопировать вчерашнее
      </Button>
      {dialog}
    </>
  );
}
