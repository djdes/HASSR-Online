"use client";

import { useCallback, useEffect, useState } from "react";
import { Clock, Info, Loader2, OctagonAlert, TriangleAlert } from "lucide-react";

import { humanMsk } from "@/lib/mailing/forecast";
import type { QueueState } from "@/lib/mailing/operations.server";
import { cn } from "@/lib/utils";

import { CARD, Notice, SECTION_LABEL, api } from "./ui";

/**
 * «Состояние очереди» запущенной рассылки (как в YesBeat): сколько
 * получателей ждут и почему, ближайшая попытка, план по часам, работает ли
 * обработчик и когда очередь примерно закончится.
 */
export function QueueStateCard({ campaignId, status, version }: { campaignId: string; status: string; version: number }) {
  const [state, setState] = useState<QueueState | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      setState(await api<QueueState>(`/api/root/mailing/campaigns/${campaignId}/queue`));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [campaignId]);

  // `version` меняется при каждом обновлении карточки — состояние следует за ней.
  useEffect(() => {
    void load();
  }, [load, version, status]);

  if (!state) {
    return (
      <section className={CARD} data-testid="queue-state">
        <div className={cn(SECTION_LABEL, "mb-2")}>Состояние очереди</div>
        <div className="flex items-center gap-2 text-[13px] text-[#6f7282]">
          {failed ? "Не удалось загрузить состояние очереди." : <><Loader2 className="size-4 animate-spin" /> Загружаем…</>}
        </div>
      </section>
    );
  }

  const max = Math.max(1, ...state.plan.map((p) => p.count));
  return (
    <section className={CARD} data-testid="queue-state">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div className={SECTION_LABEL}>Состояние очереди</div>
        <div className="text-[12px] text-[#6f7282]">
          {state.heartbeat ? `Обработчик: ${humanMsk(state.heartbeat)} МСК` : "Обработчик ещё не запускался"}
          {state.enabled ? "" : " · очередь выключена"}
        </div>
      </div>

      {state.issues.length > 0 ? (
        <div className="mb-4 space-y-2" data-testid="queue-issues">
          {state.issues.map((issue, i) => (
            <Notice
              key={i}
              tone={issue.level === "error" ? "danger" : issue.level === "warning" ? "warn" : "info"}
              icon={issue.level === "error" ? <OctagonAlert /> : issue.level === "warning" ? <TriangleAlert /> : <Info />}
            >
              {issue.text}
            </Notice>
          ))}
        </div>
      ) : null}

      {state.total === 0 ? (
        <p className="text-[13px] text-[#6f7282]">В очереди никого: всем получателям уже отправлено, пропущено или отменено.</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            <div className="mb-2 text-[13px] text-[#3c4053]">
              Ждут: <b className="tabular-nums">{state.total}</b>
              {state.forecast?.finishHuman ? (
                <>
                  {" "}
                  · закончится примерно <b data-testid="queue-forecast">{state.forecast.finishHuman}</b> МСК
                  {state.forecast.ahead > 0 ? ` (перед ней в очереди ${state.forecast.ahead} писем других рассылок)` : ""}
                </>
              ) : state.forecast?.capped ? (
                " · при текущих лимитах очередь не закончится в обозримое время"
              ) : null}
            </div>
            <ul className="space-y-1.5" data-testid="queue-reasons">
              {state.waiting.map((g) => (
                <li key={g.reason ?? "ready"} className="flex items-start justify-between gap-3 rounded-xl border border-[#ececf4] bg-[#fafbff] px-3 py-2 text-[13px]">
                  <span className="min-w-0 text-[#3c4053]">
                    {g.label}
                    {g.reason ? <span className="block text-[12px] text-[#9b9fb3]">с {humanMsk(g.nextAt)} МСК</span> : null}
                  </span>
                  <b className="tabular-nums text-[#0b1024]">{g.count}</b>
                </li>
              ))}
            </ul>
            {state.forecast ? (
              <p className="mt-2 text-[12px] text-[#9b9fb3]">
                Оценка по лимитам: до {state.forecast.perHour} писем в час, {state.forecast.perDay} в сутки с учётом часов
                отправки. Перерыв между рассылками и лимит на домен могут растянуть срок.
              </p>
            ) : null}
          </div>
          <div>
            <div className="mb-2 flex items-center gap-1.5 text-[13px] text-[#3c4053]">
              <Clock className="size-4 text-[#5566f6]" /> План отправки по часам
            </div>
            <ul className="space-y-1" data-testid="queue-plan">
              {state.plan.slice(0, 24).map((slot) => (
                <li key={slot.hour} className="flex items-center gap-2 text-[12px]">
                  <span className="w-[104px] shrink-0 tabular-nums text-[#6f7282]">{hourLabel(slot.hour)}</span>
                  <span className="h-2 flex-1 overflow-hidden rounded-full bg-[#f2f3f8]">
                    <span className="block h-full rounded-full bg-[#5566f6]" data-meter style={{ width: `${Math.max(4, (slot.count / max) * 100)}%` }} />
                  </span>
                  <b className="w-12 shrink-0 text-right tabular-nums text-[#0b1024]">{slot.count}</b>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[12px] text-[#9b9fb3]">
              По времени ближайшей попытки. Ждущие лимита писем уходят по мере освобождения лимита — их час примерный.
            </p>
          </div>
        </div>
      )}
    </section>
  );
}

/** «2026-11-24T09» → «24.11, 09:00». */
function hourLabel(hour: string): string {
  const [date, h] = hour.split("T");
  const [, m, d] = date.split("-");
  return `${d}.${m}, ${h}:00`;
}
