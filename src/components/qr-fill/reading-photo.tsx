"use client";

import { useQrFillCopy, useQrFeedback, qrResponseFeedback, type QrFeedback, type QrFillTranslator } from "@/components/qr-fill/qr-fill-presentation";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Camera, Loader2, Lock, RotateCcw, X } from "lucide-react";

import { PhotoLightbox } from "@/components/shared/photo-lightbox";
import { downscaleImageFile } from "@/lib/ai-vision/downscale";
import { type ReadingPhotoPhase } from "@/lib/reading-photo-fixation";
import { formatRecognizedReading, type ReadingMetric } from "@/lib/reading-photos";

/**
 * «Фото» у поля показания в QR-форме холодильника и склада (2026-09-26).
 *
 * На телефоне кнопка сразу открывает камеру (`capture="environment"`), на
 * компьютере — выбор файла. Снимок уменьшается в браузере (~1600 px JPEG),
 * уходит в `/api/qr-fill/reading-photo` и прикрепляется к замеру — ссылку
 * форма пришлёт вместе с сохранением, в журнале фото видно рядом со
 * значением. Так на любом тарифе.
 *
 * Платный тариф (`autofill` из ответа сервера): показание со снимка
 * распознаётся (`/recognize`, 10–40 секунд) и подставляется в поле —
 * пометку «с фото — проверьте» у поля рисует форма. Нечитаемое не
 * выдумывается: поле остаётся как было, подсказка «Не разобрали цифры —
 * введите вручную». Если за время распознавания человек сам ввёл число, его
 * не затираем — предлагаем «Подставить».
 *
 * Бесплатный тариф: фото прикрепляется, вместо автоввода — «Автоввод с
 * фото — на платном тарифе» и ссылка на тарифы (только руководителю).
 *
 * Фотофиксация показаний (2026-09-27): вариант `primary` — главная кнопка
 * формы «Сфотографируйте показание» во всю ширину, пока снимка нет; после
 * снимка — та же карточка, что у маленькой «Фото». Форма узнаёт этап
 * (`onPhaseChange`), чтобы показать поле только с результатом. Компонент один
 * и стоит на одном месте дерева: смена варианта не сбрасывает распознавание.
 */

type Status =
  | { kind: "idle" }
  | { kind: "uploading" }
  | { kind: "recognizing" }
  | { kind: "filled"; value: string }
  | { kind: "kept"; value: string }
  | { kind: "unreadable" }
  | { kind: "paid-only"; tariffsHref: string | null }
  | { kind: "recognize-error"; message: QrFeedback }
  | { kind: "upload-error"; message: QrFeedback };

const OUTLINE_BUTTON =
  "inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[15px] font-semibold text-[#3848c7] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 disabled:cursor-not-allowed disabled:opacity-50";
const SMALL_BUTTON =
  "inline-flex h-11 items-center justify-center gap-1.5 rounded-2xl border border-[#dcdfed] bg-white px-3.5 text-[14px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 disabled:cursor-not-allowed disabled:opacity-50";
const PRIMARY_BUTTON =
  "flex h-16 w-full items-center justify-center gap-2.5 rounded-2xl bg-[#5566f6] px-5 text-[18px] font-semibold text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors duration-150 hover:bg-[#4a5bf0] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/25 disabled:cursor-not-allowed disabled:bg-[#c8cbe0] disabled:shadow-none";

/** Этап для формы: грузим/распознаём — «busy», снимок обработан — «done». */
function phaseOf(status: Status): ReadingPhotoPhase {
  if (status.kind === "uploading" || status.kind === "recognizing") return "busy";
  if (status.kind === "idle" || status.kind === "upload-error") return "idle";
  return "done";
}

/** Подсказка под кнопкой, пока снимка нет. */
function emptyHint(variant: "inline" | "primary", autofill: boolean, required: boolean, t: QrFillTranslator): string {
  if (variant === "primary") {
    const base = autofill
      ? t("photo.primaryAutoHint")
      : t("photo.primaryManualHint");
    return required ? t("photo.requiredPrefix", { hint: base }) : base;
  }
  if (required) return t("photo.requiredHint");
  return autofill ? t("photo.inlineAutoHint") : t("photo.inlineManualHint");
}

/** Черновик «−» морозилки или пустое поле — это ещё не введённое число. */
function isBlankValue(value: string): boolean {
  const text = value.trim();
  return text === "" || text === "-";
}

export function ReadingPhoto({
  kind,
  objectId,
  token,
  employeeId,
  pass,
  metric = "temperature",
  unit = "°C",
  autofill,
  photoUrl,
  onPhotoChange,
  value,
  onRecognized,
  disabledReason = null,
  variant = "inline",
  required = false,
  onPhaseChange,
}: {
  kind: "equipment" | "room";
  objectId: string;
  token: string;
  /** Выбранный в форме сотрудник — сервер проверяет его так же, как при сохранении. */
  employeeId: string;
  /** Пропуск после шага PIN (или null — пропуск в cookie / PIN не нужен). */
  pass: string | null;
  metric?: ReadingMetric;
  unit?: string;
  /** Платный тариф (страница знает заранее; после загрузки решает ответ сервера). */
  autofill: boolean;
  /** Прикреплённое фото — `/uploads/readings/…` или null. */
  photoUrl: string | null;
  onPhotoChange: (url: string | null) => void;
  /** Текущее значение поля: введённое руками за время распознавания не затираем. */
  value: string;
  /** Распознанное число строкой — в поле. */
  onRecognized: (value: string) => void;
  /** Почему кнопка недоступна («Сначала выберите своё имя»); null — доступна. */
  disabledReason?: string | null;
  /** `primary` — главная кнопка формы «Сфотографируйте показание» (пока снимка нет). */
  variant?: "inline" | "primary";
  /** «Фото обязательно» в организации — подсказка у кнопки. */
  required?: boolean;
  /** Этап снимка — форма показывает поле, когда распознавание закончилось. */
  onPhaseChange?: (phase: ReadingPhotoPhase) => void;
}) {
  const { t } = useQrFillCopy();
  const feedback = useQrFeedback();
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [preview, setPreview] = useState<string | null>(null);
  const [viewing, setViewing] = useState(false);
  // Последний снимок: ответ на прежний (переснял, пока распознавали) не применяем.
  const seqRef = useRef(0);
  const valueRef = useRef(value);
  useEffect(() => {
    valueRef.current = value;
  }, [value]);
  useEffect(() => {
    return () => {
      seqRef.current += 1;
    };
  }, []);
  useEffect(() => {
    if (!preview) return;
    return () => URL.revokeObjectURL(preview);
  }, [preview]);

  const busy = status.kind === "uploading" || status.kind === "recognizing";
  const disabled = Boolean(disabledReason);
  const phase = phaseOf(status);
  const onPhaseRef = useRef(onPhaseChange);
  useEffect(() => {
    onPhaseRef.current = onPhaseChange;
  });
  useEffect(() => {
    onPhaseRef.current?.(phase);
  }, [phase]);

  async function recognize(url: string, seq: number) {
    const startValue = valueRef.current;
    setStatus({ kind: "recognizing" });
    try {
      const response = await fetch("/api/qr-fill/reading-photo/recognize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, objectId, token, employeeId, ...(pass ? { pass } : {}), url, metric }),
      });
      const data = await response.json().catch(() => null);
      if (seq !== seqRef.current) return;
      if (response.status === 402) {
        setStatus({ kind: "paid-only", tariffsHref: typeof data?.tariffsHref === "string" ? data.tariffsHref : null });
        return;
      }
      if (!response.ok) {
        setStatus({ kind: "recognize-error", message: qrResponseFeedback(data, "photo.recognizeError") });
        return;
      }
      if (typeof data?.value !== "number" || !Number.isFinite(data.value)) {
        setStatus({ kind: "unreadable" });
        return;
      }
      const text = formatRecognizedReading(data.value);
      const current = valueRef.current;
      // Пока ждали, человек ввёл своё число — не затираем, предлагаем подставить.
      if (current.trim() !== startValue.trim() && !isBlankValue(current)) {
        setStatus({ kind: "kept", value: text });
        return;
      }
      onRecognized(text);
      setStatus({ kind: "filled", value: text });
    } catch {
      if (seq !== seqRef.current) return;
      setStatus({ kind: "recognize-error", message: { key: "photo.recognizeNetworkError" } });
    }
  }

  async function handleFile(file: File) {
    const seq = ++seqRef.current;
    setPreview(URL.createObjectURL(file));
    setStatus({ kind: "uploading" });
    onPhotoChange(null);
    let blob: Blob = file;
    try {
      blob = await downscaleImageFile(file);
    } catch {
      /* браузер не открыл снимок (например, HEIC) — отправим как есть, сервер ответит понятным текстом */
    }
    const form = new FormData();
    form.set("kind", kind);
    form.set("objectId", objectId);
    form.set("token", token);
    form.set("employeeId", employeeId);
    if (pass) form.set("pass", pass);
    form.set("photo", blob, "reading.jpg");
    let data: { url?: string; autofill?: boolean; tariffsHref?: string | null; error?: string } | null = null;
    try {
      const response = await fetch("/api/qr-fill/reading-photo", { method: "POST", body: form });
      data = await response.json().catch(() => null);
      if (seq !== seqRef.current) return;
      if (!response.ok || typeof data?.url !== "string") {
        setPreview(null);
        setStatus({ kind: "upload-error", message: qrResponseFeedback(data, "photo.uploadError") });
        return;
      }
    } catch {
      if (seq !== seqRef.current) return;
      setPreview(null);
      setStatus({ kind: "upload-error", message: { key: "photo.uploadNetworkError" } });
      return;
    }
    onPhotoChange(data.url);
    if (!data.autofill) {
      setStatus({ kind: "paid-only", tariffsHref: data.tariffsHref ?? null });
      return;
    }
    await recognize(data.url, seq);
  }

  function openCamera() {
    if (disabled || busy) return;
    inputRef.current?.click();
  }

  function remove() {
    seqRef.current += 1;
    setPreview(null);
    setStatus({ kind: "idle" });
    onPhotoChange(null);
  }

  const shownUrl = preview ?? photoUrl;
  const fileInput = (
    <input
      ref={inputRef}
      type="file"
      accept="image/*"
      capture="environment"
      className="hidden"
      data-testid="reading-photo-input"
      onChange={(event) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (file) void handleFile(file);
      }}
    />
  );

  if (!shownUrl && variant === "primary") {
    return (
      <div data-testid="reading-photo" data-variant="primary">
        {fileInput}
        <button type="button" onClick={openCamera} disabled={disabled} className={PRIMARY_BUTTON} data-testid="reading-photo-button">
          <Camera className="size-6" />
          {t("photo.capture")}
        </button>
        <p className="mt-2 text-center text-[14px] leading-snug text-[#6f7282]" data-testid="reading-photo-hint">
          {disabledReason ?? emptyHint("primary", autofill, required, t)}
        </p>
        {status.kind === "upload-error" ? (
          <p className="mt-2 text-center text-[14px] leading-snug text-[#a13a32]" role="alert">
            {feedback(status.message)}
          </p>
        ) : null}
      </div>
    );
  }

  if (!shownUrl) {
    return (
      <div className="mt-3" data-testid="reading-photo">
        {fileInput}
        <div className="flex items-center gap-3">
          <button type="button" onClick={openCamera} disabled={disabled} className={OUTLINE_BUTTON} data-testid="reading-photo-button">
            <Camera className="size-5" />
            {t("photo.button")}
          </button>
          <p className={`min-w-0 text-[13px] leading-snug ${required && !disabledReason ? "font-medium text-[#7a4a00]" : "text-[#6f7282]"}`} data-testid="reading-photo-hint">
            {disabledReason ?? emptyHint("inline", autofill, required, t)}
          </p>
        </div>
        {status.kind === "upload-error" ? (
          <p className="mt-2 text-[13px] leading-snug text-[#a13a32]" role="alert">
            {feedback(status.message)}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div
      className="mt-3 rounded-2xl border border-[#ececf4] bg-white p-3 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]"
      data-testid="reading-photo"
      data-status={status.kind}
    >
      {fileInput}
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={() => setViewing(true)}
          aria-label={t("photo.open")}
          className="relative size-14 shrink-0 overflow-hidden rounded-xl border border-[#ececf4] bg-[#fafbff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- снимок из загрузок или blob: превью, не статика */}
          <img src={shownUrl} alt="" className="size-full object-cover" />
          {status.kind === "uploading" ? (
            <span className="absolute inset-0 flex items-center justify-center bg-white/60">
              <Loader2 className="size-5 animate-spin text-[#5566f6]" />
            </span>
          ) : null}
        </button>
        <div className="min-w-0 flex-1" aria-live="polite">
          <div className="text-[14px] font-medium leading-snug text-[#0b1024]">
            {status.kind === "uploading" ? t("photo.uploading") : t("photo.attached")}
          </div>
          <StatusLine status={status} unit={unit} value={value} onApply={(text) => {
            onRecognized(text);
            setStatus({ kind: "filled", value: text });
          }} />
        </div>
      </div>
      <div className="mt-2.5 flex flex-wrap gap-2">
        <button type="button" onClick={openCamera} disabled={disabled || busy} className={SMALL_BUTTON}>
          <RotateCcw className="size-4 text-[#5566f6]" />
          {t("photo.retake")}</button>
        <button type="button" onClick={remove} disabled={status.kind === "uploading"} className={SMALL_BUTTON}>
          <X className="size-4 text-[#6f7282]" />
          {t("photo.remove")}</button>
      </div>
      {viewing
        ? createPortal(<PhotoLightbox url={shownUrl} filename={t("photo.title")} caption={t("photo.title")} onClose={() => setViewing(false)} />, document.body)
        : null}
    </div>
  );
}

function StatusLine({
  status,
  unit,
  value,
  onApply,
}: {
  status: Status;
  unit: string;
  value: string;
  onApply: (value: string) => void;
}) {
  const { t } = useQrFillCopy();
  const feedback = useQrFeedback();
  switch (status.kind) {
    case "recognizing":
      return (
        <p className="mt-0.5 flex items-center gap-1.5 text-[13px] leading-snug text-[#3848c7]" data-testid="reading-photo-status">
          <Loader2 className="size-3.5 shrink-0 animate-spin" />
          {t("photo.recognizing")}
        </p>
      );
    case "filled":
      return (
        <p className="mt-0.5 text-[13px] leading-snug text-[#3848c7]" data-testid="reading-photo-status">
          {value.trim() === status.value
            ? `${t("photo.filled", { value: `${status.value} ${unit}` })} ${t("photo.checkMark")}`
            : t("photo.recognized", { value: `${status.value} ${unit}` })}
        </p>
      );
    case "kept":
      return (
        <p className="mt-0.5 text-[13px] leading-snug text-[#3848c7]" data-testid="reading-photo-status">
          {t("photo.kept", { value: `${status.value} ${unit}` })}{" "}
          <button type="button" onClick={() => onApply(status.value)} className="font-semibold underline underline-offset-2">
            {t("photo.useRecognized")} {status.value}
          </button>
        </p>
      );
    case "unreadable":
      return (
        <p className="mt-0.5 text-[13px] font-medium leading-snug text-[#7a4a00]" data-testid="reading-photo-status">
          {t("photo.unreadable")}
        </p>
      );
    case "paid-only":
      return (
        <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[13px] leading-snug text-[#6f7282]" data-testid="reading-photo-status">
          <Lock className="size-3.5 shrink-0" />
          <span>{t("photo.paidOnly")}</span>
          {status.tariffsHref ? (
            <a href={status.tariffsHref} className="font-semibold text-[#3848c7] underline underline-offset-2" data-testid="reading-photo-tariffs">
              {t("photo.plans")}
            </a>
          ) : null}
        </p>
      );
    case "recognize-error":
      return (
        <p className="mt-0.5 text-[13px] leading-snug text-[#7a4a00]" data-testid="reading-photo-status">
          {feedback(status.message)}
        </p>
      );
    default:
      return null;
  }
}
