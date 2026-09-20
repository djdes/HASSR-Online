import type { HeatmapRow } from "@/lib/compliance-heatmap";

type Props = {
  rows: HeatmapRow[];
  days: string[];
};

/**
 * Heatmap-сетка: строки = шаблоны журналов (отсортированы по числу
 * пропусков), колонки = дни. Цвет ячейки:
 *   - зелёный = есть запись (с opacity по count'у);
 *   - красный = пропуск;
 *   - серый = будущий день (на случай если окно расширили).
 *
 * Render — собственный SVG-grid без recharts: 30 шаблонов × 30 дней
 * = 900 div'ов, не нужен heavyweight chart engine.
 */
export function ComplianceHeatmap({ rows, days }: Props) {
  if (rows.length === 0) {
    return (
      <div className="rounded-3xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-6 py-14 text-center">
        <div className="text-[15px] font-medium text-[#0b1024]">
          Нет активных журналов
        </div>
        <p className="mx-auto mt-1.5 max-w-[360px] text-[13px] text-[#6f7282]">
          Включите хотя бы один журнал в /settings/journals — heatmap
          появится автоматически.
        </p>
      </div>
    );
  }

  // Подсветим разделители недель — каждые 7 дней лёгкая чёрточка.
  const startDay = new Date(days[0]).getUTCDay();

  return (
    <section className="rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] md:p-6">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 className="text-[16px] font-semibold tracking-[-0.01em] text-[#0b1024]">
            Карта заполнения журналов
          </h2>
          <p className="mt-0.5 text-[13px] text-[#6f7282]">
            Строки — журналы (сверху самые проблемные), колонки — дни
            ({days.length}-дневное окно).
          </p>
        </div>
        <div className="flex items-center gap-3 text-[12px] text-[#6f7282]">
          <span className="inline-flex items-center gap-1.5">
            <span className="size-3 rounded-sm bg-[#22c55e]" /> заполнено
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-3 rounded-sm bg-[#fda5a5]" /> пропуск
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-3 rounded-sm bg-[#ececf4]" /> будущее
          </span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="border-separate border-spacing-0 text-[12px]">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-white pr-3 text-left font-medium text-[#6f7282]">
                Журнал
              </th>
              {days.map((d, i) => {
                const dt = new Date(d);
                const dayNum = dt.getUTCDate();
                const dayOfWeek = (i + startDay) % 7;
                const isMonday = dayOfWeek === 1;
                return (
                  <th
                    key={d}
                    className={`px-0.5 text-center font-normal text-[10px] tabular-nums text-[#9b9fb3] ${
                      isMonday ? "border-l border-[#ececf4]" : ""
                    }`}
                    title={d}
                  >
                    {dayNum === 1 || i === 0 ? (
                      <span className="text-[#0b1024]">
                        {dt.toLocaleString("ru-RU", { month: "short" })}
                      </span>
                    ) : null}
                    <br />
                    {dayNum}
                  </th>
                );
              })}
              <th className="sticky right-0 z-10 bg-white pl-3 text-right font-medium text-[#6f7282]">
                %
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const past = row.cells.filter((c) => c.status !== "future");
              const filled = past.filter((c) => c.status === "filled").length;
              const pct =
                past.length === 0
                  ? null
                  : Math.round((filled / past.length) * 100);
              const pctColor =
                pct === null
                  ? "#9b9fb3"
                  : pct >= 90
                    ? "#116b2a"
                    : pct >= 60
                      ? "#7a4a00"
                      : "#a13a32";
              return (
                <tr key={row.templateCode}>
                  <td className="sticky left-0 z-10 max-w-[180px] truncate bg-white py-1 pr-3 text-[#0b1024]">
                    <span title={row.templateName}>{row.templateName}</span>
                  </td>
                  {row.cells.map((cell, i) => {
                    const dayOfWeek = (i + startDay) % 7;
                    const isMonday = dayOfWeek === 1;
                    let bg = "#ececf4";
                    if (cell.status === "filled") {
                      // Opacity по count: 1 = 0.6, 5+ = 1.
                      const o = Math.min(1, 0.6 + cell.count * 0.1);
                      bg = `rgba(34, 197, 94, ${o})`;
                    } else if (cell.status === "missed") {
                      bg = "#fda5a5";
                    }
                    return (
                      <td
                        key={cell.date}
                        className={`p-0.5 ${
                          isMonday ? "border-l border-[#ececf4]" : ""
                        }`}
                      >
                        <div
                          className="size-4 rounded-sm transition-transform hover:scale-125"
                          style={{ backgroundColor: bg }}
                          title={`${cell.date}: ${
                            cell.status === "filled"
                              ? `${cell.count} запис(ей)`
                              : cell.status === "missed"
                                ? "пропуск"
                                : "будущее"
                          }`}
                        />
                      </td>
                    );
                  })}
                  <td className="sticky right-0 z-10 bg-white pl-3 text-right text-[12px] font-semibold tabular-nums">
                    <span style={{ color: pctColor }}>
                      {pct === null ? "—" : `${pct}%`}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
