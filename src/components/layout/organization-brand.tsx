"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Loader2, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { ORG_LOGO_ACCEPT, uploadOrgLogoFile } from "@/components/settings/org-logo-upload";
import type { SidebarOrgIdentity } from "@/lib/sidebar-org-identity";

const FOCUS = "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15";

/** Первые буквы двух слов названия — монограмма вместо логотипа. */
function initialsOf(name: string): string {
  return (
    name
      .replace(/[«»"']/g, "")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word[0]?.toLocaleUpperCase("ru-RU") ?? "")
      .join("") || "W"
  );
}

function Monogram({ name, compact = false }: { name: string; compact?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex shrink-0 items-center justify-center rounded-xl bg-[#eef1ff] font-semibold text-[#3848c7]",
        compact ? "size-8 text-[13px]" : "size-9 text-[14px]",
      )}
    >
      {initialsOf(name)}
    </span>
  );
}

/** Логотип организации в шапке без меню; нет логотипа — монограмма и название. */
export function OrganizationMark({
  logoUrl,
  name,
  compact = false,
}: {
  logoUrl: string | null;
  name: string;
  compact?: boolean;
}) {
  // Битая ссылка на логотип не должна оставлять пустое место — монограмма.
  const [failed, setFailed] = useState(false);
  if (logoUrl && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={logoUrl}
        alt={name}
        className={cn("w-auto object-contain object-left", compact ? "h-7 max-w-[120px]" : "max-h-10 max-w-[200px]")}
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <Monogram name={name} compact={compact} />
      {compact ? null : <span className="truncate text-[15px] font-semibold text-[#0b1024]">{name}</span>}
    </span>
  );
}

/**
 * Шапка меню (эскизы руководителя 2026-10-28): по центру логотип компании,
 * под ним краткое название и ИНН. Логотипа нет — заглушка с инициалами, а
 * руководителю (`admin.full`) ещё и компактная кнопка «Загрузить логотип»:
 * файл уходит сразу, логотип встаёт на место заглушки, кнопка пропадает.
 * Сменить или убрать логотип потом — только в «Фирменном стиле».
 * Общая для сайдбара, листа меню на телефоне и листа меню в Mini App (П-3).
 */
export function OrganizationBrand({
  logoUrl,
  name,
  identity,
  homeHref,
  canEditBranding = false,
  large = false,
  className,
}: {
  logoUrl: string | null;
  /** Название компании: подпись логотипа и инициалы заглушки. */
  name: string;
  /** Под логотипом: краткое название и ИНН (`sidebarOrgIdentity`). */
  identity: SidebarOrgIdentity;
  homeHref: string;
  canEditBranding?: boolean;
  /** Шапка сайдбара (эскиз: «лого крупнее в 2 раза») — логотип до 80 px. */
  large?: boolean;
  className?: string;
}) {
  const t = useTranslations("navigation.shell");
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  // Только что загруженный логотип стоит на месте заглушки, пока страница
  // обновляется; пришёл логотип с сервера — свой больше не нужен.
  const [uploaded, setUploaded] = useState<string | null>(null);
  if (uploaded && logoUrl) setUploaded(null);
  // Битая ссылка на логотип — снова заглушка (и кнопка, если её можно показать).
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const candidate = logoUrl ?? uploaded;
  const logo = candidate && candidate !== failedSrc ? candidate : null;
  const canUpload = canEditBranding && !logo;

  async function upload(file: File) {
    setBusy(true);
    try {
      setUploaded(await uploadOrgLogoFile(file, { failedMessage: t("logoFailed") }));
      toast.success(t("logoUploaded"));
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("logoFailed"));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div
      className={cn("flex flex-col items-center text-center", className)}
      data-organization-brand
      data-has-logo={logo ? "" : undefined}
    >
      <Link
        href={homeHref}
        aria-label={logo ? undefined : name}
        className={cn(
          "flex max-w-full items-center justify-center rounded-2xl transition-opacity duration-150 hover:opacity-90",
          FOCUS,
        )}
      >
        {logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logo}
            alt={name}
            className={cn("w-auto max-w-full object-contain", large ? "max-h-20" : "max-h-14")}
            referrerPolicy="no-referrer"
            onError={() => setFailedSrc(logo)}
          />
        ) : (
          <span
            aria-hidden
            data-logo-placeholder
            className={cn(
              "flex items-center justify-center rounded-2xl bg-[#eef1ff] font-semibold tracking-[-0.02em] text-[#3848c7] ring-1 ring-inset ring-[#5566f6]/10",
              large ? "size-[72px] text-[24px]" : "size-14 text-[20px]",
            )}
          >
            {initialsOf(name)}
          </span>
        )}
      </Link>
      {canUpload ? (
        <>
          <button
            type="button"
            disabled={busy}
            onClick={() => input.current?.click()}
            title={t("uploadLogoHint")}
            data-logo-upload
            className={cn(
              "relative -mt-2.5 inline-flex h-7 items-center gap-1.5 rounded-full border border-[#dcdfed] bg-white px-3 text-[12.5px] font-medium text-[#3848c7] shadow-[0_6px_16px_-10px_rgba(85,102,246,0.55)] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] disabled:opacity-70",
              FOCUS,
            )}
          >
            {busy ? (
              <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden />
            ) : (
              <Upload className="size-3.5 shrink-0" aria-hidden />
            )}
            {busy ? t("logoUploading") : t("uploadLogo")}
          </button>
          <input
            ref={input}
            type="file"
            accept={ORG_LOGO_ACCEPT}
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void upload(file);
            }}
          />
        </>
      ) : null}
      <div className={cn("flex w-full min-w-0 flex-col items-center gap-0.5", canUpload ? "mt-2.5" : "mt-3")}>
        <span
          className={cn(
            "line-clamp-2 font-semibold leading-snug text-[#0b1024] [overflow-wrap:anywhere]",
            large ? "text-[14px]" : "text-[15px]",
          )}
          title={identity.name}
          data-org-short-name
        >
          {identity.name}
        </span>
        {identity.inn ? (
          <span className="text-[12px] leading-tight tracking-[0.02em] text-[#6f7282] tabular-nums" data-org-inn>
            {t("inn", { inn: identity.inn })}
          </span>
        ) : null}
      </div>
    </div>
  );
}
