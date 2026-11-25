"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, RotateCcw, Sparkles } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { isDraftBlock } from "@/lib/ppk/text-drafts";
import type { PpkFolderKey } from "@/lib/ppk/folders";
import type { PpkTextBlock } from "@/lib/ppk/records";
import {
  PPK_BUTTON_PRIMARY_CLASS,
  PPK_BUTTON_TEXT_CLASS,
  PPK_TEXTAREA_CLASS,
} from "@/components/production-control/ppk-ui";

const API = "/api/production-control/records";
const DRAFT_API = "/api/production-control/text-docs/draft";
const MAX = 30000;

/**
 * Дата «Сохранено …» в поясе организации: так она одинакова на сервере и в
 * браузере (иначе около полуночи разошлась бы при гидратации). Неизвестный
 * пояс — Москва.
 */
function savedDate(iso: string, locale: string, timeZone: string): string {
  const options = { day: "numeric", month: "long", year: "numeric" } as const;
  try {
    return new Date(iso).toLocaleDateString(locale, { ...options, timeZone });
  } catch {
    return new Date(iso).toLocaleDateString(locale, { ...options, timeZone: "Europe/Moscow" });
  }
}

/**
 * Текст пункта: пока своего нет — в поле шаблон (если он у пункта есть);
 * «Сохранить» фиксирует текст (правленый шаблон или свой), «Вернуть шаблон»
 * подставляет шаблон заново. Пункт без шаблона — пустое поле.
 */
export function TextDocEditor({
  block,
  record,
  template,
  scanFolder,
  timeZone,
}: {
  block: PpkTextBlock;
  record: { id: string; text: string; updatedAt: string } | null;
  template: string;
  scanFolder: PpkFolderKey | null;
  /** Пояс организации — для даты «Сохранено …». */
  timeZone: string;
}) {
  const t = useTranslations("productionControl.structure.text");
  const locale = useLocale();
  const [recordId, setRecordId] = useState<string | null>(record?.id ?? null);
  const [savedText, setSavedText] = useState<string | null>(record ? record.text : null);
  const [savedAt, setSavedAt] = useState<string | null>(record?.updatedAt ?? null);
  const [text, setText] = useState<string>(record ? record.text : template);
  const [saving, setSaving] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [askReplace, setAskReplace] = useState(false);
  // Черновик от ИИ-помощника (2026-11-25): только у пунктов с текстом.
  const canDraft = isDraftBlock(block);

  async function draft() {
    if (drafting) return;
    setAskReplace(false);
    setDrafting(true);
    try {
      const response = await fetch(DRAFT_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ block }),
      });
      const body = (await response.json().catch(() => null)) as { text?: string; error?: string } | null;
      if (!response.ok || !body?.text) {
        toast.error(body?.error || t("draftFailed"));
        return;
      }
      // Черновик — в поле, не сохранён: человек проверяет и нажимает «Сохранить».
      setText(body.text);
      toast.success(t("draftReady"));
    } catch {
      toast.error(t("draftFailed"));
    } finally {
      setDrafting(false);
    }
  }

  const fromTemplate = savedText === null && template.length > 0;
  const dirty = savedText === null ? text.trim().length > 0 : text !== savedText;

  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      const data = { text: text.trim() };
      const response = await fetch(recordId ? `${API}/${recordId}` : API, {
        method: recordId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(recordId ? { data } : { block, data }),
      });
      const body = (await response.json().catch(() => null)) as
        | { record?: { id: string; updatedAt: string }; error?: string }
        | null;
      if (!response.ok || !body?.record) {
        toast.error(body?.error || t("saveFailed"));
        return;
      }
      setRecordId(body.record.id);
      setSavedText(data.text);
      setText(data.text);
      setSavedAt(body.record.updatedAt);
      toast.success(t("saved"));
      window.dispatchEvent(new Event("ppk:changed"));
    } catch {
      toast.error(t("saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  const status = fromTemplate
    ? t("statusTemplate")
    : savedText === null
      ? t("statusEmpty")
      : savedAt
        ? t("statusSaved", { date: savedDate(savedAt, locale, timeZone) })
        : null;

  return (
    <section className="space-y-3" data-ppk-text={block}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[15.5px] font-semibold tracking-[-0.01em] text-[#0b1024]">
          {template ? t("textTitle") : t("ownTextTitle")}
        </h3>
        {status ? (
          <span
            className={
              fromTemplate
                ? "rounded-full bg-[#fff7e6] px-2.5 py-1 text-[12px] font-medium text-[#8a5a00]"
                : "text-[12.5px] text-[#6f7282]"
            }
          >
            {status}
          </span>
        ) : null}
      </div>
      <textarea
        value={text}
        maxLength={MAX}
        rows={14}
        placeholder={template ? undefined : t("placeholder")}
        onChange={(event) => setText(event.target.value)}
        aria-label={template ? t("textTitle") : t("ownTextTitle")}
        className={`${PPK_TEXTAREA_CLASS} min-h-[260px] text-[14.5px]`}
      />
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => void save()} disabled={saving || !dirty} className={PPK_BUTTON_PRIMARY_CLASS}>
          {saving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
          {t("save")}
        </button>
        {template && text !== template ? (
          <button type="button" onClick={() => setText(template)} className={PPK_BUTTON_TEXT_CLASS}>
            <RotateCcw className="size-4" aria-hidden />
            {t("resetTemplate")}
          </button>
        ) : null}
        {canDraft ? (
          <button
            type="button"
            onClick={() => (text.trim() ? setAskReplace(true) : void draft())}
            disabled={drafting || saving}
            className={PPK_BUTTON_TEXT_CLASS}
            data-ppk-draft
          >
            {drafting ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Sparkles className="size-4" aria-hidden />}
            {drafting ? t("drafting") : t("draft")}
          </button>
        ) : null}
        <span className="text-[12.5px] tabular-nums text-[#9b9fb3]">
          {text.length.toLocaleString(locale)} / {MAX.toLocaleString(locale)}
        </span>
      </div>
      {scanFolder ? <p className="text-[12.5px] text-[#6f7282]">{t("scanOrText")}</p> : null}
      {canDraft ? <p className="text-[12.5px] text-[#6f7282]">{t("draftHint")}</p> : null}
      <ConfirmDialog
        open={askReplace}
        onClose={() => setAskReplace(false)}
        onConfirm={() => void draft()}
        title={t("draftReplaceTitle")}
        description={t("draftReplaceBody")}
        confirmLabel={t("draftReplaceConfirm")}
        cancelLabel={t("draftReplaceCancel")}
      />
    </section>
  );
}
