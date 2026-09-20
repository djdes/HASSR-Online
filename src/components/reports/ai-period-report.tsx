"use client";

import { useState } from "react";
import { Copy, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GlowLoader } from "@/components/ui/glow-loader";
import { localDayKey } from "@/lib/entry-defaults";

// Дата — по часам компьютера, а не по UTC: в Москве с полуночи до
// трёх ночи поле «по» подставляло вчерашнее число.
function todayKey() {
  return localDayKey();
}
function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return localDayKey(d);
}

/**
 * ИИ-отчёт за период: 2 date-picker'а, кнопка «Сгенерировать».
 * После — текст в textarea + «Скопировать».
 *
 * Использование: менеджер в конце месяца открывает /reports →
 * жмёт «Сгенерировать», получает текст, правит чуть и отправляет
 * собственнику. Раньше — 2 часа ручного truda.
 */
export function AiPeriodReportCard() {
  const [from, setFrom] = useState(daysAgo(30));
  const [to, setTo] = useState(todayKey());
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<string | null>(null);
  const [facts, setFacts] = useState<string | null>(null);

  async function generate() {
    setBusy(true);
    setReport(null);
    try {
      const response = await fetch("/api/ai/period-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from, to }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error ?? "Ошибка генерации");
      }
      setReport(data.report ?? "");
      setFacts(data.facts ?? null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  }

  function copy() {
    if (!report) return;
    navigator.clipboard.writeText(report);
    toast.success("Отчёт скопирован");
  }

  return (
    <div className="rounded-3xl border border-[#ececf4] bg-white p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
      <div className="flex items-start gap-4">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#5566f6]">
          <Sparkles className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-semibold text-[#0b1024]">
            ИИ-отчёт за период
          </div>
          <p className="mt-1 max-w-[640px] text-[13px] leading-relaxed text-[#6f7282]">
            Система собирает все журналы, инциденты, CAPA, премии за
            период и пишет связный текст «вот что было хорошо, вот
            проблемы, вот рекомендации». Готовый материал для
            ежемесячного отчёта собственнику.
          </p>

          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label className="text-[13px] text-[#6f7282]">За период с</Label>
              <Input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="rounded-xl"
                disabled={busy}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[13px] text-[#6f7282]">по</Label>
              <Input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="rounded-xl"
                disabled={busy}
              />
            </div>
            <div className="flex items-end">
              <Button
                type="button"
                onClick={generate}
                disabled={busy}
                className="h-10 w-full rounded-xl bg-[#5566f6] px-4 text-[14px] font-medium text-white hover:bg-[#4a5bf0]"
              >
                {busy ? (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                ) : (
                  <Sparkles className="mr-2 size-4" />
                )}
                Сгенерировать
              </Button>
            </div>
          </div>

          {busy && !report ? (
            <div className="mt-5">
              <GlowLoader
                label="Собираю данные за период и формирую narrative..."
                targetSeconds={20}
              />
            </div>
          ) : null}

          {report ? (
            <div className="mt-5 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[12px] font-semibold uppercase tracking-[0.06em] text-[#6f7282]">
                  Отчёт
                </span>
                <button
                  type="button"
                  onClick={copy}
                  className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[12px] font-medium text-[#3848c7] hover:bg-[#f5f6ff]"
                >
                  <Copy className="size-3.5" />
                  Скопировать
                </button>
              </div>
              <textarea
                value={report}
                onChange={(e) => setReport(e.target.value)}
                rows={Math.min(20, Math.max(8, report.split("\n").length + 1))}
                className="w-full rounded-2xl border border-[#dcdfed] bg-[#fafbff] p-4 text-[13px] leading-relaxed text-[#0b1024] focus:border-[#5566f6] focus:outline-none"
              />
              {facts ? (
                <details className="rounded-xl border border-[#ececf4] bg-[#fafbff] px-3 py-2">
                  <summary className="cursor-pointer text-[12px] font-medium text-[#6f7282]">
                    Показать сырые данные на которых построен отчёт
                  </summary>
                  <pre className="mt-2 whitespace-pre-wrap text-[11px] leading-relaxed text-[#3c4053]">
                    {facts}
                  </pre>
                </details>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
