"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { AlertTriangle, Loader2 } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { buildDocumentOrgBlock, type LegalOverrideKey } from "@/lib/document-org-block";
import { missingOrgInfo, requiredOrgInfo, ORG_INFO_FIELDS, type OrgInfoField } from "@/lib/ppk/structure-fields";
import {
  PPK_BUTTON_PRIMARY_CLASS,
  PPK_FIELD_CLASS,
  PPK_LABEL_CLASS,
  PPK_TEXTAREA_CLASS,
} from "@/components/production-control/ppk-ui";

type OwnValues = {
  name: string;
  inn: string | null;
  address: string | null;
  phone: string | null;
} & Record<LegalOverrideKey, string | null>;

type Draft = Record<OrgInfoField, string>;

const MAX: Record<OrgInfoField, number> = {
  legalFullName: 300,
  inn: 12,
  kpp: 9,
  ogrn: 15,
  legalAddress: 500,
  address: 500,
  phone: 40,
  directorName: 200,
  directorPost: 200,
};

const MULTILINE: OrgInfoField[] = ["legalAddress", "address"];

/**
 * Форма 1.1: свои значения реквизитов, под пустым полем — значение из ЕГРЮЛ,
 * которое и пойдёт в документы. Сохраняются только изменённые поля — правки
 * поверх реестра не плодятся. Не хватает обязательного — предупреждение;
 * сохранить с пропуском можно после подтверждения.
 */
export function OrgInfoForm({
  own,
  registry,
  legalProfileJson,
  canManage,
}: {
  own: OwnValues;
  registry: Record<LegalOverrideKey, string | null>;
  legalProfileJson: unknown;
  canManage: boolean;
}) {
  const t = useTranslations("productionControl.structure.orgInfo");
  const router = useRouter();
  const initial = useMemo<Draft>(
    () => Object.fromEntries(ORG_INFO_FIELDS.map((key) => [key, (own[key] ?? "").toString()])) as Draft,
    [own],
  );
  const [saved, setSaved] = useState<Draft>(initial);
  const [draft, setDraft] = useState<Draft>(initial);
  const [saving, setSaving] = useState(false);
  const [confirmSkip, setConfirmSkip] = useState(false);

  // Действующий блок реквизитов из черновика — тем же правилом, что документы.
  const block = useMemo(
    () =>
      buildDocumentOrgBlock({
        org: {
          name: own.name,
          inn: draft.inn || null,
          address: draft.address || null,
          phone: draft.phone || null,
          legalProfileJson,
          legalFullName: draft.legalFullName || null,
          kpp: draft.kpp || null,
          ogrn: draft.ogrn || null,
          legalAddress: draft.legalAddress || null,
          directorName: draft.directorName || null,
          directorPost: draft.directorPost || null,
        },
      }),
    [draft, legalProfileJson, own.name],
  );
  const missing = missingOrgInfo(block.org);
  const required = new Set(requiredOrgInfo(block.org));
  const changed = ORG_INFO_FIELDS.filter((key) => draft[key].trim() !== saved[key].trim());

  const hint = (key: OrgInfoField): string | null => {
    if (draft[key].trim()) return null;
    if (key in registry && registry[key as LegalOverrideKey]) {
      return t("fromRegistry", { value: registry[key as LegalOverrideKey] as string });
    }
    if (key === "address" && block.org.address) return t("sameAsLegal");
    return null;
  };

  async function save() {
    if (saving || changed.length === 0) return;
    setSaving(true);
    try {
      const payload = Object.fromEntries(changed.map((key) => [key, draft[key].trim() || null]));
      const response = await fetch("/api/settings/organization", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
        toast.error(typeof body?.error === "string" && body.error ? body.error : t("saveFailed"));
        return;
      }
      setSaved(draft);
      toast.success(t("saved"));
      window.dispatchEvent(new Event("ppk:changed"));
      router.refresh();
    } catch {
      toast.error(t("saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  const missingNames = missing.map((key) => t(`fields.${key}`)).join(", ");

  return (
    <div className="space-y-4" data-ppk-org-info>
      {missing.length > 0 ? (
        <div role="status" className="flex gap-3 rounded-2xl bg-[#fff7e6] px-4 py-3 text-[13.5px] leading-[1.5] text-[#8a5a00]">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <div>
            <div className="font-medium">{t("incomplete")}</div>
            <div>{t("missingList", { fields: missingNames })}</div>
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        {ORG_INFO_FIELDS.map((key) => {
          const multiline = MULTILINE.includes(key);
          const label = (
            <span className={PPK_LABEL_CLASS}>
              {t(`fields.${key}`)}
              {required.has(key) ? <span className="text-[#a13a32]"> *</span> : null}
            </span>
          );
          const common = {
            value: draft[key],
            disabled: !canManage,
            maxLength: MAX[key],
            "aria-invalid": missing.includes(key) || undefined,
            // Пустое поле — в документы идёт значение из ЕГРЮЛ (полное наименование — название организации).
            placeholder:
              key in registry
                ? (registry[key as LegalOverrideKey] ?? (key === "legalFullName" ? own.name : ""))
                : "",
          };
          return (
            <label key={key} className={multiline || key === "legalFullName" ? "block sm:col-span-2" : "block"}>
              {label}
              {multiline ? (
                <textarea
                  {...common}
                  rows={2}
                  onChange={(event) => setDraft((prev) => ({ ...prev, [key]: event.target.value }))}
                  className={`${PPK_TEXTAREA_CLASS} min-h-[64px]`}
                />
              ) : (
                <input
                  {...common}
                  inputMode={key === "inn" || key === "ogrn" ? "numeric" : key === "phone" ? "tel" : undefined}
                  onChange={(event) => setDraft((prev) => ({ ...prev, [key]: event.target.value }))}
                  className={PPK_FIELD_CLASS}
                />
              )}
              {hint(key) ? <span className="mt-1 block text-[12.5px] text-[#6f7282]">{hint(key)}</span> : null}
            </label>
          );
        })}
      </div>

      {canManage ? (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={saving || changed.length === 0}
            onClick={() => (missing.length > 0 ? setConfirmSkip(true) : void save())}
            className={PPK_BUTTON_PRIMARY_CLASS}
          >
            {saving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            {t("save")}
          </button>
          {changed.length === 0 ? <span className="text-[13px] text-[#6f7282]">{t("noChanges")}</span> : null}
        </div>
      ) : (
        <p className="text-[13px] text-[#6f7282]">{t("readOnly")}</p>
      )}

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
