"use client";

import { Camera, Loader2, X } from "lucide-react";
import { useRef, useState } from "react";

import { compressImageIfWorthwhile } from "@/lib/image-compress";
import {
  holdQueuedPhoto,
  isQueuedPhotoMark,
  queuedPhotoPreview,
  releaseQueuedPhoto,
} from "@/components/journals/queued-photos";

/**
 * Поле «фото» для журналов.
 *
 * Зачем: по `journal-specs.ts` четыре журнала требуют фото
 * (`pest_control`, `product_writeoff`, `equipment_calibration`,
 * `accident_journal`) и ещё одиннадцать его рекомендуют — но типа поля
 * `photo` не существовало ни в `DynamicForm`, ни в `TaskFormField`.
 * В `/mini/claim` бейдж «Требуется фото» был вовсе декоративным: за ним
 * не стояло загрузчика.
 *
 * Снимок сжимается на клиенте перед отправкой (повар снимает 3-4 МБ, а
 * связь на кухне сотовая) и уходит в тот же `/api/mini/attachments`,
 * что и вложения Mini App — эндпоинту достаточно обычной сессии, он не
 * привязан к Telegram.
 *
 * Значение поля — строка с URL'ами через `\n`: так оно переживает
 * `TaskFormValues`, где допустимы только строка, число и булево.
 */
export const PHOTO_VALUE_SEPARATOR = "\n";

/** Те же ограничения, что на сервере (`/api/mini/attachments`). */
export const PHOTO_MAX_BYTES = 5 * 1024 * 1024;
export const PHOTO_ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];
export const PHOTO_RULES_HINT = "JPG, PNG или WebP, не больше 5 МБ";

/**
 * Проверка снимка ДО отправки. Раньше её не было вовсе: человек ждал
 * загрузку восьмимегабайтного кадра по сотовой связи, чтобы в конце
 * получить отказ. Тексты — те же, что отдаёт сервер, чтобы правило
 * звучало одинаково, откуда бы ни пришло.
 */
export function checkPhotoBeforeUpload(file: File): string | null {
  // Снимок с камеры иногда приходит без mime-типа — не придираемся.
  if (file.type && !PHOTO_ALLOWED_TYPES.includes(file.type)) {
    return "Подойдут JPG, PNG или WebP";
  }
  if (file.size > PHOTO_MAX_BYTES) {
    return "Фото больше 5 МБ — сожмите или снимите заново";
  }
  return null;
}

export function parsePhotoValue(raw: unknown): string[] {
  if (typeof raw !== "string" || raw.trim() === "") return [];
  return raw.split(PHOTO_VALUE_SEPARATOR).map((item) => item.trim()).filter(Boolean);
}

export function PhotoField({
  label,
  value,
  onChange,
  required = false,
  disabled = false,
  hint,
  offlineFallback = false,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  required?: boolean;
  disabled?: boolean;
  hint?: string;
  /**
   * Разрешить оставить снимок на устройстве, когда связи нет, и
   * догрузить его вместе с записью из очереди. Включается только в
   * кабинете (`/mini`): на дашборде очереди нет, и метка вместо адреса
   * уехала бы в журнал как строка «queued-photo:…».
   */
  offlineFallback?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const urls = parsePhotoValue(value);

  async function upload(file: File) {
    // Сначала — правила, потом сеть. Ждать загрузку ради отказа незачем.
    const problem = checkPhotoBeforeUpload(file);
    if (problem) {
      setError(problem);
      return;
    }
    setUploading(true);
    setError(null);
    // Объявлено снаружи try: если отправка упадёт, в офлайн-очередь
    // должен уехать тот же сжатый файл, а не исходник на 8 мегабайт.
    let compressedOrOriginal: Blob | null = null;
    try {
      const compressed = await compressImageIfWorthwhile(file);
      compressedOrOriginal = compressed ?? file;
      const form = new FormData();
      form.append("file", compressed ?? file);

      const response = await fetch("/api/mini/attachments", {
        method: "POST",
        body: form,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.url) {
        setError(data?.error || "Не удалось загрузить фото");
        return;
      }
      onChange([...urls, String(data.url)].join(PHOTO_VALUE_SEPARATOR));
    } catch {
      // Сюда попадаем, когда промис fetch отклонён, то есть связи нет.
      // Раньше снимок на этом просто пропадал, а в журналах с
      // обязательным фото пропадала и вся запись: без снимка форма не
      // отправляется. Теперь держим снимок на устройстве и грузим его
      // вместе с записью, когда связь вернётся.
      if (offlineFallback) {
        const mark = holdQueuedPhoto(compressedOrOriginal ?? file);
        onChange([...urls, mark].join(PHOTO_VALUE_SEPARATOR));
        setError(null);
        return;
      }
      setError("Нет связи — попробуйте ещё раз");
    } finally {
      setUploading(false);
    }
  }

  function removeAt(index: number) {
    const removed = urls[index];
    // Удерживаемый снимок отпускаем сразу: иначе он останется в памяти
    // страницы до перезагрузки, хотя человек его уже убрал.
    if (removed && isQueuedPhotoMark(removed)) releaseQueuedPhoto(removed);
    onChange(
      urls.filter((_, i) => i !== index).join(PHOTO_VALUE_SEPARATOR)
    );
  }

  const missing = required && urls.length === 0;

  return (
    <div className="min-w-0">
      <div className="mb-1 flex items-center gap-2">
        <span className="text-[12px] font-medium text-[#6f7282]">{label}</span>
        {required ? (
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
              missing
                ? "bg-[#fff4f2] text-[#a13a32]"
                : "bg-[#ecfdf5] text-[#116b2a]"
            }`}
          >
            {missing ? "обязательно" : "есть"}
          </span>
        ) : null}
      </div>

      {urls.length > 0 ? (
        <div className="mb-2 flex flex-wrap gap-2">
          {urls.map((url, index) => {
            // Снимок, снятый без связи: сервер его ещё не видел, но
            // показать человеку нужно — иначе кажется, что фото
            // пропало, и он снимает второе.
            const pending = isQueuedPhotoMark(url);
            const src = pending ? queuedPhotoPreview(url) : url;
            return (
            <div
              key={`${url}-${index}`}
              className="relative size-20 overflow-hidden rounded-2xl border border-[#ececf4] bg-[#fafbff]"
            >
              {/* Обычный <img>: файлы лежат в /uploads и не проходят через
                  оптимизатор Next, а размер тут фиксированный. */}
              {src ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={src}
                  alt={`Фото ${index + 1}`}
                  className="size-full object-cover"
                />
              ) : null}
              {pending ? (
                <span className="absolute inset-x-0 bottom-0 bg-[#0b1024]/70 px-1 py-0.5 text-center text-[9px] font-medium text-white">
                  уйдёт со связью
                </span>
              ) : null}
              {!disabled ? (
                <button
                  type="button"
                  aria-label="Удалить фото"
                  onClick={() => removeAt(index)}
                  className="absolute right-1 top-1 flex size-6 items-center justify-center rounded-full bg-[#0b1024]/60 text-white transition-colors hover:bg-[#0b1024]/80"
                >
                  <X className="size-3.5" />
                </button>
              ) : null}
            </div>
            );
          })}
        </div>
      ) : null}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={async (event) => {
          const file = event.target.files?.[0];
          if (file) await upload(file);
          if (inputRef.current) inputRef.current.value = "";
        }}
      />

      <button
        type="button"
        disabled={disabled || uploading}
        onClick={() => inputRef.current?.click()}
        className={`inline-flex h-12 items-center gap-2 rounded-2xl border px-4 text-[14px] font-medium transition-colors duration-150 disabled:opacity-60 ${
          missing
            ? "border-[#e0857d] bg-[#fff4f2] text-[#a13a32] hover:bg-[#ffe9e5]"
            : "border-[#dcdfed] bg-white text-[#3848c7] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
        }`}
      >
        {uploading ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Camera className="size-4" />
        )}
        {uploading ? "Загружаем…" : urls.length > 0 ? "Ещё фото" : "Снять фото"}
      </button>

      {error ? (
        <div className="mt-1 text-[12px] font-medium text-[#a13a32]">{error}</div>
      ) : (
        // Правило показываем ЗАРАНЕЕ, а не после неудачной отправки.
        <div className="mt-1 text-[12px] text-[#9b9fb3]">
          {hint ? `${hint} · ${PHOTO_RULES_HINT}` : PHOTO_RULES_HINT}
        </div>
      )}
    </div>
  );
}
