import Link from "next/link";
import { FileCheck2 } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { ppkBlock, ppkBlockHref } from "@/lib/ppk/registry";
import type { PpkTodaySummary } from "@/lib/ppk/today.server";
import { PpkProgressBar } from "./ppk-progress-bar";

const MAX_ROWS = 3;

/**
 * Плашка «Производственный контроль» на главной руководителя: прогресс программы,
 * ближайшие сроки планов и следующий шаг. Если всё заполнено и сроков нет — не показывается.
 */
export async function PpkTodayCard({ summary }: { summary: PpkTodaySummary }) {
  if (!summary.nextKey && summary.due.length === 0) return null;
  const t = await getTranslations("productionControl");
  const nav = await getTranslations("navigation");

  const status = (daysLeft: number): string => {
    if (daysLeft < 0) return t("today.overdue", { days: String(-daysLeft) });
    if (daysLeft === 0) return t("today.today");
    if (daysLeft === 1) return t("today.tomorrow");
    return t("today.inDays", { days: String(daysLeft) });
  };

  const shown = summary.due.slice(0, MAX_ROWS);
  const hidden = summary.due.length - shown.length;
  const next = summary.nextKey ? ppkBlock(summary.nextKey) : null;
  const progress = t("today.progress", { done: String(summary.done), total: String(summary.total) });

  return (
    <div
      data-ppk-today
      className="rounded-3xl border border-[#ececf4] bg-white p-5 transition-all duration-150 hover:-translate-y-0.5 hover:shadow-[0_8px_24px_-12px_rgba(11,16,36,0.15)]"
    >
      <Link
        href="/production-control"
        className="flex items-center gap-4 rounded-2xl focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
      >
        <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#5566f6]">
          <FileCheck2 className="size-5" aria-hidden />
        </span>
        <h2 className="min-w-0 flex-1 text-[16px] font-semibold tracking-[-0.01em] text-[#0b1024]">
          {t("today.title")}
        </h2>
        <div className="w-28 shrink-0 text-right sm:w-36">
          <p className="text-[13px] font-medium text-[#6f7282]">{progress}</p>
          <PpkProgressBar done={summary.done} total={summary.total} label={progress} className="mt-1.5 h-1.5" />
        </div>
      </Link>
      {shown.length > 0 || next ? (
        <div className="mt-3 space-y-1 pl-[60px] text-[13.5px]">
          {shown.map((item) => (
            <p
              key={`${item.block}:${item.title}:${item.nextDate}`}
              className="text-[#6f7282] [overflow-wrap:anywhere]"
            >
              • {item.title} —{" "}
              <span className={item.daysLeft < 0 ? "font-medium text-[#a13a32]" : "font-medium text-[#8a5a00]"}>
                {status(item.daysLeft)}
              </span>
            </p>
          ))}
          {hidden > 0 ? <p className="text-[#9b9fb3]">{t("today.more", { count: String(hidden) })}</p> : null}
          {next ? (
            <p className="pt-1 text-[#0b1024]">
              <Link
                href={ppkBlockHref(next)}
                className="rounded-md font-medium text-[#5566f6] transition-colors duration-150 hover:text-[#4a5bf0] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
              >
                {t("today.next", { block: nav(`shell.menus.productionControl.items.${next.key}`) })}
              </Link>
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
