"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowRight, Building2, Plus, RotateCcw, ShieldCheck, Store } from "lucide-react";
import { toast } from "sonner";
import type { LegalProfile } from "@/lib/org-legal-profile";
import {
  buildDocumentOrgBlock,
  documentOrgRows,
  journalHeaderOrgText,
  registryDefaults,
  type LegalOverrideKey,
} from "@/lib/document-org-block";
import { ORG_JOURNAL_NAME_MAX, suggestOrgJournalName } from "@/lib/org-journal-name";
import { KPP_PATTERN } from "@/lib/organization-profile-patch";
import {
  FieldRow,
  ORG_INPUT_CLASS,
  ORG_OUTLINE_BUTTON_CLASS,
  ORG_SMALL_BUTTON_CLASS,
  ORG_TEXTAREA_CLASS,
  SaveButton,
  StepCard,
  UnsavedBar,
  patchOrganization,
} from "@/components/settings/organization-page-kit";

/** Правки организации на этой странице: название для журналов и реквизиты поверх ЕГРЮЛ. */
type OrgDraft = { journalShortName: string | null } & Record<LegalOverrideKey, string | null>;

/** Поля точки, которые печатаются в шапке её документов. */
type PointDraft = { journalName: string; address: string; kpp: string; phone: string };

export type DocumentsPoint = {
  id: string;
  name: string;
  address: string | null;
  journalName: string | null;
  kpp: string | null;
  phone: string | null;
};

export type DocumentsOrg = OrgDraft & {
  name: string;
  inn: string | null;
  address: string | null;
  phone: string | null;
};

/**
 * Правки реквизитов поверх ЕГРЮЛ — порядок полей карточки «Об организации».
 * Пустое поле = значение из снимка реестра (`document-org-block.ts`).
 */
const LEGAL_FIELDS: Array<{ key: LegalOverrideKey; multiline?: boolean; maxLength: number; inputMode?: "numeric" }> = [
  { key: "legalFullName", maxLength: 300 },
  // КПП — без цифровой клавиатуры: с 2019 г. в причине постановки бывают латинские буквы.
  { key: "kpp", maxLength: 9 },
  { key: "ogrn", maxLength: 15, inputMode: "numeric" },
  { key: "legalAddress", multiline: true, maxLength: 500 },
  { key: "directorName", maxLength: 200 },
  { key: "directorPost", maxLength: 200 },
];

const ORG_KEYS: Array<keyof OrgDraft> = ["journalShortName", ...LEGAL_FIELDS.map(({ key }) => key)];

const POINT_KEYS: Array<keyof PointDraft> = ["journalName", "address", "kpp", "phone"];

/** Ошибки сервера, которые относятся к конкретному полю. */
const FIELD_ERRORS: Partial<Record<string, LegalOverrideKey>> = { invalidKpp: "kpp", invalidOgrn: "ogrn" };

const same = (a: string | null | undefined, b: string | null | undefined) => (a ?? "").trim() === (b ?? "").trim();

function toPointDraft(point: DocumentsPoint): PointDraft {
  return {
    journalName: point.journalName ?? "",
    address: point.address ?? "",
    kpp: point.kpp ?? "",
    phone: point.phone ?? "",
  };
}

function normalizedKpp(value: string): string {
  return value.replace(/\s/g, "").toUpperCase();
}

/**
 * «Моя компания → Сведения для документов» (скан 82, лист 2: блок сведений
 * «в любом документе»): ① об организации — правки реквизитов поверх ЕГРЮЛ,
 * ② о торговой точке — то, что точка добавляет к шапке своих документов,
 * ③ живой предпросмотр теми же функциями, что у PDF.
 */
export function OrganizationDocumentsForm({
  org,
  legalProfile,
  points,
  initialPointId,
}: {
  org: DocumentsOrg;
  legalProfile: LegalProfile | null;
  points: DocumentsPoint[];
  initialPointId: string | null;
}) {
  const t = useTranslations("settingsManagement.organizationProfile");
  const router = useRouter();

  const initialOrg: OrgDraft = Object.fromEntries(ORG_KEYS.map((key) => [key, org[key] ?? null])) as OrgDraft;
  const [orgSaved, setOrgSaved] = useState<OrgDraft>(initialOrg);
  const [orgDraft, setOrgDraft] = useState<OrgDraft>(initialOrg);

  const initialPoints = Object.fromEntries(points.map((point) => [point.id, toPointDraft(point)]));
  const [pointSaved, setPointSaved] = useState<Record<string, PointDraft>>(initialPoints);
  const [pointDrafts, setPointDrafts] = useState<Record<string, PointDraft>>(initialPoints);
  const [pointId, setPointId] = useState<string | null>(
    initialPointId && points.some((point) => point.id === initialPointId) ? initialPointId : (points[0]?.id ?? null),
  );

  const [errors, setErrors] = useState<Partial<Record<LegalOverrideKey, string>>>({});
  const [pointErrors, setPointErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const orgDirtyKeys = ORG_KEYS.filter((key) => !same(orgDraft[key], orgSaved[key]));
  const dirtyPointIds = points
    .map((point) => point.id)
    .filter((id) => POINT_KEYS.some((key) => !same(pointDrafts[id]?.[key], pointSaved[id]?.[key])));
  const dirty = orgDirtyKeys.length > 0 || dirtyPointIds.length > 0;

  const point = pointId ? points.find((item) => item.id === pointId) ?? null : null;
  const pointDraft = point ? pointDrafts[point.id] : null;

  // Предпросмотр — те же функции, что у PDF журналов, ППК и приказов.
  const registry = registryDefaults({ inn: org.inn, legalProfileJson: legalProfile });
  const legalShortName = suggestOrgJournalName(legalProfile);
  const block = buildDocumentOrgBlock({
    org: { name: org.name, inn: org.inn, address: org.address, phone: org.phone, legalProfileJson: legalProfile, ...orgDraft },
    point:
      point && pointDraft
        ? {
            name: point.name,
            address: pointDraft.address,
            journalName: pointDraft.journalName,
            kpp: normalizedKpp(pointDraft.kpp),
            phone: pointDraft.phone,
          }
        : null,
  });
  const header = journalHeaderOrgText(block);
  const rows = documentOrgRows(block);

  function setOrgField(key: keyof OrgDraft, value: string | null) {
    setOrgDraft((prev) => ({ ...prev, [key]: value }));
    if (key !== "journalShortName") setErrors((prev) => ({ ...prev, [key]: undefined }));
  }

  function setPointField(key: keyof PointDraft, value: string) {
    if (!point) return;
    const id = point.id;
    setPointDrafts((prev) => ({ ...prev, [id]: { ...prev[id], [key]: value } }));
    if (key === "kpp") setPointErrors((prev) => ({ ...prev, [id]: "" }));
  }

  function discard() {
    setOrgDraft(orgSaved);
    setPointDrafts(pointSaved);
    setErrors({});
    setPointErrors({});
  }

  async function save() {
    if (saving || !dirty) return;
    // КПП точки сервер не проверяет по формату — проверяем здесь, тем же правилом, что у организации.
    const badPoint = dirtyPointIds.find((id) => {
      const kpp = normalizedKpp(pointDrafts[id].kpp);
      return kpp !== "" && !KPP_PATTERN.test(kpp);
    });
    if (badPoint) {
      setPointErrors((prev) => ({ ...prev, [badPoint]: t("form.apiErrors.invalidKpp") }));
      setPointId(badPoint);
      toast.error(t("form.apiErrors.invalidKpp"));
      return;
    }

    setSaving(true);
    try {
      if (orgDirtyKeys.length > 0) {
        // Пустая правка уходит пустой строкой — сервер очистит её, и в документы снова пойдёт ЕГРЮЛ.
        const payload = Object.fromEntries(orgDirtyKeys.map((key) => [key, orgDraft[key] ?? ""]));
        const result = await patchOrganization(payload);
        if (!result.ok) {
          if (result.network) {
            toast.error(t("form.networkError"));
            return;
          }
          const fieldErrors: Partial<Record<LegalOverrideKey, string>> = {};
          const other: string[] = [];
          for (const key of result.keys ?? []) {
            const field = FIELD_ERRORS[key];
            if (field) fieldErrors[field] = t(`form.apiErrors.${key}`);
            else other.push(t(`form.apiErrors.${key}`));
          }
          setErrors(fieldErrors);
          toast.error(other.length > 0 ? other.join("; ") : result.keys ? t("documentsPage.fixFields") : t("form.saveError"));
          return;
        }
        setOrgSaved(orgDraft);
        setErrors({});
      }

      for (const id of dirtyPointIds) {
        const draft = pointDrafts[id];
        const response = await fetch(`/api/settings/buildings/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            journalName: draft.journalName.trim() || null,
            address: draft.address.trim() || null,
            kpp: normalizedKpp(draft.kpp) || null,
            phone: draft.phone.trim() || null,
          }),
        }).catch(() => null);
        if (!response?.ok) {
          setPointId(id);
          toast.error(response ? t("documentsPage.pointSaveError") : t("form.networkError"));
          return;
        }
        setPointSaved((prev) => ({ ...prev, [id]: draft }));
      }

      toast.success(t("documentsPage.saved"));
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  const pointTitle = (item: DocumentsPoint) => item.name || item.address || t("documentsPage.pointUntitled");

  return (
    <div className="space-y-5">
      {dirty ? <UnsavedBar saving={saving} onSave={save} onDiscard={discard} /> : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)] lg:items-start">
        <div className="min-w-0 space-y-5">
          {/* ① Об организации */}
          <StepCard n={1} id="organization" title={t("documentsPage.orgTitle")} lead={t("documentsPage.orgLead")}>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#ececf4] bg-[#fafbff] px-4 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-[12px] font-medium text-[#6f7282]">
                  <Building2 className="size-3.5 text-[#5566f6]" aria-hidden />
                  {t("documentsPage.fromRequisites")}
                </div>
                <div className="mt-0.5 text-[14px] font-medium leading-snug text-[#0b1024] [overflow-wrap:anywhere]">
                  {org.name}
                  {org.inn ? <span className="text-[#6f7282]"> · {t("documentsPage.innValue", { inn: org.inn })}</span> : null}
                </div>
              </div>
              <Link href="/settings/organization" className={ORG_SMALL_BUTTON_CLASS}>
                {t("documentsPage.editRequisites")}
                <ArrowRight className="size-3.5 text-[#5566f6]" aria-hidden />
              </Link>
            </div>

            <FieldRow label={t("form.journalShortName")} hint={t("documentsPage.journalShortNameHint")} htmlFor="doc-journalShortName">
              <div className="space-y-1.5">
                <input
                  id="doc-journalShortName"
                  type="text"
                  value={orgDraft.journalShortName ?? ""}
                  onChange={(event) => setOrgField("journalShortName", event.target.value || null)}
                  className={ORG_INPUT_CLASS}
                  placeholder={legalShortName ?? org.name}
                  maxLength={ORG_JOURNAL_NAME_MAX}
                />
                {legalShortName && legalShortName !== (orgDraft.journalShortName ?? "").trim() ? (
                  <button type="button" onClick={() => setOrgField("journalShortName", legalShortName)} className={ORG_SMALL_BUTTON_CLASS}>
                    <ShieldCheck className="size-3.5 text-[#5566f6]" aria-hidden />
                    {t("form.useFromRegistry", { name: legalShortName })}
                  </button>
                ) : null}
              </div>
            </FieldRow>

            {LEGAL_FIELDS.map(({ key, multiline, maxLength, inputMode }) => {
              const own = orgDraft[key] ?? "";
              const fromRegistry = registry[key];
              const error = errors[key] ?? null;
              const inputId = `doc-${key}`;
              return (
                <FieldRow key={key} label={t(`form.${key}`)} hint={t(`form.${key}Hint`)} error={error} htmlFor={inputId}>
                  <div className="space-y-1.5">
                    {multiline ? (
                      <textarea
                        id={inputId}
                        value={own}
                        onChange={(event) => setOrgField(key, event.target.value || null)}
                        className={ORG_TEXTAREA_CLASS}
                        placeholder={fromRegistry ?? ""}
                        maxLength={maxLength}
                        aria-invalid={error ? true : undefined}
                      />
                    ) : (
                      <input
                        id={inputId}
                        type="text"
                        value={own}
                        onChange={(event) => setOrgField(key, event.target.value || null)}
                        className={ORG_INPUT_CLASS}
                        placeholder={fromRegistry ?? ""}
                        maxLength={maxLength}
                        inputMode={inputMode}
                        aria-invalid={error ? true : undefined}
                      />
                    )}
                    {fromRegistry ? (
                      own.trim() && own.trim() !== fromRegistry ? (
                        <div className="flex flex-wrap items-center gap-2 text-[12px] leading-snug text-[#6f7282]">
                          <span className="min-w-0 break-words">{t("form.fromRegistry", { value: fromRegistry })}</span>
                          <button type="button" onClick={() => setOrgField(key, null)} className={ORG_SMALL_BUTTON_CLASS}>
                            <RotateCcw className="size-3.5 text-[#5566f6]" aria-hidden />
                            {t("form.resetToRegistry")}
                          </button>
                        </div>
                      ) : !own.trim() ? (
                        <div className="flex items-center gap-1.5 text-[12px] text-[#6f7282]">
                          <ShieldCheck className="size-3.5 text-[#5566f6]" aria-hidden />
                          {t("form.registryUsed")}
                        </div>
                      ) : null
                    ) : null}
                  </div>
                </FieldRow>
              );
            })}
          </StepCard>

          {/* ② О торговой точке */}
          <StepCard n={2} id="point" title={t("documentsPage.pointTitle")} lead={t("documentsPage.pointLead")}>
            {points.length === 0 || !point || !pointDraft ? (
              <div className="rounded-2xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-5 py-8 text-center" data-points-empty>
                <Store className="mx-auto mb-2 size-6 text-[#9b9fb3]" aria-hidden />
                <div className="text-[15px] font-medium text-[#0b1024]">{t("documentsPage.pointsEmptyTitle")}</div>
                <p className="mx-auto mt-1.5 max-w-[380px] text-[13px] leading-[1.5] text-[#6f7282]">{t("documentsPage.pointsEmptyBody")}</p>
                <Link href="/settings/buildings" className={`${ORG_OUTLINE_BUTTON_CLASS} mt-4`}>
                  <Plus className="size-4 text-[#5566f6]" aria-hidden />
                  {t("documentsPage.pointsAdd")}
                </Link>
              </div>
            ) : (
              <>
                {points.length > 1 ? (
                  <div role="radiogroup" aria-label={t("documentsPage.pointPick")} className="flex flex-wrap gap-2" data-point-picker>
                    {points.map((item) => {
                      const active = item.id === point.id;
                      const changed = dirtyPointIds.includes(item.id);
                      return (
                        <button
                          key={item.id}
                          type="button"
                          role="radio"
                          aria-checked={active}
                          onClick={() => setPointId(item.id)}
                          className={`inline-flex min-h-10 max-w-full items-center gap-2 rounded-2xl border px-3.5 py-2 text-left text-[13.5px] font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 ${
                            active
                              ? "border-[#5566f6] bg-[#eef1ff] text-[#3848c7]"
                              : "border-[#dcdfed] bg-white text-[#0b1024] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
                          }`}
                        >
                          <Store className={`size-4 shrink-0 ${active ? "text-[#5566f6]" : "text-[#9b9fb3]"}`} aria-hidden />
                          <span className="min-w-0 truncate">{pointTitle(item)}</span>
                          {changed ? <span className="size-1.5 shrink-0 rounded-full bg-[#f59e0b]" aria-label={t("form.unsaved")} /> : null}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-[14px] font-medium text-[#0b1024]">
                    <Store className="size-4 text-[#5566f6]" aria-hidden />
                    {pointTitle(point)}
                  </div>
                )}

                <FieldRow label={t("documentsPage.pointJournalName")} hint={t("documentsPage.pointJournalNameHint")} htmlFor="point-journalName">
                  <input
                    id="point-journalName"
                    type="text"
                    value={pointDraft.journalName}
                    onChange={(event) => setPointField("journalName", event.target.value)}
                    className={ORG_INPUT_CLASS}
                    placeholder={pointDraft.address.trim() ? `${point.name}, ${pointDraft.address.trim()}` : point.name}
                    maxLength={200}
                  />
                </FieldRow>
                <FieldRow label={t("documentsPage.pointAddress")} hint={t("documentsPage.pointAddressHint")} htmlFor="point-address">
                  <input
                    id="point-address"
                    type="text"
                    value={pointDraft.address}
                    onChange={(event) => setPointField("address", event.target.value)}
                    className={ORG_INPUT_CLASS}
                    maxLength={200}
                  />
                </FieldRow>
                <FieldRow
                  label={t("documentsPage.pointKpp")}
                  hint={t("documentsPage.pointKppHint")}
                  error={pointErrors[point.id] || null}
                  htmlFor="point-kpp"
                >
                  <input
                    id="point-kpp"
                    type="text"
                    value={pointDraft.kpp}
                    onChange={(event) => setPointField("kpp", event.target.value)}
                    className={ORG_INPUT_CLASS}
                    placeholder={block.org.kpp ?? ""}
                    maxLength={9}
                    aria-invalid={pointErrors[point.id] ? true : undefined}
                  />
                </FieldRow>
                <FieldRow label={t("documentsPage.pointPhone")} hint={t("documentsPage.pointPhoneHint")} htmlFor="point-phone">
                  <input
                    id="point-phone"
                    type="tel"
                    value={pointDraft.phone}
                    onChange={(event) => setPointField("phone", event.target.value)}
                    className={ORG_INPUT_CLASS}
                    maxLength={40}
                  />
                </FieldRow>
                <div>
                  <Link href="/settings/buildings" className="inline-flex items-center gap-1.5 rounded-lg text-[13px] font-medium text-[#3848c7] transition-colors duration-150 hover:text-[#5566f6] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15">
                    {t("documentsPage.pointsManage")}
                    <ArrowRight className="size-3.5" aria-hidden />
                  </Link>
                </div>
              </>
            )}
          </StepCard>

          <SaveButton dirty={dirty} saving={saving} onSave={save} />
        </div>

        {/* ③ Предпросмотр — рядом с полями на компьютере, под ними на телефоне */}
        <StepCard
          n={3}
          id="preview"
          title={t("documentsPage.previewTitle")}
          lead={t("documentsPage.previewLead")}
          className="lg:sticky lg:top-20"
        >
          <div className="rounded-2xl border border-[#dcdfed] bg-white p-3">
            <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-[#6f7282]">{t("form.docsPreviewJournal")}</div>
            <div className="mt-1.5 text-[13px] font-semibold leading-snug text-[#0b1024] [overflow-wrap:anywhere]" data-doc-header-preview>
              {header}
            </div>
            <div className="mt-2 text-[11.5px] text-[#6f7282]" data-preview-scope>
              {point ? t("documentsPage.previewForPoint", { name: pointTitle(point) }) : t("documentsPage.previewNoPoint")}
            </div>
          </div>
          <dl className="divide-y divide-[#f0f1f7] rounded-2xl border border-[#ececf4] bg-[#fafbff]" data-doc-rows-preview>
            {rows.map((row) => (
              <div key={row.key} className="grid gap-0.5 px-3 py-2" data-row={row.key}>
                <dt className="text-[11.5px] font-medium text-[#6f7282]">{row.label}</dt>
                <dd className={`text-[13px] leading-snug [overflow-wrap:anywhere] ${row.point ? "text-[#3848c7]" : "text-[#0b1024]"}`}>{row.value}</dd>
              </div>
            ))}
          </dl>
          <p className="text-[12px] leading-snug text-[#6f7282]">{t("form.docsPreviewNote")}</p>
        </StepCard>
      </div>
    </div>
  );
}
