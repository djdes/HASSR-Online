"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ImagePlus, Loader2, Trash2, Upload } from "lucide-react";
import { prepareLogo } from "@/components/partner/logo-uploader";
import { LOGO_MAX_BYTES } from "@/lib/partners/validation";

/**
 * Логотип организации файлом — для меню слева. PNG/JPG браузер ужимает
 * и переводит в PNG (`prepareLogo`), SVG сервер проверяет и очищает.
 */
export function OrgLogoUpload({
  url,
  onChange,
}: {
  url: string | null;
  onChange: (url: string | null) => void;
}) {
  const t = useTranslations("settingsManagement.organizationProfile");
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function upload(file: File) {
    setBusy(true);
    try {
      const prepared = await prepareLogo(file);
      if (prepared.size > LOGO_MAX_BYTES) throw new Error(t("form.logoFailed"));
      const form = new FormData();
      form.set("file", prepared, prepared.name);
      const response = await fetch("/api/settings/organization/logo", { method: "POST", body: form });
      const data = await response.json().catch(() => null);
      if (!response.ok || typeof data?.logoUrl !== "string") {
        throw new Error(data?.error ?? t("form.logoFailed"));
      }
      onChange(data.logoUrl);
      toast.success(t("form.logoUploaded"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("form.logoFailed"));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  async function remove() {
    setBusy(true);
    try {
      const response = await fetch("/api/settings/organization/logo", { method: "DELETE" });
      if (!response.ok) throw new Error(t("form.logoFailed"));
      onChange(null);
      toast.success(t("form.logoRemoved"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("form.logoFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3" data-org-logo>
      <div className="flex h-16 w-[200px] items-center justify-center rounded-2xl border border-dashed border-[#dcdfed] bg-white p-2">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url}
            alt={t("form.preview")}
            className="max-h-full max-w-full object-contain"
            referrerPolicy="no-referrer"
          />
        ) : (
          <ImagePlus className="size-6 text-[#c7ccea]" aria-hidden />
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => input.current?.click()}
          className="inline-flex h-10 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 disabled:opacity-60"
        >
          {busy ? (
            <Loader2 className="size-4 animate-spin text-[#5566f6]" />
          ) : (
            <Upload className="size-4 text-[#5566f6]" />
          )}
          {url ? t("form.logoReplace") : t("form.logoUpload")}
        </button>
        {url ? (
          <button
            type="button"
            disabled={busy}
            onClick={remove}
            aria-label={t("form.logoRemove")}
            title={t("form.logoRemove")}
            className="inline-flex size-10 items-center justify-center rounded-2xl text-[#9b9fb3] transition-colors duration-150 hover:bg-[#fff4f2] hover:text-[#a13a32] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 disabled:opacity-60"
          >
            <Trash2 className="size-4" />
          </button>
        ) : null}
      </div>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/svg+xml,.png,.jpg,.jpeg,.webp,.svg"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void upload(file);
        }}
      />
    </div>
  );
}
