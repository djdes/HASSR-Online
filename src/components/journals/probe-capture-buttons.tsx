"use client";

import { Bluetooth, Camera, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import {
  isBluetoothProbeSupported,
  readTemperatureFromProbe,
} from "@/lib/bluetooth-probe";
import { compressImageIfWorthwhile } from "@/lib/image-compress";

const ICON_BUTTON_CLASS =
  "flex size-12 shrink-0 items-center justify-center rounded-2xl border border-[#dcdfed] bg-white text-[#3848c7] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 disabled:opacity-50";

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
 */
export function DisplayOcrButton({
  onReading,
  disabled,
}: {
  onReading: (value: number) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function recognize(file: File) {
    setBusy(true);
    // Распознаёт диспетчер (очередь) — это 10–40 секунд, а не мгновенно:
    // без подсказки крутящаяся иконка выглядит как зависание. Тот же тост
    // потом превращается в результат.
    const toastId = toast.loading("Распознаём показание… обычно 10–40 секунд");
    try {
      const compressed = await compressImageIfWorthwhile(file);
      const form = new FormData();
      form.append("photo", compressed ?? file);

      const response = await fetch("/api/ocr/reading", {
        method: "POST",
        body: form,
      });
      const data = await response.json().catch(() => null);

      if (!response.ok) {
        toast.error(data?.error || "Не удалось распознать показание", { id: toastId });
        return;
      }
      if (typeof data?.value !== "number") {
        toast.error("На снимке не видно числа — попробуйте снять ближе", { id: toastId });
        return;
      }
      onReading(data.value);
      toast.success(
        data.confidence === "low"
          ? `Распознано ${data.value} — проверьте, снимок нечёткий`
          : `Распознано: ${data.value}`,
        { id: toastId }
      );
    } catch {
      toast.error("Нет связи — распознавание недоступно", { id: toastId });
    } finally {
      setBusy(false);
    }
  }

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
        aria-label="Снять показание с дисплея"
        title="Сфотографировать дисплей термометра"
        disabled={disabled || busy}
        onClick={() => inputRef.current?.click()}
        className={ICON_BUTTON_CLASS}
      >
        {busy ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Camera className="size-4" />
        )}
      </button>
    </>
  );
}
