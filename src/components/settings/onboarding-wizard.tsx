"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Check, ArrowRight } from "lucide-react";
import { OnboardingApplyButton } from "@/components/settings/onboarding-apply-button";
import { BulkStaffImport } from "@/components/settings/bulk-staff-import";

type Props = {
  orgType: string;
  orgName: string;
  initialPositionsCount: number;
  initialStaffCount: number;
  tasksflowConnected: boolean;
};

type Step = {
  id: 1 | 2 | 3;
  title: string;
  done: boolean;
  body: React.ReactNode;
};

/**
 * Простой stepper-wizard: 3 пронумерованные карточки. Готовность
 * каждого шага определяется на сервере (initial*) и не пересчитывается
 * клиентом — повторный заход в страницу обновит state. Намеренно нет
 * принудительной последовательности (можно подключить TF до того как
 * добавил сотрудников) — пользователь сам выбирает порядок.
 */
export function OnboardingWizard({
  orgType,
  orgName,
  initialPositionsCount,
  initialStaffCount,
  tasksflowConnected,
}: Props) {
  const t = useTranslations("settingsUi.onboardingWizard");
  const [activeStep, setActiveStep] = useState<1 | 2 | 3>(
    initialPositionsCount > 0
      ? initialStaffCount > 0
        ? tasksflowConnected
          ? 3
          : 3
        : 2
      : 1
  );

  const steps: Step[] = [
    {
      id: 1,
      title: t("step1Title"),
      done: initialPositionsCount > 0,
      body: (
        <OnboardingApplyButton
          orgType={orgType}
          showSeedStaff={initialStaffCount === 0}
          label={t("applyTemplateLabel", { orgType })}
        />
      ),
    },
    {
      id: 2,
      title: t("step2Title"),
      done: initialStaffCount > 0,
      body: (
        <div className="space-y-3">
          <p className="text-[13px] leading-snug text-[#6f7282]">
            {t.rich("step2Body", {
              orgName,
              count: initialStaffCount,
              strong: (chunks) => <strong>{chunks}</strong>,
            })}
          </p>
          <BulkStaffImport />
          <Link
            href="/settings/users"
            className="inline-flex items-center gap-1 text-[12px] text-[#5566f6] hover:underline"
          >
            {t("addManually")}
            <ArrowRight className="size-3" />
          </Link>
        </div>
      ),
    },
    {
      id: 3,
      title: t("step3Title"),
      done: tasksflowConnected,
      body: tasksflowConnected ? (
        <div className="text-[13px] text-[#136b2a]">
          {t("connectedNote")}
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-[13px] leading-snug text-[#6f7282]">
            {t("aboutTasksflow")}
          </p>
          <Link
            href="/settings/integrations/tasksflow"
            className="inline-flex h-11 items-center gap-2 rounded-xl bg-[#5566f6] px-4 text-[13px] font-medium text-white hover:bg-[#4a5bf0]"
          >
            {t("connect")}
            <ArrowRight className="size-4" />
          </Link>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-3">
      {steps.map((s) => (
        <div
          key={s.id}
          className={`rounded-2xl border bg-white p-4 transition-all ${
            s.done
              ? "border-[#c8f0d5] bg-[#ecfdf5]/40"
              : activeStep === s.id
                ? "border-[#5566f6] shadow-[0_8px_24px_-12px_rgba(85,102,246,0.4)]"
                : "border-[#dcdfed]"
          }`}
        >
          <button
            type="button"
            onClick={() => setActiveStep(s.id)}
            className="flex w-full items-center gap-3 text-left"
          >
            <span
              className={`flex size-9 shrink-0 items-center justify-center rounded-full text-[14px] font-semibold ${
                s.done
                  ? "bg-[#c8f0d5] text-[#136b2a]"
                  : activeStep === s.id
                    ? "bg-[#5566f6] text-white"
                    : "bg-[#eef1ff] text-[#5566f6]"
              }`}
            >
              {s.done ? <Check className="size-4" /> : s.id}
            </span>
            <div className="flex-1">
              <div className="text-[15px] font-semibold text-[#0b1024]">
                {s.title}
              </div>
              <div className="text-[12px] text-[#6f7282]">
                {s.done ? t("statusDone") : t("statusTodo")}
              </div>
            </div>
          </button>
          {activeStep === s.id ? (
            <div className="mt-4 border-t border-[#ececf4] pt-4">{s.body}</div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
