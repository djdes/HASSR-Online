"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { TEXT_DOC_MAX, TEXT_DOC_TITLE_MAX, type TextDocSource } from "@/lib/ppk/text-docs";
import {
  PPK_BUTTON_PRIMARY_CLASS,
  PPK_BUTTON_TEXT_CLASS,
  PPK_FIELD_CLASS,
  PPK_LABEL_CLASS,
  PPK_TEXTAREA_CLASS,
} from "@/components/production-control/ppk-ui";

const API = "/api/production-control/text-docs";

/**
 * Документ текстом: создать (название + текст) или исправить. После
 * сохранения — событие `ppk:changed`: плашка редакции перечитывается и, если
 * документ был утверждён, программа спрашивает про новую редакцию.
 */
export function TextDocDialog({
  open,
  onClose,
  source,
  docId,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  source: TextDocSource;
  /** null — новый документ; id — правка документа текстом. */
  docId: string | null;
  onSaved: (id: string) => void;
}) {
  const t = useTranslations("productionControl.textDocs");
  const locale = useLocale();
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle("");
    setText("");
    if (!docId) return;
    const abort = new AbortController();
    setLoading(true);
    fetch(`${API}/${docId}`, { cache: "no-store", signal: abort.signal })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as { title?: string; text?: string; error?: string } | null;
        if (!response.ok || !body) throw new Error(body?.error || t("loadFailed"));
        setTitle(body.title ?? "");
        setText(body.text ?? "");
      })
      .catch((error: unknown) => {
        if (!abort.signal.aborted) toast.error(error instanceof Error ? error.message : t("loadFailed"));
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [open, docId, t]);

  async function save() {
    if (saving || !title.trim() || !text.trim()) return;
    setSaving(true);
    try {
      const response = await fetch(docId ? `${API}/${docId}` : API, {
        method: docId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(docId ? { title, text } : { source, title, text }),
      });
      const body = (await response.json().catch(() => null)) as { id?: string; error?: string } | null;
      if (!response.ok) {
        toast.error(body?.error || t("saveFailed"));
        return;
      }
      toast.success(docId ? t("saved") : t("created"));
      onSaved(docId ?? body?.id ?? "");
      window.dispatchEvent(new Event("ppk:changed"));
      onClose();
    } catch {
      toast.error(t("saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? null : onClose())}>
      <DialogContent className="flex max-h-[92dvh] flex-col overflow-hidden rounded-3xl sm:max-w-[760px]" data-text-doc-dialog>
        <DialogHeader>
          <DialogTitle>{docId ? t("editTitle") : source === "procedures" ? t("createProcedure") : t("createInstruction")}</DialogTitle>
          <DialogDescription>{t("hint")}</DialogDescription>
        </DialogHeader>
        {loading ? (
          <div className="flex items-center gap-2 py-10 text-[14px] text-[#6f7282]">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            {t("loading")}
          </div>
        ) : (
          <div className="min-h-0 space-y-4 overflow-y-auto px-0.5 pb-1">
            <label className="block">
              <span className={PPK_LABEL_CLASS}>{t("titleLabel")}</span>
              <input
                value={title}
                maxLength={TEXT_DOC_TITLE_MAX}
                onChange={(event) => setTitle(event.target.value)}
                placeholder={source === "procedures" ? t("procedurePlaceholder") : t("instructionPlaceholder")}
                className={PPK_FIELD_CLASS}
                data-text-doc-title
              />
            </label>
            <label className="block">
              <span className={PPK_LABEL_CLASS}>{t("textLabel")}</span>
              <textarea
                value={text}
                maxLength={TEXT_DOC_MAX}
                rows={14}
                onChange={(event) => setText(event.target.value)}
                className={`${PPK_TEXTAREA_CLASS} min-h-[280px] text-[14.5px]`}
                data-text-doc-text
              />
              <span className="mt-1 block text-right text-[12px] tabular-nums text-[#9b9fb3]">
                {text.length.toLocaleString(locale)} / {TEXT_DOC_MAX.toLocaleString(locale)}
              </span>
            </label>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className={PPK_BUTTON_TEXT_CLASS}>
            {t("cancel")}
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || loading || !title.trim() || !text.trim()}
            className={PPK_BUTTON_PRIMARY_CLASS}
            data-text-doc-save
          >
            {saving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            {t("save")}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
