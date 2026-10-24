"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { ArrowRight, BadgeCheck, UserPlus } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Онбординг-гейт диалогов «Создание документа».
 *
 * Если в организации ещё нет ни одного активного сотрудника, форму
 * создания показывать бессмысленно: документ создастся без ответственных
 * и без строк (seedEntriesForDocument нечего сидить). Вместо формы —
 * блок как на эталоне haccp-online: что нужно сделать и куда пойти.
 *
 * Используется в create-document-dialog.tsx, cleaning-documents-client.tsx
 * и sanitation-day-documents-client.tsx.
 */
export function CreateDocumentEmptyState({
  className,
  onNavigate,
}: {
  className?: string;
  /** Вызывается при клике по ссылке — чтобы закрыть диалог. */
  onNavigate?: () => void;
}) {
  const t = useTranslations("journalUi.createDocumentEmptyState");
  return (
    <div className={cn("space-y-5", className)}>
      <p className="text-[15px] leading-[1.45] text-[#6f7282]">
        {t("intro")}
      </p>

      <div className="space-y-3 rounded-2xl border border-[#dfe1ec] bg-[#f7f8fd] p-4 sm:p-5">
        <Step
          icon={<BadgeCheck className="size-4" />}
          label={t("step1")}
          text={t("addPosition")}
        />
        <Step
          icon={<UserPlus className="size-4" />}
          label={t("step2")}
          text={t("addEmployee")}
        />
      </div>

      <div className="flex justify-end">
        <Link
          href="/settings/users"
          onClick={onNavigate}
          className={cn(
            "inline-flex h-11 items-center gap-2 rounded-2xl bg-[#5566f6] px-5 text-[15px] font-medium text-white shadow-sm",
            "transition-colors duration-150 hover:bg-[#4a5bf0]",
            "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
          )}
        >
          {t("goToStaff")}
          <ArrowRight className="size-4" />
        </Link>
      </div>
    </div>
  );
}

function Step({
  icon,
  label,
  text,
}: {
  icon: React.ReactNode;
  label: string;
  text: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[#5566f6]/10 text-[#5566f6]">
        {icon}
      </span>
      <span className="text-[15px] leading-[1.35] text-black">
        <span className="font-medium text-[#5566f6]">{label}:</span> {text}
      </span>
    </div>
  );
}
