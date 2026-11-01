"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  Clock,
  Download,
  Loader2,
  Printer,
  XCircle,
} from "lucide-react";
import { LinkPendingSpinner } from "@/components/ui/link-pending";
import { useLocale, useTranslations } from "next-intl";
import { FORMAT_LOCALES } from "@/i18n/locales";

/**
 * Блок «Онлайн принтер» на дашборде: состояние программы печати и
 * история заданий.
 *
 * Смысл — чтобы в момент внезапной проверки человек не гадал, доедет ли
 * бланк до принтера. Видно сразу: программа на связи или нет, на каком
 * принтере печатает, и что уходило последним.
 *
 * Данные тянем на клиенте и обновляем раз в 20 секунд: «онлайн» — штука
 * скоропортящаяся, и серверный рендер показывал бы состояние на момент
 * загрузки страницы, которая может провисеть открытой полдня.
 */

type Agent = {
  id: string;
  name: string;
  printerName: string | null;
  lastSeenAt: string | null;
  online: boolean;
  /** Точка принтера (2026-11-01); нет — вся организация. */
  buildingName?: string | null;
};

type Job = {
  id: string;
  docTitle: string;
  status: "pending" | "printing" | "done" | "error" | "cancelled";
  errorMsg: string | null;
  createdAt: string;
  createdByName: string | null;
};

const REFRESH_MS = 20 * 1000;

const STATUS: Record<
  Job["status"],
  { className: string; icon: typeof CheckCircle2 }
> = {
  pending: { className: "text-[#6f7282]", icon: Clock },
  printing: { className: "text-[#3848c7]", icon: Loader2 },
  done: { className: "text-[#116b2a]", icon: CheckCircle2 },
  error: { className: "text-[#a13a32]", icon: XCircle },
  cancelled: { className: "text-[#9b9fb3]", icon: XCircle },
};

/**
 * `historyOnly` — на странице «Онлайн-принтер», где подключение и машины уже
 * показаны: только предупреждение «не на связи» и последние задания.
 */
export function PrintAgentCard({ historyOnly = false }: { historyOnly?: boolean } = {}) {
  const t = useTranslations("printAgent.card");
  const locale = useLocale();
  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/print/status");
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        setAgents(data.agents ?? []);
        setJobs(data.jobs ?? []);
      } catch {
        /* сеть моргнула — покажем прошлое состояние, следующий тик догонит */
      }
    }
    void load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const online = agents?.filter((a) => a.online) ?? [];
  const connected = (agents?.length ?? 0) > 0;

  if (historyOnly && jobs.length === 0 && !(connected && online.length === 0)) return null;

  return (
    <div className="space-y-4">
      {historyOnly ? null : !connected ? (
        <div className="rounded-3xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-6 py-8 text-center">
          <span className="mx-auto flex size-11 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#5566f6]">
            <Printer className="size-5" />
          </span>
          <div className="mt-3 text-[15px] font-medium text-[#0b1024]">
            {t("disconnected")}
          </div>
          <p className="mx-auto mt-1.5 max-w-[420px] text-[13px] leading-snug text-[#6f7282]">
            {t("description")}
          </p>
          <Link
            href="/settings/print-agent"
            className="mt-4 inline-flex h-10 items-center gap-2 rounded-2xl bg-[#5566f6] px-4 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors hover:bg-[#4a5bf0]"
          >
            <Download className="size-4" />
            {t("download")}
            <LinkPendingSpinner />
          </Link>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {agents?.map((agent) => (
            <span
              key={agent.id}
              title={
                agent.lastSeenAt
                  ? t("lastSeen", { date: new Date(agent.lastSeenAt).toLocaleString(FORMAT_LOCALES[locale]) })
                  : t("neverSeen")
              }
              className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[13px] ${
                agent.online
                  ? "bg-[#ecfdf5] text-[#116b2a]"
                  : "bg-[#fff4f2] text-[#a13a32]"
              }`}
            >
              <span
                aria-hidden
                className={`size-1.5 rounded-full ${
                  agent.online ? "bg-[#116b2a]" : "bg-[#a13a32]"
                }`}
              />
              {agent.name}
              {agent.printerName ? (
                <span className="opacity-70">· {agent.printerName}</span>
              ) : null}
              {agent.buildingName ? (
                <span className="opacity-70">· {agent.buildingName}</span>
              ) : null}
            </span>
          ))}
          <Link
            href="/settings/print-agent"
            className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[#5566f6] transition-colors hover:text-[#3848c7]"
          >
            {t("configure")}
            <LinkPendingSpinner />
          </Link>
        </div>
      )}

      {connected && online.length === 0 ? (
        <p className="rounded-2xl bg-[#fff8eb] px-4 py-2.5 text-[13px] leading-snug text-[#7a4a00]">
          {t("offline")}
        </p>
      ) : null}

      {jobs.length > 0 ? (
        <div className="space-y-1">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#9b9fb3]">
            {t("history")}
          </div>
          {jobs.map((job) => {
            const s = STATUS[job.status];
            const Icon = s.icon;
            return (
              <div
                key={job.id}
                className="flex items-center gap-3 rounded-2xl px-2 py-1.5 text-[13px] transition-colors hover:bg-[#fafbff]"
              >
                <Icon
                  className={`size-3.5 shrink-0 ${s.className} ${
                    job.status === "printing" ? "animate-spin" : ""
                  }`}
                />
                <span className="min-w-0 flex-1 truncate text-[#0b1024]">
                  {job.docTitle}
                </span>
                <span
                  className={`shrink-0 text-[12px] ${s.className}`}
                  title={job.errorMsg ?? undefined}
                >
                  {t(`status.${job.status}`)}
                </span>
                <span className="hidden shrink-0 text-[12px] tabular-nums text-[#9b9fb3] sm:inline">
                  {new Date(job.createdAt).toLocaleString(FORMAT_LOCALES[locale], {
                    day: "2-digit",
                    month: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
