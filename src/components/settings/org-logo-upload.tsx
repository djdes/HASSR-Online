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
 * `kind="icon"` — тот же загрузчик для квадратного значка в центре QR.
 */
export function OrgLogoUpload({
  url,
  onChange,
  kind = "logo",
}: {
  url: string | null;
  onChange: (url: string | null) => void;
  /** logo — логотип для меню и документов; icon — квадратный значок для центра QR. */
  kind?: "logo" | "icon";
}) {
  const t = useTranslations("settingsManagement.organizationProfile");
  const isIcon = kind === "icon";
  const endpoint = isIcon ? "/api/settings/organization/qr-icon" : "/api/settings/organization/logo";
  const responseKey = isIcon ? "qrIconUrl" : "logoUrl";
  const labels = isIcon
    ? {
        upload: t("brandingPage.iconUpload"),
        replace: t("brandingPage.iconReplace"),
        remove: t("brandingPage.iconRemove"),
        uploaded: t("brandingPage.iconUploaded"),
        removed: t("brandingPage.iconRemoved"),
        failed: t("brandingPage.iconFailed"),
      }
    : {
        upload: t("form.logoUpload"),
        replace: t("form.logoReplace"),
        remove: t("form.logoRemove"),
        uploaded: t("form.logoUploaded"),
        removed: t("form.logoRemoved"),
        failed: t("form.logoFailed"),
      };
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function upload(file: File) {
    setBusy(true);
    try {
      const prepared = await prepareLogo(file);
      if (prepared.size > LOGO_MAX_BYTES) throw new Error(labels.failed);
      const form = new FormData();
      form.set("file", prepared, prepared.name);
      const response = await fetch(endpoint, { method: "POST", body: form });
      const data = await response.json().catch(() => null);
      if (!response.ok || typeof data?.[responseKey] !== "string") {
        throw new Error(data?.error ?? labels.failed);
      }
      onChange(data[responseKey]);
      toast.success(labels.uploaded);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : labels.failed);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  async function remove() {
    setBusy(true);
    try {
      const response = await fetch(endpoint, { method: "DELETE" });
      if (!response.ok) throw new Error(labels.failed);
      onChange(null);
      toast.success(labels.removed);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : labels.failed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="flex flex-wrap items-center gap-3"
      data-org-logo={isIcon ? undefined : ""}
      data-org-qr-icon={isIcon ? "" : undefined}
    >
      <div
        className={`flex h-16 items-center justify-center rounded-2xl border border-dashed border-[#dcdfed] bg-white p-2 ${
          isIcon ? "w-16" : "w-[200px]"
        }`}
      >
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
          {url ? labels.replace : labels.upload}
        </button>
        {url ? (
          <button
            type="button"
            disabled={busy}
            onClick={remove}
            aria-label={labels.remove}
            title={labels.remove}
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
