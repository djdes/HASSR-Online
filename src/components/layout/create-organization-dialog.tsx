"use client";
import { BodyScrollLock } from "@/lib/use-body-scroll-lock";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { CalendarClock, Loader2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { BILLING_PAY_HREF, lastDayBefore } from "@/lib/billing-period";
import { isInsideMobileApp } from "@/lib/mobile-app";
import { ORG_SPHERES } from "@/lib/org-profile";
import { useTariffLimitToast } from "@/lib/billing-limit-toast";
import { postActiveOrganization } from "@/lib/switch-organization";
import { useContentTransition } from "@/components/layout/content-transition";
import { shortSwitchName, showSwitchToast, switchWithReturn, type SwitchSide } from "@/components/layout/switch-toast";

/**
 * Условия создания от сервера (`GET /api/organizations/creation-preview`):
 * займёт оплаченную точку, получит свои 14 дней, останется в пробном периоде
 * аккаунта или отказ с причиной — человек видит это до кнопки «Создать».
 */
type CreationPreview =
  | {
      ok: true;
      mode: "open" | "account_trial" | "paid_point" | "org_trial";
      ownTrial: boolean;
      trialEndsAt: string | null;
      used: number | null;
      limit: number | null;
    }
  | { ok: false; reason: "free_plan" | "trials_used" | "locked_org"; limit: number | null; lockedName: string | null };

/**
 * Модалка «Новая организация».
 *
 * Живёт отдельным файлом, потому что вызывается из двух мест: пункт
 * «+ Добавить организацию» в меню профиля и одноимённая кнопка на
 * `/settings/users`. Форма одна — иначе два экрана начали бы
 * расходиться в полях и текстах.
 */
export function CreateOrganizationDialog({
  currentSphere,
  currentId = null,
  currentName,
  organizationsCount,
  onClose,
}: {
  /** Сфера текущей точки — разумный дефолт для второй такой же. */
  currentSphere: string;
  /** Текущая организация — «Вернуться в «…»» в тосте после создания. */
  currentId?: string | null;
  /** Название текущей организации для подписи чекбокса копирования. */
  currentName: string;
  organizationsCount: number;
  onClose: () => void;
}) {
  const t = useTranslations("layoutUi.createOrganizationDialog");
  const tc = useTranslations("common");
  const tSwitch = useTranslations("navigation.shell.switchToast");
  const tSwitcher = useTranslations("layoutUi.organizationSwitcher");
  const router = useRouter();
  const { refreshAfter } = useContentTransition();

  /** Сторона смены «прежняя ⇄ новая» — как в переключателе меню профиля. */
  const organizationSide = (organization: { id: string; name: string }): SwitchSide => ({
    tag: organization.id,
    go: async () => {
      try {
        await postActiveOrganization(organization.id, tSwitcher("switchFailed"));
        return true;
      } catch (error) {
        toast.error(error instanceof Error ? error.message : tSwitcher("error"));
        return false;
      }
    },
    message: tSwitch("organization", { name: organization.name }),
    returnLabel: tSwitch("returnToOrganization", { name: shortSwitchName(organization.name) }),
  });
  const tariffLimit = useTariffLimitToast();
  const [name, setName] = useState("");
  const [sphere, setSphere] = useState(currentSphere);
  const [copy, setCopy] = useState(true);
  const [saving, setSaving] = useState(false);
  const locale = useLocale();
  const tBilling = useTranslations("common.billing");
  const [preview, setPreview] = useState<CreationPreview | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/organizations/creation-preview")
      .then((response) => (response.ok ? response.json() : null))
      .then((data: CreationPreview | null) => {
        if (alive && data && typeof data.ok === "boolean") setPreview(data);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  const refused = preview && !preview.ok ? preview : null;
  const freeUntil =
    preview?.ok && preview.trialEndsAt
      ? new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", timeZone: "Europe/Moscow" }).format(
          lastDayBefore(new Date(preview.trialEndsAt)),
        )
      : null;
  const previewText = !preview
    ? null
    : !preview.ok
      ? preview.reason === "free_plan"
        ? t("refusedFreePlan")
        : preview.reason === "locked_org"
          ? t("refusedLockedOrg", { name: preview.lockedName ?? "" })
          : t("refusedTrialsUsed", { limit: String(preview.limit ?? 1) })
      : preview.mode === "paid_point" && preview.used !== null && preview.limit !== null
        ? t("previewPaidPoint", { used: String(preview.used), limit: String(preview.limit) })
        : freeUntil && preview.mode === "org_trial"
          ? t("previewOrgTrial", { date: freeUntil })
          : freeUntil && preview.mode === "account_trial"
            ? preview.ownTrial
              ? t("previewOrgTrial", { date: freeUntil })
              : t("previewAccountTrial", { date: freeUntil })
            : null;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (name.trim().length < 2 || saving || refused) return;
    setSaving(true);
    try {
      const response = await fetch("/api/organizations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          sphere,
          // Копируем структуру текущей точки: у сети должности и набор
          // журналов почти всегда одинаковые, и набивать их заново —
          // самая скучная часть открытия второго заведения.
          copyFrom: copy ? "current" : undefined,
        }),
      });
      const data = await response.json().catch(() => null);
      // Новая организация — новая точка тарифа: toast с кнопкой «Выбрать тариф».
      if (!response.ok && tariffLimit(data)) return;
      if (!response.ok) throw new Error(data?.error ?? t("createFailed"));
      onClose();
      // Сервер уже сделал новую организацию активной. Её «Сегодня» — в общем
      // переходе (скелет), тост смены — когда страница пришла (2026-11-12):
      // «Организация «…» создана» и «Вернуться в «прежнюю»».
      const created = { id: String(data?.organizationId ?? ""), name: name.trim() };
      const previous = currentId ? { id: currentId, name: currentName } : null;
      refreshAfter(
        created.id,
        async () => {
          // В адресе — id новой организации: «Вернуться в прежнюю» из тоста не
          // должно открывать её мастер и плашку в прежней организации.
          router.push(`/dashboard?welcome-org=${encodeURIComponent(created.id || "1")}`);
          return true;
        },
        () =>
          showSwitchToast(
            t("created", { name: created.name }),
            previous && created.id
              ? {
                  label: tSwitch("returnToOrganization", { name: shortSwitchName(previous.name) }),
                  onClick: () => switchWithReturn(refreshAfter, organizationSide(previous), organizationSide(created)),
                }
              : null,
          ),
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("error"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-[#0b1024]/40 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <BodyScrollLock />
      <form
        onSubmit={submit}
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-[440px] rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_30px_80px_-30px_rgba(11,16,36,0.5)]"
      >
        <h2 className="text-[18px] font-semibold text-[#0b1024]">
          {t("title")}
        </h2>
        <p className="mt-1 text-[13px] text-[#6f7282]">
          {t("description")}
        </p>

        <label className="mt-4 block">
          <span className="mb-1.5 block text-[13px] font-medium text-[#3c4053]">
            {t("nameLabel")}
          </span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoFocus
            placeholder={t("namePlaceholder")}
            maxLength={200}
            className="h-11 w-full rounded-2xl border border-[#dcdfed] bg-white px-4 text-[15px] text-[#0b1024] placeholder:text-[#9b9fb3] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
          />
        </label>

        <label className="mt-3 block">
          <span className="mb-1.5 block text-[13px] font-medium text-[#3c4053]">
            {t("sphereLabel")}
          </span>
          <select
            value={sphere}
            onChange={(event) => setSphere(event.target.value)}
            className="h-11 w-full rounded-2xl border border-[#dcdfed] bg-white px-4 text-[15px] text-[#0b1024] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
          >
            {ORG_SPHERES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        {currentName ? (
          <label className="mt-3 flex cursor-pointer items-start gap-2.5 rounded-2xl bg-[#f5f6ff] p-3">
            <input
              type="checkbox"
              checked={copy}
              onChange={(event) => setCopy(event.target.checked)}
              className="mt-0.5 size-4 accent-[#5566f6]"
            />
            <span className="text-[13px] leading-snug text-[#3c4053]">
              {t("copyLabel", { name: currentName })}
            </span>
          </label>
        ) : null}

        {previewText ? (
          <div
            data-testid="org-creation-preview"
            data-refused={refused ? "true" : "false"}
            className={
              refused
                ? "mt-3 flex items-start gap-2.5 rounded-2xl border border-[#ffd9a8] bg-[#fffaf0] p-3 text-[13px] leading-snug text-[#7a4a00]"
                : "mt-3 flex items-start gap-2.5 rounded-2xl border border-[#dcdfed] bg-[#fafbff] p-3 text-[13px] leading-snug text-[#3c4053]"
            }
          >
            {refused ? (
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-[#b25e00]" />
            ) : (
              <CalendarClock className="mt-0.5 size-4 shrink-0 text-[#5566f6]" />
            )}
            <span className="min-w-0 flex-1">
              {previewText}
              {refused && !isInsideMobileApp() ? (
                <>
                  {" "}
                  <Link href={BILLING_PAY_HREF} onClick={onClose} className="font-medium text-[#3848c7] underline underline-offset-2">
                    {tBilling("pay")}
                  </Link>
                </>
              ) : null}
            </span>
          </div>
        ) : null}

        <p className="mt-3 text-[12px] text-[#9b9fb3]">
          {t("afterCreate", { count: organizationsCount + 1 })}
        </p>

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-11 items-center rounded-2xl px-4 text-[15px] text-[#6f7282] transition-colors hover:bg-[#f5f6ff]"
          >
            {tc("cancel")}
          </button>
          <button
            type="submit"
            disabled={saving || name.trim().length < 2 || Boolean(refused)}
            className="inline-flex h-11 items-center gap-2 rounded-2xl bg-[#5566f6] px-5 text-[15px] font-medium text-white transition-colors hover:bg-[#4a5bf0] disabled:cursor-not-allowed disabled:bg-[#c9cef7]"
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}
            {t("submit")}
          </button>
        </div>
      </form>
    </div>
  );
}
