"use client";
import { BodyScrollLock } from "@/lib/use-body-scroll-lock";

import { useCallback, useRef, useState } from "react";
import { Camera, Image as ImageIcon, X, Loader2 } from "lucide-react";
import { haptic } from "./use-haptic";
import { compressImageIfWorthwhile } from "@/lib/image-compress";

export type PhotoFile = {
  url: string;
  filename: string;
  size: number;
};

type Source = "camera" | "gallery";

/** То же ограничение, что у `/api/mini/attachments`. */
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/**
 * Ответ сервера бывает на английском («File too large. Max 5MB.»).
 * Русский текст оттуда пропускаем как есть — он осмысленный
 * (например, про дневной лимит загрузок).
 */
function russianUploadError(status: number, serverText?: string): string {
  if (serverText && /[а-яё]/i.test(serverText)) return serverText;
  if (status === 401) {
    return "Приложение вышло из учётной записи — откройте его заново.";
  }
  if (status === 413 || /too large/i.test(serverText ?? "")) {
    return "Фото слишком большое. Максимум 5 МБ.";
  }
  if (/file type/i.test(serverText ?? "")) {
    return "Можно приложить только фото — JPG, PNG или WebP.";
  }
  if (status === 404) {
    return "Запись не найдена — обновите экран и попробуйте снова.";
  }
  return "Фото не загрузилось. Попробуйте ещё раз.";
}

/**
 * Native bottom-sheet pattern: тап «прикрепить» → sheet с двумя пунктами:
 * камера / галерея. Каждый пункт триггерит свой `<input>` с
 * правильными атрибутами:
 *  - камера   → accept="image/*" capture="environment" (на iOS открывает
 *               сразу заднюю камеру, без галереи).
 *  - галерея  → accept="image/*" без capture (галерея без камеры).
 *
 * iOS Safari и так умеет показывать native action-sheet для одного `<input>`
 * с capture, но (а) не на всех клиентах Telegram WebApp пользовательский
 * выбор работает, и (б) UX без явных подписей хуже на Android. Свой sheet
 * работает одинаково везде.
 *
 * PDF/документ — отдельный пункт умышленно не делаем: API
 * `/api/mini/attachments` whitelistит только image/jpeg|png|webp с cap'ом
 * 5MB. Если пользователь выберет PDF, бэкенд вернёт 400 и пользователь
 * увидит «Upload failed» без объяснения. Лучше не предлагать.
 */
export function PhotoUploader({
  entryId,
  onUploaded,
}: {
  entryId?: string;
  onUploaded?: (photo: PhotoFile) => void;
}) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const upload = useCallback(
    async (file: File) => {
      // Проверяем до отправки: сервер отвечает на это по-английски
      // («Invalid file type. Use JPG, PNG, or WebP.»), и повар видел
      // непонятную строку вместо подсказки.
      if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
        setError("Можно приложить только фото — JPG, PNG или WebP.");
        haptic("error");
        return;
      }
      setUploading(true);
      setError(null);
      try {
        // Client-side compression перед upload. Повар на iPhone снимает
        // 3-4MB JPEG — на cellular из подвала кухни это 5-10s upload,
        // иногда падает по timeout. После сжатия 1600px-side @0.85 файл
        // ~500KB, sub-second upload. Если compress fail (старый браузер,
        // PNG/WebP, файл и так маленький) — отправляем исходный.
        const compressed = await compressImageIfWorthwhile(file);
        const payload = compressed ?? file;

        // Сжатие спасает не всегда (PNG, старый браузер). Лучше сказать
        // про размер сразу, чем ждать отправку ради отказа сервера.
        if (payload.size > MAX_UPLOAD_BYTES) {
          setError(
            `Фото слишком большое — ${(payload.size / 1024 / 1024).toFixed(1)} МБ. Максимум 5 МБ: снимите в меньшем качестве.`
          );
          haptic("error");
          return;
        }

        const form = new FormData();
        form.append("file", payload);
        if (entryId) form.append("entryId", entryId);

        const res = await fetch("/api/mini/attachments", {
          method: "POST",
          body: form,
        });

        const data = await res.json().catch(() => ({ error: "" }));
        if (!res.ok) {
          setError(russianUploadError(res.status, data.error));
          haptic("error");
          return;
        }
        onUploaded?.(data as PhotoFile);
        haptic("success");
      } catch {
        setError("Нет связи — фото не загрузилось. Попробуйте ещё раз.");
        haptic("error");
      } finally {
        setUploading(false);
      }
    },
    [entryId, onUploaded]
  );

  const handleFile =
    (resetRef: React.RefObject<HTMLInputElement | null>) =>
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) await upload(file);
      if (resetRef.current) resetRef.current.value = "";
    };

  function pick(source: Source) {
    haptic("light");
    setSheetOpen(false);
    // setTimeout(0) даёт sheet'у закрыться (иначе нативный picker иногда
    // открывается на фоне исчезающего overlay'я и UX становится дёрганым).
    setTimeout(() => {
      if (source === "camera") cameraRef.current?.click();
      else galleryRef.current?.click();
    }, 50);
  }

  return (
    <div className="flex flex-col gap-1">
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFile(cameraRef)}
        className="hidden"
      />
      <input
        ref={galleryRef}
        type="file"
        accept="image/*"
        onChange={handleFile(galleryRef)}
        className="hidden"
      />

      <button
        type="button"
        onClick={() => {
          haptic("light");
          setSheetOpen(true);
        }}
        disabled={uploading}
        className="mini-press inline-flex items-center gap-2 rounded-xl px-3 py-2 text-[13px] font-medium disabled:opacity-50"
        style={{
          background: "var(--mini-surface-2)",
          border: "1px solid var(--mini-divider-strong)",
          color: "var(--mini-text)",
        }}
      >
        {uploading ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            Загрузка…
          </>
        ) : (
          <>
            <Camera className="size-4" />
            Прикрепить фото
          </>
        )}
      </button>
      {error ? (
        <p className="text-[12px] leading-4" style={{ color: "var(--mini-crimson)" }}>
          {error}
        </p>
      ) : null}

      {sheetOpen ? (
        <div
          className="fixed inset-0 z-[80] flex items-end justify-center bg-black/60 p-3"
          role="dialog"
          aria-modal="true"
          onClick={() => setSheetOpen(false)}
        >
          <BodyScrollLock />
          {/* Лист был всегда тёмным: в светлой теме он выглядел
              чужим окном поверх приложения. */}
          <div
            className="w-full max-w-md rounded-3xl p-3 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.45)]"
            style={{
              background: "var(--mini-surface-1)",
              border: "1px solid var(--mini-divider-strong)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 flex items-center justify-between px-2">
              <div
                className="text-[12px] font-semibold uppercase tracking-[0.16em]"
                style={{ color: "var(--mini-text-muted)" }}
              >
                Источник
              </div>
              <button
                type="button"
                onClick={() => setSheetOpen(false)}
                className="rounded-full p-1.5"
                style={{ color: "var(--mini-text-muted)" }}
                aria-label="Закрыть"
              >
                <X className="size-4" />
              </button>
            </div>
            <SheetItem
              icon={Camera}
              label="Камера"
              hint="Сделать фото прямо сейчас"
              onClick={() => pick("camera")}
            />
            <SheetItem
              icon={ImageIcon}
              label="Галерея"
              hint="Уже снятое фото из библиотеки"
              onClick={() => pick("gallery")}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SheetItem({
  icon: Icon,
  label,
  hint,
  onClick,
}: {
  icon: typeof Camera;
  label: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mini-press flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left"
      style={{ color: "var(--mini-text)" }}
    >
      <span
        className="flex size-10 items-center justify-center rounded-2xl"
        style={{ background: "var(--mini-surface-2)", color: "var(--mini-text)" }}
      >
        <Icon className="size-5" />
      </span>
      <span className="flex flex-col">
        <span className="text-[15px] font-medium">{label}</span>
        <span className="text-[12px]" style={{ color: "var(--mini-text-muted)" }}>
          {hint}
        </span>
      </span>
    </button>
  );
}
