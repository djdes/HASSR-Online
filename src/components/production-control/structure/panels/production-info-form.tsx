"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { AlertTriangle, ArrowUpRight, Loader2 } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { ProductionInfoData } from "@/lib/ppk/records";
import {
  PRODUCTION_INFO_FIELDS,
  emptyProductionInfo,
  missingProductionInfo,
  type ProductionPulled,
} from "@/lib/ppk/structure-fields";
import {
  PPK_BUTTON_PRIMARY_CLASS,
  PPK_FIELD_CLASS,
  PPK_LABEL_CLASS,
  PPK_TEXTAREA_CLASS,
} from "@/components/production-control/ppk-ui";

const API = "/api/production-control/records";

/**
 * Форма 1.4: подтянутые из объекта сведения — только чтение со ссылкой на
 * источник; поля шаблона правятся здесь. Пропуски обязательного — с
 * предупреждением и подтверждением.
 */
export function ProductionInfoForm({
  record,
  pulled,
  staffCount,
  objectHref,
}: {
  record: { id: string; data: ProductionInfoData } | null;
  pulled: ProductionPulled;
  staffCount: number;
  objectHref: string;
}) {
  const t = useTranslations("productionControl.structure.production");
  const router = useRouter();
  const [recordId, setRecordId] = useState<string | null>(record?.id ?? null);
  const [saved, setSaved] = useState<ProductionInfoData>(record?.data ?? emptyProductionInfo());
  const [draft, setDraft] = useState<ProductionInfoData>(record?.data ?? emptyProductionInfo());
  const [saving, setSaving] = useState(false);
  const [confirmSkip, setConfirmSkip] = useState(false);

  const missing = missingProductionInfo(draft, pulled);
  const dirty = !recordId || PRODUCTION_INFO_FIELDS.some((field) => draft[field.key].trim() !== saved[field.key].trim());
  const missingNames = missing.map((key) => t(`fields.${key}`)).join(", ");

  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      const data = Object.fromEntries(
        PRODUCTION_INFO_FIELDS.map((field) => [field.key, draft[field.key].trim()]),
      ) as ProductionInfoData;
      const response = await fetch(recordId ? `${API}/${recordId}` : API, {
        method: recordId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(recordId ? { data } : { block: "production-info", data }),
      });
      const body = (await response.json().catch(() => null)) as { record?: { id: string }; error?: string } | null;
      if (!response.ok || !body?.record) {
        toast.error(body?.error || t("saveFailed"));
        return;
      }
      setRecordId(body.record.id);
      setSaved(data);
      setDraft(data);
      toast.success(t("saved"));
      window.dispatchEvent(new Event("ppk:changed"));
      router.refresh();
    } catch {
      toast.error(t("saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  const readOnlyRow = (label: string, value: string | null, isMissing: boolean) => (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
      <dt className="text-[13px] text-[#6f7282] sm:w-[220px] sm:shrink-0">
        {label}
        <span className="text-[#a13a32]"> *</span>
      </dt>
      <dd className={isMissing ? "text-[14px] text-[#a13a32]" : "text-[14px] text-[#0b1024]"}>{value || t("notSet")}</dd>
    </div>
  );

  return (
    <div className="space-y-5" data-ppk-production-info>
      {missing.length > 0 ? (
        <div role="status" className="flex gap-3 rounded-2xl bg-[#fff7e6] px-4 py-3 text-[13.5px] leading-[1.5] text-[#8a5a00]">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <div>
            <div className="font-medium">{t("incomplete")}</div>
            <div>{t("missingList", { fields: missingNames })}</div>
          </div>
        </div>
      ) : null}

      <div className="space-y-2 rounded-2xl bg-[var(--app-veil)] px-4 py-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-[14px] font-semibold text-[#0b1024]">{t("pulledTitle")}</h3>
          <Link
            href={objectHref}
            className="inline-flex items-center gap-1 text-[13px] font-medium text-[#3848c7] transition-colors duration-150 hover:text-[#5566f6]"
          >
            {t("editObject")}
            <ArrowUpRight className="size-3.5" aria-hidden />
          </Link>
        </div>
        <dl className="space-y-2">
          {readOnlyRow(t("fields.objectName"), pulled.objectName, missing.includes("objectName"))}
          {readOnlyRow(t("fields.objectAddress"), pulled.objectAddress, missing.includes("objectAddress"))}
          <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
            <dt className="text-[13px] text-[#6f7282] sm:w-[220px] sm:shrink-0">{t("fields.staffCount")}</dt>
            <dd className="text-[14px] tabular-nums text-[#0b1024]">{staffCount}</dd>
          </div>
        </dl>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {PRODUCTION_INFO_FIELDS.map((field) => (
          <label key={field.key} className={field.multiline ? "block sm:col-span-2" : "block"}>
            <span className={PPK_LABEL_CLASS}>
              {t(`fields.${field.key}`)}
              {field.required ? <span className="text-[#a13a32]"> *</span> : null}
            </span>
            {field.multiline ? (
              <textarea
                value={draft[field.key]}
                maxLength={field.max}
                onChange={(event) => setDraft((prev) => ({ ...prev, [field.key]: event.target.value }))}
                className={PPK_TEXTAREA_CLASS}
              />
            ) : (
              <input
                value={draft[field.key]}
                maxLength={field.max}
                aria-invalid={missing.includes(field.key) || undefined}
                placeholder={field.key === "activity" ? (pulled.activity ?? t(`placeholders.${field.key}`)) : t(`placeholders.${field.key}`)}
                onChange={(event) => setDraft((prev) => ({ ...prev, [field.key]: event.target.value }))}
                className={PPK_FIELD_CLASS}
              />
            )}
          </label>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={saving || !dirty}
          onClick={() => (missing.length > 0 ? setConfirmSkip(true) : void save())}
          className={PPK_BUTTON_PRIMARY_CLASS}
        >
          {saving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
          {t("save")}
        </button>
        {!dirty ? <span className="text-[13px] text-[#6f7282]">{t("noChanges")}</span> : null}
      </div>

      <ConfirmDialog
        open={confirmSkip}
        onClose={() => setConfirmSkip(false)}
        onConfirm={async () => {
          setConfirmSkip(false);
          await save();
        }}
        title={t("incomplete")}
        description={t("missingList", { fields: missingNames })}
        confirmLabel={t("skipAndSave")}
        cancelLabel={t("keepFilling")}
        variant="warn"
      />
    </div>
  );
}
