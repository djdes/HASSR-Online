"use client";

import { useCallback, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, FlaskConical, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useLocale, useTranslations } from "next-intl";
import { FORMAT_LOCALES, type Locale } from "@/i18n/locales";
import { useContentTransition } from "@/components/layout/content-transition";
import { postActiveOrganization } from "@/lib/switch-organization";
import { shortSwitchName, showSwitchToast, switchWithReturn, type SwitchSide } from "@/components/layout/switch-toast";

/**
 * Полоса «вы в демо» над контентом.
 *
 * Не закрывается: человек должен всегда видеть, что журналы, сотрудники
 * и compliance перед ним — тестовые, общие для всех гостей и что раз в
 * сутки демо ставится заново. Выход один — вернуться в свою организацию;
 * удалить общую демо гость не может.
 *
 * `?welcome-demo=1` — первый показ сразу после входа: баннер тот же,
 * плюс тост смены (единый, `switch-toast.tsx`) с «Вернуться в мою
 * организацию», чтобы переключение не осталось незамеченным.
 */
export function DemoOrgBanner({
  organizationId,
  organizationName,
  nextResetAt,
  homeOrganizationId,
}: {
  /** Сама демо — чтобы из своей организации можно было вернуться обратно. */
  organizationId: string;
  organizationName: string;
  /** Когда демо переустановится. ISO — из server component дату сериализуем строкой. */
  nextResetAt: string | null;
  homeOrganizationId: string;
}) {
  const router = useRouter();
  const t = useTranslations("organizationsUi");
  const tSwitch = useTranslations("navigation.shell.switchToast");
  const locale = useLocale() as Locale;
  const searchParams = useSearchParams();
  const welcome = searchParams.get("welcome-demo") === "1";
  // Выход — общий переход кабинета: скелет, пока не придёт своя организация.
  const { refreshAfter, pendingTag } = useContentTransition();
  const leaving = pendingTag === homeOrganizationId;
  const welcomed = useRef(false);

  /**
   * Своя организация ⇄ демо: тост смены с возвратом. Обе стороны открывают
   * «Сегодня» — страницы демо в своей организации нет.
   */
  const leave = useCallback(() => {
    const open = (id: string) => async () => {
      try {
        await postActiveOrganization(id, t("demoOrgBanner.switchFailed"));
        router.push("/dashboard");
        return true;
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t("demoOrgBanner.error"));
        return false;
      }
    };
    const home: SwitchSide = {
      tag: homeOrganizationId,
      go: open(homeOrganizationId),
      message: t("demoOrgBanner.returned"),
      returnLabel: t("demoOrgBanner.backToMine"),
    };
    const demo: SwitchSide = {
      tag: organizationId,
      go: open(organizationId),
      message: t("demoOrgBanner.welcomeTitle"),
      returnLabel: tSwitch("returnToOrganization", { name: shortSwitchName(organizationName) }),
    };
    switchWithReturn(refreshAfter, home, demo);
  }, [homeOrganizationId, organizationId, organizationName, refreshAfter, router, t, tSwitch]);

  useEffect(() => {
    if (!welcome || welcomed.current) return;
    welcomed.current = true;
    showSwitchToast(t("demoOrgBanner.welcomeTitle"), { label: t("demoOrgBanner.backToMine"), onClick: leave });
    // Параметр из адреса убираем: перезагрузка не должна повторять тост.
    router.replace("/dashboard");
  }, [welcome, router, t, leave]);

  const reset = nextResetAt ? new Date(nextResetAt) : null;
  // Срок в прошлом (cron не отработал) — без даты: демо обновится при входе.
  const resetLabel =
    reset && reset.getTime() > Date.now()
      ? reset.toLocaleString(FORMAT_LOCALES[locale], {
          day: "numeric",
          month: "long",
          hour: "2-digit",
          minute: "2-digit",
        })
      : null;

  return (
    <div className="mx-auto w-full max-w-[1800px] px-4 pt-4 md:px-8">
      <div
        data-testid="demo-org-banner"
        className="rounded-3xl border border-[#dcdfed] bg-[#fafbff] p-4 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] md:p-5"
      >
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <span className="mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#5566f6]">
              <FlaskConical className="size-5" />
            </span>
            <div className="min-w-0">
              <div className="text-[15px] font-semibold text-[#0b1024]">
                {t("demoOrgBanner.title", { name: organizationName })}
              </div>
              <p className="mt-0.5 text-[13px] leading-[1.5] text-[#6f7282]">
                {resetLabel
                  ? t("demoOrgBanner.expiresIn", { date: resetLabel })
                  : t("demoOrgBanner.expiresDefault")}
                {" · "}
                {t("demoOrgBanner.homeSafe")}
              </p>
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap gap-2 md:pl-3">
            <button
              type="button"
              onClick={leave}
              disabled={leaving}
              className="inline-flex h-10 items-center gap-2 rounded-2xl bg-[#5566f6] px-4 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors duration-150 hover:bg-[#4a5bf0] disabled:cursor-not-allowed disabled:bg-[#c9cef7] disabled:shadow-none"
            >
              {leaving ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <ArrowLeft className="size-4" />
              )}
              {t("demoOrgBanner.backToMine")}
            </button>
          </div>
        </div>
      </div>

    </div>
  );
}
