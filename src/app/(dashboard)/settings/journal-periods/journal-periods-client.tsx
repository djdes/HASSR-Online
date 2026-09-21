"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { JournalPeriodKind } from "@/lib/journal-period";

type Item = {
  code: string;
  name: string;
  defaultKind: JournalPeriodKind;
  kind: JournalPeriodKind | null;
  days: number | null;
};

const KIND_LABEL: Record<JournalPeriodKind, string> = {
  monthly: "По месяцу",
  yearly: "По году",
  "half-monthly": "Полумесячный (1–15 / 16–конец месяца)",
  "single-day": "Один день",
  perpetual: "Бессрочный",
  days: "По N дней",
};

export function JournalPeriodsClient({ initial }: { initial: Item[] }) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [saving, setSaving] = useState(false);

  function update(code: string, patch: Partial<Item>) {
    setRows((prev) =>
      prev.map((r) => (r.code === code ? { ...r, ...patch } : r))
    );
  }

  async function save() {
    setSaving(true);
    try {
      const periods: Record<string, { kind: JournalPeriodKind; days?: number }> =
        {};
      for (const r of rows) {
        if (!r.kind) continue;
        if (r.kind === "days") {
          if (!r.days || r.days < 1 || r.days > 31) {
            toast.error(
              `«${r.name}»: для «По N дней» введите число дней 1–31`
            );
            return;
          }
          periods[r.code] = { kind: "days", days: r.days };
        } else {
          periods[r.code] = { kind: r.kind };
        }
      }
      const res = await fetch("/api/settings/journal-periods", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ periods }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        toast.error(d?.error ?? "Не удалось сохранить");
        return;
      }
      const data = (await res.json().catch(() => ({}))) as {
        applied?: Array<{ code: string; action: string }>;
      };
      const updatedEmpty = (data.applied ?? []).filter(
        (a) => a.action === "updated_empty"
      ).length;
      const skipped = (data.applied ?? []).filter(
        (a) => a.action === "skipped_has_entries"
      ).length;
      let msg = "Сохранено";
      if (updatedEmpty > 0) {
        msg += ` · переcreate без потерь: ${updatedEmpty}`;
      }
      if (skipped > 0) {
        msg += ` · с записями (применится со следующего цикла): ${skipped}`;
      }
      toast.success(msg);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      {/* Sticky save bar — всегда виден сверху, не нужно скроллить через 35 строк. */}
      <div className="sticky top-2 z-10 flex items-center justify-between gap-3 rounded-2xl border border-[#ececf4] bg-white/90 px-4 py-2.5 shadow-[0_8px_24px_-12px_rgba(11,16,36,0.18)] backdrop-blur">
        <div className="text-[13px] text-[#6f7282]">
          Изменения применятся к пустым активным документам сразу,
          к заполненным — со следующего цикла.
        </div>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="inline-flex h-10 shrink-0 items-center rounded-2xl bg-[#5566f6] px-5 text-[13.5px] font-medium text-white shadow-[0_10px_26px_-12px_rgba(85,102,246,0.55)] transition-colors hover:bg-[#4a5bf0] disabled:cursor-not-allowed disabled:bg-[#c8cbe0]"
        >
          {saving ? "Сохраняем…" : "Сохранить"}
        </button>
      </div>
    <div className="rounded-3xl border border-[#ececf4] bg-white shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
      <div className="overflow-x-auto">
        <table className="w-full text-[13.5px]">
          <thead className="bg-[#fafbff] text-[12px] font-semibold uppercase tracking-[0.06em] text-[#6f7282]">
            <tr>
              {/* Закреплена: на телефоне таблицу крутят вбок, и без
                  названия непонятно, чей это период. */}
              <th className="sticky left-0 z-10 bg-[#fafbff] px-5 py-3 text-left">
                Журнал
              </th>
              <th className="px-3 py-3 text-left">Период</th>
              <th className="px-3 py-3 text-left w-24">Дней</th>
              <th className="px-3 py-3 text-left">По умолчанию</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const effectiveKind = r.kind ?? r.defaultKind;
              const isDays = r.kind === "days";
              return (
                <tr key={r.code} className="border-t border-[#eef0f6]">
                  <td className="sticky left-0 z-10 bg-white px-5 py-2.5 font-medium text-[#0b1024]">
                    {r.name}
                    <div className="text-[11px] font-normal text-[#9b9fb3]">
                      {r.code}
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <select
                      value={r.kind ?? ""}
                      onChange={(e) =>
                        update(r.code, {
                          kind: (e.target.value || null) as JournalPeriodKind | null,
                        })
                      }
                      className="h-9 rounded-xl border border-[#dcdfed] bg-white px-2 text-[13px] focus:border-[#5566f6] focus:outline-none focus:ring-2 focus:ring-[#5566f6]/15"
                    >
                      <option value="">— по умолчанию —</option>
                      <option value="monthly">{KIND_LABEL.monthly}</option>
                      <option value="half-monthly">
                        {KIND_LABEL["half-monthly"]}
                      </option>
                      <option value="days">{KIND_LABEL.days}</option>
                      <option value="yearly">{KIND_LABEL.yearly}</option>
                      <option value="single-day">
                        {KIND_LABEL["single-day"]}
                      </option>
                      <option value="perpetual">{KIND_LABEL.perpetual}</option>
                    </select>
                  </td>
                  <td className="px-3 py-2.5">
                    {isDays ? (
                      <input
                        type="number"
                        min={1}
                        max={31}
                        value={r.days ?? ""}
                        onChange={(e) => {
                          const n = parseInt(e.target.value, 10);
                          update(r.code, {
                            days: Number.isFinite(n) ? n : null,
                          });
                        }}
                        placeholder="N"
                        className="h-9 w-20 rounded-xl border border-[#dcdfed] bg-white px-2 text-[13px] focus:border-[#5566f6] focus:outline-none focus:ring-2 focus:ring-[#5566f6]/15"
                      />
                    ) : (
                      <span className="text-[#9b9fb3]">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-[12px] text-[#6f7282]">
                    {r.kind ? (
                      <span>
                        Активно: <b>{KIND_LABEL[effectiveKind]}</b>
                      </span>
                    ) : (
                      <span>{KIND_LABEL[r.defaultKind]}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex justify-end border-t border-[#eef0f6] px-5 py-3">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="inline-flex h-10 items-center rounded-2xl bg-[#5566f6] px-5 text-[13.5px] font-medium text-white shadow-[0_10px_26px_-12px_rgba(85,102,246,0.55)] transition-colors hover:bg-[#4a5bf0] disabled:cursor-not-allowed disabled:bg-[#c8cbe0]"
        >
          {saving ? "Сохраняем…" : "Сохранить"}
        </button>
      </div>
    </div>
    </div>
  );
}
