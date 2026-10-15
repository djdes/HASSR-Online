"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Sparkles, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

type Props = {
  /** Текущий type организации — управляющий шаблоном по умолчанию. */
  orgType: string | null;
  /** Если true — кнопка предложит заодно «заселить демо-сотрудников» */
  showSeedStaff?: boolean;
  /** Текст лейбла, чтобы переиспользовать на разных страницах. */
  label?: string;
};

const TYPE_CODES = ["restaurant", "meat", "dairy", "bakery", "confectionery", "other"] as const;
type TypeCode = typeof TYPE_CODES[number];
function isTypeCode(value: unknown): value is TypeCode {
  return typeof value === "string" && (TYPE_CODES as readonly string[]).includes(value);
}
function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/**
 * Применяет онбординг-пресет: создаёт канонические должности + связи
 * journal-access. Опционально заселяет демо-сотрудников (для пустой
 * новой компании). Идемпотентно: повторное нажатие не дублирует.
 */
export function OnboardingApplyButton({ orgType, showSeedStaff = false, label }: Props) {
  const router = useRouter();
  const t = useTranslations("settingsManagement.onboardingApply");
  const currentTranslations = useRef(t);
  useEffect(() => { currentTranslations.current = t; }, [t]);
  const typeId = useId();
  const [busy, setBusy] = useState(false);
  const [seed, setSeed] = useState(showSeedStaff);
  const [pickedType, setPickedType] = useState<string>(orgType ?? "other");

  const typeLabel = t(`types.${isTypeCode(pickedType) ? pickedType : "other"}`);
  const typeChanged = pickedType !== (orgType ?? "other");

  async function apply() {
    setBusy(true);
    try {
      const res = await fetch("/api/onboarding/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: pickedType,
          updateOrgType: typeChanged,
          seedDemoStaff: seed,
          applyJournalAccess: true,
          // Набор журналов пресет не трогает: он строится от сферы на
          // /settings/journals, и затирать там ручной выбор нельзя.
          applyDisabledJournals: false,
          applyAutoJournals: true,
        }),
      });
      if (!res.ok) {
        toast.error(currentTranslations.current(res.status === 403 ? "errors.forbidden" : res.status === 400 ? "errors.invalid" : res.status === 404 ? "errors.notFound" : "errors.failed"));
        return;
      }
      const data: unknown = await res.json();
      if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Invalid onboarding response");
      const result = data as Record<string, unknown>;
      if (!isCount(result.positionsCreated) || !isCount(result.journalAccessRowsCreated) || (seed && !isCount(result.staffCreated))) throw new Error("Invalid onboarding counts");
      const orgUpd = result.orgUpdated && typeof result.orgUpdated === "object" ? result.orgUpdated as Record<string, unknown> : undefined;
      const autoCodes = orgUpd?.autoJournalCodes;
      if (autoCodes !== undefined && (!Array.isArray(autoCodes) || !autoCodes.every(code => typeof code === "string"))) throw new Error("Invalid automatic journal codes");
      const presetType = isTypeCode(result.type) ? result.type : isTypeCode(pickedType) ? pickedType : "other";
      const feedbackT = currentTranslations.current;
      const values = {
        preset: feedbackT(`types.${presetType}`),
        positions: result.positionsCreated,
        access: result.journalAccessRowsCreated,
        automatic: Array.isArray(autoCodes) ? autoCodes.length : 0,
      };
      toast.success(seed ? feedbackT("successWithStaff", { ...values, staff: result.staffCreated as number }) : feedbackT("success", values));
      router.refresh();
    } catch (err) {
      toast.error(currentTranslations.current(err instanceof TypeError ? "errors.network" : "errors.failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-[#dcdfed] bg-[#f5f6ff] p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#5566f6]/15 text-[#5566f6]">
          <Sparkles className="size-5" />
        </span>
        <div>
          <div className="text-[14px] font-semibold text-[#0b1024]">
            {label ?? t("heading", { preset: typeLabel })}
          </div>
          <div className="mt-0.5 text-[12px] leading-snug text-[#6f7282]">
            {t("description")}
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <label htmlFor={typeId} className="text-[12px] font-medium text-[#3a3f55]">
              {t("companyType")}
            </label>
            <select
              id={typeId}
              value={pickedType}
              onChange={(e) => setPickedType(e.target.value)}
              className="h-8 rounded-lg border border-[#dcdfed] bg-white px-2 text-[12px] text-[#0b1024]"
              disabled={busy}
            >
              {TYPE_CODES.map((k) => (
                <option key={k} value={k}>
                  {t(`types.${k}`)}
                </option>
              ))}
            </select>
            {typeChanged ? (
              <span className="rounded-full bg-[#fff8eb] px-2 py-0.5 text-[11px] text-[#7a4a00]">
                {t("typeChanged")}
              </span>
            ) : null}
          </div>
          {showSeedStaff ? (
            <label className="mt-2 inline-flex cursor-pointer items-center gap-2 text-[12px] text-[#3a3f55]">
              <input
                type="checkbox"
                className="size-4 rounded border-[#dcdfed]"
                checked={seed}
                onChange={(e) => setSeed(e.target.checked)}
              />
              {t("seedStaff")}
            </label>
          ) : null}
        </div>
      </div>
      <Button
        type="button"
        onClick={apply}
        disabled={busy}
        className="h-11 rounded-xl bg-[#5566f6] px-4 text-[13px] font-medium text-white hover:bg-[#4a5bf0]"
      >
        {busy ? (
          <Loader2 className="mr-2 size-4 animate-spin" />
        ) : (
          <Sparkles className="mr-2 size-4" />
        )}
        {busy ? t("applying") : t("apply")}
      </Button>
    </div>
  );
}
