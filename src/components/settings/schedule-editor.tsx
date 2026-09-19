"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RotateCcw, Save, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { confirmAsync } from "@/components/ui/confirm-async";
import { pluralRu } from "@/lib/plural-ru";
import { cn } from "@/lib/utils";

type ShiftStatus = "scheduled" | "off" | "vacation" | "sick" | "none";

type UserRow = {
  id: string;
  name: string;
  role: string;
  jobPositionId: string | null;
  jobPositionName: string | null;
  categoryKey: string | null;
};

type Position = {
  id: string;
  name: string;
  categoryKey: string;
};

type ShiftCell = {
  userId: string;
  date: string;
  status: string;
  jobPositionId: string | null;
};

type Props = {
  startYmd: string;
  endYmd: string;
  users: UserRow[];
  positions: Position[];
  shifts: ShiftCell[];
};

const STATUS_CYCLE: ShiftStatus[] = [
  "none",
  "scheduled",
  "off",
  "vacation",
  "sick",
];

const STATUS_LABEL: Record<ShiftStatus, string> = {
  none: "",
  scheduled: "С",
  off: "В",
  vacation: "От",
  sick: "Б",
};

const STATUS_TITLE: Record<ShiftStatus, string> = {
  none: "Не запланирован — авто-назначений не будет",
  scheduled: "На смене",
  off: "Выходной",
  vacation: "Отпуск",
  sick: "Больничный",
};

const STATUS_COLOR: Record<ShiftStatus, string> = {
  none: "bg-white border-[#dcdfed] text-[#9b9fb3]",
  scheduled:
    "bg-[#ecfdf5] border-[#7cf5c0] text-[#136b2a] font-semibold",
  off: "bg-[#f5f6ff] border-[#dcdfed] text-[#6f7282]",
  vacation: "bg-[#eef1ff] border-0 bg-[#5566f6]/[0.04] text-[#5566f6]",
  sick: "bg-[#fff4f2] border-[#ffd2cd] text-[#a13a32]",
};

function cellKey(userId: string, date: string) {
  return `${userId}:${date}`;
}

export function ScheduleEditor({
  startYmd,
  endYmd,
  users,
  positions,
  shifts,
}: Props) {
  const router = useRouter();
  const [cells, setCells] = useState<Map<string, ShiftCell>>(() => {
    const map = new Map<string, ShiftCell>();
    for (const s of shifts) {
      map.set(cellKey(s.userId, s.date), s);
    }
    return map;
  });
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  // Уход со страницы терял несохранённый график молча — ни отмены, ни
  // предупреждения. Теперь браузер спрашивает, а рядом с «Сохранить»
  // появляется «Отменить изменения».
  useEffect(() => {
    if (dirty.size === 0) return;
    function onBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  async function resetChanges() {
    const ok = await confirmAsync({
      title: "Отменить изменения графика?",
      description: `Несохранённых правок: ${dirty.size}. График вернётся к тому, что сейчас записано в системе.`,
      variant: "warn",
      confirmLabel: "Отменить правки",
    });
    if (!ok) return;
    const map = new Map<string, ShiftCell>();
    for (const s of shifts) map.set(cellKey(s.userId, s.date), s);
    setCells(map);
    setDirty(new Set());
    toast.success("Правки отменены");
  }

  const dates = useMemo(() => {
    const out: string[] = [];
    const start = new Date(`${startYmd}T00:00:00.000Z`);
    const end = new Date(`${endYmd}T00:00:00.000Z`);
    const cursor = new Date(start);
    while (cursor <= end) {
      out.push(cursor.toISOString().slice(0, 10));
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return out;
  }, [startYmd, endYmd]);

  const positionById = useMemo(
    () => new Map(positions.map((p) => [p.id, p])),
    [positions]
  );

  function cycleStatus(userId: string, date: string) {
    const key = cellKey(userId, date);
    const current =
      (cells.get(key)?.status as ShiftStatus | undefined) ?? "none";
    const nextIdx = (STATUS_CYCLE.indexOf(current) + 1) % STATUS_CYCLE.length;
    const next = STATUS_CYCLE[nextIdx];
    setCells((prev) => {
      const copy = new Map(prev);
      if (next === "none") {
        copy.delete(key);
      } else {
        copy.set(key, {
          userId,
          date,
          status: next,
          jobPositionId: copy.get(key)?.jobPositionId ?? null,
        });
      }
      return copy;
    });
    setDirty((prev) => new Set(prev).add(key));
  }

  function setJobPositionForCell(
    userId: string,
    date: string,
    positionId: string | null
  ) {
    const key = cellKey(userId, date);
    setCells((prev) => {
      const copy = new Map(prev);
      const existing = copy.get(key);
      if (!existing) return copy;
      copy.set(key, { ...existing, jobPositionId: positionId });
      return copy;
    });
    setDirty((prev) => new Set(prev).add(key));
  }

  function statusFor(userId: string, date: string): ShiftStatus {
    return (cells.get(cellKey(userId, date))?.status as ShiftStatus | undefined) ??
      "none";
  }

  async function save() {
    if (saving || dirty.size === 0) return;
    setSaving(true);
    try {
      const payload: Array<{
        userId: string;
        date: string;
        status: string;
        jobPositionId: string | null;
      }> = [];
      const toDelete: Array<{ userId: string; date: string }> = [];
      for (const key of dirty) {
        const [userId, date] = key.split(":");
        const cell = cells.get(key);
        if (cell) {
          payload.push({
            userId,
            date,
            status: cell.status,
            jobPositionId: cell.jobPositionId,
          });
        } else {
          toDelete.push({ userId, date });
        }
      }
      if (payload.length > 0) {
        const res = await fetch("/api/organizations/schedule", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ shifts: payload }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          throw new Error(data?.error ?? "Не удалось сохранить");
        }
      }
      // Раньше ответ DELETE не проверялся: неудавшееся снятие смены
      // молча терялось, а «Есть изменений» обнулялось — после обновления
      // страницы смена возвращалась, и выглядело это как потеря правок.
      let failedDeletes = 0;
      for (const d of toDelete) {
        const res = await fetch(
          `/api/organizations/schedule?userId=${encodeURIComponent(d.userId)}&date=${d.date}`,
          { method: "DELETE" }
        );
        if (!res.ok) failedDeletes++;
      }
      if (failedDeletes > 0) {
        throw new Error(
          `Не удалось снять ${failedDeletes} ${pluralRu(failedDeletes, "смену", "смены", "смен")} — изменения оставлены, попробуйте сохранить ещё раз`
        );
      }
      toast.success("График сохранён");
      setDirty(new Set());
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Ошибка");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-3xl border border-[#ececf4] bg-[#fafbff] px-5 py-4">
        <div className="flex flex-wrap items-center gap-3 text-[12px] text-[#3c4053]">
          <span className="font-semibold uppercase tracking-[0.14em] text-[#6f7282]">
            Статус (кликните на ячейку, чтобы переключить)
          </span>
          {(["scheduled", "off", "vacation", "sick"] as ShiftStatus[]).map(
            (s) => (
              <span
                key={s}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5",
                  STATUS_COLOR[s]
                )}
              >
                <span className="rounded-full bg-white/60 px-1.5 py-0.5 font-mono text-[11px]">
                  {STATUS_LABEL[s]}
                </span>
                {STATUS_TITLE[s]}
              </span>
            )
          )}
        </div>
      </div>

      <section className="rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] md:p-6">
        <div className="mb-3 flex items-center gap-2">
          <Users className="size-4 text-[#5566f6]" />
          <h2 className="text-[15px] font-semibold text-[#0b1024]">
            Ближайшие 14 дней
          </h2>
        </div>
        <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <table className="w-full min-w-max border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-[#ececf4]">
                <th className="sticky left-0 z-[1] bg-white px-3 py-2 text-left font-medium text-[#6f7282]">
                  Сотрудник
                </th>
                {dates.map((d) => {
                  const parsed = new Date(`${d}T00:00:00.000Z`);
                  const weekday = parsed.toLocaleDateString("ru-RU", {
                    weekday: "short",
                  });
                  const day = parsed.getUTCDate();
                  return (
                    <th
                      key={d}
                      className="px-1 py-2 text-center font-medium text-[#6f7282]"
                    >
                      <div className="text-[11px] uppercase">{weekday}</div>
                      <div className="text-[13px] text-[#0b1024]">{day}</div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-[#ececf4]">
                  <td className="sticky left-0 z-[1] min-w-[200px] bg-white px-3 py-2">
                    <div className="font-medium text-[#0b1024]">{u.name}</div>
                    <div className="text-[11px] text-[#6f7282]">
                      {u.jobPositionName ?? "без должности"}
                    </div>
                  </td>
                  {dates.map((d) => {
                    const s = statusFor(u.id, d);
                    const cell = cells.get(cellKey(u.id, d));
                    return (
                      <td
                        key={d}
                        className="px-1 py-1 text-center align-top"
                      >
                        <button
                          type="button"
                          onClick={() => cycleStatus(u.id, d)}
                          title={STATUS_TITLE[s]}
                          className={cn(
                            "inline-flex h-9 w-9 items-center justify-center rounded-lg border text-[12px] transition-colors",
                            STATUS_COLOR[s]
                          )}
                        >
                          {STATUS_LABEL[s] || "—"}
                        </button>
                        {s === "scheduled" ? (
                          <select
                            value={cell?.jobPositionId ?? ""}
                            onChange={(e) =>
                              setJobPositionForCell(
                                u.id,
                                d,
                                e.target.value || null
                              )
                            }
                            className="mt-1 w-[92px] rounded border border-[#dcdfed] bg-white px-1 py-0.5 text-[10px] text-[#3c4053]"
                            title="Должность на этот день (если отличается от базовой)"
                          >
                            <option value="">
                              {u.jobPositionName ?? "—"}
                            </option>
                            {positions.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name}
                              </option>
                            ))}
                          </select>
                        ) : null}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {users.length === 0 ? (
                <tr>
                  <td
                    colSpan={dates.length + 1}
                    className="px-4 py-10 text-center text-[13px] text-[#9b9fb3]"
                  >
                    В организации ещё нет сотрудников
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <div className="sticky bottom-4 z-10 flex flex-wrap items-center gap-3 rounded-3xl border border-[#ececf4] bg-white/95 px-5 py-3 shadow-[0_12px_32px_-16px_rgba(11,16,36,0.18)] backdrop-blur">
        <div className="text-[13px] text-[#3c4053]">
          {dirty.size === 0
            ? "Изменений нет"
            : `Есть изменений: ${dirty.size}`}
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={resetChanges}
          disabled={saving || dirty.size === 0}
          className="ml-auto h-11 rounded-2xl border-[#dcdfed] px-4 text-[14px] font-medium text-[#3c4053] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
        >
          <RotateCcw className="size-4" />
          Отменить изменения
        </Button>
        <Button
          type="button"
          onClick={save}
          disabled={saving || dirty.size === 0}
          className="h-11 rounded-2xl bg-[#5566f6] px-5 text-[14px] font-medium text-white hover:bg-[#4a5bf0] disabled:bg-[#c8cbe0]"
        >
          {saving ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Save className="size-4" />
          )}
          Сохранить график
        </Button>
      </div>
    </div>
  );
}
