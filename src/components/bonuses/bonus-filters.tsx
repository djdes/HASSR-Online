"use client";

import { useRouter } from "next/navigation";
import { Download } from "lucide-react";
import { useTranslations } from "next-intl";

/**
 * Фильтр периода / сотрудника + кнопка CSV-экспорта
 * (Phase 3, шаг 3.6).
 *
 * Применение фильтра — обычная навигация: при `submit` обновляем
 * query-параметры через `router.replace`, страница перерисовывается
 * с новой выборкой. CSV-кнопка — простая `<a>` с уже посчитанным
 * `exportHref`, чтобы браузер обработал `Content-Disposition`.
 */
export function BonusFilters({
  from,
  to,
  userId,
  employees,
  exportHref,
}: {
  from: string;
  to: string;
  userId: string;
  employees: Array<{ id: string; name: string }>;
  exportHref: string;
}) {
  const t = useTranslations("bonusesUi.bonusFilters");
  const router = useRouter();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const next = new URLSearchParams();
    const fromValue = String(formData.get("from") ?? "");
    const toValue = String(formData.get("to") ?? "");
    const userValue = String(formData.get("user") ?? "");

    if (fromValue) next.set("from", fromValue);
    if (toValue) next.set("to", toValue);
    if (userValue && userValue !== "all") next.set("user", userValue);

    const qs = next.toString();
    router.replace(qs ? `/bonuses?${qs}` : "/bonuses");
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-3 rounded-2xl border border-[#ececf4] bg-white px-4 py-4 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] md:flex-row md:items-end"
    >
      <FilterField label={t("from")}>
        <input
          type="date"
          name="from"
          defaultValue={from}
          max={to}
          className="h-10 w-full rounded-xl border border-[#dcdfed] bg-white px-3 text-[14px] text-[#0b1024] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
        />
      </FilterField>
      <FilterField label={t("to")}>
        <input
          type="date"
          name="to"
          defaultValue={to}
          min={from}
          className="h-10 w-full rounded-xl border border-[#dcdfed] bg-white px-3 text-[14px] text-[#0b1024] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
        />
      </FilterField>
      <FilterField label={t("employee")}>
        <select
          name="user"
          defaultValue={userId}
          className="h-10 w-full rounded-xl border border-[#dcdfed] bg-white px-3 text-[14px] text-[#0b1024] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
        >
          <option value="all">{t("allEmployees")}</option>
          {employees.map((employee) => (
            <option key={employee.id} value={employee.id}>
              {employee.name}
            </option>
          ))}
        </select>
      </FilterField>

      <div className="flex flex-row gap-2 md:ml-auto md:items-end">
        <button
          type="submit"
          className="inline-flex h-10 items-center rounded-xl bg-[#5566f6] px-4 text-[13.5px] font-semibold text-white shadow-[0_8px_24px_-12px_rgba(85,102,246,0.55)] hover:bg-[#4a5bf0]"
        >
          {t("apply")}
        </button>
        <a
          href={exportHref}
          className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-[#dcdfed] bg-white px-4 text-[13.5px] font-medium text-[#0b1024] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
        >
          <Download className="size-3.5" strokeWidth={2.2} />
          {t("downloadCsv")}
        </a>
      </div>
    </form>
  );
}

function FilterField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-1 flex-col gap-1.5">
      <span className="text-[12px] font-medium uppercase tracking-[0.08em] text-[#6f7282]">
        {label}
      </span>
      {children}
    </label>
  );
}
