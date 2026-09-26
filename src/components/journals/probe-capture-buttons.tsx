"use client";

import { Bluetooth, Camera, Loader2, Lock } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import {
  isBluetoothProbeSupported,
  readTemperatureFromProbe,
} from "@/lib/bluetooth-probe";
import { compressImageIfWorthwhile } from "@/lib/image-compress";
import {
  READING_PHOTO_TEXT,
  formatRecognizedReading,
  type ReadingMetric,
} from "@/lib/reading-photos";

const ICON_BUTTON_CLASS =
  "relative flex size-12 shrink-0 items-center justify-center rounded-2xl border border-[#dcdfed] bg-white text-[#3848c7] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 disabled:opacity-50";

type AutofillStatus = { autofill: boolean; tariffsHref: string | null };

/**
 * Доступен ли автоввод с фото (платный тариф) — один запрос на страницу:
 * кнопок камеры в документе столько, сколько холодильников. Ответ живёт
 * минуту (тариф могли сменить в соседней вкладке); ошибка не кешируется —
 * тогда решает сервер (402 на бесплатном).
 */
const AUTOFILL_STATUS_TTL_MS = 60_000;
let autofillStatusCache: { at: number; promise: Promise<AutofillStatus | null> } | null = null;

function loadAutofillStatus(): Promise<AutofillStatus | null> {
  if (autofillStatusCache && Date.now() - autofillStatusCache.at < AUTOFILL_STATUS_TTL_MS) {
    return autofillStatusCache.promise;
  }
  const promise = fetch("/api/ocr/reading", { cache: "no-store" })
    .then((response) => (response.ok ? response.json() : null))
    .then((data) =>
      data && typeof data.autofill === "boolean"
        ? { autofill: data.autofill as boolean, tariffsHref: typeof data.tariffsHref === "string" ? data.tariffsHref : null }
        : null
    )
    .catch(() => null);
  autofillStatusCache = { at: Date.now(), promise };
  void promise.then((value) => {
    if (!value && autofillStatusCache?.promise === promise) autofillStatusCache = null;
  });
  return promise;
}

/**
 * Кнопка «взять замер со щупа».
 *
 * Рендерится только там, где Web Bluetooth действительно есть (Chrome на
 * Android и десктопах). В Safari и внутри Telegram на iOS его нет, и
 * показывать неработающую кнопку хуже, чем не показывать никакой.
 */
export function BluetoothProbeButton({
  onReading,
  disabled,
}: {
  onReading: (celsius: number) => void;
  disabled?: boolean;
}) {
  const [supported, setSupported] = useState(false);
  const [busy, setBusy] = useState(false);

  // Проверяем после монтирования: на сервере `navigator` нет, и
  // рассинхрон разметки дал бы ошибку гидрации.
  useEffect(() => {
    setSupported(isBluetoothProbeSupported());
  }, []);

  if (!supported) return null;

  return (
    <button
      type="button"
      aria-label="Замер со щупа"
      title="Взять замер с Bluetooth-щупа"
      disabled={disabled || busy}
      onClick={async () => {
        setBusy(true);
        try {
          const result = await readTemperatureFromProbe();
          if (result.ok) {
            onReading(result.celsius);
            toast.success(
              result.deviceName
                ? `${result.celsius} °C — ${result.deviceName}`
                : `Замер: ${result.celsius} °C`
            );
            return;
          }
          if (result.reason === "cancelled") return;
          toast.error(
            result.reason === "timeout"
              ? "Щуп не прислал замер. Поднесите его к продукту и попробуйте снова."
              : "Не удалось связаться со щупом"
          );
        } finally {
          setBusy(false);
        }
      }}
      className={ICON_BUTTON_CLASS}
    >
      {busy ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <Bluetooth className="size-4" />
      )}
    </button>
  );
}

/**
 * Кнопка «сфотографировать дисплей».
 *
 * Снимок уходит в `/api/ocr/reading`, оттуда возвращается распознанное
 * число, и человек его подтверждает обычным сохранением поля. Своими
 * руками цифры с термометра переписывать не нужно — а ошибиться в
 * «-18» против «18» на морозильнике проще, чем кажется.
 *
 * Автоввод с фото — только на платном тарифе (2026-09-26). На бесплатном
 * кнопка камеру не открывает: короткая подсказка «Автоввод с фото — на
 * платном тарифе», руководителю — со ссылкой на тарифы. Сервер проверяет
 * тариф сам (402), так что и без этой подсказки распознавания не будет.
 */
export function DisplayOcrButton({
  onReading,
  disabled,
  metric = "temperature",
}: {
  onReading: (value: number) => void;
  disabled?: boolean;
  /** Какое число нужно с дисплея: у термогигрометра их два. */
  metric?: ReadingMetric;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<AutofillStatus | null>(null);

  // Тариф узнаём заранее: на бесплатном снимок просить незачем.
  useEffect(() => {
    let alive = true;
    void loadAutofillStatus().then((value) => {
      if (alive) setStatus(value);
    });
    return () => {
      alive = false;
    };
  }, []);

  function showPaidOnly(tariffsHref: string | null, id?: string | number) {
    toast.info(READING_PHOTO_TEXT.paidOnly, {
      ...(id !== undefined ? { id } : {}),
      ...(tariffsHref
        ? { action: { label: READING_PHOTO_TEXT.tariffsLink, onClick: () => router.push(tariffsHref) } }
        : {}),
    });
  }

  async function recognize(file: File) {
    setBusy(true);
    // Распознаёт диспетчер (очередь) — это 10–40 секунд, а не мгновенно:
    // без подсказки крутящаяся иконка выглядит как зависание. Тот же тост
    // потом превращается в результат.
    const toastId = toast.loading(READING_PHOTO_TEXT.recognizing);
    try {
      const compressed = await compressImageIfWorthwhile(file);
      const form = new FormData();
      form.append("photo", compressed ?? file);
      form.append("metric", metric);

      const response = await fetch("/api/ocr/reading", {
        method: "POST",
        body: form,
      });
      const data = await response.json().catch(() => null);

      if (response.status === 402) {
        // Тариф сменился, пока страница была открыта, — сервер не распознаёт.
        const tariffsHref = typeof data?.tariffsHref === "string" ? data.tariffsHref : null;
        autofillStatusCache = null;
        setStatus({ autofill: false, tariffsHref });
        showPaidOnly(tariffsHref, toastId);
        return;
      }
      if (!response.ok) {
        toast.error(data?.error || "Не удалось распознать показание", { id: toastId });
        return;
      }
      if (typeof data?.value !== "number") {
        // Нечитаемое не выдумываем: поле как было, число — руками.
        toast.error(READING_PHOTO_TEXT.unreadable, { id: toastId });
        return;
      }
      onReading(data.value);
      const text = formatRecognizedReading(data.value);
      toast.success(
        data.confidence === "low"
          ? `Распознано ${text} ${READING_PHOTO_TEXT.checkMark}, снимок нечёткий`
          : `Распознано ${text} ${READING_PHOTO_TEXT.checkMark}`,
        { id: toastId }
      );
    } catch {
      toast.error("Нет связи — распознавание недоступно", { id: toastId });
    } finally {
      setBusy(false);
    }
  }

  const paidOnly = status !== null && !status.autofill;

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={async (event) => {
          const file = event.target.files?.[0];
          if (file) await recognize(file);
          if (inputRef.current) inputRef.current.value = "";
        }}
      />
      <button
        type="button"
        aria-label={paidOnly ? `Снять показание с дисплея — ${READING_PHOTO_TEXT.paidOnly.toLowerCase()}` : "Снять показание с дисплея"}
        title={paidOnly ? READING_PHOTO_TEXT.paidOnly : "Сфотографировать дисплей термометра — число заполнится само"}
        data-testid="display-ocr-button"
        data-autofill={status === null ? "unknown" : status.autofill ? "paid" : "free"}
        disabled={disabled || busy}
        onClick={() => {
          if (status && !status.autofill) {
            showPaidOnly(status.tariffsHref);
            return;
          }
          // Тариф ещё не известен — камеру открываем сразу (иначе браузер
          // может не дать открыть выбор файла после ожидания), решит сервер.
          inputRef.current?.click();
        }}
        className={ICON_BUTTON_CLASS}
      >
        {busy ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Camera className="size-4" />
        )}
        {paidOnly && !busy ? (
          <span className="absolute -bottom-1 -right-1 flex size-[18px] items-center justify-center rounded-full bg-white text-[#6f7282] ring-1 ring-[#dcdfed]">
            <Lock className="size-2.5" />
          </span>
        ) : null}
      </button>
    </>
  );
}
