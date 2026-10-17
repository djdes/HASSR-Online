"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { todayKey } from "@/lib/ppk/sanitation";
import { PPK_BUTTON_OUTLINE_CLASS, PPK_BUTTON_PRIMARY_CLASS, PPK_FIELD_CLASS, PPK_LABEL_CLASS } from "./ppk-ui";

/** YYYY-MM-DD → ДД.ММ.ГГГГ для тоста. */
function dmy(value: string): string {
  const [y, m, d] = value.split("-");
  return `${d}.${m}.${y}`;
}

/**
 * Окно «Отметить выполнение» для планов санитарии: дата выполнения, следующий срок
 * (у дезинсекции редактируемый, у лаборатории — только расчёт) и необязательный файл
 * (протокол или акт), который уходит в папку раздела ППК.
 */
export function MarkDoneDialog({
  computeNext,
  editableNext,
  fileKind,
  folder,
  onClose,
  onSubmit,
}: {
  /** Следующий срок по выбранной дате; null — срок не считается. */
  computeNext: (date: string) => string | null;
  /** Можно ли править следующий срок вручную (дезинсекция) или он только показывается (лаборатория). */
  editableNext: boolean;
  fileKind: "protocol" | "act";
  folder: "lab-protocols" | "pest-acts";
  onClose: () => void;
  /** Записать выполнение; true — сервер принял. */
  onSubmit: (date: string, nextDate: string | null) => Promise<boolean>;
}) {
  const t = useTranslations("productionControl.markDone");
  const [date, setDate] = useState(todayKey());
  const [next, setNext] = useState(computeNext(todayKey()) ?? "");
  const [touched, setTouched] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  const changeDate = (value: string) => {
    setDate(value);
    // Пока срок не правили руками — он следует за датой.
    if (!touched) setNext(computeNext(value) ?? "");
  };

  const effectiveNext = editableNext ? next || null : computeNext(date);

  const submit = async () => {
    if (!date || saving) return;
    setSaving(true);
    const saved = await onSubmit(date, effectiveNext);
    if (!saved) {
      setSaving(false);
      return;
    }
    if (file) {
      const form = new FormData();
      form.set("folder", folder);
      form.set("file", file, file.name);
      try {
        const response = await fetch("/api/production-control/files", { method: "POST", body: form });
        if (!response.ok) {
          const data = await response.json().catch(() => null);
          toast.error(data?.error ?? t("uploadFailed", { name: file.name }));
        } else {
          window.dispatchEvent(new Event("ppk:changed"));
        }
      } catch {
        toast.error(t("uploadFailed", { name: file.name }));
      }
    }
    toast.success(effectiveNext ? t("done", { date: dmy(effectiveNext) }) : t("doneNoNext"));
    setSaving(false);
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[90vh] max-w-[480px] flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 gap-0 border-b border-[#ececf4] px-6 py-4 pr-14 text-left">
          <DialogTitle className="text-[18px] font-semibold tracking-[-0.01em] text-[#0b1024]">{t("title")}</DialogTitle>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
          <label className="block">
            <span className={PPK_LABEL_CLASS}>{t("date")}</span>
            <input type="date" value={date} onChange={(event) => changeDate(event.target.value)} className={PPK_FIELD_CLASS} />
          </label>

          {editableNext ? (
            <label className="block">
              <span className={PPK_LABEL_CLASS}>{t("next")}</span>
              <input
                type="date"
                value={next}
                onChange={(event) => {
                  setTouched(true);
                  setNext(event.target.value);
                }}
                className={PPK_FIELD_CLASS}
              />
            </label>
          ) : (
            <p className="rounded-2xl bg-[#f5f6ff] px-4 py-3 text-[14px] text-[#3c4053]">
              {effectiveNext ? t("nextPreview", { date: dmy(effectiveNext) }) : t("noNext")}
            </p>
          )}

          <label className="block">
            <span className={PPK_LABEL_CLASS}>{fileKind === "protocol" ? t("attachProtocol") : t("attachAct")}</span>
            <input
              type="file"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              className="block w-full text-[14px] text-[#3c4053] file:mr-3 file:h-10 file:cursor-pointer file:rounded-2xl file:border file:border-[#dcdfed] file:bg-white file:px-4 file:text-[14px] file:font-medium file:text-[#0b1024] hover:file:bg-[#f5f6ff]"
            />
          </label>
        </div>

        <DialogFooter className="shrink-0 gap-2 border-t border-[#ececf4] px-6 py-4">
          <button type="button" onClick={onClose} className={PPK_BUTTON_OUTLINE_CLASS}>
            {t("cancel")}
          </button>
          <button type="button" onClick={submit} disabled={!date || saving} className={PPK_BUTTON_PRIMARY_CLASS}>
            {t("submit")}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
