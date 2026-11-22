"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Check, Loader2, RotateCcw, Upload } from "lucide-react";
import { toast } from "sonner";
import {
  BUILDING_ICON_LIBRARY,
  BUILDING_ICON_MAX_BYTES,
  BUILDING_ICON_UPLOAD_SIZE,
  parseBuildingIcon,
  type BuildingIconKey,
} from "@/lib/building-icons";
import { cn } from "@/lib/utils";
import { BuildingIcon } from "@/components/layout/building-icon";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const SOFT_BUTTON =
  "inline-flex h-10 items-center gap-2 rounded-2xl bg-[var(--app-veil)] px-4 text-[14px] font-medium text-[#0b1024] transition-colors duration-150 hover:bg-[var(--app-veil-hover)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 disabled:opacity-60";

/**
 * Растровую картинку браузер ужимает до квадрата 128px (PNG): в списке
 * значок 18–36px, а сервер принимает только PNG и SVG. SVG уходит как есть —
 * сервер его очищает.
 */
async function prepareIconFile(file: File): Promise<Blob> {
  if (file.type === "image/svg+xml" || /\.svg$/i.test(file.name)) return file;
  const bitmap = await createImageBitmap(file);
  const size = BUILDING_ICON_UPLOAD_SIZE;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("canvas");
  const scale = Math.min(size / bitmap.width, size / bitmap.height);
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  context.drawImage(bitmap, Math.round((size - width) / 2), Math.round((size - height) / 2), width, height);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("toBlob"))), "image/png"),
  );
}

/**
 * Значок объекта на странице объекта (владелец, 2026-11-22): типовой из
 * библиотеки или свой файл; «Как было» — значок по виду объекта. Видно его в
 * листе и меню «Объекты» и в полосе текущего объекта.
 */
export function BuildingIconPicker({
  buildingId,
  icon,
  office = false,
  readOnly = false,
}: {
  buildingId: string;
  icon: string | null;
  office?: boolean;
  readOnly?: boolean;
}) {
  const t = useTranslations("settingsManagement.points.icon");
  // Перенос по слогам в подписях плиток — по языку человека.
  const locale = useLocale();
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const current = parseBuildingIcon(icon);
  const currentLabel =
    current?.kind === "library" ? t(`library.${current.key}`) : current?.kind === "upload" ? t("custom") : office ? t("defaultOffice") : t("default");

  async function finish(response: Response) {
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) throw new Error(data.error ?? t("failed"));
    toast.success(t("saved"));
    setOpen(false);
    // Значок — ещё и в шапке и в листе «Объекты»: обновляем всю разметку.
    startTransition(() => router.refresh());
  }

  async function choose(key: BuildingIconKey | null) {
    setBusy(key ?? "reset");
    try {
      await finish(
        await fetch(`/api/settings/buildings/${buildingId}/icon`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ icon: key }),
        }),
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("failed"));
    } finally {
      setBusy(null);
    }
  }

  async function upload(file: File) {
    setBusy("upload");
    try {
      const prepared = await prepareIconFile(file);
      if (prepared.size > BUILDING_ICON_MAX_BYTES) throw new Error(t("tooLarge"));
      const form = new FormData();
      form.append("file", prepared, prepared === file ? file.name : "icon.png");
      await finish(await fetch(`/api/settings/buildings/${buildingId}/icon`, { method: "POST", body: form }));
    } catch (error) {
      toast.error(error instanceof Error && error.message !== "canvas" && error.message !== "toBlob" ? error.message : t("failed"));
    } finally {
      setBusy(null);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  return (
    <div className="flex items-center gap-3" data-building-icon-picker>
      <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-[var(--app-veil)] text-[#3848c7]">
        <BuildingIcon icon={icon} office={office} className="size-6" uploadClassName="size-9" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[12.5px] text-[#6f7282]">{t("title")}</span>
        <span className="block truncate text-[14.5px] text-[#0b1024]">{currentLabel}</span>
      </span>
      {readOnly ? null : (
        <button type="button" className={SOFT_BUTTON} onClick={() => setOpen(true)} data-building-icon-open>
          {t("change")}
        </button>
      )}
      <Dialog open={open} onOpenChange={(value) => (busy ? null : setOpen(value))}>
        <DialogContent className="sm:max-w-[520px]">
          {/* Слева и с полем под крестик: по центру подпись заезжала под него. */}
          <DialogHeader className="pr-12 text-left">
            <DialogTitle>{t("dialogTitle")}</DialogTitle>
            <DialogDescription>{t("dialogHint")}</DialogDescription>
          </DialogHeader>
          <div
            role="radiogroup"
            aria-label={t("dialogTitle")}
            className="no-mobile-shrink grid grid-cols-4 gap-2 sm:grid-cols-5"
            data-building-icon-library
          >
            {BUILDING_ICON_LIBRARY.map(({ key }) => {
              const selected = current?.kind === "library" && current.key === key;
              return (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  disabled={busy !== null}
                  onClick={() => void choose(key)}
                  data-building-icon-option={key}
                  className={cn(
                    "relative flex min-h-[76px] flex-col items-center justify-center gap-1.5 rounded-2xl px-1.5 py-2 text-center transition-colors duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 disabled:opacity-60",
                    selected
                      ? "border border-[#5566f6] bg-[#f5f6ff] text-[#3848c7]"
                      : "bg-[var(--app-veil)] text-[#3c4053] hover:bg-[var(--app-veil-hover)]",
                  )}
                >
                  {busy === key ? (
                    <Loader2 className="size-5 animate-spin" aria-hidden />
                  ) : (
                    <BuildingIcon icon={key} className="size-5" />
                  )}
                  <span className="line-clamp-2 w-full text-[11px] leading-tight hyphens-auto [overflow-wrap:anywhere]" lang={locale}>
                    {t(`library.${key}`)}
                  </span>
                  {selected ? <Check className="absolute top-1.5 right-1.5 size-3.5" aria-hidden /> : null}
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileInput}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              className="sr-only"
              aria-label={t("upload")}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void upload(file);
              }}
              data-building-icon-file
            />
            <button type="button" className={SOFT_BUTTON} disabled={busy !== null} onClick={() => fileInput.current?.click()}>
              {busy === "upload" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Upload className="size-4" aria-hidden />}
              {t("upload")}
            </button>
            {current ? (
              <button type="button" className={SOFT_BUTTON} disabled={busy !== null} onClick={() => void choose(null)} data-building-icon-reset>
                {busy === "reset" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <RotateCcw className="size-4" aria-hidden />}
                {t("reset")}
              </button>
            ) : null}
          </div>
          <p className="text-[12.5px] leading-[1.45] text-[#6f7282]">{t("uploadHint")}</p>
        </DialogContent>
      </Dialog>
    </div>
  );
}
