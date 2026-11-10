"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, Camera, Check, Delete, X } from "lucide-react";

import {
  fieldsNeedingCorrection,
  isOutOfRange,
  offlineSigners,
  offlineSignerStep,
  parseTypedNumber,
  rangeText,
} from "@/lib/offline/offline-logic";
import type { OfflineValues } from "@/lib/offline/merge";
import { photoMark } from "@/lib/offline/photo-slots";
import {
  checkOfflinePin,
  nextOfflinePinLock,
  offlinePinLockMinutes,
  type OfflinePinLock,
} from "@/lib/offline/pin-verifier";
import { getOfflineValue, setOfflineValue } from "@/lib/offline/store";
import {
  OFFLINE_FIELD_PHOTO_LIMIT,
  OFFLINE_PHOTO_MAX_BYTES,
  OFFLINE_PHOTO_TYPES,
  OFFLINE_READING_PHOTO_SLOT,
  offlineFieldPhotoSlot,
  type OfflineAuthKind,
  type OfflinePack,
  type OfflinePackEmployee,
  type OfflinePackObject,
} from "@/lib/offline/types";
import { buildCompletionValidator, type TaskFormField, type TaskFormSchema } from "@/lib/tasksflow-adapters/task-form";

/* ------------------------------------------------------------------
 * Shared look — the same as the QR fill pages (`/equipment-fill`).
 * ---------------------------------------------------------------- */

export const ui = {
  card: "rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] sm:p-6",
  title: "text-[22px] font-semibold leading-tight tracking-[-0.02em] text-[#0b1024]",
  hint: "text-[14px] leading-relaxed text-[#6f7282]",
  label: "mb-1.5 block text-[14px] font-medium text-[#0b1024]",
  input:
    "h-14 w-full rounded-2xl border border-[#dcdfed] bg-white px-4 text-[18px] text-[#0b1024] outline-none transition-colors placeholder:text-[#9b9fb3] focus:border-[#5566f6] focus:ring-4 focus:ring-[#5566f6]/15",
  primary:
    "h-14 w-full rounded-2xl bg-[#5566f6] px-5 text-[18px] font-semibold text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors hover:bg-[#4a5bf0] disabled:bg-[#c8cbe0] disabled:shadow-none",
  ghost:
    "h-12 w-full rounded-2xl border border-[#dcdfed] bg-white px-5 text-[16px] font-semibold text-[#3848c7] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] disabled:opacity-50",
  item:
    "flex w-full items-center gap-3 rounded-2xl border border-[#ececf4] bg-white px-4 py-3.5 text-left transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]",
  error: "rounded-2xl border border-[#ffd2cd] bg-[#fff4f2] p-3 text-[15px] leading-snug text-[#a13a32]",
  warn: "flex gap-3 rounded-2xl border border-[#ffe9b0] bg-[#fff8eb] p-4 text-[14px] leading-relaxed text-[#7a4a00]",
  info: "rounded-2xl border border-[#d6dcff] bg-[#eef1ff] px-4 py-2.5 text-[14px] leading-snug text-[#3848c7]",
};

/* ------------------------------------------------------------------
 * «Кто вы?» + PIN
 * ---------------------------------------------------------------- */

export type OfflineSigner = { employee: OfflinePackEmployee; auth: OfflineAuthKind; pinFp: string | null };

/** PIN confirmed on this device recently — not asked again for 30 minutes (same as the online pass). */
const PIN_PASS_MS = 30 * 60 * 1000;
const pinPasses = new Map<string, number>();
const REMEMBER_KEY = "remember-employee";
const lockKey = (employeeId: string) => `pin-lock:${employeeId}`;

function hasPinPass(employeeId: string): boolean {
  return (pinPasses.get(employeeId) ?? 0) > Date.now();
}

export function SignerPicker({
  pack,
  allowedIds,
  onReady,
}: {
  pack: OfflinePack;
  allowedIds: readonly string[];
  onReady: (signer: OfflineSigner) => void;
}) {
  const t = useTranslations("offlineApp");
  const signers = useMemo(() => offlineSigners(pack, allowedIds), [pack, allowedIds]);
  const [chosen, setChosen] = useState<OfflinePackEmployee | null>(null);
  const [remembered, setRemembered] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void getOfflineValue<string>(REMEMBER_KEY).then(setRemembered);
  }, []);

  const step = chosen ? offlineSignerStep(pack, chosen, hasPinPass(chosen.id)) : null;

  function pick(employee: OfflinePackEmployee) {
    setError(null);
    setPin("");
    const next = offlineSignerStep(pack, employee, hasPinPass(employee.id));
    if (next.step === "ready") {
      void setOfflineValue(REMEMBER_KEY, employee.id).catch(() => undefined);
      onReady({ employee, auth: next.auth, pinFp: next.auth === "pin" ? employee.pinFp : null });
      return;
    }
    setChosen(employee);
  }

  async function submitPin(value: string) {
    if (!chosen?.pin || busy) return;
    setBusy(true);
    setError(null);
    try {
      const lock = await getOfflineValue<OfflinePinLock>(lockKey(chosen.id));
      const lockedFor = offlinePinLockMinutes(lock);
      if (lockedFor > 0) {
        setError(t("pin.locked", { minutes: String(lockedFor) }));
        return;
      }
      const valid = await checkOfflinePin(value, chosen.pin);
      const nextLock = nextOfflinePinLock(lock, valid);
      await setOfflineValue(lockKey(chosen.id), nextLock).catch(() => undefined);
      if (!valid) {
        setPin("");
        setError(nextLock.lockedUntil ? t("pin.lockedNow") : t("pin.wrong", { attempts: String(5 - nextLock.failed) }));
        return;
      }
      pinPasses.set(chosen.id, Date.now() + PIN_PASS_MS);
      void setOfflineValue(REMEMBER_KEY, chosen.id).catch(() => undefined);
      onReady({ employee: chosen, auth: "pin", pinFp: chosen.pinFp });
    } finally {
      setBusy(false);
    }
  }

  if (signers.length === 0) return <p className={ui.error}>{t("signer.none")}</p>;

  if (chosen && step?.step === "denied") {
    return (
      <div className="space-y-4">
        <p className={ui.error}>{t(`signer.${step.reason}`)}</p>
        <button type="button" className={ui.ghost} onClick={() => setChosen(null)}>
          {t("signer.other")}
        </button>
      </div>
    );
  }

  if (chosen && step?.step === "pin") {
    const press = (digit: string) => {
      if (busy) return;
      setPin((pin + digit).slice(0, 6));
      setError(null);
    };
    const key = "h-16 rounded-2xl border border-[#dcdfed] bg-white text-[24px] font-semibold text-[#0b1024] active:bg-[#eef1ff]";
    return (
      <div className="space-y-4" data-testid="offline-pin-step">
        <div>
          <h2 className="text-[18px] font-semibold text-[#0b1024]">{chosen.name}</h2>
          <p className={ui.hint}>{t("pin.hint")}</p>
        </div>
        <div className="flex justify-center gap-3 py-1" aria-label={t("pin.entered", { count: String(pin.length) })}>
          {Array.from({ length: 6 }, (_, index) => (
            <span key={index} className={`size-3.5 rounded-full ${index < pin.length ? "bg-[#5566f6]" : index < 4 ? "bg-[#dcdfed]" : "bg-[#eef0f7]"}`} />
          ))}
        </div>
        {/* Hidden field so the PIN can also be typed on a hardware keyboard. */}
        <input
          className="sr-only"
          inputMode="numeric"
          autoComplete="off"
          aria-label={t("pin.label")}
          data-testid="offline-pin-input"
          value={pin}
          onChange={(event) => {
            setPin(event.target.value.replace(/\D/g, "").slice(0, 6));
            setError(null);
          }}
        />
        <div className="mx-auto grid max-w-[300px] grid-cols-3 gap-2.5">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((digit) => (
            <button key={digit} type="button" className={key} onClick={() => press(digit)}>
              {digit}
            </button>
          ))}
          <span />
          <button type="button" className={key} onClick={() => press("0")}>
            0
          </button>
          <button type="button" aria-label={t("pin.erase")} className={`${key} flex items-center justify-center text-[#6f7282]`} onClick={() => setPin(pin.slice(0, -1))}>
            <Delete className="size-6" aria-hidden />
          </button>
        </div>
        {error ? <p className={ui.error} role="alert">{error}</p> : null}
        <button type="button" className={ui.primary} disabled={pin.length < 4 || busy} onClick={() => void submitPin(pin)} data-testid="offline-pin-submit">
          {busy ? t("pin.checking") : t("pin.continue")}
        </button>
        <button type="button" className={ui.ghost} onClick={() => setChosen(null)}>
          {t("signer.notMe")}
        </button>
      </div>
    );
  }

  const ordered = remembered ? [...signers].sort((a, b) => Number(b.id === remembered) - Number(a.id === remembered)) : signers;
  return (
    <div className="space-y-3" data-testid="offline-signers">
      <h2 className="text-[18px] font-semibold text-[#0b1024]">{t("signer.who")}</h2>
      <div className="space-y-2">
        {ordered.map((employee) => (
          <button key={employee.id} type="button" className={ui.item} onClick={() => pick(employee)}>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[16px] font-medium text-[#0b1024]">{employee.name}</span>
              {employee.positionTitle ? <span className="block truncate text-[13px] text-[#6f7282]">{employee.positionTitle}</span> : null}
            </span>
            {employee.id === pack.user.id ? <span className="shrink-0 rounded-full bg-[#eef1ff] px-2.5 py-1 text-[12px] font-medium text-[#3848c7]">{t("signer.you")}</span> : null}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------
 * Photos kept on the device
 * ---------------------------------------------------------------- */

/** Why a picked file cannot be used; `null` — it can. The key is under `offlineApp.photo`. */
export function photoProblem(file: Pick<File, "type" | "size">): "notImage" | "tooBig" | null {
  if (!OFFLINE_PHOTO_TYPES.includes(file.type)) return "notImage";
  if (file.size > OFFLINE_PHOTO_MAX_BYTES) return "tooBig";
  return null;
}

function PhotoPicker({
  label,
  photos,
  limit,
  testId,
  onChange,
}: {
  label: string;
  photos: Blob[];
  limit: number;
  testId: string;
  onChange: (photos: Blob[]) => void;
}) {
  const t = useTranslations("offlineApp.photo");
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  // Local previews of the photos; the object URLs are released when the list changes.
  const previews = useMemo(() => photos.map((photo) => URL.createObjectURL(photo)), [photos]);
  useEffect(() => () => previews.forEach((url) => URL.revokeObjectURL(url)), [previews]);

  return (
    <div data-testid={testId}>
      <span className={ui.label}>{label}</span>
      {previews.length > 0 ? (
        <div className="mb-2 flex flex-wrap gap-2">
          {previews.map((url, index) => (
            <span key={url} className="relative">
              {/* A local blob preview — the image optimizer has nothing to fetch. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt="" className="size-20 rounded-2xl border border-[#dcdfed] object-cover" />
              <button
                type="button"
                aria-label={t("remove")}
                className="absolute -right-2 -top-2 flex size-7 items-center justify-center rounded-full border border-[#dcdfed] bg-white text-[#6f7282]"
                onClick={() => onChange(photos.filter((_, position) => position !== index))}
              >
                <X className="size-4" aria-hidden />
              </button>
            </span>
          ))}
        </div>
      ) : null}
      {photos.length < limit ? (
        <button type="button" className={`${ui.ghost} flex items-center justify-center gap-2`} onClick={() => input.current?.click()}>
          <Camera className="size-5" aria-hidden />
          {photos.length > 0 ? t("addMore") : t("add")}
        </button>
      ) : null}
      <input
        ref={input}
        type="file"
        accept="image/*"
        className="sr-only"
        tabIndex={-1}
        data-testid={`${testId}-input`}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          const problem = photoProblem(file);
          if (problem) {
            setError(problem === "tooBig" ? t("tooBig", { mb: String(OFFLINE_PHOTO_MAX_BYTES / (1024 * 1024)) }) : t("notImage"));
            return;
          }
          setError(null);
          onChange([...photos, file].slice(0, limit));
        }}
      />
      {photos.length > 0 ? <p className="mt-1.5 text-[13px] text-[#6f7282]">{t("kept")}</p> : null}
      {error ? <p className={`${ui.error} mt-2`} role="alert">{error}</p> : null}
    </div>
  );
}

/* ------------------------------------------------------------------
 * Journal row form (TaskFormSchema)
 * ---------------------------------------------------------------- */

type Draft = Record<string, string | boolean>;

const isValueField = (field: TaskFormField) => field.type !== "photo" && field.type !== "signature";

function toDraft(schema: TaskFormSchema, values: OfflineValues): Draft {
  const draft: Draft = {};
  for (const field of schema.fields) {
    const value = values[field.key];
    if (field.type === "boolean") draft[field.key] = value === true;
    else if (isValueField(field)) draft[field.key] = value === null || value === undefined ? "" : String(value);
  }
  return draft;
}

function cleanLabel(label: string): string {
  return label.replace(/\s*\*\s*$/, "");
}

export type JournalFormResult = {
  values: Record<string, string | number | boolean | null>;
  correction: string;
  /** Photos by queue slot; the values hold the matching markers. */
  photos: Record<string, Blob>;
};

export function JournalRowForm({
  schema,
  initial,
  filled,
  onSubmit,
}: {
  schema: TaskFormSchema;
  initial: OfflineValues;
  /** The row already has a record for that day — the button says «Сохранить изменения». */
  filled: boolean;
  onSubmit: (result: JournalFormResult) => Promise<void>;
}) {
  const t = useTranslations("offlineApp");
  const [draft, setDraft] = useState<Draft>(() => toDraft(schema, initial));
  const [photos, setPhotos] = useState<Record<string, Blob[]>>({});
  const [correction, setCorrection] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // A signature cannot be made offline; a required one blocks the form, as before.
  const blocking = schema.fields.filter((field) => field.type === "signature" && field.required);
  const valueFields = useMemo(() => schema.fields.filter(isValueField), [schema]);
  const typed = useMemo(() => {
    const out: OfflineValues = {};
    for (const field of valueFields) {
      const raw = draft[field.key];
      if (field.type === "boolean") out[field.key] = raw === true;
      else if (field.type === "number") out[field.key] = typeof raw === "string" ? parseTypedNumber(raw) : null;
      else out[field.key] = typeof raw === "string" && raw.trim() !== "" ? raw.trim() : null;
    }
    return out;
  }, [draft, valueFields]);
  const offNorm = fieldsNeedingCorrection(schema, typed);

  async function submit() {
    setError(null);
    for (const field of valueFields) {
      if (field.type === "number" && typeof draft[field.key] === "string" && (draft[field.key] as string).trim() !== "" && typed[field.key] === null) {
        setError(t("form.enterNumber", { label: cleanLabel(field.label) }));
        return;
      }
    }
    const missingPhoto = schema.fields.find((field) => field.type === "photo" && field.required && (photos[field.key]?.length ?? 0) === 0);
    if (missingPhoto) {
      setError(t("photo.fieldNeeded", { label: cleanLabel(missingPhoto.label) }));
      return;
    }
    const validator = buildCompletionValidator({ ...schema, fields: valueFields });
    const submitted = Object.fromEntries(Object.entries(typed).filter(([, value]) => value !== null));
    const parsed = validator.safeParse(submitted);
    if (!parsed.success) {
      const missing = parsed.error.issues
        .map((issue) => schema.fields.find((field) => field.key === issue.path[0]))
        .filter((field): field is TaskFormField => Boolean(field))
        .map((field) => `«${cleanLabel(field.label)}»`);
      setError(missing.length > 0 ? t("form.check", { fields: Array.from(new Set(missing)).join(", ") }) : t("form.checkValues"));
      return;
    }
    // Photo fields: the value is a list of markers, the photos themselves go to the queue item.
    const values = { ...(parsed.data as Record<string, string | number | boolean | null>) };
    const slots: Record<string, Blob> = {};
    for (const field of schema.fields) {
      if (field.type !== "photo") continue;
      const taken = photos[field.key] ?? [];
      if (taken.length === 0) continue;
      values[field.key] = taken.map((_, index) => photoMark(offlineFieldPhotoSlot(field.key, index))).join(",");
      taken.forEach((photo, index) => (slots[offlineFieldPhotoSlot(field.key, index)] = photo));
    }
    setSaving(true);
    try {
      await onSubmit({ values, correction: correction.trim(), photos: slots });
    } catch {
      setError(t("form.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  if (blocking.length > 0) {
    return (
      <div className={ui.warn}>
        <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden />
        <span>{t("form.signatureRequired", { fields: blocking.map((field) => cleanLabel(field.label)).join(", ") })}</span>
      </div>
    );
  }

  return (
    <form
      className="space-y-4"
      data-testid="offline-journal-form"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      {schema.intro ? <p className={ui.hint}>{schema.intro}</p> : null}
      {schema.notice ? <p className={ui.info}>{schema.notice}</p> : null}
      {/* Step-by-step instruction of the journal (cleaning, maintenance) — a list above the form, as on the QR page. */}
      {schema.pipeline && schema.pipeline.length > 0 ? (
        <ol className="space-y-2" data-testid="offline-steps">
          {schema.pipeline.map((step, index) => (
            <li key={step.id} className="flex gap-3 rounded-2xl border border-[#ececf4] bg-[#fafbff] px-4 py-3">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[#eef1ff] text-[14px] font-semibold text-[#3848c7]">{index + 1}</span>
              <span className="min-w-0 text-[15px] leading-snug text-[#0b1024]">
                {step.title}
                {step.detail ? <span className="mt-0.5 block text-[13px] text-[#6f7282]">{step.detail}</span> : null}
              </span>
            </li>
          ))}
        </ol>
      ) : null}
      {schema.fields.map((field) =>
        field.type === "photo" ? (
          <PhotoPicker
            key={field.key}
            testId={`offline-photo-${field.key}`}
            label={`${cleanLabel(field.label)}${field.required ? ` — ${t("form.required")}` : ""}`}
            photos={photos[field.key] ?? []}
            limit={OFFLINE_FIELD_PHOTO_LIMIT}
            onChange={(next) => setPhotos((prev) => ({ ...prev, [field.key]: next }))}
          />
        ) : (
          <FieldInput key={field.key} field={field} value={draft[field.key]} onChange={(value) => setDraft((prev) => ({ ...prev, [field.key]: value }))} />
        )
      )}
      {offNorm.length > 0 ? (
        <div>
          <p className={ui.warn}>
            <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden />
            <span>{t("form.offNorm", { fields: offNorm.map((field) => cleanLabel(field.label)).join(", ") })}</span>
          </p>
          <label className={`${ui.label} mt-3`} htmlFor="offline-correction">
            {t("form.whatDone")}
          </label>
          <textarea id="offline-correction" className={`${ui.input} h-24 py-3`} maxLength={300} value={correction} onChange={(event) => setCorrection(event.target.value)} />
        </div>
      ) : null}
      {error ? <p className={ui.error} role="alert">{error}</p> : null}
      <button type="submit" className={ui.primary} disabled={saving}>
        {saving ? t("form.saving") : filled ? t("form.saveChanges") : t("form.save")}
      </button>
    </form>
  );
}

function FieldInput({ field, value, onChange }: { field: TaskFormField; value: string | boolean | undefined; onChange: (value: string | boolean) => void }) {
  const t = useTranslations("offlineApp.form");
  const id = `offline-field-${field.key}`;
  const label = cleanLabel(field.label);
  const required = "required" in field && field.required === true;

  if (field.type === "photo") return null;
  if (field.type === "signature") {
    return <p className="rounded-2xl border border-dashed border-[#dcdfed] px-4 py-3 text-[14px] text-[#6f7282]">{t("signatureLater", { label })}</p>;
  }
  if (field.type === "boolean") {
    const checked = value === true;
    return (
      <button type="button" role="checkbox" aria-checked={checked} className={`${ui.item} ${checked ? "border-[#5566f6] bg-[#f5f6ff]" : ""}`} onClick={() => onChange(!checked)} data-field={field.key}>
        <span className={`flex size-7 shrink-0 items-center justify-center rounded-lg border ${checked ? "border-[#5566f6] bg-[#5566f6] text-white" : "border-[#c8cbe0] bg-white"}`}>{checked ? <Check className="size-5" aria-hidden /> : null}</span>
        <span className="text-[16px] leading-snug text-[#0b1024]">{label}</span>
      </button>
    );
  }
  const text = typeof value === "string" ? value : "";
  const star = required ? <span className="text-[#a13a32]"> *</span> : null;
  const caption = (
    <label className={ui.label} htmlFor={id}>
      {label}
      {star}
    </label>
  );
  if (field.type === "select") {
    if (field.options.length <= 4) {
      return (
        <div role="radiogroup" aria-label={label}>
          <span className={ui.label}>
            {label}
            {star}
          </span>
          <div className="grid gap-2 sm:grid-cols-2">
            {field.options.map((option) => (
              <button key={option.value} type="button" role="radio" aria-checked={text === option.value} data-field={field.key} data-value={option.value} className={`${ui.item} justify-center text-[16px] font-medium ${text === option.value ? "border-[#5566f6] bg-[#eef1ff] text-[#3848c7]" : "text-[#0b1024]"}`} onClick={() => onChange(option.value)}>
                {option.label}
              </button>
            ))}
          </div>
        </div>
      );
    }
    return (
      <div>
        {caption}
        <select id={id} className={ui.input} value={text} onChange={(event) => onChange(event.target.value)} data-field={field.key}>
          <option value="">{t("select")}</option>
          {field.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
    );
  }
  if (field.type === "number") {
    const norm = rangeText(field.normalRange, field.unit ?? "");
    const off = isOutOfRange(text, field.normalRange);
    return (
      <div>
        {caption}
        <div className="relative">
          <input id={id} data-field={field.key} className={`${ui.input} ${field.unit ? "pr-16" : ""} ${off ? "border-[#e8a33d]" : ""}`} inputMode="decimal" autoComplete="off" placeholder={field.placeholder ?? ""} value={text} onChange={(event) => onChange(event.target.value)} />
          {field.unit ? <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[16px] text-[#6f7282]">{field.unit}</span> : null}
        </div>
        {norm ? <p className={`mt-1.5 text-[13px] ${off ? "font-medium text-[#7a4a00]" : "text-[#6f7282]"}`}>{t("norm", { range: norm.trim() })}</p> : null}
      </div>
    );
  }
  if (field.type === "text" && field.multiline) {
    return (
      <div>
        {caption}
        <textarea id={id} data-field={field.key} className={`${ui.input} h-24 py-3`} maxLength={field.maxLength} placeholder={field.placeholder ?? ""} value={text} onChange={(event) => onChange(event.target.value)} />
      </div>
    );
  }
  return (
    <div>
      {caption}
      <input
        id={id}
        data-field={field.key}
        className={ui.input}
        type={field.type === "date" ? "date" : field.type === "time" ? "time" : "text"}
        maxLength={field.type === "text" ? field.maxLength : undefined}
        placeholder={"placeholder" in field ? field.placeholder ?? "" : ""}
        value={text}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

/* ------------------------------------------------------------------
 * Sticker forms: fridge temperature, room climate, UV lamp, fryer
 * ---------------------------------------------------------------- */

export type ObjectSubmit = {
  action: "temperature" | "climate" | "uv-on" | "uv-off" | "fryer-start" | "fryer-end";
  body: Record<string, unknown>;
  summary: string;
  photos?: Record<string, Blob>;
};

export function ObjectForm({
  object,
  fryerStarted,
  onSubmit,
}: {
  object: OfflinePackObject;
  /** A «начало жарки» of this fryer is already waiting in the queue of this device. */
  fryerStarted?: boolean;
  onSubmit: (submit: ObjectSubmit) => Promise<void>;
}) {
  const t = useTranslations("offlineApp");
  const [temperature, setTemperature] = useState("");
  const [humidity, setHumidity] = useState("");
  const [status, setStatus] = useState<"service" | "repair" | null>(null);
  const [correction, setCorrection] = useState("");
  const [photo, setPhoto] = useState<Blob[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function send(submit: ObjectSubmit) {
    setSaving(true);
    setError(null);
    try {
      await onSubmit(submit);
    } catch {
      setError(t("form.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  if (object.fill === "unsupported") {
    return (
      <p className={ui.warn}>
        <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden />
        <span>{object.unsupportedReason ? t("object.fryerNoJournal") : t("object.unsupported")}</span>
      </p>
    );
  }

  if (object.fill === "uv") {
    return (
      <div className="space-y-3" data-testid="offline-uv-form">
        <p className={ui.hint}>{t("uv.hint")}</p>
        <button type="button" className={ui.primary} disabled={saving} onClick={() => void send({ action: "uv-on", body: { action: "on" }, summary: t("uv.summaryOn") })}>
          {t("uv.on")}
        </button>
        <button type="button" className={ui.ghost} disabled={saving} onClick={() => void send({ action: "uv-off", body: { action: "off" }, summary: t("uv.summaryOff") })}>
          {t("uv.off")}
        </button>
        {error ? <p className={ui.error} role="alert">{error}</p> : null}
      </div>
    );
  }

  if (object.fill === "fryer") {
    return <FryerForm object={object} started={fryerStarted === true} saving={saving} error={error} setError={setError} onSend={send} />;
  }

  const isRoom = object.fill === "climate";
  const tempNorm = rangeText(object.temperature, "°C");
  const humNorm = rangeText(object.humidity, "%");
  const tempOff = isOutOfRange(temperature, object.temperature);
  const humOff = isOutOfRange(humidity, object.humidity);
  const needCorrection = !status && (tempOff || humOff);

  async function submit() {
    setError(null);
    if (status) {
      await send({ action: "temperature", body: { status }, summary: status === "service" ? t("reading.service") : t("reading.repair") });
      return;
    }
    const temp = temperature.trim() === "" ? null : parseTypedNumber(temperature);
    const hum = humidity.trim() === "" ? null : parseTypedNumber(humidity);
    if (temperature.trim() !== "" && temp === null) return setError(t("reading.errTempNumber"));
    if (humidity.trim() !== "" && hum === null) return setError(t("reading.errHumNumber"));
    if (temp !== null && (temp < -60 || temp > 80)) return setError(t("reading.errTempRange"));
    if (hum !== null && (hum < 0 || hum > 100)) return setError(t("reading.errHumRange"));
    if (isRoom ? temp === null && hum === null : temp === null) return setError(isRoom ? t("reading.errEnterAny") : t("reading.errEnterTemp"));
    if (needCorrection && correction.trim() === "") return setError(t("reading.errCorrection"));
    // The photo proves a temperature reading; the server does not ask for it with humidity alone.
    const hasPhoto = photo.length > 0 && temp !== null;
    if (object.photo === "required" && temp !== null && !hasPhoto) return setError(t("photo.readingNeeded"));
    const parts = [temp !== null ? `${temp > 0 ? "+" : ""}${temp} °C` : null, hum !== null ? `${hum} %` : null, hasPhoto ? t("photo.attached", { count: "1" }) : null].filter(Boolean);
    await send({
      action: isRoom ? "climate" : "temperature",
      body: {
        ...(temp !== null ? { temperature: temp } : {}),
        ...(hum !== null ? { humidity: hum } : {}),
        ...(needCorrection ? { correction: correction.trim() } : {}),
        ...(hasPhoto ? { photo: photoMark(OFFLINE_READING_PHOTO_SLOT) } : {}),
      },
      summary: parts.join(", "),
      ...(hasPhoto ? { photos: { [OFFLINE_READING_PHOTO_SLOT]: photo[0] } } : {}),
    });
  }

  return (
    <form
      className="space-y-4"
      data-testid="offline-object-form"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      {object.temperature || !isRoom ? (
        <div>
          <label className={ui.label} htmlFor="offline-temperature">
            {t("reading.temperature")}
          </label>
          <div className="relative">
            <input id="offline-temperature" data-testid="offline-temperature" className={`${ui.input} pr-16 ${tempOff ? "border-[#e8a33d]" : ""}`} inputMode="decimal" autoComplete="off" disabled={status !== null} value={temperature} onChange={(event) => setTemperature(event.target.value)} />
            <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[16px] text-[#6f7282]">°C</span>
          </div>
          {tempNorm ? <p className={`mt-1.5 text-[13px] ${tempOff ? "font-medium text-[#7a4a00]" : "text-[#6f7282]"}`}>{t("form.norm", { range: tempNorm })}</p> : null}
        </div>
      ) : null}
      {object.humidity ? (
        <div>
          <label className={ui.label} htmlFor="offline-humidity">
            {isRoom ? t("reading.humidity") : t("reading.humidityOptional")}
          </label>
          <div className="relative">
            <input id="offline-humidity" data-testid="offline-humidity" className={`${ui.input} pr-16 ${humOff ? "border-[#e8a33d]" : ""}`} inputMode="decimal" autoComplete="off" disabled={status !== null} value={humidity} onChange={(event) => setHumidity(event.target.value)} />
            <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[16px] text-[#6f7282]">%</span>
          </div>
          {humNorm ? <p className={`mt-1.5 text-[13px] ${humOff ? "font-medium text-[#7a4a00]" : "text-[#6f7282]"}`}>{t("form.norm", { range: humNorm })}</p> : null}
        </div>
      ) : null}
      {object.photo !== "off" && !status ? (
        <PhotoPicker testId="offline-reading-photo" label={object.photo === "required" ? t("photo.readingRequired") : t("photo.reading")} photos={photo} limit={1} onChange={setPhoto} />
      ) : null}
      {!isRoom ? (
        <div className="grid grid-cols-2 gap-2">
          {(["service", "repair"] as const).map((value) => (
            <button key={value} type="button" aria-pressed={status === value} className={`${ui.ghost} ${status === value ? "border-[#5566f6] bg-[#eef1ff]" : ""}`} onClick={() => setStatus(status === value ? null : value)}>
              {value === "service" ? t("reading.service") : t("reading.repair")}
            </button>
          ))}
        </div>
      ) : null}
      {needCorrection ? (
        <div>
          <p className={ui.warn}>
            <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden />
            <span>{t("reading.offNorm")}</span>
          </p>
          <label className={`${ui.label} mt-3`} htmlFor="offline-object-correction">
            {t("form.whatDone")}
          </label>
          <textarea id="offline-object-correction" data-testid="offline-object-correction" className={`${ui.input} h-24 py-3`} maxLength={300} value={correction} onChange={(event) => setCorrection(event.target.value)} />
        </div>
      ) : null}
      {error ? <p className={ui.error} role="alert">{error}</p> : null}
      <button type="submit" className={ui.primary} disabled={saving}>
        {saving ? t("form.saving") : t("form.save")}
      </button>
    </form>
  );
}

function FryerForm({
  object,
  started,
  saving,
  error,
  setError,
  onSend,
}: {
  object: OfflinePackObject;
  started: boolean;
  saving: boolean;
  error: string | null;
  setError: (error: string | null) => void;
  onSend: (submit: ObjectSubmit) => Promise<void>;
}) {
  const t = useTranslations("offlineApp");
  const lists = object.fryer ?? { fatTypes: [], productTypes: [], fatType: "", productType: "", phase: "start" as const };
  // The journal expected the end when the pack was made, or the start is already waiting on this device.
  const [phase, setPhase] = useState<"start" | "end">(started || lists.phase === "end" ? "end" : "start");
  const [fatType, setFatType] = useState(lists.fatType);
  const [productType, setProductType] = useState(lists.productType);
  const [quality, setQuality] = useState(5);
  const [carryover, setCarryover] = useState("");
  const [disposed, setDisposed] = useState("");

  async function submit() {
    setError(null);
    if (phase === "start") {
      if (!fatType.trim()) return setError(t("fryer.errFat"));
      if (!productType.trim()) return setError(t("fryer.errProduct"));
      await onSend({ action: "fryer-start", body: { phase: "start", fatType: fatType.trim(), productType: productType.trim(), quality }, summary: t("fryer.summaryStart", { quality: String(quality) }) });
      return;
    }
    const kg = (raw: string) => (raw.trim() === "" ? 0 : parseTypedNumber(raw));
    const carryoverKg = kg(carryover);
    const disposedKg = kg(disposed);
    if (carryoverKg === null || disposedKg === null || carryoverKg < 0 || carryoverKg > 1000 || disposedKg < 0 || disposedKg > 1000) return setError(t("fryer.errKg"));
    await onSend({ action: "fryer-end", body: { phase: "end", quality, carryoverKg, disposedKg }, summary: t("fryer.summaryEnd", { quality: String(quality) }) });
  }

  const pick = (id: string, label: string, value: string, options: string[], onChange: (value: string) => void) => (
    <div>
      <label className={ui.label} htmlFor={id}>
        {label}
      </label>
      {options.length > 0 ? (
        <select id={id} data-testid={id} className={ui.input} value={value} onChange={(event) => onChange(event.target.value)}>
          {options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      ) : (
        <input id={id} data-testid={id} className={ui.input} value={value} maxLength={200} onChange={(event) => onChange(event.target.value)} />
      )}
    </div>
  );

  return (
    <form
      className="space-y-4"
      data-testid="offline-fryer-form"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="grid grid-cols-2 gap-2" role="radiogroup">
        {(["start", "end"] as const).map((value) => (
          <button key={value} type="button" role="radio" aria-checked={phase === value} data-testid={`offline-fryer-${value}`} className={`${ui.ghost} ${phase === value ? "border-[#5566f6] bg-[#eef1ff]" : ""}`} onClick={() => setPhase(value)}>
            {value === "start" ? t("fryer.start") : t("fryer.end")}
          </button>
        ))}
      </div>
      <p className={ui.hint}>{t("fryer.phaseHint")}</p>
      {phase === "start" ? (
        <>
          {pick("offline-fryer-fat", t("fryer.fat"), fatType, lists.fatTypes, setFatType)}
          {pick("offline-fryer-product", t("fryer.product"), productType, lists.productTypes, setProductType)}
        </>
      ) : null}
      <div role="radiogroup" aria-label={t("fryer.quality")}>
        <span className={ui.label}>{t("fryer.quality")}</span>
        <div className="grid grid-cols-5 gap-2">
          {[1, 2, 3, 4, 5].map((value) => (
            <button key={value} type="button" role="radio" aria-checked={quality === value} className={`${ui.ghost} px-0 ${quality === value ? "border-[#5566f6] bg-[#eef1ff]" : ""}`} onClick={() => setQuality(value)}>
              {value}
            </button>
          ))}
        </div>
      </div>
      {phase === "end" ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={ui.label} htmlFor="offline-fryer-carryover">
              {t("fryer.carryover")}
            </label>
            <input id="offline-fryer-carryover" data-testid="offline-fryer-carryover" className={ui.input} inputMode="decimal" value={carryover} onChange={(event) => setCarryover(event.target.value)} />
          </div>
          <div>
            <label className={ui.label} htmlFor="offline-fryer-disposed">
              {t("fryer.disposed")}
            </label>
            <input id="offline-fryer-disposed" data-testid="offline-fryer-disposed" className={ui.input} inputMode="decimal" value={disposed} onChange={(event) => setDisposed(event.target.value)} />
          </div>
        </div>
      ) : null}
      {error ? <p className={ui.error} role="alert">{error}</p> : null}
      <button type="submit" className={ui.primary} disabled={saving}>
        {saving ? t("form.saving") : t("form.save")}
      </button>
    </form>
  );
}
