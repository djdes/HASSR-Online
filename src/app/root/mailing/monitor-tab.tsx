"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Activity, Loader2, Radio, RefreshCw } from "lucide-react";

import { humanMsk } from "@/lib/mailing/forecast";
import type { CampaignListRow } from "@/lib/mailing/campaigns.server";
import type { MonitorData, MonitorRow } from "@/lib/mailing/operations.server";
import { cn } from "@/lib/utils";

import { CampaignActions } from "./campaign-actions";
import { CARD, ChannelIcons, Notice, OUTLINE_SM, SECTION_LABEL, StatusPill, api, formatDateTime } from "./ui";

/**
 * «Сейчас идут» — как монитор рассылок YesBeat: запланированные, идущие и
 * на паузе с прогрессом, ближайшей попыткой и примерным окончанием; плюс
 * завершённые за три дня. Пока вкладка открыта — обновление раз в 15 секунд.
 */
export function MonitorTab({
  active,
  onDuplicated,
  onOpenLimits,
}: {
  active: boolean;
  onDuplicated: (row: CampaignListRow) => void;
  onOpenLimits: () => void;
}) {
  const [data, setData] = useState<MonitorData | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api<MonitorData>("/api/root/mailing/monitor"));
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    void load();
    const t = setInterval(() => void load(), 15_000);
    return () => clearInterval(t);
  }, [active, load]);

  const rows = data?.rows ?? [];
  const running = rows.filter((r) => r.status === "sending" || r.status === "scheduled" || r.status === "paused");
  const recent = rows.filter((r) => r.status === "done" || r.status === "cancelled");

  return (
    <div className="space-y-5" data-testid="mailing-monitor-tab">
      {data && !data.enabled ? (
        <Notice tone="danger" icon={<Activity />} testId="monitor-disabled">
          Очередь выключена — ни одна рассылка не отправляется.{" "}
          <button type="button" className="font-medium underline underline-offset-2" onClick={onOpenLimits}>
            Включить в «Лимитах»
          </button>
        </Notice>
      ) : null}
      {data && data.enabled && data.stale && running.some((r) => r.counts.queued > 0) ? (
        <Notice tone="danger" icon={<Activity />}>
          Обработчик очереди {data.heartbeat ? `не запускался с ${humanMsk(data.heartbeat)} МСК` : "ещё ни разу не запускался"} —
          проверьте cron /api/cron/mailing на сервере.
        </Notice>
      ) : null}

      <section className={CARD}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className={cn(SECTION_LABEL, "flex items-center gap-2")}>
            <Radio className="size-4 text-[#5566f6]" /> Сейчас идут · {running.length}
          </div>
          <div className="flex items-center gap-3 text-[12px] text-[#6f7282]">
            {data ? (
              <span>
                Сегодня писем: <b className="tabular-nums text-[#0b1024]">{data.sentToday}</b> из {data.settings.perDay}
              </span>
            ) : null}
            <button type="button" className={OUTLINE_SM} onClick={() => void load()} disabled={loading}>
              {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4 text-[#5566f6]" />}
              Обновить
            </button>
          </div>
        </div>
        {failed && !data ? (
          <p className="text-[13px] text-[#a13a32]">Не удалось загрузить — нажмите «Обновить».</p>
        ) : !data ? (
          <div className="flex items-center gap-2 text-[13px] text-[#6f7282]">
            <Loader2 className="size-4 animate-spin" /> Загружаем…
          </div>
        ) : running.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-6 py-10 text-center text-[13px] text-[#6f7282]">
            Сейчас ничего не отправляется и не запланировано.
          </div>
        ) : (
          <ul className="space-y-3">
            {running.map((row) => (
              <MonitorItem
                key={row.id}
                row={row}
                onChanged={() => void load()}
                onDuplicated={onDuplicated}
              />
            ))}
          </ul>
        )}
      </section>

      {recent.length > 0 ? (
        <section className={CARD}>
          <div className={cn(SECTION_LABEL, "mb-4")}>Завершены за 3 дня · {recent.length}</div>
          <ul className="space-y-3">
            {recent.map((row) => (
              <MonitorItem key={row.id} row={row} onChanged={() => void load()} onDuplicated={onDuplicated} />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function MonitorItem({
  row,
  onChanged,
  onDuplicated,
}: {
  row: MonitorRow;
  onChanged: () => void;
  onDuplicated: (row: CampaignListRow) => void;
}) {
  const c = row.counts;
  const total = Math.max(1, c.total);
  const part = (n: number) => `${(n / total) * 100}%`;
  const done = c.sent + c.failed + c.skipped + c.cancelled;
  return (
    <li className="rounded-2xl border border-[#ececf4] bg-[#fafbff] p-4" data-testid="monitor-row" data-campaign-id={row.id}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/root/mailing/${row.id}`} className="text-[16px] font-semibold text-[#0b1024] hover:text-[#3848c7] [overflow-wrap:anywhere]">
              {row.title}
            </Link>
            <StatusPill status={row.status} label={row.statusLabel} />
            <ChannelIcons channels={row.channels} />
          </div>
          <div className="mt-1.5 text-[13px] text-[#6f7282]">
            {row.status === "scheduled" ? `Старт ${formatDateTime(row.scheduledAt)} МСК · ` : ""}
            {row.startedAt ? `Запуск ${formatDateTime(row.startedAt)} · ` : ""}
            {row.status === "paused" && row.pausedAt ? `Пауза с ${formatDateTime(row.pausedAt)} · ` : ""}
            {row.finishedAt ? `Завершена ${formatDateTime(row.finishedAt)} · ` : ""}
            {row.cancelledAt ? `Отменена ${formatDateTime(row.cancelledAt)} · ` : ""}
            Часы {String(row.windowStart).padStart(2, "0")}–{String(row.windowEnd).padStart(2, "0")} МСК
          </div>
          {c.queued > 0 && row.status !== "paused" ? (
            <div className="mt-1 text-[13px] text-[#3c4053]">
              {row.nextAt ? `Ближайшая попытка ${humanMsk(row.nextAt)} МСК` : "В очереди"}
              {row.finishHuman ? ` · закончится примерно ${row.finishHuman} МСК` : ""}
            </div>
          ) : null}
          {row.lastError ? <div className="mt-1 text-[13px] text-[#a13a32]">{row.lastError}</div> : null}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <CampaignActions campaign={row} onChanged={onChanged} onDuplicated={onDuplicated} withCancel />
          <Link href={`/root/mailing/${row.id}`} className={OUTLINE_SM}>
            Карточка
          </Link>
        </div>
      </div>
      <div className="mt-3" data-testid="monitor-progress">
        <div className="flex h-2.5 overflow-hidden rounded-full bg-[#eceef7]">
          <span className="bg-[#22a04b]" style={{ width: part(c.sent) }} />
          <span className="bg-[#e0584a]" style={{ width: part(c.failed) }} />
          <span className="bg-[#b9bdd0]" style={{ width: part(c.skipped + c.cancelled) }} />
        </div>
        <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-[#6f7282]">
          <span>
            Обработано <b className="tabular-nums text-[#0b1024]">{done}</b> из {c.total}
          </span>
          <span className="text-[#116b2a]">отправлено {c.sent}</span>
          <span>ждут {c.queued}</span>
          {c.failed ? <span className="text-[#a13a32]">ошибок {c.failed}</span> : null}
          {c.skipped + c.cancelled ? <span>пропущено {c.skipped + c.cancelled}</span> : null}
          {c.clicks ? <span className="text-[#3848c7]">перешли {c.clicks}</span> : null}
        </div>
      </div>
    </li>
  );
}
