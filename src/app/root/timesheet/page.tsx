import { CalendarDays } from "lucide-react";

import { requireRoot } from "@/lib/auth-helpers";
import { isMonthKey, monthKey } from "@/lib/staff-timesheet";
import { loadTimesheet } from "@/lib/staff-timesheet.server";
import { TimesheetBoard } from "./timesheet-board";

export const dynamic = "force-dynamic";

export const metadata = { title: "Табель" };

/**
 * Табель сотрудников платформы (2026-11-11) — по образцу DocsFlow: часы по
 * дням, ставка за час, премия или штраф за период и отметки о выплатах.
 * Только владелец платформы.
 */
export default async function TimesheetPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  await requireRoot();
  const { m } = await searchParams;
  const now = new Date();
  const month = isMonthKey(m) ? m : monthKey(now);
  const people = await loadTimesheet(month);
  return (
    <div className="space-y-6" data-timesheet>
      <div className="flex items-start gap-4">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#3848c7]">
          <CalendarDays className="size-5" />
        </span>
        <div>
          <h1 className="text-[26px] font-semibold tracking-[-0.02em] text-[#0b1024]">Табель</h1>
          <p className="mt-1 max-w-[760px] text-[14px] leading-relaxed text-[#6f7282]">
            Часы по дням, начисление по ставке за час и выплаты. Месяц делится на два периода: 1–15 — аванс, 16–конец — расчёт. В ячейке — часы
            (8 или 7,5) или О — отпуск, Б — больничный, В — выходной.
          </p>
        </div>
      </div>
      <TimesheetBoard month={month} today={monthKey(now) === month ? Number(new Date(now.getTime() + 3 * 3600000).toISOString().slice(8, 10)) : null} todayDate={new Date(now.getTime() + 3 * 3600000).toISOString().slice(0, 10)} people={people} />
    </div>
  );
}
