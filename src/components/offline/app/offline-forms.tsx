"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, Delete } from "lucide-react";

import {
  fieldsNeedingCorrection,
  isOutOfRange,
  offlineSigners,
  offlineSignerStep,
  parseTypedNumber,
  rangeText,
} from "@/lib/offline/offline-logic";
import type { OfflineValues } from "@/lib/offline/merge";
import {
  checkOfflinePin,
  nextOfflinePinLock,
  offlinePinLockMinutes,
  type OfflinePinLock,
} from "@/lib/offline/pin-verifier";
import { getOfflineValue, setOfflineValue } from "@/lib/offline/store";
import type { OfflineAuthKind, OfflinePack, OfflinePackEmployee, OfflinePackObject } from "@/lib/offline/types";
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
        setError(`ПИН заблокирован после ошибок. Попробуйте через ${lockedFor} мин.`);
        return;
      }
      const valid = await checkOfflinePin(value, chosen.pin);
      const nextLock = nextOfflinePinLock(lock, valid);
      await setOfflineValue(lockKey(chosen.id), nextLock).catch(() => undefined);
      if (!valid) {
        setPin("");
        setError(
          nextLock.lockedUntil
            ? "Неверный ПИН 5 раз — вход заблокирован на 15 минут."
            : `Неверный ПИН. Осталось попыток: ${5 - nextLock.failed}.`
        );
        return;
      }
      pinPasses.set(chosen.id, Date.now() + PIN_PASS_MS);
      void setOfflineValue(REMEMBER_KEY, chosen.id).catch(() => undefined);
      onReady({ employee: chosen, auth: "pin", pinFp: chosen.pinFp });
    } finally {
      setBusy(false);
    }
  }

  if (signers.length === 0) {
    return <p className={ui.error}>В сохранённых данных нет сотрудников, которые могут заполнять этот объект. Откройте приложение с интернетом, чтобы обновить данные.</p>;
  }

  if (chosen && step?.step === "denied") {
    return (
      <div className="space-y-4">
        <p className={ui.error}>{step.reason}</p>
        <button type="button" className={ui.ghost} onClick={() => setChosen(null)}>
          Выбрать другого сотрудника
        </button>
      </div>
    );
  }

  if (chosen && step?.step === "pin") {
    const press = (digit: string) => {
      if (busy) return;
      const next = (pin + digit).slice(0, 6);
      setPin(next);
      setError(null);
    };
    return (
      <div className="space-y-4" data-testid="offline-pin-step">
        <div>
          <h2 className="text-[18px] font-semibold text-[#0b1024]">{chosen.name}</h2>
          <p className={ui.hint}>Введите свой ПИН — он проверяется на устройстве, без интернета.</p>
        </div>
        <div className="flex justify-center gap-3 py-1" aria-label={`Введено цифр: ${pin.length}`}>
          {Array.from({ length: 6 }, (_, index) => (
            <span
              key={index}
              className={`size-3.5 rounded-full ${index < pin.length ? "bg-[#5566f6]" : index < 4 ? "bg-[#dcdfed]" : "bg-[#eef0f7]"}`}
            />
          ))}
        </div>
        {/* Скрытое поле — чтобы ПИН можно было набрать и с клавиатуры планшета. */}
        <input
          className="sr-only"
          inputMode="numeric"
          autoComplete="off"
          aria-label="ПИН"
          data-testid="offline-pin-input"
          value={pin}
          onChange={(event) => {
            setPin(event.target.value.replace(/\D/g, "").slice(0, 6));
            setError(null);
          }}
        />
        <div className="mx-auto grid max-w-[300px] grid-cols-3 gap-2.5">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((digit) => (
            <button key={digit} type="button" className="h-16 rounded-2xl border border-[#dcdfed] bg-white text-[24px] font-semibold text-[#0b1024] active:bg-[#eef1ff]" onClick={() => press(digit)}>
              {digit}
            </button>
          ))}
          <span />
          <button type="button" className="h-16 rounded-2xl border border-[#dcdfed] bg-white text-[24px] font-semibold text-[#0b1024] active:bg-[#eef1ff]" onClick={() => press("0")}>
            0
          </button>
          <button type="button" aria-label="Стереть цифру" className="flex h-16 items-center justify-center rounded-2xl border border-[#dcdfed] bg-white text-[#6f7282] active:bg-[#eef1ff]" onClick={() => setPin(pin.slice(0, -1))}>
            <Delete className="size-6" aria-hidden />
          </button>
        </div>
        {error ? <p className={ui.error} role="alert">{error}</p> : null}
        <button type="button" className={ui.primary} disabled={pin.length < 4 || busy} onClick={() => void submitPin(pin)} data-testid="offline-pin-submit">
          {busy ? "Проверяем…" : "Продолжить"}
        </button>
        <button type="button" className={ui.ghost} onClick={() => setChosen(null)}>
          Это не я
        </button>
      </div>
    );
  }

  const ordered = remembered ? [...signers].sort((a, b) => Number(b.id === remembered) - Number(a.id === remembered)) : signers;
  return (
    <div className="space-y-3" data-testid="offline-signers">
      <h2 className="text-[18px] font-semibold text-[#0b1024]">Кто вы?</h2>
      <div className="space-y-2">
        {ordered.map((employee) => (
          <button key={employee.id} type="button" className={ui.item} onClick={() => pick(employee)}>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[16px] font-medium text-[#0b1024]">{employee.name}</span>
              {employee.positionTitle ? <span className="block truncate text-[13px] text-[#6f7282]">{employee.positionTitle}</span> : null}
            </span>
            {employee.id === pack.user.id ? <span className="shrink-0 rounded-full bg-[#eef1ff] px-2.5 py-1 text-[12px] font-medium text-[#3848c7]">вы вошли</span> : null}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------
 * Journal row form (TaskFormSchema)
 * ---------------------------------------------------------------- */

type Draft = Record<string, string | boolean>;

function toDraft(schema: TaskFormSchema, values: OfflineValues): Draft {
  const draft: Draft = {};
  for (const field of schema.fields) {
    const value = values[field.key];
    if (field.type === "boolean") draft[field.key] = value === true;
    else if (field.type !== "photo" && field.type !== "signature") draft[field.key] = value === null || value === undefined ? "" : String(value);
  }
  return draft;
}

const fillableFields = (schema: TaskFormSchema) => schema.fields.filter((field) => field.type !== "photo" && field.type !== "signature");

function cleanLabel(label: string): string {
  return label.replace(/\s*\*\s*$/, "");
}

export function JournalRowForm({
  schema,
  initial,
  submitLabel,
  onSubmit,
}: {
  schema: TaskFormSchema;
  initial: OfflineValues;
  submitLabel: string;
  onSubmit: (values: Record<string, string | number | boolean | null>, correction: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(schema, initial));
  const [correction, setCorrection] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const blocking = schema.fields.filter((field) => (field.type === "photo" || field.type === "signature") && field.required);
  const typed = useMemo(() => {
    const out: OfflineValues = {};
    for (const field of fillableFields(schema)) {
      const raw = draft[field.key];
      if (field.type === "boolean") out[field.key] = raw === true;
      else if (field.type === "number") out[field.key] = typeof raw === "string" ? parseTypedNumber(raw) : null;
      else out[field.key] = typeof raw === "string" && raw.trim() !== "" ? raw.trim() : null;
    }
    return out;
  }, [draft, schema]);
  const offNorm = fieldsNeedingCorrection(schema, typed);

  async function submit() {
    setError(null);
    for (const field of fillableFields(schema)) {
      if (field.type === "number" && typeof draft[field.key] === "string" && (draft[field.key] as string).trim() !== "" && typed[field.key] === null) {
        setError(`«${cleanLabel(field.label)}»: введите число`);
        return;
      }
    }
    const validator = buildCompletionValidator({ ...schema, fields: fillableFields(schema) });
    const submitted = Object.fromEntries(Object.entries(typed).filter(([, value]) => value !== null));
    const parsed = validator.safeParse(submitted);
    if (!parsed.success) {
      const missing = parsed.error.issues
        .map((issue) => schema.fields.find((field) => field.key === issue.path[0]))
        .filter((field): field is TaskFormField => Boolean(field))
        .map((field) => `«${cleanLabel(field.label)}»`);
      setError(missing.length > 0 ? `Проверьте: ${Array.from(new Set(missing)).join(", ")}` : "Проверьте введённые значения");
      return;
    }
    setSaving(true);
    try {
      await onSubmit(parsed.data as Record<string, string | number | boolean | null>, correction.trim());
    } catch {
      setError("Не удалось сохранить на устройстве. Проверьте, что в настройках не запрещено хранение данных сайта.");
    } finally {
      setSaving(false);
    }
  }

  if (blocking.length > 0) {
    return (
      <div className={ui.warn}>
        <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden />
        <span>Для этой записи обязательно {blocking.map((field) => cleanLabel(field.label).toLowerCase()).join(", ")} — без связи её сделать нельзя. Заполните, когда появится интернет.</span>
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
      {schema.fields.map((field) => (
        <FieldInput key={field.key} field={field} value={draft[field.key]} onChange={(value) => setDraft((prev) => ({ ...prev, [field.key]: value }))} />
      ))}
      {offNorm.length > 0 ? (
        <div>
          <p className={ui.warn}>
            <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden />
            <span>Вне нормы: {offNorm.map((field) => cleanLabel(field.label)).join(", ")}. Напишите, что сделали.</span>
          </p>
          <label className={`${ui.label} mt-3`} htmlFor="offline-correction">
            Что сделали
          </label>
          <textarea id="offline-correction" className={`${ui.input} h-24 py-3`} maxLength={300} value={correction} onChange={(event) => setCorrection(event.target.value)} />
        </div>
      ) : null}
      {error ? <p className={ui.error} role="alert">{error}</p> : null}
      <button type="submit" className={ui.primary} disabled={saving}>
        {saving ? "Сохраняем…" : submitLabel}
      </button>
    </form>
  );
}

function FieldInput({ field, value, onChange }: { field: TaskFormField; value: string | boolean | undefined; onChange: (value: string | boolean) => void }) {
  const id = `offline-field-${field.key}`;
  const label = cleanLabel(field.label);
  const required = "required" in field && field.required === true;

  if (field.type === "photo" || field.type === "signature") {
    return <p className="rounded-2xl border border-dashed border-[#dcdfed] px-4 py-3 text-[14px] text-[#6f7282]">{label}: приложить можно в кабинете, когда появится интернет.</p>;
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
  const caption = (
    <label className={ui.label} htmlFor={id}>
      {label}
      {required ? <span className="text-[#a13a32]"> *</span> : null}
    </label>
  );
  if (field.type === "select") {
    if (field.options.length <= 4) {
      return (
        <div role="radiogroup" aria-label={label}>
          <span className={ui.label}>
            {label}
            {required ? <span className="text-[#a13a32]"> *</span> : null}
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
          <option value="">Выберите…</option>
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
        {norm ? <p className={`mt-1.5 text-[13px] ${off ? "font-medium text-[#7a4a00]" : "text-[#6f7282]"}`}>Норма: {norm.trim()}</p> : null}
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
 * Sticker forms: fridge temperature, room climate, UV lamp
 * ---------------------------------------------------------------- */

export type ObjectSubmit =
  | { action: "temperature" | "climate"; body: Record<string, unknown>; summary: string }
  | { action: "uv-on" | "uv-off"; body: Record<string, unknown>; summary: string };

export function ObjectForm({ object, onSubmit }: { object: OfflinePackObject; onSubmit: (submit: ObjectSubmit) => Promise<void> }) {
  const [temperature, setTemperature] = useState("");
  const [humidity, setHumidity] = useState("");
  const [status, setStatus] = useState<"service" | "repair" | null>(null);
  const [correction, setCorrection] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function send(submit: ObjectSubmit) {
    setSaving(true);
    setError(null);
    try {
      await onSubmit(submit);
    } catch {
      setError("Не удалось сохранить на устройстве. Проверьте, что в настройках не запрещено хранение данных сайта.");
    } finally {
      setSaving(false);
    }
  }

  if (object.fill === "unsupported") {
    return <p className={ui.warn}><AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden /><span>{object.unsupportedReason ?? "Этот объект без связи заполнить нельзя."}</span></p>;
  }

  if (object.fill === "uv") {
    return (
      <div className="space-y-3" data-testid="offline-uv-form">
        <p className={ui.hint}>Время включения и выключения запишется по часам устройства.</p>
        <button type="button" className={ui.primary} disabled={saving} onClick={() => void send({ action: "uv-on", body: { action: "on" }, summary: "Включил" })}>
          Я включил
        </button>
        <button type="button" className={ui.ghost} disabled={saving} onClick={() => void send({ action: "uv-off", body: { action: "off" }, summary: "Выключил" })}>
          Я выключил
        </button>
        {error ? <p className={ui.error} role="alert">{error}</p> : null}
      </div>
    );
  }

  if (object.photoRequired) {
    return <p className={ui.warn}><AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden /><span>В организации включено «Фото показания обязательно» — без связи снимок не отправить. Запишите показание, когда появится интернет.</span></p>;
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
      await send({ action: "temperature", body: { status }, summary: status === "service" ? "Обслуживание" : "Ремонт" });
      return;
    }
    const temp = temperature.trim() === "" ? null : parseTypedNumber(temperature);
    const hum = humidity.trim() === "" ? null : parseTypedNumber(humidity);
    if (temperature.trim() !== "" && temp === null) return setError("Температура: введите число, например 4,5");
    if (humidity.trim() !== "" && hum === null) return setError("Влажность: введите число");
    if (temp !== null && (temp < -60 || temp > 80)) return setError("Температура: проверьте значение");
    if (hum !== null && (hum < 0 || hum > 100)) return setError("Влажность: от 0 до 100 %");
    if (isRoom ? temp === null && hum === null : temp === null) return setError(isRoom ? "Введите температуру или влажность" : "Введите температуру");
    if (needCorrection && correction.trim() === "") return setError("Показание вне нормы — напишите, что сделали");
    const parts = [temp !== null ? `${temp > 0 ? "+" : ""}${temp} °C` : null, hum !== null ? `${hum} %` : null].filter(Boolean);
    await send({
      action: isRoom ? "climate" : "temperature",
      body: {
        ...(temp !== null ? { temperature: temp } : {}),
        ...(hum !== null ? { humidity: hum } : {}),
        ...(needCorrection ? { correction: correction.trim() } : {}),
      },
      summary: parts.join(", "),
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
            Температура
          </label>
          <div className="relative">
            <input id="offline-temperature" data-testid="offline-temperature" className={`${ui.input} pr-16 ${tempOff ? "border-[#e8a33d]" : ""}`} inputMode="decimal" autoComplete="off" disabled={status !== null} value={temperature} onChange={(event) => setTemperature(event.target.value)} />
            <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[16px] text-[#6f7282]">°C</span>
          </div>
          {tempNorm ? <p className={`mt-1.5 text-[13px] ${tempOff ? "font-medium text-[#7a4a00]" : "text-[#6f7282]"}`}>Норма: {tempNorm}</p> : null}
        </div>
      ) : null}
      {object.humidity ? (
        <div>
          <label className={ui.label} htmlFor="offline-humidity">
            Влажность{isRoom ? "" : " (необязательно)"}
          </label>
          <div className="relative">
            <input id="offline-humidity" data-testid="offline-humidity" className={`${ui.input} pr-16 ${humOff ? "border-[#e8a33d]" : ""}`} inputMode="decimal" autoComplete="off" disabled={status !== null} value={humidity} onChange={(event) => setHumidity(event.target.value)} />
            <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-[16px] text-[#6f7282]">%</span>
          </div>
          {humNorm ? <p className={`mt-1.5 text-[13px] ${humOff ? "font-medium text-[#7a4a00]" : "text-[#6f7282]"}`}>Норма: {humNorm}</p> : null}
        </div>
      ) : null}
      {!isRoom ? (
        <div className="grid grid-cols-2 gap-2">
          {(["service", "repair"] as const).map((value) => (
            <button key={value} type="button" aria-pressed={status === value} className={`${ui.ghost} ${status === value ? "border-[#5566f6] bg-[#eef1ff]" : ""}`} onClick={() => setStatus(status === value ? null : value)}>
              {value === "service" ? "Обслуживание" : "Ремонт"}
            </button>
          ))}
        </div>
      ) : null}
      {needCorrection ? (
        <div>
          <p className={ui.warn}>
            <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden />
            <span>Показание вне нормы. Напишите, что сделали — без этого запись не принимается.</span>
          </p>
          <label className={`${ui.label} mt-3`} htmlFor="offline-object-correction">
            Что сделали
          </label>
          <textarea id="offline-object-correction" data-testid="offline-object-correction" className={`${ui.input} h-24 py-3`} maxLength={300} value={correction} onChange={(event) => setCorrection(event.target.value)} />
        </div>
      ) : null}
      {error ? <p className={ui.error} role="alert">{error}</p> : null}
      <button type="submit" className={ui.primary} disabled={saving}>
        {saving ? "Сохраняем…" : "Сохранить"}
      </button>
    </form>
  );
}
