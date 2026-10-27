"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Info } from "lucide-react";
import { toast } from "sonner";
import { OrgLogoUpload } from "@/components/settings/org-logo-upload";
import { LabelPreview, PosterPreview, QrStickerPreview } from "@/components/settings/brand-style-preview";
import { normalizeBrandColor } from "@/lib/document-brand";
import { ORG_LOGO_PATH_PATTERN } from "@/lib/org-logo-file";
import {
  normalizeWebsite,
  qrFrameColor,
  resolvePrintBrand,
  resolvePrintColors,
} from "@/lib/print-brand";
import {
  FieldRow,
  ORG_INPUT_CLASS,
  ORG_SMALL_BUTTON_CLASS,
  SaveButton,
  StepCard,
  UnsavedBar,
  patchOrganization,
} from "@/components/settings/organization-page-kit";

export type BrandStyleInitial = {
  brandColor: string | null;
  brandColor2: string | null;
  brandColor3: string | null;
  website: string | null;
  qrBrandFrame: boolean;
  qrCenterLogo: boolean;
  logoUrl: string | null;
  qrIconUrl: string | null;
};

/** Поля, которые сохраняются кнопкой «Сохранить»: файлы (логотип, значок) уходят сразу. */
type Draft = Omit<BrandStyleInitial, "qrIconUrl">;

/** Тот же формат, что принимает PATCH: #rgb, #rrggbb, #rrggbbaa. */
const HEX_COLOR = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

type ColorKey = "brandColor" | "brandColor2" | "brandColor3";

/**
 * «Моя компания → Фирменный стиль»: ① логотип, ② три необязательных цвета,
 * ③ сайт для шапки, ④ QR-коды, ⑤ живой предпросмотр плаката, QR-наклейки и
 * этикетки (с переключателем «Ч/б»). Файлы сохраняются сразу, остальное —
 * одной кнопкой «Сохранить». Интерфейс кабинета не перекрашивается.
 */
export function OrganizationBrandingForm({
  initial,
  orgName,
}: {
  initial: BrandStyleInitial;
  /** Название организации на плакате и для буквы в центре QR. */
  orgName: string;
}) {
  const t = useTranslations("settingsManagement.organizationProfile");
  const router = useRouter();
  const [saved, setSaved] = useState<Draft>(initial);
  const [draft, setDraft] = useState<Draft>(initial);
  const [qrIconUrl, setQrIconUrl] = useState<string | null>(initial.qrIconUrl);
  const [mono, setMono] = useState(false);
  const [saving, setSaving] = useState(false);
  const [colorErrors, setColorErrors] = useState<Partial<Record<ColorKey, string>>>({});
  const [siteError, setSiteError] = useState<string | null>(null);
  const [logoUrlError, setLogoUrlError] = useState<string | null>(null);
  // Ссылка на картинку раскрыта сразу, если логотип задан ссылкой (а не файлом).
  const [linkOpen] = useState(() => Boolean(initial.logoUrl && !ORG_LOGO_PATH_PATTERN.test(initial.logoUrl)));

  const dirty = (Object.keys(draft) as (keyof Draft)[]).some((key) => (draft[key] ?? "") !== (saved[key] ?? ""));

  const typed = (key: ColorKey) => (draft[key] ?? "").trim();
  const invalid = (key: ColorKey) => typed(key) !== "" && !HEX_COLOR.test(typed(key));
  // Что увидит печать: неверный ввод = цвета нет.
  const own = (key: ColorKey) => (invalid(key) ? null : normalizeBrandColor(typed(key)));
  const siteTyped = (draft.website ?? "").trim();
  const siteValid = siteTyped === "" || normalizeWebsite(siteTyped) !== null;
  const logoUrl = draft.logoUrl?.trim() || null;

  const colors = resolvePrintColors(own("brandColor"), own("brandColor2"), own("brandColor3"));
  const brand = resolvePrintBrand(
    {
      name: orgName,
      logoUrl,
      qrIconUrl,
      brandColor: own("brandColor"),
      brandColor2: own("brandColor2"),
      brandColor3: own("brandColor3"),
      website: normalizeWebsite(siteTyped),
      qrBrandFrame: draft.qrBrandFrame,
      qrCenterLogo: draft.qrCenterLogo,
    },
    { mono },
  );
  const qrStrip = qrFrameColor({ colors, mono: false, qr: { brandFrame: true, centerLogo: true } });

  function setColor(key: ColorKey, value: string | null) {
    setDraft((prev) => ({ ...prev, [key]: value }));
    setColorErrors((prev) => ({ ...prev, [key]: undefined }));
  }

  function discard() {
    setDraft(saved);
    setColorErrors({});
    setSiteError(null);
    setLogoUrlError(null);
  }

  async function save() {
    if (saving || !dirty) return;
    const errors: Partial<Record<ColorKey, string>> = {};
    for (const key of ["brandColor", "brandColor2", "brandColor3"] as const) {
      if (invalid(key)) errors[key] = t("form.apiErrors.invalidBrandColor");
    }
    setColorErrors(errors);
    if (!siteValid) setSiteError(t("form.apiErrors.invalidWebsite"));
    if (Object.keys(errors).length > 0 || !siteValid) return;

    setSaving(true);
    try {
      const payload: Record<string, unknown> = {};
      for (const key of ["brandColor", "brandColor2", "brandColor3"] as const) {
        if ((draft[key] ?? "") !== (saved[key] ?? "")) payload[key] = typed(key);
      }
      if ((draft.website ?? "") !== (saved.website ?? "")) payload.website = siteTyped;
      if (draft.qrBrandFrame !== saved.qrBrandFrame) payload.qrBrandFrame = draft.qrBrandFrame;
      if (draft.qrCenterLogo !== saved.qrCenterLogo) payload.qrCenterLogo = draft.qrCenterLogo;
      if ((draft.logoUrl ?? "") !== (saved.logoUrl ?? "")) payload.logoUrl = logoUrl ?? "";
      const result = await patchOrganization(payload);
      if (!result.ok) {
        if (result.network) {
          toast.error(t("form.networkError"));
          return;
        }
        const keys = result.keys ?? [];
        if (keys.includes("invalidBrandColor")) {
          setColorErrors({ brandColor: t("form.apiErrors.invalidBrandColor") });
        }
        if (keys.includes("invalidWebsite")) setSiteError(t("form.apiErrors.invalidWebsite"));
        if (keys.includes("invalidLogoUrl")) setLogoUrlError(t("form.apiErrors.invalidLogoUrl"));
        toast.error(keys.length > 0 ? keys.map((key) => t(`form.apiErrors.${key}`)).join("; ") : t("form.saveError"));
        return;
      }
      const next: Draft = {
        ...draft,
        brandColor: typed("brandColor") || null,
        brandColor2: typed("brandColor2") || null,
        brandColor3: typed("brandColor3") || null,
        website: normalizeWebsite(siteTyped) ?? null,
        logoUrl,
      };
      setSaved(next);
      setDraft(next);
      setSiteError(null);
      toast.success(t("form.saved"));
      // Логотип в меню слева и цвета — из layout.
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  const colorRows: {
    key: ColorKey;
    id: string;
    label: string;
    hint: string;
    resolved: string;
    notes: string[];
  }[] = [
    {
      key: "brandColor",
      id: "brand-color-1",
      label: t("brandingPage.colorPrimaryLabel"),
      hint: t("brandingPage.colorPrimaryHint"),
      resolved: colors.primary,
      notes: [
        ...(own("brandColor") && colors.primaryInk !== colors.primary
          ? [t("brandingPage.colorInkDarkened", { ink: colors.primaryInk })]
          : []),
        ...(own("brandColor") && qrStrip !== colors.primary
          ? [t("brandingPage.colorQrDarkened", { color: qrStrip })]
          : []),
      ],
    },
    {
      key: "brandColor2",
      id: "brand-color-2",
      label: t("brandingPage.colorSecondaryLabel"),
      hint: t("brandingPage.colorSecondaryHint"),
      resolved: colors.secondary,
      notes:
        own("brandColor2") && colors.secondaryInk !== colors.secondary
          ? [t("brandingPage.colorInkDarkened", { ink: colors.secondaryInk })]
          : [],
    },
    {
      key: "brandColor3",
      id: "brand-color-3",
      label: t("brandingPage.colorBgLabel"),
      hint: t("brandingPage.colorBgHint"),
      resolved: colors.background,
      notes:
        own("brandColor3") && colors.background !== own("brandColor3")
          ? [t("brandingPage.colorBgDarkened", { color: colors.background })]
          : [],
    },
  ];
  const nothingChosen = !own("brandColor") && !own("brandColor2") && !own("brandColor3");

  return (
    <div className="space-y-5">
      {dirty ? <UnsavedBar saving={saving} onSave={save} onDiscard={discard} /> : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,400px)] lg:items-start">
        <div className="min-w-0 space-y-5">
          {/* ① Логотип */}
          <StepCard n={1} id="logo" title={t("form.logoTitle")} lead={t("brandingPage.logoLead")}>
            {/* Файл сохраняется сразу, без кнопки «Сохранить»: логотип видно в меню слева, как только он загружен. */}
            <OrgLogoUpload
              url={draft.logoUrl}
              onChange={(url) => {
                setSaved((prev) => ({ ...prev, logoUrl: url }));
                setDraft((prev) => ({ ...prev, logoUrl: url }));
                setLogoUrlError(null);
                router.refresh();
              }}
            />
            <p className="text-[12.5px] leading-snug text-[#6f7282]">{t("form.logoHint")}</p>
            <details className="group rounded-2xl border border-[#ececf4] bg-[#fafbff] px-4 py-3" open={linkOpen || undefined}>
              <summary className="cursor-pointer list-none text-[13px] font-medium text-[#3848c7] transition-colors duration-150 hover:text-[#5566f6]">
                {t("form.logoByUrl")}
              </summary>
              <div className="mt-3">
                <FieldRow label={t("form.logoUrl")} hint={t("form.logoUrlHint")} error={logoUrlError} htmlFor="brand-logo-url">
                  <input
                    id="brand-logo-url"
                    type="url"
                    value={draft.logoUrl ?? ""}
                    onChange={(event) => {
                      setDraft((prev) => ({ ...prev, logoUrl: event.target.value || null }));
                      setLogoUrlError(null);
                    }}
                    className={ORG_INPUT_CLASS}
                    placeholder="https://example.com/logo.png"
                    aria-invalid={logoUrlError ? true : undefined}
                  />
                </FieldRow>
              </div>
            </details>
          </StepCard>

          {/* ② Цвета */}
          <StepCard n={2} id="color" title={t("brandingPage.colorTitle")} lead={t("brandingPage.colorLead")}>
            {colorRows.map((row) => {
              const value = draft[row.key] ?? "";
              const ownValue = own(row.key);
              const error = colorErrors[row.key] ?? (invalid(row.key) ? t("form.apiErrors.invalidBrandColor") : null);
              return (
                <FieldRow key={row.key} label={row.label} hint={row.hint} error={error} htmlFor={`${row.id}-text`}>
                  <div className="flex flex-wrap items-center gap-2" data-brand-color={row.key}>
                    <input
                      type="color"
                      value={(ownValue ?? row.resolved).slice(0, 7)}
                      onChange={(event) => setColor(row.key, event.target.value)}
                      aria-label={row.label}
                      className="h-11 w-14 shrink-0 cursor-pointer rounded-2xl border border-[#dcdfed] bg-white p-1 transition-colors duration-150 hover:border-[#5566f6]/40 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
                    />
                    <input
                      id={`${row.id}-text`}
                      type="text"
                      value={value}
                      onChange={(event) => setColor(row.key, event.target.value || null)}
                      className={`${ORG_INPUT_CLASS} min-w-[120px] flex-1 font-mono`}
                      placeholder="#5566f6"
                      maxLength={9}
                      aria-invalid={error ? true : undefined}
                    />
                    {value ? (
                      <button type="button" onClick={() => setColor(row.key, null)} className={ORG_SMALL_BUTTON_CLASS}>
                        {t("brandingPage.colorResetAuto")}
                      </button>
                    ) : null}
                  </div>
                  {!ownValue ? (
                    <div className="mt-2 flex items-center gap-2 text-[12px] text-[#6f7282]" data-brand-auto>
                      <span className="size-4 shrink-0 rounded-md border border-black/10" style={{ background: row.resolved }} aria-hidden />
                      <span className="font-mono">{t("brandingPage.colorAuto", { value: row.resolved })}</span>
                    </div>
                  ) : null}
                  {row.notes.map((note) => (
                    <p key={note} className="mt-1.5 flex items-start gap-1.5 text-[12px] leading-snug text-[#b45309]" data-brand-note>
                      <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                      {note}
                    </p>
                  ))}
                </FieldRow>
              );
            })}
            {nothingChosen ? (
              <p className="flex items-start gap-1.5 rounded-2xl bg-[#f5f6ff] px-3 py-2.5 text-[12.5px] leading-snug text-[#3848c7]">
                <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                {t("brandingPage.colorDefaultNote")}
              </p>
            ) : null}
          </StepCard>

          {/* ③ Сайт */}
          <StepCard n={3} id="site" title={t("brandingPage.siteTitle")} lead={t("brandingPage.siteLead")}>
            <FieldRow label={t("brandingPage.siteLabel")} hint={t("brandingPage.siteHint")} error={siteError} htmlFor="brand-site">
              <input
                id="brand-site"
                type="text"
                inputMode="url"
                value={draft.website ?? ""}
                onChange={(event) => {
                  setDraft((prev) => ({ ...prev, website: event.target.value || null }));
                  setSiteError(null);
                }}
                className={ORG_INPUT_CLASS}
                placeholder={t("brandingPage.sitePlaceholder")}
                maxLength={120}
                aria-invalid={siteError || !siteValid ? true : undefined}
              />
              {!siteValid && !siteError ? (
                <p role="alert" className="mt-1.5 text-[12.5px] leading-snug text-[#a13a32]" data-field-error>
                  {t("form.apiErrors.invalidWebsite")}
                </p>
              ) : null}
            </FieldRow>
          </StepCard>

          {/* ④ QR-коды */}
          <StepCard n={4} id="qr" title={t("brandingPage.qrTitle")} lead={t("brandingPage.qrLead")}>
            <FieldRow label={t("brandingPage.qrIconLabel")} hint={t("brandingPage.qrIconHint")}>
              {/* Значок сохраняется сразу, как логотип. */}
              <OrgLogoUpload kind="icon" url={qrIconUrl} onChange={setQrIconUrl} />
            </FieldRow>
            <Toggle
              checked={draft.qrBrandFrame}
              onChange={(value) => setDraft((prev) => ({ ...prev, qrBrandFrame: value }))}
              label={t("brandingPage.qrFrameLabel")}
              hint={t("brandingPage.qrFrameHint")}
              testId="qr-brand-frame"
            />
            <Toggle
              checked={draft.qrCenterLogo}
              onChange={(value) => setDraft((prev) => ({ ...prev, qrCenterLogo: value }))}
              label={t("brandingPage.qrCenterLabel")}
              hint={t("brandingPage.qrCenterHint")}
              testId="qr-center-logo"
            />
            <p className="flex items-start gap-1.5 rounded-2xl bg-[#f5f6ff] px-3 py-2.5 text-[12.5px] leading-snug text-[#3848c7]">
              <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              {t("brandingPage.qrFallback")}
            </p>
          </StepCard>

          <SaveButton dirty={dirty} saving={saving} onSave={save} />
        </div>

        {/* ⑤ Предпросмотр */}
        <StepCard
          n={5}
          id="preview"
          title={t("brandingPage.previewTitle")}
          lead={t("brandingPage.previewLead")}
          className="lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto"
        >
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-[#ececf4] bg-[#fafbff] px-3.5 py-2.5">
            <span className="text-[12.5px] leading-snug text-[#6f7282]">{t("brandingPage.monoHint")}</span>
            <button
              type="button"
              role="switch"
              aria-checked={mono}
              onClick={() => setMono((prev) => !prev)}
              data-mono-toggle
              className={`inline-flex h-8 shrink-0 items-center rounded-xl border px-3 text-[12.5px] font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 ${
                mono
                  ? "border-[#0b1024] bg-[#0b1024] text-white hover:bg-[#262b45]"
                  : "border-[#dcdfed] bg-white text-[#0b1024] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
              }`}
            >
              {t("brandingPage.monoToggle")}
            </button>
          </div>

          <Figure caption={t("brandingPage.previewPosterCaption")}>
            <PosterPreview brand={brand} orgName={orgName || t("brandingPage.sampleOrgName")} />
          </Figure>
          <Figure caption={t("brandingPage.previewQrCaption")}>
            <QrStickerPreview brand={brand} orgName={orgName || t("brandingPage.sampleOrgName")} />
          </Figure>
          <Figure caption={t("brandingPage.previewLabelCaption")}>
            <LabelPreview brand={brand} />
          </Figure>
        </StepCard>
      </div>
    </div>
  );
}

function Figure({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <figure className="space-y-2">
      <figcaption className="text-[12px] font-medium text-[#6f7282]">{caption}</figcaption>
      <div className="overflow-hidden rounded-2xl border border-[#ececf4] bg-[#f3f4f8] p-3">{children}</div>
    </figure>
  );
}

function Toggle({
  checked,
  onChange,
  label,
  hint,
  testId,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  hint: string;
  testId: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-2xl border border-[#ececf4] bg-[#fafbff] px-4 py-3">
      <div className="min-w-0">
        <div className="text-[13.5px] font-medium text-[#0b1024]">{label}</div>
        <div className="mt-0.5 text-[12px] leading-snug text-[#6f7282]">{hint}</div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        data-testid={testId}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 ${
          checked ? "bg-[#5566f6] hover:bg-[#4a5bf0]" : "bg-[#c8cbe0] hover:bg-[#b5b9d3]"
        }`}
      >
        <span
          className={`absolute left-0.5 top-0.5 size-5 rounded-full bg-white shadow transition-transform duration-150 ${
            checked ? "translate-x-5" : ""
          }`}
        />
      </button>
    </div>
  );
}
