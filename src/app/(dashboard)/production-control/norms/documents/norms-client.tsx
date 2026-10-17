"use client";

import { useState, type KeyboardEvent } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Plus, X } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { NORM_CATALOG } from "@/lib/ppk/norm-catalog";
import type { NormsData } from "@/lib/ppk/records";
import { usePpkRecords, type PpkRecordRow } from "@/components/production-control/use-ppk-records";
import {
  PPK_BUTTON_PRIMARY_CLASS,
  PPK_BUTTON_TEXT_CLASS,
  PPK_FIELD_CLASS,
  PPK_ICON_BUTTON_CLASS,
} from "@/components/production-control/ppk-ui";

/** Пределы — те же, что в схеме записи `norms`. */
const CUSTOM_MAX = 50;
const TITLE_MAX = 300;

const EMPTY: NormsData = { selected: [], custom: [] };

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((item) => set.has(item));
}

/**
 * Нормативные документы заведения: отметки каталога и свои документы. Правки
 * копятся в окне до кнопки «Сохранить»; одна запись блока `norms` — создаётся
 * при первом сохранении и дальше обновляется.
 */
export function NormsClient({ initial }: { initial: PpkRecordRow<NormsData>[] }) {
  const t = useTranslations("productionControl.norms");
  const { records, create, update } = usePpkRecords<NormsData>("norms", initial);
  const row = records[0] ?? null;
  const saved = row?.data ?? EMPTY;
  const savedCustom = saved.custom.map((item) => item.title);

  const [selected, setSelected] = useState<string[]>(saved.selected);
  const [custom, setCustom] = useState<string[]>(savedCustom);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  const dirty = !sameSet(selected, saved.selected) || custom.join("\u0000") !== savedCustom.join("\u0000");

  function toggle(id: string, on: boolean) {
    setSelected((current) => (on ? [...current.filter((item) => item !== id), id] : current.filter((item) => item !== id)));
  }

  function selectRecommended() {
    setSelected((current) => [
      ...current,
      ...NORM_CATALOG.filter((doc) => doc.recommended && !current.includes(doc.id)).map((doc) => doc.id),
    ]);
  }

  function addCustom() {
    const title = draft.trim().slice(0, TITLE_MAX);
    if (!title || custom.length >= CUSTOM_MAX) return;
    setCustom((current) => [...current, title]);
    setDraft("");
  }

  function onDraftKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      addCustom();
    }
  }

  async function save() {
    setSaving(true);
    // Порядок — как в каталоге, чтобы запись не зависела от порядка отметок.
    const data: NormsData = {
      selected: NORM_CATALOG.filter((doc) => selected.includes(doc.id)).map((doc) => doc.id),
      custom: custom.map((title) => ({ title })),
    };
    const ok = row ? await update(row.id, data) : await create(data);
    setSaving(false);
    if (ok) toast.success(t("saved"));
  }

  return (
    <section className="space-y-6 rounded-3xl border border-[#ececf4] bg-white p-5 sm:p-6">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-[15px] font-semibold text-[#0b1024]">{t("catalog")}</h3>
          <button type="button" onClick={selectRecommended} className={PPK_BUTTON_TEXT_CLASS}>
            {t("selectRecommended")}
          </button>
        </div>
        <ul className="space-y-2">
          {NORM_CATALOG.map((doc) => {
            const checked = selected.includes(doc.id);
            return (
              <li key={doc.id}>
                <label
                  className={`flex min-h-[48px] w-full cursor-pointer items-center gap-3 rounded-2xl border px-4 py-2.5 transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] ${
                    checked ? "border-[#5566f6]/40 bg-[#f5f6ff]" : "border-[#ececf4] bg-white"
                  }`}
                >
                  <Checkbox checked={checked} onCheckedChange={(value) => toggle(doc.id, value === true)} />
                  <span className="min-w-0 flex-1 text-[14px] leading-[1.45] text-[#0b1024]">{doc.title}</span>
                  {doc.recommended ? (
                    <span className="shrink-0 rounded-full bg-[#eef0ff] px-2.5 py-0.5 text-[12px] font-medium text-[#3848c7]">
                      {t("recommended")}
                    </span>
                  ) : null}
                </label>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="space-y-3 border-t border-[#ececf4] pt-5">
        <h3 className="text-[15px] font-semibold text-[#0b1024]">{t("custom")}</h3>
        {custom.length > 0 ? (
          <ul className="space-y-2">
            {custom.map((title, index) => (
              <li
                key={`${index}-${title}`}
                className="flex min-h-[48px] items-center gap-3 rounded-2xl border border-[#ececf4] px-4 py-2"
              >
                <span className="min-w-0 flex-1 text-[14px] leading-[1.45] text-[#0b1024]">{title}</span>
                <button
                  type="button"
                  aria-label={t("remove")}
                  title={t("remove")}
                  onClick={() => setCustom((current) => current.filter((_, i) => i !== index))}
                  className={PPK_ICON_BUTTON_CLASS}
                >
                  <X className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onDraftKey}
            maxLength={TITLE_MAX}
            placeholder={t("customPlaceholder")}
            className={PPK_FIELD_CLASS}
          />
          <button
            type="button"
            onClick={addCustom}
            disabled={!draft.trim() || custom.length >= CUSTOM_MAX}
            className={`${PPK_BUTTON_PRIMARY_CLASS} shrink-0 justify-center`}
          >
            <Plus className="size-4" />
            {t("add")}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#ececf4] pt-5">
        {dirty ? (
          <span className="rounded-full bg-[#fff7e6] px-3 py-1 text-[12.5px] font-medium text-[#8a5a00]">
            {t("unsaved")}
          </span>
        ) : row ? (
          <span className="rounded-full bg-[#e9f7ef] px-3 py-1 text-[12.5px] font-medium text-[#1f7a46]">
            {t("saved")}
          </span>
        ) : (
          <span />
        )}
        <button
          type="button"
          onClick={() => void save()}
          disabled={!dirty || saving}
          className={PPK_BUTTON_PRIMARY_CLASS}
        >
          {t("save")}
        </button>
      </div>
    </section>
  );
}
