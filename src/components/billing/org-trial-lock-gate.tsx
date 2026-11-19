"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useLocale, useTranslations } from "next-intl";
import { ArrowRight, Building2, CalendarClock, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { switchOrganizationAndOpen } from "@/lib/switch-organization";
import { lockBodyScroll, unlockBodyScroll } from "@/lib/use-body-scroll-lock";

const subscribeNever = () => () => undefined;

/**
 * Окно закрытой организации: её бесплатные 14 дней закончились, а оплаченной
 * точки на неё нет (`lib/org-trial.ts`). Показывается всем, кто в ней
 * работает, и не закрывается — иначе сотрудники продолжали бы вести журналы.
 * Тому, кто решает про тариф, — «Добавить точку к тарифу» и «Удалить
 * организацию»; остальным — «обратитесь к руководителю». Перейти в другую
 * организацию аккаунта можно всем (они работают как обычно). На страницах
 * оплаты и настроек организации окна нет — иначе оно закрыло бы сам выход.
 */
export function OrgTrialLockGate({
  name,
  lastDayIso,
  canDecide,
  payHref,
  deleteHref,
  organizations,
  switchHref = null,
  hideOnPaths = [],
}: {
  name: string;
  /** Последний бесплатный день. */
  lastDayIso: string;
  /** Человек решает про тариф: ему оплата и удаление, остальным — объяснение. */
  canDecide: boolean;
  /** null — звать к оплате нельзя (приложение WeSetup, правила сторов) или некому. */
  payHref: string | null;
  /** Страница, где организацию можно удалить, — выход для того, кому она не нужна. */
  deleteHref: string | null;
  /** Остальные организации человека — куда можно перейти. */
  organizations: Array<{ id: string; name: string }>;
  /** Страница со своим переключателем организаций (профиль мини-приложения) — вместо списка. */
  switchHref?: string | null;
  /** Страницы без окна — только тому, кто решает про тариф. */
  hideOnPaths?: string[];
}) {
  const t = useTranslations("billingUi.orgTrialLockGate");
  const locale = useLocale();
  const pathname = usePathname();
  // Портал в <body> есть только в браузере: на сервере и при гидрации — ничего.
  const mounted = useSyncExternalStore(subscribeNever, () => true, () => false);
  const [switching, setSwitching] = useState<string | null>(null);
  const hidden = canDecide && hideOnPaths.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  useEffect(() => {
    if (hidden) return;
    lockBodyScroll();
    return () => unlockBodyScroll();
  }, [hidden]);

  if (!mounted || hidden) return null;

  const date = new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", timeZone: "Europe/Moscow" }).format(
    new Date(lastDayIso),
  );

  async function switchTo(organizationId: string) {
    if (switching) return;
    setSwitching(organizationId);
    try {
      await switchOrganizationAndOpen(organizationId, "/dashboard");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("switchFailed"));
      setSwitching(null);
    }
  }

  return createPortal(
    <div className="pointer-events-auto fixed inset-0 z-[85] flex items-end justify-center bg-[#0b1024]/45 p-0 backdrop-blur-sm sm:items-center sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="org-trial-lock-title"
        data-testid="org-trial-lock-modal"
        className="relative flex max-h-[92vh] w-full max-w-[520px] flex-col overflow-hidden rounded-t-3xl bg-white pb-[env(safe-area-inset-bottom)] shadow-[0_30px_80px_-30px_rgba(11,16,36,0.55)] sm:rounded-3xl sm:pb-0"
      >
        <div className="flex-1 overflow-y-auto px-5 pb-5 pt-6 sm:px-6">
          <div className="flex size-11 items-center justify-center rounded-2xl bg-[#fff4e0] text-[#b25e00]">
            <CalendarClock className="size-5" />
          </div>
          <h2 id="org-trial-lock-title" className="mt-4 text-[20px] font-semibold leading-tight text-[#0b1024]">
            {t("title")}
          </h2>
          <p className="mt-2 text-[14px] leading-[1.55] text-[#3c4053]">
            {t(canDecide ? "lead" : "staffLead", { name, date })}
          </p>
          <p className="mt-2 text-[13px] leading-[1.55] text-[#6f7282]">{t("safe")}</p>

          {payHref ? (
            <Link
              href={payHref}
              data-testid="org-trial-lock-pay"
              className="mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-[#5566f6] px-5 text-[15px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors hover:bg-[#4a5bf0]"
            >
              {t("pay")}
              <ArrowRight className="size-4" />
            </Link>
          ) : null}

          {canDecide && deleteHref ? (
            <Link
              href={deleteHref}
              data-testid="org-trial-lock-delete"
              className="mt-3 inline-flex text-[13px] text-[#6f7282] underline underline-offset-2 transition-colors hover:text-[#0b1024]"
            >
              {t("deleteLink")}
            </Link>
          ) : null}

          {switchHref ? (
            <Link
              href={switchHref}
              className="mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-5 text-[15px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
            >
              <Building2 className="size-4 text-[#6f7282]" />
              {t("switchTitle")}
            </Link>
          ) : null}

          {organizations.length > 0 ? (
            <div className="mt-5">
              <div className="text-[12px] font-medium uppercase tracking-[0.08em] text-[#9b9fb3]">{t("switchTitle")}</div>
              <ul className="mt-2 space-y-1.5">
                {organizations.map((organization) => (
                  <li key={organization.id}>
                    <button
                      type="button"
                      onClick={() => switchTo(organization.id)}
                      disabled={Boolean(switching)}
                      className="flex h-11 w-full items-center gap-2.5 rounded-2xl border border-[#dcdfed] bg-white px-3.5 text-left text-[14px] text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {switching === organization.id ? (
                        <Loader2 className="size-4 shrink-0 animate-spin text-[#5566f6]" />
                      ) : (
                        <Building2 className="size-4 shrink-0 text-[#6f7282]" />
                      )}
                      <span className="min-w-0 flex-1 truncate">{organization.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}
