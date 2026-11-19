"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { TriangleAlert } from "lucide-react";

import { BILLING_PAY_HREF } from "@/lib/billing-period";
import { isInsideMobileApp } from "@/lib/mobile-app";
import { cn } from "@/lib/utils";
import {
  EXCHANGE_KINDS,
  isEmptyResult,
  summaryTotals,
  type ExchangeKindResult,
  type ExchangeSummary,
} from "./exchange-api";

/** «создано: 3 · обновлено: 1» — только ненулевые части итога, по порядку. */
export function useResultParts(): (result: ExchangeKindResult) => string[] {
  const t = useTranslations("dashboardUi.directoryExchange.result");
  return (result) => {
    const parts: string[] = [];
    if (result.created > 0) parts.push(t("created", { count: String(result.created) }));
    if (result.updated > 0) parts.push(t("updated", { count: String(result.updated) }));
    if (result.skippedLimit > 0) parts.push(t("skippedLimit", { count: String(result.skippedLimit) }));
    if (result.skippedConflict > 0) parts.push(t("skippedConflict", { count: String(result.skippedConflict) }));
    return parts;
  };
}

/**
 * Часть записей не добавлена из-за тарифа: говорим, что лимиты действуют, и
 * ведём на страницу тарифа. В приложении WeSetup к оплате не зовём (правила
 * сторов) — там только текст.
 */
export function ExchangeLimitNote({ onNavigate, className }: { onNavigate?: () => void; className?: string }) {
  const t = useTranslations("dashboardUi.directoryExchange.result");
  return (
    <div
      className={cn(
        "flex items-start gap-2.5 rounded-2xl border border-[#ffd9a8] bg-[#fffaf0] p-3 text-[13px] leading-snug text-[#7a4a00]",
        className,
      )}
      data-testid="exchange-limit-note"
    >
      <TriangleAlert className="mt-0.5 size-4 shrink-0 text-[#b25e00]" aria-hidden />
      <span className="min-w-0 flex-1">
        {t("limitNote")}
        {isInsideMobileApp() ? null : (
          <>
            {" "}
            <Link
              href={BILLING_PAY_HREF}
              onClick={onNavigate}
              className="font-medium text-[#3848c7] underline underline-offset-2"
            >
              {t("limitLink")}
            </Link>
          </>
        )}
      </span>
    </div>
  );
}

/** Итог обмена или переноса: по организациям и спискам, плюс заметки сервера. */
export function ExchangeSummaryView({ summary }: { summary: ExchangeSummary }) {
  const t = useTranslations("dashboardUi.directoryExchange");
  const parts = useResultParts();
  const changed = summary.organizations.filter(
    (organization) => !isEmptyResult(summaryTotals({ organizations: [organization], notes: [] })),
  );

  return (
    <div className="space-y-3">
      {changed.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-4 py-3 text-[13.5px] leading-[1.5] text-[#3c4053]">
          {t("result.noChanges")}
        </p>
      ) : (
        <ul className="space-y-2">
          {changed.map((organization, index) => (
            <li
              key={`${organization.organizationId}-${index}`}
              className="rounded-2xl border border-[#ececf4] bg-white px-4 py-3"
            >
              <div className="truncate text-[14px] font-semibold text-[#0b1024]">{organization.name}</div>
              <dl className="mt-1.5 space-y-1">
                {EXCHANGE_KINDS.map((kind) => {
                  const result = organization.kinds[kind];
                  if (!result || isEmptyResult(result)) return null;
                  return (
                    <div key={kind} className="flex flex-wrap gap-x-2 text-[13px] leading-snug">
                      <dt className="font-medium text-[#3c4053]">{t(`kinds.${kind}`)}</dt>
                      <dd className="text-[#6f7282]">{parts(result).join(" · ")}</dd>
                    </div>
                  );
                })}
              </dl>
            </li>
          ))}
        </ul>
      )}
      {summary.notes.length > 0 ? (
        <ul className="space-y-1 text-[12.5px] leading-snug text-[#6f7282]">
          {summary.notes.map((note, index) => (
            <li key={index}>{note}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
