"use client";

import { useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Bed,
  Calendar,
  CheckCircle2,
  Clock,
  Coffee,
  Loader2,
  MessageSquareOff,
  Plane,
} from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";

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
    label: string;
    icon: typeof Activity;
    color: string;
    bg: string;
    border: string;
  }
> = {
  working: {
    label: "В работе",
    icon: Activity,
    color: "text-[#3848c7]",
    bg: "bg-[#eef1ff]",
    border: "border-[#5566f6]/40",
  },
  completed_only: {
    label: "Закончил смену",
    icon: CheckCircle2,
    color: "text-[#136b2a]",
    bg: "bg-[#ecfdf5]",
    border: "border-[#c8f0d5]",
  },
  not_started: {
    label: "Прохлаждается",
    icon: Coffee,
    color: "text-[#a13a32]",
    bg: "bg-[#fff8eb]",
    border: "border-[#ffe9b0]",
  },
  off_day: {
    label: "Отгул",
    icon: Calendar,
    color: "text-[#6f7282]",
    bg: "bg-[#fafbff]",
    border: "border-[#dcdfed]",
  },
  vacation: {
    label: "Отпуск",
    icon: Plane,
    color: "text-[#6f7282]",
    bg: "bg-[#fafbff]",
    border: "border-[#dcdfed]",
  },
  sick: {
    label: "Больничный",
    icon: Bed,
    color: "text-[#6f7282]",
    bg: "bg-[#fafbff]",
    border: "border-[#dcdfed]",
  },
  shift_off: {
    label: "Не на смене",
    icon: Coffee,
    color: "text-[#9b9fb3]",
    bg: "bg-[#f5f6ff]",
    border: "border-[#dcdfed]",
  },
  no_telegram: {
    label: "Нет Telegram",
    icon: MessageSquareOff,
    color: "text-[#a13a32]",
    bg: "bg-[#fff4f2]",
    border: "border-[#ffd2cd]",
  },
};

function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "только что";
  if (m < 60) return `${m} мин назад`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} ч назад`;
  return `${Math.floor(h / 24)} д назад`;
}

export function TeamClient() {
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
    const t = window.setInterval(() => void load(), 30000);
    return () => window.clearInterval(t);
  }, []);

  if (loading && !data) {
    return (
      <div className="flex h-[200px] items-center justify-center text-[#6f7282]">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }
  if (!data) return null;

  const groups = ([
    {
      key: "active_now" as const,
      label: "Сейчас работают",
      items: data.team.filter((m) => m.workStatus === "working"),
    },
    {
      key: "completed_only",
      label: "Закончили смену",
      items: data.team.filter((m) => m.workStatus === "completed_only"),
    },
    {
      key: "not_started",
      label: "Прохлаждаются (не взяли задачу)",
      items: data.team.filter((m) => m.workStatus === "not_started"),
    },
    {
      key: "no_telegram",
      label: "Не подключили Telegram",
      items: data.team.filter((m) => m.workStatus === "no_telegram"),
    },
    {
      key: "shift_off",
      label: "Не на смене / отгул",
      items: data.team.filter(
        (m) =>
          m.workStatus === "shift_off" ||
          m.workStatus === "off_day"
      ),
    },
    {
      key: "vacation",
      label: "Отпуск",
      items: data.team.filter((m) => m.workStatus === "vacation"),
    },
    {
      key: "sick",
      label: "Больничный",
      items: data.team.filter((m) => m.workStatus === "sick"),
    },
  ] as { key: string; label: string; items: TeamMember[] }[]).filter((g) => g.items.length > 0);

  return (
    <div className="space-y-6">
      {/* Счётчики по статусам не дублируем в шапке: ниже каждая группа
          сотрудников и так подписана «Название (N)». */}
      <PageHeader
        title="Моя команда"
        description="Кто работает, кто закончил, кто ещё не начал. Обновляется каждые 30 секунд."
      />

      {groups.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-6 py-14 text-center text-[14px] text-[#6f7282]">
          В вашей команде пока нет сотрудников. Попросите админа добавить вас в
          ManagerScope.
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
            {meta.label}
          </div>
        </div>
      </div>

      {member.activeClaim ? (
        <div className="mt-3 rounded-2xl border border-[#5566f6]/30 bg-white px-3 py-2 text-[12px]">
          <div className="font-medium text-[#3848c7]">{member.activeClaim.scopeLabel}</div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[#6f7282]">
            <Clock className="size-3" />
            Взято {timeAgo(member.activeClaim.claimedAt)}
          </div>
        </div>
      ) : null}

      {member.workStatus === "completed_only" && member.doneCount > 0 ? (
        <div className="mt-3 text-[12px] text-[#136b2a]">
          Выполнено сегодня: {member.doneCount}
        </div>
      ) : null}

      {member.workStatus === "not_started" && member.hasTelegram ? (
        <div className="mt-3 inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-[11px] text-[#a13a32]">
          <AlertTriangle className="size-3" />
          Задач сегодня ещё нет
        </div>
      ) : null}

      {member.workStatus === "no_telegram" ? (
        <div className="mt-3 text-[12px] leading-snug text-[#a13a32]">
          Без бота сотрудник не получает задачи. Отправьте ему приглашение в разделе «Сотрудники».
        </div>
      ) : null}

      {member.sick ? (
        <div className="mt-3 text-[12px] text-[#6f7282]">
          Больничный до {new Date(member.sick.dateTo).toLocaleDateString("ru-RU")}
        </div>
      ) : null}
      {member.vacation ? (
        <div className="mt-3 text-[12px] text-[#6f7282]">
          Отпуск до {new Date(member.vacation.dateTo).toLocaleDateString("ru-RU")}
        </div>
      ) : null}
      {member.offDay ? (
        <div className="mt-3 text-[12px] text-[#6f7282]">Отгул сегодня</div>
      ) : null}

      {member.lastSeenAt ? (
        <div className="mt-3 text-[11px] text-[#9b9fb3]">
          Активность: {timeAgo(member.lastSeenAt)}
        </div>
      ) : null}
    </div>
  );
}
