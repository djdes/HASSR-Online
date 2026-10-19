"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { CheckCircle2, ImagePlus, Info, QrCode, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { OrgLogoUpload } from "@/components/settings/org-logo-upload";
import { brandPalette, contrastRatio, normalizeBrandColor } from "@/lib/document-brand";
import { ORG_LOGO_PATH_PATTERN } from "@/lib/org-logo-file";
import {
  FieldRow,
  ORG_INPUT_CLASS,
  ORG_SMALL_BUTTON_CLASS,
  SaveButton,
  StepCard,
  UnsavedBar,
  patchOrganization,
} from "@/components/settings/organization-page-kit";

type Brand = { brandColor: string | null; logoUrl: string | null };

/** Тот же формат, что принимает PATCH: #rgb, #rrggbb, #rrggbbaa. */
const HEX_COLOR = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/** Ниже этого контраста с белым тонкая линия теряется на бумаге (`brandInk`). */
const THIN_LINE_CONTRAST = 3;

/**
 * «Моя компания → Логотип и цвета»: ① логотип (файл сохраняется сразу),
 * ② фирменный цвет с проверкой контраста, ③ миниатюры шапки журнала PDF и
 * QR-плаката. Цвет — только в документах и на плакатах (решение плана,
 * раздел 7): интерфейс кабинета не перекрашивается.
 */
export function OrganizationBrandingForm({
  initial,
  headerText,
  orgName,
}: {
  initial: Brand;
  /** Ячейка организации в шапке журнала — `journalHeaderOrgText`. */
  headerText: string;
  /** Название организации на плакате. */
  orgName: string;
}) {
  const t = useTranslations("settingsManagement.organizationProfile");
  const tPdf = useTranslations("journalPdf");
  const router = useRouter();
  const [saved, setSaved] = useState<Brand>(initial);
  const [draft, setDraft] = useState<Brand>(initial);
  const [saving, setSaving] = useState(false);
  const [colorError, setColorError] = useState<string | null>(null);
  const [logoUrlError, setLogoUrlError] = useState<string | null>(null);
  // Ссылка на картинку раскрыта сразу, если логотип задан ссылкой (а не файлом).
  const [linkOpen] = useState(() => Boolean(initial.logoUrl && !ORG_LOGO_PATH_PATTERN.test(initial.logoUrl)));

  const dirty = (draft.brandColor ?? "") !== (saved.brandColor ?? "") || (draft.logoUrl ?? "") !== (saved.logoUrl ?? "");
  const typedColor = (draft.brandColor ?? "").trim();
  const colorInvalid = typedColor !== "" && !HEX_COLOR.test(typedColor);
  // Что увидят документы: неверный ввод = цвета нет.
  const color = colorInvalid ? null : normalizeBrandColor(typedColor);
  const palette = color ? brandPalette(color) : null;
  const contrast = color ? contrastRatio(color, "#ffffff") : null;
  const logoUrl = draft.logoUrl?.trim() || null;
  // В PDF печатается только загруженный файл: по ссылке сервер картинку не скачивает.
  const logoInPdf = logoUrl !== null && ORG_LOGO_PATH_PATTERN.test(logoUrl);

  function setColor(value: string | null) {
    setDraft((prev) => ({ ...prev, brandColor: value }));
    setColorError(null);
  }

  function discard() {
    setDraft(saved);
    setColorError(null);
    setLogoUrlError(null);
  }

  async function save() {
    if (saving || !dirty) return;
    if (colorInvalid) {
      setColorError(t("form.apiErrors.invalidBrandColor"));
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {};
      if ((draft.brandColor ?? "") !== (saved.brandColor ?? "")) payload.brandColor = typedColor;
      if ((draft.logoUrl ?? "") !== (saved.logoUrl ?? "")) payload.logoUrl = logoUrl ?? "";
      const result = await patchOrganization(payload);
      if (!result.ok) {
        if (result.network) {
          toast.error(t("form.networkError"));
          return;
        }
        const keys = result.keys ?? [];
        if (keys.includes("invalidBrandColor")) setColorError(t("form.apiErrors.invalidBrandColor"));
        if (keys.includes("invalidLogoUrl")) setLogoUrlError(t("form.apiErrors.invalidLogoUrl"));
        toast.error(keys.length > 0 ? keys.map((key) => t(`form.apiErrors.${key}`)).join("; ") : t("form.saveError"));
        return;
      }
      const next = { brandColor: typedColor || null, logoUrl };
      setSaved(next);
      setDraft(next);
      toast.success(t("form.saved"));
      // Логотип в меню слева — из layout.
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

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

          {/* ② Фирменный цвет */}
          <StepCard n={2} id="color" title={t("brandingPage.colorTitle")} lead={t("brandingPage.colorLead")}>
            <FieldRow label={t("form.brandColor")} hint={t("brandingPage.colorHint")} error={colorError} htmlFor="brand-color-text">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="color"
                  value={color ?? "#5566f6"}
                  onChange={(event) => setColor(event.target.value)}
                  aria-label={t("brandingPage.colorPicker")}
                  className="h-11 w-14 shrink-0 cursor-pointer rounded-2xl border border-[#dcdfed] bg-white p-1 transition-colors duration-150 hover:border-[#5566f6]/40 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
                />
                <input
                  id="brand-color-text"
                  type="text"
                  value={draft.brandColor ?? ""}
                  onChange={(event) => setColor(event.target.value || null)}
                  className={`${ORG_INPUT_CLASS} min-w-[140px] flex-1 font-mono`}
                  placeholder="#5566f6"
                  maxLength={9}
                  aria-invalid={colorError || colorInvalid ? true : undefined}
                />
                {draft.brandColor ? (
                  <button type="button" onClick={() => setColor(null)} className={ORG_SMALL_BUTTON_CLASS}>
                    {t("brandingPage.colorReset")}
                  </button>
                ) : null}
              </div>
            </FieldRow>

            {/* Проверка контраста — те же правила, что у генераторов документов (`document-brand.ts`). */}
            <div className="rounded-2xl border border-[#ececf4] bg-[#fafbff] p-4" data-contrast-check={palette ? (contrast !== null && contrast >= THIN_LINE_CONTRAST ? "ok" : "light") : "none"}>
              <div className="text-[12px] font-semibold uppercase tracking-[0.14em] text-[#6f7282]">{t("brandingPage.contrastTitle")}</div>
              {palette && contrast !== null ? (
                <div className="mt-3 space-y-3">
                  <div className="flex items-start gap-2 text-[13.5px] leading-snug text-[#0b1024]">
                    {contrast >= THIN_LINE_CONTRAST ? (
                      <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-[#116b2a]" aria-hidden />
                    ) : (
                      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-[#b45309]" aria-hidden />
                    )}
                    <span>
                      {contrast >= THIN_LINE_CONTRAST
                        ? t("brandingPage.contrastGood", { ratio: contrast.toFixed(1) })
                        : t("brandingPage.contrastLight", { ratio: contrast.toFixed(1), ink: palette.ink })}
                    </span>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-3">
                    <Swatch label={t("brandingPage.swatchColor")} value={palette.fill} />
                    <Swatch label={t("brandingPage.swatchLines")} value={palette.ink} />
                    <div className="flex items-center gap-2.5 rounded-xl border border-[#ececf4] bg-white p-2.5">
                      <span
                        className="flex size-7 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold"
                        style={{ background: palette.fill, color: palette.onFill }}
                        aria-hidden
                      >
                        1
                      </span>
                      <span className="min-w-0 text-[12px] leading-snug text-[#3c4053]">
                        {palette.onFill === "#ffffff" ? t("brandingPage.markerWhite") : t("brandingPage.markerDark")}
                      </span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="mt-2 flex items-start gap-2 text-[13.5px] leading-snug text-[#3c4053]">
                  <Info className="mt-0.5 size-4 shrink-0 text-[#5566f6]" aria-hidden />
                  {colorInvalid ? t("form.apiErrors.invalidBrandColor") : t("brandingPage.colorNone")}
                </div>
              )}
            </div>
          </StepCard>

          <SaveButton dirty={dirty} saving={saving} onSave={save} />
        </div>

        {/* ③ Предпросмотр */}
        <StepCard
          n={3}
          id="preview"
          title={t("brandingPage.previewTitle")}
          lead={t("brandingPage.previewLead")}
          className="lg:sticky lg:top-20"
        >
          <figure className="space-y-2" data-brand-preview="journal">
            <figcaption className="text-[12px] font-medium text-[#6f7282]">{t("brandingPage.previewJournal")}</figcaption>
            <div className="rounded-2xl border border-[#ececf4] bg-[#f3f4f8] p-3">
              <div className="rounded-md bg-white p-2.5 shadow-[0_6px_18px_-12px_rgba(11,16,36,0.45)]">
                <div className="relative grid grid-cols-[1.15fr_1.6fr_1fr] border border-[#0b1024] text-[8.5px] leading-tight text-black">
                  {palette ? (
                    <span className="absolute inset-x-0 top-0 h-[3px]" style={{ background: palette.ink }} data-brand-band aria-hidden />
                  ) : null}
                  <div className="row-span-2 flex flex-col items-center justify-center gap-1 border-r border-[#0b1024] px-1.5 py-2 text-center font-semibold">
                    {logoInPdf && logoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={logoUrl} alt="" className="max-h-6 max-w-[90%] object-contain" data-brand-logo referrerPolicy="no-referrer" />
                    ) : null}
                    <span className="line-clamp-4 [overflow-wrap:anywhere]">{headerText}</span>
                  </div>
                  <div className="flex items-center justify-center border-b border-r border-[#0b1024] px-1 py-1.5 text-center">{tPdf("system")}</div>
                  <div className="flex flex-col justify-center border-b border-[#0b1024] px-1.5 py-1">
                    <span>
                      <b>{tPdf("started")}</b> 01.10.2026
                    </span>
                    <span>
                      <b>{tPdf("finished")}</b> ____
                    </span>
                  </div>
                  <div className="flex items-center justify-center border-r border-[#0b1024] px-1 py-2 text-center font-semibold">
                    {t("brandingPage.sampleJournal")}
                  </div>
                  <div className="flex items-center justify-center px-1 py-2 text-center font-semibold">{tPdf("page", { page: 1, total: 1 })}</div>
                </div>
                <div className="mt-1.5 grid grid-cols-6 border-l border-t border-[#0b1024]" aria-hidden>
                  {Array.from({ length: 12 }, (_, index) => (
                    <span key={index} className={`h-2.5 border-b border-r border-[#0b1024] ${index < 6 ? "bg-[#f3f4f8]" : ""}`} />
                  ))}
                </div>
              </div>
            </div>
            {logoUrl && !logoInPdf ? (
              <p className="flex items-start gap-1.5 text-[12px] leading-snug text-[#b45309]">
                <ImagePlus className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                {t("brandingPage.logoUrlNotInPdf")}
              </p>
            ) : null}
          </figure>

          <figure className="space-y-2" data-brand-preview="poster">
            <figcaption className="text-[12px] font-medium text-[#6f7282]">{t("brandingPage.previewPoster")}</figcaption>
            <div className="rounded-2xl border border-[#ececf4] bg-[#f3f4f8] p-3">
              <div
                className="mx-auto flex aspect-[210/297] w-[150px] flex-col items-center bg-white px-3 pt-3 text-center text-black shadow-[0_6px_18px_-12px_rgba(11,16,36,0.45)]"
                style={palette ? { borderTop: `4px solid ${palette.ink}` } : undefined}
              >
                {logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={logoUrl} alt="" className="mb-1.5 max-h-5 max-w-[70%] object-contain" referrerPolicy="no-referrer" />
                ) : null}
                <div className="text-[5.5px] font-semibold uppercase tracking-[0.12em] text-[#333]">{t("brandingPage.posterEyebrow")}</div>
                <div className="mt-1 text-[9px] font-bold leading-tight">{t("brandingPage.sampleJournal")}</div>
                <div className="mt-0.5 line-clamp-2 text-[6px] [overflow-wrap:anywhere]">{orgName}</div>
                <QrCode className="mt-2 size-[72px] text-black" strokeWidth={1.25} aria-hidden />
              </div>
            </div>
          </figure>

          <p className="flex items-start gap-1.5 rounded-2xl bg-[#f5f6ff] px-3 py-2.5 text-[12.5px] leading-snug text-[#3848c7]" data-brand-note>
            <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            {t("brandingPage.previewNote")}
          </p>
        </StepCard>
      </div>
    </div>
  );
}

function Swatch({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-[#ececf4] bg-white p-2.5">
      <span className="size-7 shrink-0 rounded-lg border border-black/10" style={{ background: value }} aria-hidden />
      <span className="min-w-0">
        <span className="block text-[12px] leading-snug text-[#3c4053]">{label}</span>
        <span className="block font-mono text-[11.5px] text-[#6f7282]">{value}</span>
      </span>
    </div>
  );
}
