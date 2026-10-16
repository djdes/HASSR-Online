"use client";

import { useRef, useState } from "react";
import { ImagePlus, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { LOGO_BOX, LOGO_MAX_BYTES, LOGO_PNG_MAX } from "@/lib/partners/validation";
import { btnOutline, readError } from "@/components/partner/ui";
import { cn } from "@/lib/utils";

type Variant = "light" | "dark";

/**
 * Загрузка логотипа партнёра (светлый/тёмный вариант). PNG перед
 * отправкой подгоняется в браузере под 480×128 (2× от коробки 240×64):
 * серверу image-библиотеки недоступны, он проверяет только заголовок.
 * SVG уходит как есть — сервер его санитизирует.
 */
export function LogoUploader({
  variant,
  url,
  onChange,
  title,
  hint,
}: {
  variant: Variant;
  url: string | null;
  onChange: (url: string | null) => void;
  title: string;
  hint: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const dark = variant === "dark";

  async function upload(file: File) {
    setBusy(true);
    try {
      const prepared = await prepareLogo(file);
      if (prepared.size > LOGO_MAX_BYTES) {
        throw new Error("Логотип больше 500 КБ даже после сжатия — уменьшите файл");
      }
      const form = new FormData();
      form.set("variant", variant);
      form.set("file", prepared, prepared.name);
      const res = await fetch("/api/partner/branding/logo", { method: "POST", body: form });
      if (!res.ok) throw new Error(await readError(res, "Не удалось загрузить логотип"));
      const data = (await res.json()) as { url: string };
      onChange(data.url);
      toast.success("Логотип загружен");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось загрузить логотип");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function remove() {
    setBusy(true);
    try {
      const res = await fetch(`/api/partner/branding/logo?variant=${variant}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await readError(res, "Не удалось удалить логотип"));
      onChange(null);
      toast.success("Логотип удалён");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось удалить логотип");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-[#ececf4] bg-[#fafbff] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[14px] font-medium text-[#0b1024]">{title}</div>
          <p className="mt-0.5 text-[12px] leading-[1.5] text-[#6f7282]">{hint}</p>
        </div>
        <div className="flex gap-2">
          <button type="button" className={cn(btnOutline, "h-9 px-3")} disabled={busy} onClick={() => inputRef.current?.click()}>
            {url ? <Upload className="size-4 text-[#5566f6]" /> : <ImagePlus className="size-4 text-[#5566f6]" />}
            {url ? "Заменить" : "Загрузить"}
          </button>
          {url ? (
            <button
              type="button"
              className={cn(btnOutline, "h-9 px-3 text-[#a13a32] hover:border-[#a13a32]/40 hover:bg-[#fff4f2]")}
              disabled={busy}
              onClick={remove}
              aria-label="Удалить логотип"
            >
              <Trash2 className="size-4" />
            </button>
          ) : null}
        </div>
      </div>
      <div
        className={cn(
          "mt-3 flex items-center justify-center rounded-xl border border-dashed p-3",
          dark ? "border-white/20 bg-[#0b1024]" : "border-[#dcdfed] bg-white",
        )}
        style={{ minHeight: LOGO_BOX.height + 24 }}
      >
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url}
            alt=""
            style={{ maxWidth: LOGO_BOX.width, maxHeight: LOGO_BOX.height }}
            className="object-contain"
          />
        ) : (
          <span className={cn("text-[12px]", dark ? "text-white/50" : "text-[#9b9fb3]")}>
            {LOGO_BOX.width}×{LOGO_BOX.height} px · PNG или SVG · до 500 КБ
          </span>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/svg+xml,.png,.svg"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
        }}
      />
    </div>
  );
}

/**
 * PNG больше 480×128 → пропорционально уменьшаем через canvas (прозрачный
 * фон сохраняется). Не-PNG растровые (jpeg/webp) тоже конвертируем в PNG —
 * сервер принимает только PNG и SVG. SVG возвращаем нетронутым.
 */
export async function prepareLogo(file: File): Promise<File> {
  const isSvg = file.type === "image/svg+xml" || /\.svg$/i.test(file.name);
  if (isSvg) return file;
  if (!file.type.startsWith("image/")) throw new Error("Поддерживаются только PNG и SVG");

  const bitmap = await loadImage(file);
  const scale = Math.min(1, LOGO_PNG_MAX.width / bitmap.width, LOGO_PNG_MAX.height / bitmap.height);
  if (scale === 1 && file.type === "image/png") return file;

  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Браузер не поддерживает обработку изображений");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, width, height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("Не удалось подготовить PNG");
  return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".png", { type: "image/png" });
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Не удалось прочитать изображение"));
    };
    img.src = objectUrl;
  });
}
