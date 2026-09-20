"use client";

import { useMemo, useState } from "react";
import { CalendarRange, Download, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { localDayKey } from "@/lib/entry-defaults";

// Даты — по местным часам, а не по UTC: ночью в Москве поле «по»
// подставляло вчерашнее число.
function firstOfCurrentMonth(): string {
  const d = new Date();
  return localDayKey(new Date(d.getFullYear(), d.getMonth(), 1));
}
function todayYmd(): string {
  return localDayKey();
}

type Preset = { label: string; from: string; to: string };

function buildPresets(): Preset[] {
  const now = new Date();
  const thisMonthFrom = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
  );
  const thisMonthTo = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)
  );
  const lastMonthFrom = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)
  );
  const lastMonthTo = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0)
  );
  const quarterStartMonth = Math.floor(now.getUTCMonth() / 3) * 3;
  const quarterFrom = new Date(
    Date.UTC(now.getUTCFullYear(), quarterStartMonth, 1)
  );
  const quarterTo = new Date(
    Date.UTC(now.getUTCFullYear(), quarterStartMonth + 3, 0)
  );
  const ymd = (d: Date) => d.toISOString().slice(0, 10);
  const weekFrom = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 6)
  );
  const weekTo = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );
  return [
    {
      label: "По звонку инспектора (7 дней)",
      from: ymd(weekFrom),
      to: ymd(weekTo),
    },
    { label: "Текущий месяц", from: ymd(thisMonthFrom), to: ymd(thisMonthTo) },
    { label: "Прошлый месяц", from: ymd(lastMonthFrom), to: ymd(lastMonthTo) },
    { label: "Текущий квартал", from: ymd(quarterFrom), to: ymd(quarterTo) },
  ];
}

/**
 * «Сводный отчёт за проверкой» — pick a period and download a ZIP of
 * every journal's PDF for that period. The block sits under the
 * per-journal report form on /reports.
 *
 * Download uses window.location so the browser's native «save as»
 * dialog handles big archives — no need to hold the whole blob in JS
 * memory.
 */
export function ComplianceBundleCard() {
  const [from, setFrom] = useState<string>(firstOfCurrentMonth());
  const [to, setTo] = useState<string>(todayYmd());
  const [busy, setBusy] = useState(false);
  const presets = useMemo(buildPresets, []);

  async function download() {
    if (busy) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      toast.error("Выберите корректные даты");
      return;
    }
    if (from > to) {
      toast.error("Дата «по» не может быть раньше «с»");
      return;
    }
    setBusy(true);
    toast.info("Собираем архив — это может занять минуту для большого периода.");
    try {
      const url = `/api/reports/compliance-bundle?from=${from}&to=${to}`;
      const response = await fetch(url, { credentials: "include" });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(
          data?.error || `Не удалось собрать архив (${response.status})`
        );
      }
      const included = response.headers.get("x-compliance-included");
      const failed = response.headers.get("x-compliance-failed");
      const blob = await response.blob();
      const downloadUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = downloadUrl;
      a.download = `compliance-${from}__${to}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(downloadUrl);
      const parts = [`включено ${included ?? "?"}`];
      if (failed && failed !== "0") parts.push(`ошибок ${failed}`);
      toast.success(`Архив скачан · ${parts.join(" · ")}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-3xl border border-[#ececf4] bg-white p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] md:p-7">
      <div className="flex items-start gap-4">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#5566f6]">
          <ShieldCheck className="size-5" />
        </span>
        <div className="flex-1 min-w-0">
          <h2 className="text-[18px] font-semibold tracking-[-0.02em] text-[#0b1024]">
            Сводный отчёт за проверкой
          </h2>
          <p className="mt-1 text-[13px] leading-relaxed text-[#6f7282]">
            Один ZIP со всеми журналами за период. Подойдёт для визита
            Роспотребнадзора: отдал архив — и инспектор видит всю картину
            сам. Внутри лежат PDF каждого журнала + манифест с перечнем.
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            {presets.map((preset) => {
              const active = preset.from === from && preset.to === to;
              return (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => {
                    setFrom(preset.from);
                    setTo(preset.to);
                  }}
                  className={`rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors ${
                    active
                      ? "border-[#5566f6] bg-[#5566f6] text-white"
                      : "border-[#dcdfed] bg-white text-[#3c4053] hover:bg-[#f5f6ff]"
                  }`}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
            <div>
              <label className="text-[12px] font-medium text-[#6f7282]">
                С
              </label>
              <Input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="mt-1 h-11 rounded-2xl border-[#dcdfed]"
              />
            </div>
            <div>
              <label className="text-[12px] font-medium text-[#6f7282]">
                По
              </label>
              <Input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="mt-1 h-11 rounded-2xl border-[#dcdfed]"
              />
            </div>
            <div className="flex items-end">
              <Button
                type="button"
                onClick={download}
                disabled={busy}
                className="h-11 rounded-2xl bg-[#5566f6] px-5 text-[14px] font-medium text-white hover:bg-[#4a5bf0] disabled:bg-[#c8cbe0]"
              >
                {busy ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Download className="size-4" />
                )}
                {busy ? "Собираем…" : "Скачать архив"}
              </Button>
            </div>
          </div>

          <div className="mt-3 flex items-center gap-2 text-[12px] text-[#9b9fb3]">
            <CalendarRange className="size-3.5" />
            Включаются все документы, чей период пересекается с выбранным.
            Максимум 400 дней за один архив.
          </div>
        </div>
      </div>
    </div>
  );
}
