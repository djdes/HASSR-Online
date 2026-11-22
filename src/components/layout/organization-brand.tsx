"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ImagePlus, Loader2, Settings2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { ORG_LOGO_ACCEPT, uploadOrgLogoFile } from "@/components/settings/org-logo-upload";
import type { SidebarOrgIdentity } from "@/lib/sidebar-org-identity";
import { BRANDING_SETTINGS_HREF } from "@/components/theme/theme-tiles";

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
 * Загрузка логотипа одним нажатием: выбор файла, отправка, тост, обновление
 * разметки. Общая для значка на плитке логотипа и кнопки в шапке листа меню.
 */
function useLogoUpload(onUploaded?: (url: string) => void) {
  const t = useTranslations("navigation.shell");
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function upload(file: File) {
    setBusy(true);
    try {
      const url = await uploadOrgLogoFile(file, { failedMessage: t("logoFailed") });
      onUploaded?.(url);
      toast.success(t("logoUploaded"));
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("logoFailed"));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  const picker = (
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
  );
  return { busy, pick: () => input.current?.click(), picker };
}

/** Круглая кнопка листа меню — того же вида и размера, что крестик напротив. */
const ROUND_ACTION =
  "flex size-10 shrink-0 items-center justify-center rounded-full bg-[#f5f6ff] text-[#3848c7] transition-colors hover:bg-[#eef1ff] disabled:opacity-70";

/**
 * Кнопка оформления в шапке листа меню на телефоне (владелец, 2026-11-22:
 * «логотип и кнопка загрузки друг на друге — кнопку настройки сбоку»). Стоит
 * слева, напротив крестика: логотипа нет — загрузить, есть — «Фирменный стиль».
 */
export function BrandHeaderAction({ logoUrl, onNavigate }: { logoUrl: string | null; onNavigate?: () => void }) {
  const t = useTranslations("navigation.shell");
  const { busy, pick, picker } = useLogoUpload();
  if (logoUrl) {
    return (
      <Link
        href={BRANDING_SETTINGS_HREF}
        onClick={onNavigate}
        aria-label={t("brandingSettings")}
        title={t("brandingSettings")}
        data-brand-action="settings"
        className={cn(ROUND_ACTION, FOCUS)}
      >
        <Settings2 className="size-[18px]" aria-hidden />
      </Link>
    );
  }
  return (
    <>
      <button
        type="button"
        disabled={busy}
        onClick={pick}
        aria-label={t("uploadLogo")}
        title={t("uploadLogoHint")}
        data-brand-action="upload"
        data-logo-upload
        className={cn(ROUND_ACTION, FOCUS)}
      >
        {busy ? <Loader2 className="size-[18px] animate-spin" aria-hidden /> : <ImagePlus className="size-[18px]" aria-hidden />}
      </button>
      {picker}
    </>
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
  // Только что загруженный логотип стоит на месте заглушки, пока страница
  // обновляется; пришёл логотип с сервера — свой больше не нужен.
  const [uploaded, setUploaded] = useState<string | null>(null);
  if (uploaded && logoUrl) setUploaded(null);
  const { busy, pick, picker } = useLogoUpload(setUploaded);
  // Битая ссылка на логотип — снова заглушка (и кнопка, если её можно показать).
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const candidate = logoUrl ?? uploaded;
  const logo = candidate && candidate !== failedSrc ? candidate : null;
  const canUpload = canEditBranding && !logo;

  return (
    <div
      className={cn("flex flex-col items-center text-center", className)}
      data-organization-brand
      data-has-logo={logo ? "" : undefined}
    >
      {/* Плитка логотипа; у руководителя без логотипа — круглый значок
          загрузки на её углу, а не плашка поверх (владелец, 2026-11-22). */}
      <div className="relative max-w-full">
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
              onClick={pick}
              aria-label={t("uploadLogo")}
              title={t("uploadLogoHint")}
              data-logo-upload
              className={cn(
                "absolute -right-2 -bottom-2 flex size-8 items-center justify-center rounded-full bg-[var(--app-surface,#fff)] text-[#3848c7] shadow-[0_1px_4px_rgba(11,16,36,0.18)] transition-colors duration-150 hover:bg-[#f5f6ff] disabled:opacity-70",
                FOCUS,
              )}
            >
              {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <ImagePlus className="size-4" aria-hidden />}
            </button>
            {picker}
          </>
        ) : null}
      </div>
      <div className="mt-3 flex w-full min-w-0 flex-col items-center gap-0.5">
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
