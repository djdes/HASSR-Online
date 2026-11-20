"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { CalendarClock } from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  extendedOrgTrialEnd,
  ORG_TRIAL_EXTEND_MAX_DAYS,
  ORG_TRIAL_EXTEND_MIN_DAYS,
  type OrgTrialAdminState,
  type OrgTrialAdminView,
} from "@/lib/org-trial-admin";
import { organizationDate } from "./organization-presentation";

/**
 * «Свои 14 дней организации» в карточке клиента (серия B, Р11): срок,
 * состояние, выдачи по аккаунту и подозрения на повторный пробный период.
 * Действия — у кого раздел «Оплаты и тарифы», каждое с подтверждением.
 */

type Action = "extend" | "clear" | "reset_grants";

const STATE_KEYS = {
  trial: "orgTrial.states.trial",
  locked: "orgTrial.states.locked",
  none: "orgTrial.states.none",
  inactive: "orgTrial.states.inactive",
} as const satisfies Record<OrgTrialAdminState, string>;

const STATE_TONE: Record<OrgTrialAdminState, string> = {
  trial: "bg-[#eef6fd] text-[#2f80c9]",
  locked: "bg-[#fff4f2] text-[#a13a32]",
  none: "bg-[#f4f4f6] text-[#5f6170]",
  inactive: "bg-[#f4f4f6] text-[#5f6170]",
};

const ERROR_KEYS = {
  ORG_NOT_FOUND: "errors.organizationMissing",
  ORG_NO_ACCOUNT: "errors.noAccount",
  ORG_TRIAL_NO_MARK: "orgTrial.noMark",
  ORG_TRIAL_INVALID: "orgTrial.daysInvalid",
} as const;

export function OrgTrialControl({ view, canEdit }: { view: OrgTrialAdminView; canEdit: boolean }) {
  const t = useTranslations("rootOrganizationManagement");
  const locale = useLocale();
  const router = useRouter();
  const [days, setDays] = useState("14");
  const [pending, setPending] = useState<Action | null>(null);

  const dayCount = Number(days);
  const daysValid =
    Number.isInteger(dayCount) && dayCount >= ORG_TRIAL_EXTEND_MIN_DAYS && dayCount <= ORG_TRIAL_EXTEND_MAX_DAYS;
  const current = view.trialEndsAt ? new Date(view.trialEndsAt) : null;
  const preview = daysValid ? extendedOrgTrialEnd(current, dayCount, new Date()) : null;

  async function run(action: Action) {
    try {
      const response = await fetch(`/api/root/organizations/${view.organizationId}/org-trial`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "extend" ? { action, days: dayCount } : { action }),
      });
      const data = (await response.json().catch(() => null)) as { errorCode?: unknown } | null;
      if (!response.ok) {
        const code = typeof data?.errorCode === "string" ? data.errorCode : "";
        toast.error(
          Object.hasOwn(ERROR_KEYS, code)
            ? t(ERROR_KEYS[code as keyof typeof ERROR_KEYS])
            : t("orgTrial.failed"),
        );
        return;
      }
      toast.success(t("orgTrial.done"));
      setPending(null);
      router.refresh();
    } catch {
      toast.error(t("orgTrial.failed"));
    }
  }

  const dialog =
    pending === "extend"
      ? {
          title: t("orgTrial.extendTitle", { days: dayCount }),
          description: t("orgTrial.extendDescription", {
            date: preview ? organizationDate(preview, locale, true) : "—",
          }),
          confirm: t("orgTrial.extend"),
        }
      : pending === "clear"
        ? { title: t("orgTrial.clearTitle"), description: t("orgTrial.clearDescription"), confirm: t("orgTrial.clear") }
        : pending === "reset_grants"
          ? { title: t("orgTrial.resetTitle"), description: t("orgTrial.resetDescription"), confirm: t("orgTrial.reset") }
          : null;

  return (
    <div className="rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] md:p-6" data-org-trial-card>
      <div className="flex flex-wrap items-center gap-2 text-[17px] font-semibold tracking-[-0.01em] text-[#0b1024]">
        <CalendarClock className="size-5 text-[#5566f6]" />
        {t("orgTrial.title")}
      </div>

      <dl className="mt-4 grid grid-cols-1 gap-4 text-[14px] sm:grid-cols-3 sm:gap-6">
        <div>
          <dt className="text-[#8a8ea4]">{t("orgTrial.term")}</dt>
          <dd className="mt-1 font-semibold text-[#0b1024]">
            {view.trialEndsAt ? organizationDate(view.trialEndsAt, locale, true) : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-[#8a8ea4]">{t("orgTrial.state")}</dt>
          <dd className="mt-1">
            <span className={`inline-flex rounded-full px-2.5 py-1 text-[12.5px] font-medium ${STATE_TONE[view.state]}`} data-org-trial-state={view.state}>
              {t(STATE_KEYS[view.state])}
            </span>
          </dd>
        </div>
        <div>
          <dt className="text-[#8a8ea4]">{t("orgTrial.grants")}</dt>
          <dd className="mt-1 font-semibold tabular-nums text-[#0b1024]">
            {t("orgTrial.grantsValue", { count: String(view.grantsUsed), max: String(view.grantsMax) })}
          </dd>
        </div>
      </dl>

      <div className="mt-5">
        <div className="text-[13px] font-medium text-[#0b1024]">{t("orgTrial.suspicions")}</div>
        {view.suspicions.length === 0 ? (
          <p className="mt-1 text-[13px] text-[#9b9fb3]">{t("orgTrial.suspicionsEmpty")}</p>
        ) : (
          <ul className="mt-2 divide-y divide-[#f2f3f8] rounded-2xl border border-[#eef0f6] text-[13.5px]">
            {view.suspicions.map((item) => (
              <li key={item.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-2">
                <span className="whitespace-nowrap text-[#8a8ea4]">{organizationDate(item.at, locale, true)}</span>
                <span className={item.ended ? "font-medium text-[#a13a32]" : "font-medium text-[#6f7282]"}>
                  {t(item.ended ? "orgTrial.suspicionEnded" : "orgTrial.suspicionFlag")}
                </span>
                <span className="text-[#0b1024]">
                  {[item.inn ? t("orgTrial.suspicionInn", { inn: item.inn }) : null, item.phoneMatch ? t("orgTrial.suspicionPhone") : null]
                    .filter(Boolean)
                    .join(", ")}
                </span>
                {item.usedByName ? (
                  <span className="text-[#6f7282]">
                    {item.usedByOrganizationId ? (
                      <a className="underline decoration-[#dcdfed] underline-offset-2 hover:text-[#0b1024]" href={`/root/organizations/${item.usedByOrganizationId}`}>
                        {t("orgTrial.suspicionWith", { name: item.usedByName })}
                      </a>
                    ) : (
                      t("orgTrial.suspicionWith", { name: item.usedByName })
                    )}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      {canEdit ? (
        <div className="mt-5 flex flex-wrap items-end gap-3 border-t border-[#eef0f6] pt-5">
          <label className="space-y-1.5">
            <span className="block text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">{t("orgTrial.extendDays")}</span>
            <input
              type="number"
              inputMode="numeric"
              min={ORG_TRIAL_EXTEND_MIN_DAYS}
              max={ORG_TRIAL_EXTEND_MAX_DAYS}
              step={1}
              value={days}
              onChange={(event) => setDays(event.target.value)}
              className="h-10 w-28 rounded-xl border border-[#dcdfed] px-3.5 text-[14px] tabular-nums text-[#0b1024] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
            />
          </label>
          <button
            type="button"
            onClick={() => setPending("extend")}
            disabled={!view.trialEndsAt || !daysValid}
            title={!view.trialEndsAt ? t("orgTrial.noMark") : !daysValid ? t("orgTrial.daysInvalid") : undefined}
            className="inline-flex h-10 items-center rounded-xl bg-[#5566f6] px-4 text-[14px] font-medium text-white transition-colors hover:bg-[#4a5bf0] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t("orgTrial.extend")}
          </button>
          <button
            type="button"
            onClick={() => setPending("clear")}
            disabled={!view.trialEndsAt}
            title={!view.trialEndsAt ? t("orgTrial.noMark") : undefined}
            className="inline-flex h-10 items-center rounded-xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors hover:bg-[#f5f6ff] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t("orgTrial.clear")}
          </button>
          <button
            type="button"
            onClick={() => setPending("reset_grants")}
            disabled={view.grantsUsed === 0}
            className="inline-flex h-10 items-center rounded-xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors hover:bg-[#f5f6ff] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t("orgTrial.reset")}
          </button>
        </div>
      ) : null}

      <ConfirmDialog
        open={dialog !== null}
        onClose={() => setPending(null)}
        onConfirm={() => (pending ? run(pending) : undefined)}
        title={dialog?.title ?? ""}
        description={dialog?.description}
        confirmLabel={dialog?.confirm}
        variant={pending === "extend" ? "info" : "warn"}
      />
    </div>
  );
}
