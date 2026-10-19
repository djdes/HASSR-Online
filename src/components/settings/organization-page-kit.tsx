"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Save } from "lucide-react";
import { mapOrganizationProfileApiError, type OrganizationProfileApiErrorKey } from "@/lib/organization-profile-error-adapter";

/*
 * Общие куски страниц раздела «Моя компания» (Сведения для документов,
 * Логотип и цвета, Контакты и уведомления): нумерованная карточка, строка
 * поля, полоса «есть несохранённые изменения» и сохранение через тот же
 * PATCH /api/settings/organization, что у «Реквизитов».
 */

export const ORG_INPUT_CLASS =
  "h-11 w-full rounded-2xl border border-[#dcdfed] bg-[#fafbff] px-3.5 text-[14px] text-[#0b1024] placeholder:text-[#9b9fb3] transition-colors duration-150 focus:border-[#5566f6] focus:bg-white focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15 aria-[invalid=true]:border-[#e2675b]";

export const ORG_TEXTAREA_CLASS =
  "min-h-[72px] w-full resize-y rounded-2xl border border-[#dcdfed] bg-[#fafbff] px-3.5 py-2.5 text-[14px] leading-[1.5] text-[#0b1024] placeholder:text-[#9b9fb3] transition-colors duration-150 focus:border-[#5566f6] focus:bg-white focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15 aria-[invalid=true]:border-[#e2675b]";

export const ORG_OUTLINE_BUTTON_CLASS =
  "inline-flex h-10 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 disabled:pointer-events-none disabled:opacity-50";

export const ORG_SMALL_BUTTON_CLASS =
  "inline-flex h-8 items-center gap-1.5 rounded-xl border border-[#dcdfed] bg-white px-3 text-[12.5px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15";

/** Карточка-шаг страницы: номер, заголовок, одна строка пояснения. */
export function StepCard({
  n,
  title,
  lead,
  id,
  children,
  className = "",
}: {
  n: number;
  title: string;
  lead?: ReactNode;
  id?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      id={id}
      data-step={n}
      className={`scroll-mt-24 rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] md:p-7 ${className}`}
    >
      <div className="mb-5 flex items-start gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[#eef1ff] text-[14px] font-semibold tabular-nums text-[#3848c7]">
          {n}
        </span>
        <div className="min-w-0 pt-0.5">
          <h2 className="text-[17px] font-semibold leading-tight tracking-[-0.01em] text-[#0b1024]">{title}</h2>
          {lead ? <p className="mt-1 text-[13px] leading-[1.5] text-[#6f7282]">{lead}</p> : null}
        </div>
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

/** Подпись слева (на телефоне — сверху), поле справа, ошибка — под полем. */
export function FieldRow({
  label,
  hint,
  error,
  htmlFor,
  children,
}: {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-1.5 md:grid-cols-[200px_1fr] md:items-start md:gap-5">
      <div className="md:pt-2.5">
        <label htmlFor={htmlFor} className="text-[13px] font-medium text-[#0b1024]">
          {label}
        </label>
        {hint ? <div className="mt-0.5 text-[12px] leading-snug text-[#6f7282]">{hint}</div> : null}
      </div>
      <div className="min-w-0">
        {children}
        {error ? (
          <p role="alert" className="mt-1.5 text-[12.5px] leading-snug text-[#a13a32]" data-field-error>
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** Полоса «Есть несохранённые изменения» — прилипает к верху, пока есть правки. */
export function UnsavedBar({
  saving,
  onSave,
  onDiscard,
}: {
  saving: boolean;
  onSave: () => void;
  onDiscard: () => void;
}) {
  const t = useTranslations("settingsManagement.organizationProfile");
  return (
    <div
      className="sticky top-3 z-10 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#ffe9b0] bg-[#fff8eb] px-4 py-3 shadow-[0_10px_24px_-12px_rgba(161,58,50,0.18)]"
      data-unsaved-bar
    >
      <span className="text-[13px] text-[#7a4a00]">{t("form.unsaved")}</span>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onDiscard}
          disabled={saving}
          className="inline-flex h-9 items-center rounded-xl border border-[#dcdfed] bg-white px-3 text-[13px] text-[#3c4053] transition-colors duration-150 hover:bg-[#fafbff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 disabled:opacity-60"
        >
          {t("form.discard")}
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[#5566f6] px-3 text-[13px] font-medium text-white transition-colors duration-150 hover:bg-[#4a5bf0] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 disabled:opacity-60"
        >
          {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
          {t("form.save")}
        </button>
      </div>
    </div>
  );
}

/** Кнопка «Сохранить изменения» внизу карточки: неактивна, пока правок нет. */
export function SaveButton({ dirty, saving, onSave }: { dirty: boolean; saving: boolean; onSave: () => void }) {
  const t = useTranslations("settingsManagement.organizationProfile");
  return (
    <div className="flex justify-end">
      <button
        type="button"
        onClick={onSave}
        disabled={!dirty || saving}
        className="inline-flex h-10 items-center gap-2 rounded-2xl bg-[#5566f6] px-5 text-[14px] font-medium text-white shadow-[0_10px_26px_-12px_rgba(85,102,246,0.55)] transition-colors duration-150 hover:bg-[#4a5bf0] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 disabled:cursor-not-allowed disabled:bg-[#c8cbe0] disabled:shadow-none"
      >
        {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
        {saving ? t("form.saving") : t("form.saveChanges")}
      </button>
    </div>
  );
}

export type OrganizationPatchResult =
  | { ok: true }
  | { ok: false; keys: OrganizationProfileApiErrorKey[] | null; network: boolean };

/** PATCH /api/settings/organization — тот же, что у формы «Реквизитов». */
export async function patchOrganization(payload: Record<string, unknown>): Promise<OrganizationPatchResult> {
  try {
    const response = await fetch("/api/settings/organization", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (response.ok) return { ok: true };
    const data = await response.json().catch(() => null);
    return { ok: false, keys: mapOrganizationProfileApiError(data?.error), network: false };
  } catch {
    return { ok: false, keys: null, network: true };
  }
}
