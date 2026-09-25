"use client";

import { useEffect, useState } from "react";
import { customJournalName } from "@/lib/custom-names";
import { useCustomNames } from "@/components/shared/custom-names-provider";
import {
  Activity,
  CheckCircle2,
  Clock,
  Loader2,
  Sparkles,
} from "lucide-react";

type ActiveClaim = {
  id: string;
  journalCode: string;
  scopeKey: string;
  scopeLabel: string;
  userName: string | null;
  userId: string;
  claimedAt: string;
};

type CompletedClaim = {
  id: string;
  journalCode: string;
  scopeLabel: string;
  userName: string | null;
  completedAt: string;
};

type Response = {
  activeNow: ActiveClaim[];
  completedToday: CompletedClaim[];
  byJournal: { code: string; active: number; completed: number }[];
};

function pluralRu(one: string, few: string, many: string) {
  return (n: number) => {
    const abs = Math.abs(n) % 100;
    const last = abs % 10;
    if (abs > 10 && abs < 20) return many;
    if (last === 1) return one;
    if (last >= 2 && last <= 4) return few;
    return many;
  };
}
const minWord = pluralRu("минута", "минуты", "минут");
const taskWord = pluralRu("задача", "задачи", "задач");

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.max(0, Math.floor(diff / 60000));
  if (minutes < 1) return "только что";
  if (minutes < 60) return `${minutes} ${minWord(minutes)} назад`;
  const hours = Math.floor(minutes / 60);
  return `${hours} ч ${minutes % 60} мин назад`;
}

const JOURNAL_LABELS: Record<string, string> = {
  hygiene: "Гигиена",
  health_check: "Здоровье",
  cold_equipment_control: "Холодильники",
  climate_control: "Климат",
  cleaning: "Уборка",
  incoming_control: "Приёмка",
  finished_product: "Бракераж",
  disinfectant_usage: "Дезсредства",
  fryer_oil: "Фритюр",
  accident_journal: "Аварии",
  complaint_register: "Жалобы",
};

/**
 * Live-виджет «Кто что делает» на дашборде. Опрашивает
 * /api/dashboard/live-claims каждые 15 сек, показывает текущие
 * active claim'ы и сегодняшние completions. Для демо менеджер
 * открывает дашборд на ноутбуке, сотрудник на телефоне берёт
 * задачу — менеджер видит изменение почти в реальном времени.
 */
export function LiveClaimsCard() {
  const [data, setData] = useState<Response | null>(null);
  // Своё название журнала организации — первым, затем короткая подпись.
  const customNames = useCustomNames();
  const journalLabel = (code: string) =>
    customJournalName(customNames, code) ?? JOURNAL_LABELS[code] ?? code;
  const [loading, setLoading] = useState(true);

  async function load() {
    try {
      const res = await fetch("/api/dashboard/live-claims", { cache: "no-store" });
      if (!res.ok) return;
      const json = (await res.json()) as Response;
      setData(json);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    const t = window.setInterval(() => void load(), 15000);
    return () => window.clearInterval(t);
  }, []);

  if (loading && !data) {
    return (
      <div className="rounded-3xl border border-[#ececf4] bg-white p-5 text-[#6f7282]">
        <Loader2 className="size-4 animate-spin inline" /> Загружаю активность…
      </div>
    );
  }
  if (!data) return null;

  const totalActive = data.activeNow.length;
  const totalCompleted = data.completedToday.length;

  return (
    <div className="rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#3848c7]">
            <Activity className="size-5" />
          </span>
          <div>
            <div className="text-[15px] font-semibold text-[#0b1024]">
              Сейчас работают
            </div>
            <div className="mt-0.5 text-[12px] text-[#6f7282]">
              {totalActive} {taskWord(totalActive)} в процессе ·{" "}
              {totalCompleted} завершено сегодня · обновляется каждые 15 секунд
            </div>
          </div>
        </div>
      </div>

      {totalActive === 0 && totalCompleted === 0 ? (
        <div className="mt-4 rounded-2xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-4 py-6 text-center text-[13px] text-[#6f7282]">
          Никто пока не взял задачи. Сотрудники могут открыть мини-апп и
          начать смену.
        </div>
      ) : null}

      {totalActive > 0 ? (
        <div className="mt-4">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#9b9fb3]">
            В работе ({totalActive})
          </div>
          <div className="space-y-2">
            {data.activeNow.map((c) => (
              <div
                key={c.id}
                className="flex items-start gap-3 rounded-2xl border border-[#5566f6]/30 bg-[#eef1ff] px-3 py-2.5"
              >
                <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl bg-[#5566f6] text-white">
                  <Sparkles className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium text-[#0b1024]">
                    {c.scopeLabel}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-[#6f7282]">
                    <span className="text-[#3848c7]">
                      {c.userName || "сотрудник"}
                    </span>
                    <span>·</span>
                    <span>{journalLabel(c.journalCode)}</span>
                    <span>·</span>
                    <Clock className="size-3" />
                    {timeAgo(c.claimedAt)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {totalCompleted > 0 ? (
        <div className="mt-4">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#9b9fb3]">
            Готово сегодня ({totalCompleted})
          </div>
          <div className="space-y-2">
            {data.completedToday.slice(0, 6).map((c) => (
              <div
                key={c.id}
                className="flex items-start gap-3 rounded-2xl border border-[#c8f0d5] bg-[#ecfdf5] px-3 py-2"
              >
                <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl bg-[#d9f4e1] text-[#136b2a]">
                  <CheckCircle2 className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium text-[#0b1024]">
                    {c.scopeLabel}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-[#6f7282]">
                    <span className="text-[#136b2a]">
                      {c.userName || "сотрудник"}
                    </span>
                    <span>·</span>
                    <span>{journalLabel(c.journalCode)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
