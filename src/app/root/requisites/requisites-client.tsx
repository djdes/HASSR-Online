"use client";

import { CheckCircle2, Circle, FileText, Loader2, Upload } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import type { ChecklistItem, PlatformRequisites } from "@/lib/closing-documents/types";
import { cn } from "@/lib/utils";
import { checklistMessageKey, legacyUploadErrorKey } from "./requisites-presentation";

const INPUT =
  "h-12 w-full rounded-2xl border border-[#dcdfed] bg-white px-4 text-[15px] text-[#0b1024] placeholder:text-[#9b9fb3] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15";
const CARD =
  "rounded-3xl border border-[#ececf4] bg-white p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]";
const EYEBROW = "mb-4 text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]";
const BTN_PRIMARY =
  "inline-flex h-11 items-center gap-2 rounded-2xl bg-[#5566f6] px-5 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors hover:bg-[#4a5bf0] disabled:opacity-60";
const BTN_OUTLINE =
  "inline-flex h-11 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]";

type Form = Omit<PlatformRequisites, "updatedAt" | "facsimileFile" | "stampFile" | "vatMode">;

type ApiState = {
  requisites: PlatformRequisites;
  checklist: ChecklistItem[];
  complete: boolean;
};

function Field({
  label,
  value,
  onChange,
  placeholder,
  hint,
  inputMode,
  maxLength,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hint?: string;
  inputMode?: "numeric" | "text" | "email" | "tel";
  maxLength?: number;
  className?: string;
}) {
  return (
    <label className={cn("block", className)}>
      <span className="mb-1.5 block text-[13px] font-medium text-[#3c4053]">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        inputMode={inputMode}
        maxLength={maxLength}
        className={INPUT}
      />
      {hint ? <span className="mt-1 block text-[12px] text-[#9b9fb3]">{hint}</span> : null}
    </label>
  );
}

export function RequisitesClient({
  initial,
  initialChecklist,
}: {
  initial: PlatformRequisites;
  initialChecklist: ChecklistItem[];
}) {
  const t = useTranslations("rootRequisites");
  const translator = useRef(t);
  useLayoutEffect(() => {
    translator.current = t;
  }, [t]);
  const [form, setForm] = useState<Form>({
    nameFull: initial.nameFull,
    nameShort: initial.nameShort,
    inn: initial.inn,
    kpp: initial.kpp,
    ogrn: initial.ogrn,
    address: initial.address,
    bank: { ...initial.bank },
    head: { ...initial.head },
    email: initial.email,
    phone: initial.phone,
  });
  const [images, setImages] = useState({
    facsimile: Boolean(initial.facsimileFile),
    stamp: Boolean(initial.stampFile),
  });
  const [checklist, setChecklist] = useState(initialChecklist);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<"facsimile" | "stamp" | null>(null);
  const [version, setVersion] = useState(() => Date.now());
  const facsimileInput = useRef<HTMLInputElement | null>(null);
  const stampInput = useRef<HTMLInputElement | null>(null);

  const set = <K extends keyof Form>(key: K, value: Form[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  function applyState(state: ApiState) {
    setChecklist(state.checklist);
    setImages({
      facsimile: Boolean(state.requisites.facsimileFile),
      stamp: Boolean(state.requisites.stampFile),
    });
  }

  async function save() {
    setSaving(true);
    try {
      const response = await fetch("/api/root/legal-requisites", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = (await response.json().catch(() => null)) as ApiState | { error?: string } | null;
      if (!response.ok || !data || !("requisites" in data)) {
        const serverError = (data as { error?: string } | null)?.error;
        const knownError = serverError ? legacyUploadErrorKey(serverError) : null;
        if (knownError) {
          toast.error(translator.current(knownError));
          return;
        }
        toast.error(translator.current(serverError ? "errors.validation" : "errors.save"));
        return;
      }
      applyState(data);
      toast.success(data.complete ? translator.current("success.complete") : translator.current("success.saved"));
    } catch {
      toast.error(translator.current("errors.save"));
    } finally {
      setSaving(false);
    }
  }

  async function upload(kind: "facsimile" | "stamp", file: File | null) {
    if (!file) return;
    setUploading(kind);
    try {
      const body = new FormData();
      body.set("kind", kind);
      body.set("file", file);
      const response = await fetch("/api/root/legal-requisites/upload", { method: "POST", body });
      const data = (await response.json().catch(() => null)) as ApiState | { error?: string } | null;
      if (!response.ok || !data || !("requisites" in data)) {
        const serverError = (data as { error?: string } | null)?.error;
        const knownError = serverError ? legacyUploadErrorKey(serverError) : null;
        if (knownError) {
          toast.error(translator.current(knownError));
          return;
        }
        toast.error(translator.current("errors.upload"));
        return;
      }
      applyState(data);
      setVersion(Date.now());
      toast.success(kind === "facsimile" ? translator.current("success.facsimile") : translator.current("success.stamp"));
    } catch {
      toast.error(translator.current("errors.upload"));
    } finally {
      setUploading(null);
    }
  }

  const done = checklist.filter((item) => item.ok).length;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="space-y-5">
        <section className={CARD}>
            <div className={EYEBROW}>{t("sections.organization")}</div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label={t("fields.nameFull")}
              value={form.nameFull}
              onChange={(v) => set("nameFull", v)}
              placeholder={t("placeholders.nameFull")}
              className="sm:col-span-2"
            />
            <Field
              label={t("fields.nameShort")}
              value={form.nameShort}
              onChange={(v) => set("nameShort", v)}
              placeholder={t("placeholders.nameShort")}
            />
            <Field label={t("fields.inn")} value={form.inn} onChange={(v) => set("inn", v)} inputMode="numeric" maxLength={12} />
            <Field
              label={t("fields.kpp")}
              value={form.kpp}
              onChange={(v) => set("kpp", v)}
              inputMode="numeric"
              maxLength={9}
              hint={t("hints.kpp")}
            />
            <Field
              label={t("fields.ogrn")}
              value={form.ogrn}
              onChange={(v) => set("ogrn", v)}
              inputMode="numeric"
              maxLength={15}
            />
            <Field
              label={t("fields.address")}
              value={form.address}
              onChange={(v) => set("address", v)}
              placeholder={t("placeholders.address")}
              className="sm:col-span-2"
            />
            <Field label={t("fields.email")} value={form.email} onChange={(v) => set("email", v)} inputMode="email" />
            <Field label={t("fields.phone")} value={form.phone} onChange={(v) => set("phone", v)} inputMode="tel" />
          </div>
        </section>

        <section className={CARD}>
          <div className={EYEBROW}>{t("sections.bank")}</div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label={t("fields.bankName")}
              value={form.bank.name}
              onChange={(v) => set("bank", { ...form.bank, name: v })}
              placeholder={t("placeholders.bankName")}
              className="sm:col-span-2"
            />
            <Field
              label={t("fields.bik")}
              value={form.bank.bik}
              onChange={(v) => set("bank", { ...form.bank, bik: v })}
              inputMode="numeric"
              maxLength={9}
            />
            <Field
              label={t("fields.account")}
              value={form.bank.account}
              onChange={(v) => set("bank", { ...form.bank, account: v })}
              inputMode="numeric"
              maxLength={20}
            />
            <Field
              label={t("fields.corrAccount")}
              value={form.bank.corrAccount}
              onChange={(v) => set("bank", { ...form.bank, corrAccount: v })}
              inputMode="numeric"
              maxLength={20}
              className="sm:col-span-2"
            />
          </div>
        </section>

        <section className={CARD}>
          <div className={EYEBROW}>{t("sections.head")}</div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label={t("fields.headPost")}
              value={form.head.post}
              onChange={(v) => set("head", { ...form.head, post: v })}
              placeholder={t("placeholders.headPost")}
            />
            <Field
              label={t("fields.headName")}
              value={form.head.name}
              onChange={(v) => set("head", { ...form.head, name: v })}
              placeholder={t("placeholders.headName")}
            />
          </div>
          <p className="mt-3 text-[13px] leading-relaxed text-[#6f7282]">
            {t.rich("vatNotice", { mode: (chunks) => <strong className="text-[#0b1024]">{chunks}</strong> })}
          </p>
        </section>

        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => void save()} disabled={saving} className={BTN_PRIMARY}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}
            {saving ? t("actions.saving") : t("actions.save")}
          </button>
          <a href="/api/root/legal-requisites/sample" target="_blank" rel="noreferrer" className={BTN_OUTLINE}>
            <FileText className="size-4 text-[#5566f6]" />
            {t("actions.sample")}
          </a>
          <span className="text-[13px] text-[#6f7282]">
            {t("actions.sampleHint")}
          </span>
        </div>
      </div>

      <aside className="space-y-5 lg:sticky lg:top-6 lg:self-start">
        <section className={CARD}>
          <div className={EYEBROW}>{t("readiness.title", { done, total: checklist.length })}</div>
          <ul className="space-y-2">
            {checklist.map((item) => {
              const messageKey = checklistMessageKey(item.key);
              return (
                <li key={item.key} className="flex items-center gap-2 text-[13.5px]">
                  {item.ok ? (
                    <CheckCircle2 className="size-4 shrink-0 text-[#116b2a]" />
                  ) : (
                    <Circle className="size-4 shrink-0 text-[#c9ccdb]" />
                  )}
                  <span className={item.ok ? "text-[#0b1024]" : "text-[#6f7282]"}>
                    {messageKey ? t(messageKey) : item.label}
                  </span>
                </li>
              );
            })}
          </ul>
          <p
            className={cn(
              "mt-4 rounded-2xl px-3.5 py-2.5 text-[12.5px] leading-relaxed",
              done === checklist.length ? "bg-[#ecfdf5] text-[#116b2a]" : "bg-[#fff8eb] text-[#b25f00]"
            )}
          >
            {done === checklist.length
              ? t("readiness.complete")
              : t("readiness.incomplete")}
          </p>
        </section>

        {(
          [
            { kind: "facsimile", titleKey: "images.facsimileTitle", hintKey: "images.facsimileHint", ref: facsimileInput, box: "h-16" },
            { kind: "stamp", titleKey: "images.stampTitle", hintKey: "images.stampHint", ref: stampInput, box: "h-36" },
          ] as const
        ).map((slot) => (
          <section key={slot.kind} className={CARD}>
            <div className={EYEBROW}>{t(slot.titleKey)}</div>
            <div
              className={cn(
                "flex items-center justify-center rounded-2xl border border-dashed border-[#dcdfed] bg-[#fafbff] p-3",
                slot.box
              )}
            >
              {images[slot.kind] ? (
                // eslint-disable-next-line @next/next/no-img-element -- приватная картинка с no-store, next/image тут не нужен
                <img
                  src={`/api/root/legal-requisites/image/${slot.kind}?v=${version}`}
                  alt={t(slot.titleKey)}
                  className="max-h-full max-w-full object-contain"
                />
              ) : (
                <span className="text-[13px] text-[#9b9fb3]">{t("images.notUploaded")}</span>
              )}
            </div>
            <p className="mt-2 text-[12px] leading-relaxed text-[#9b9fb3]">{t(slot.hintKey)}</p>
            <input
              ref={slot.ref}
              type="file"
              accept="image/png"
              className="hidden"
              onChange={(event) => {
                void upload(slot.kind, event.target.files?.[0] ?? null);
                event.target.value = "";
              }}
            />
            <button
              type="button"
              onClick={() => slot.ref.current?.click()}
              disabled={uploading === slot.kind}
              className={cn(BTN_OUTLINE, "mt-3 h-10 text-[13px]")}
            >
              {uploading === slot.kind ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Upload className="size-4 text-[#5566f6]" />
              )}
              {images[slot.kind] ? t("images.replacePng") : t("images.uploadPng")}
            </button>
          </section>
        ))}
      </aside>
    </div>
  );
}
