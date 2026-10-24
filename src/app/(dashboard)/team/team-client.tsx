"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  Activity,
  AlertTriangle,
  Bed,
  Calendar,
  CheckCircle2,
  Clock,
  Coffee,
  MessageSquareOff,
  Plane,
} from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import TeamLoading from "./loading";

type WorkStatus =
  | "working"
  | "completed_only"
  | "not_started"
  | "off_day"
  | "vacation"
  | "sick"
  | "shift_off"
  | "no_telegram";

type TeamMember = {
  id: string;
  name: string;
  preset: string;
  positionLabel: string;
  hasTelegram: boolean;
  workStatus: WorkStatus;
  activeClaim: {
    scopeLabel: string;
    journalCode: string;
    claimedAt: string;
  } | null;
  doneCount: number;
  lastSeenAt: string | null;
  sick: { dateFrom: string; dateTo: string } | null;
  vacation: { dateFrom: string; dateTo: string } | null;
  offDay: { date: string } | null;
  shift: { status: string; handoverAt: string | null } | null;
};

type Resp = {
  viewMode: string;
  team: TeamMember[];
};

const STATUS_META: Record<
  WorkStatus,
  {
    icon: typeof Activity;
    color: string;
    bg: string;
    border: string;
  }
> = {
  working: {
    icon: Activity,
    color: "text-[#3848c7]",
    bg: "bg-[#eef1ff]",
    border: "border-[#5566f6]/40",
  },
  completed_only: {
    icon: CheckCircle2,
    color: "text-[#136b2a]",
    bg: "bg-[#ecfdf5]",
    border: "border-[#c8f0d5]",
  },
  not_started: {
    icon: Coffee,
    color: "text-[#a13a32]",
    bg: "bg-[#fff8eb]",
    border: "border-[#ffe9b0]",
  },
  off_day: {
    icon: Calendar,
    color: "text-[#6f7282]",
    bg: "bg-[#fafbff]",
    border: "border-[#dcdfed]",
  },
  vacation: {
    icon: Plane,
    color: "text-[#6f7282]",
    bg: "bg-[#fafbff]",
    border: "border-[#dcdfed]",
  },
  sick: {
    icon: Bed,
    color: "text-[#6f7282]",
    bg: "bg-[#fafbff]",
    border: "border-[#dcdfed]",
  },
  shift_off: {
    icon: Coffee,
    color: "text-[#9b9fb3]",
    bg: "bg-[#f5f6ff]",
    border: "border-[#dcdfed]",
  },
  no_telegram: {
    icon: MessageSquareOff,
    color: "text-[#a13a32]",
    bg: "bg-[#fff4f2]",
    border: "border-[#ffd2cd]",
  },
};

type TeamTranslator = ReturnType<typeof useTranslations<"teamUi.teamClient">>;

function statusLabel(t: TeamTranslator, status: WorkStatus): string {
  switch (status) {
    case "working":
      return t("status.working");
    case "completed_only":
      return t("status.completedOnly");
    case "not_started":
      return t("status.notStarted");
    case "off_day":
      return t("status.offDay");
    case "vacation":
      return t("status.vacation");
    case "sick":
      return t("status.sick");
    case "shift_off":
      return t("status.shiftOff");
    case "no_telegram":
      return t("status.noTelegram");
  }
}

function timeAgo(t: TeamTranslator, iso: string | null): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return t("ago.justNow");
  if (m < 60) return t("ago.minutes", { count: m });
  const h = Math.floor(m / 60);
  if (h < 24) return t("ago.hours", { count: h });
  return t("ago.days", { count: Math.floor(h / 24) });
}

export function TeamClient() {
  const t = useTranslations("teamUi.teamClient");
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    try {
      const res = await fetch("/api/team", { cache: "no-store" });
      if (res.ok) setData((await res.json()) as Resp);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 30000);
    return () => window.clearInterval(timer);
  }, []);

  // Первая загрузка — тот же скелет, что у `loading.tsx`, без промежуточного
  // пустого блока с крутилкой.
  if (loading && !data) return <TeamLoading />;
  if (!data) return null;

  const groups = ([
    {
      key: "active_now" as const,
      label: t("groups.activeNow"),
      items: data.team.filter((m) => m.workStatus === "working"),
    },
    {
      key: "completed_only",
      label: t("groups.completedOnly"),
      items: data.team.filter((m) => m.workStatus === "completed_only"),
    },
    {
      key: "not_started",
      label: t("groups.notStarted"),
      items: data.team.filter((m) => m.workStatus === "not_started"),
    },
    {
      key: "no_telegram",
      label: t("groups.noTelegram"),
      items: data.team.filter((m) => m.workStatus === "no_telegram"),
    },
    {
      key: "shift_off",
      label: t("groups.shiftOff"),
      items: data.team.filter(
        (m) =>
          m.workStatus === "shift_off" ||
          m.workStatus === "off_day"
      ),
    },
    {
      key: "vacation",
      label: t("groups.vacation"),
      items: data.team.filter((m) => m.workStatus === "vacation"),
    },
    {
      key: "sick",
      label: t("groups.sick"),
      items: data.team.filter((m) => m.workStatus === "sick"),
    },
  ] as { key: string; label: string; items: TeamMember[] }[]).filter((g) => g.items.length > 0);

  return (
    <div className="space-y-6">
      {/* Счётчики по статусам не дублируем в шапке: ниже каждая группа
          сотрудников и так подписана «Название (N)». */}
      <PageHeader
        title={t("title")}
        description={t("description")}
      />

      {groups.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-6 py-14 text-center text-[14px] text-[#6f7282]">
          {t("empty")}
        </div>
      ) : null}

      {groups.map((g) => (
        <section key={g.key} className="space-y-2">
          <div className="px-1 text-[12px] font-semibold uppercase tracking-[0.16em] text-[#9b9fb3]">
            {g.label} ({g.items.length})
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {g.items.map((m) => (
              <MemberCard key={m.id} member={m} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function MemberCard({ member }: { member: TeamMember }) {
  const t = useTranslations("teamUi.teamClient");
  const locale = useLocale();
  const meta = STATUS_META[member.workStatus];
  const Icon = meta.icon;
  return (
    <div
      className={`rounded-3xl border ${meta.border} ${meta.bg} p-4 transition-colors`}
    >
      <div className="flex items-start gap-3">
        <span
          className={`flex size-10 shrink-0 items-center justify-center rounded-2xl bg-white ${meta.color}`}
        >
          <Icon className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-semibold text-[#0b1024]">
            {member.name}
          </div>
          <div className="mt-0.5 text-[12px] text-[#6f7282]">
            {member.positionLabel}
          </div>
          <div className={`mt-2 inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-[11px] font-medium ${meta.color}`}>
            {statusLabel(t, member.workStatus)}
          </div>
        </div>
      </div>

      {member.activeClaim ? (
        <div className="mt-3 rounded-2xl border border-[#5566f6]/30 bg-white px-3 py-2 text-[12px]">
          <div className="font-medium text-[#3848c7]">{member.activeClaim.scopeLabel}</div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[#6f7282]">
            <Clock className="size-3" />
            {t("claimed", { ago: timeAgo(t, member.activeClaim.claimedAt) })}
          </div>
        </div>
      ) : null}

      {member.workStatus === "completed_only" && member.doneCount > 0 ? (
        <div className="mt-3 text-[12px] text-[#136b2a]">
          {t("doneToday", { count: member.doneCount })}
        </div>
      ) : null}

      {member.workStatus === "not_started" && member.hasTelegram ? (
        <div className="mt-3 inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-[11px] text-[#a13a32]">
          <AlertTriangle className="size-3" />
          {t("noTasksToday")}
        </div>
      ) : null}

      {member.workStatus === "no_telegram" ? (
        <div className="mt-3 text-[12px] leading-snug text-[#a13a32]">
          {t("noTelegramHint")}
        </div>
      ) : null}

      {member.sick ? (
        <div className="mt-3 text-[12px] text-[#6f7282]">
          {t("sickUntil", { date: new Date(member.sick.dateTo).toLocaleDateString(locale) })}
        </div>
      ) : null}
      {member.vacation ? (
        <div className="mt-3 text-[12px] text-[#6f7282]">
          {t("vacationUntil", { date: new Date(member.vacation.dateTo).toLocaleDateString(locale) })}
        </div>
      ) : null}
      {member.offDay ? (
        <div className="mt-3 text-[12px] text-[#6f7282]">{t("offDayToday")}</div>
      ) : null}

      {member.lastSeenAt ? (
        <div className="mt-3 text-[11px] text-[#9b9fb3]">
          {t("activity", { ago: timeAgo(t, member.lastSeenAt) })}
        </div>
      ) : null}
    </div>
  );
}
