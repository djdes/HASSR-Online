"use client";

import { useLiveRefetch } from "@/lib/use-live-refetch";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Bell,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Filter,
  Loader2,
  XCircle,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { PageHeader, PageHeaderStat } from "@/components/ui/page-header";
import ControlBoardLoading from "./loading";
import {
  showRemindResult,
  type RemindResult,
} from "@/lib/remind-toast";

type Task = {
  journalCode: string;
  journalLabel: string;
  scopeKey: string;
  scopeLabel: string;
  sublabel?: string;
  journalDocumentId?: string;
  status: "not_taken" | "in_progress" | "pending_review" | "approved" | "rejected" | "completed";
  assigneeId: string | null;
  assigneeName: string | null;
  claimId: string | null;
  claimedAt: string | null;
  completedAt: string | null;
  overdueInProgress: boolean;
};

type Sub = {
  id: string;
  name: string;
  preset: string;
  positionLabel: string;
  hasTelegram: boolean;
  inProgressCount: number;
  pendingReviewCount: number;
  approvedCount: number;
  rejectedCount: number;
  notStarted: boolean;
  /** «отпуск» / «больничный» / «выходной» по графику — иначе null. */
  absence?: string | null;
};

type Resp = {
  today: string;
  tasks: Task[];
  subordinates: Sub[];
  summary: {
    total: number;
    notTaken: number;
    inProgress: number;
    pendingReview: number;
    approved: number;
    rejected: number;
    overdue: number;
    notStartedCount: number;
    noTelegramCount: number;
  };
};

type StatusFilter = "all" | "problems" | "not_taken" | "in_progress" | "pending_review";

const STATUS_META: Record<
  Task["status"],
  { bg: string; border: string; text: string; icon: typeof Activity }
> = {
  not_taken: {
    bg: "bg-[#fff8eb]",
    border: "border-[#ffe9b0]",
    text: "text-[#a13a32]",
    icon: AlertTriangle,
  },
  in_progress: {
    bg: "bg-[#eef1ff]",
    border: "border-[#5566f6]/30",
    text: "text-[#3848c7]",
    icon: Activity,
  },
  pending_review: {
    bg: "bg-[#f5f0ff]",
    border: "border-[#b496e6]/40",
    text: "text-[#5d3ab3]",
    icon: ClipboardCheck,
  },
  approved: {
    bg: "bg-[#ecfdf5]",
    border: "border-[#c8f0d5]",
    text: "text-[#136b2a]",
    icon: CheckCircle2,
  },
  rejected: {
    bg: "bg-[#fff4f2]",
    border: "border-[#ffd2cd]",
    text: "text-[#a13a32]",
    icon: XCircle,
  },
  completed: {
    bg: "bg-[#ecfdf5]",
    border: "border-[#c8f0d5]",
    text: "text-[#136b2a]",
    icon: CheckCircle2,
  },
};

/** Локализованные «10 мин» и «10 мин назад» (подписи — из каталога). */
function useTimeFormat() {
  const t = useTranslations("controlBoardUi.controlBoardClient");
  const duration = (iso: string): string | null => {
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return null;
    if (m < 60) return t("durationMin", { minutes: m });
    const h = Math.floor(m / 60);
    return t("durationHourMin", { hours: h, minutes: m % 60 });
  };
  const timeAgo = (iso: string | null): string => {
    if (!iso) return "—";
    return duration(iso) ?? t("justNow");
  };
  /**
   * «10 мин назад».
   *
   * Отдельно от `timeAgo`, потому что к нему приклеивали « назад» без
   * разбора — и получалось «только что назад» и «— назад».
   */
  const sinceText = (iso: string | null): string => {
    if (!iso) return t("recently");
    const value = duration(iso);
    return value === null ? t("justNow") : t("ago", { value });
  };
  return { timeAgo, sinceText };
}

export function ControlBoardClient() {
  const t = useTranslations("controlBoardUi.controlBoardClient");
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<StatusFilter>("problems");
  const [groupBy, setGroupBy] = useState<"journal" | "status">("status");
  const [busyButton, setBusyButton] = useState<string | null>(null);

  async function load() {
    try {
      const res = await fetch("/api/control-board", { cache: "no-store" });
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

  // Живое событие «журнал изменился» — перечитать сразу; опрос раз в
  // 30 с остаётся страховкой, если поток не доходит.
  useLiveRefetch(() => void load());

  async function remindAll() {
    setBusyButton("remind-all");
    try {
      const res = await fetch("/api/control-board/remind", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const j = (await res.json()) as RemindResult;
      if (!res.ok) {
        toast.error(j.error || t("remindFailed"));
        return;
      }
      showRemindResult(j, (sent) => t("remindSentTo", { count: sent }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("remindFailed"));
    } finally {
      setBusyButton(null);
    }
  }

  async function remindOne(userId: string, scopeLabel?: string) {
    setBusyButton(`remind-${userId}`);
    try {
      const res = await fetch("/api/control-board/remind", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userIds: [userId], scopeLabel }),
      });
      const j = (await res.json()) as RemindResult;
      if (!res.ok) {
        toast.error(j.error || t("remindFailed"));
        return;
      }
      showRemindResult(j, () => t("remindSent"));
    } catch {
      toast.error(t("remindFailed"));
    } finally {
      setBusyButton(null);
    }
  }

  const filteredTasks = useMemo(() => {
    if (!data) return [];
    switch (filter) {
      case "all":
        return data.tasks;
      case "not_taken":
        return data.tasks.filter((t) => t.status === "not_taken");
      case "in_progress":
        return data.tasks.filter((t) => t.status === "in_progress");
      case "pending_review":
        return data.tasks.filter((t) => t.status === "pending_review");
      case "problems":
        return data.tasks.filter(
          (t) =>
            t.status === "not_taken" ||
            t.status === "rejected" ||
            t.overdueInProgress ||
            t.status === "pending_review"
        );
    }
  }, [data, filter]);

  const grouped = useMemo(() => {
    const statusLabel = (status: Task["status"]): string => {
      switch (status) {
        case "not_taken":
          return t("statusNotTaken");
        case "in_progress":
          return t("statusInProgress");
        case "pending_review":
          return t("statusPendingReview");
        case "approved":
          return t("statusApproved");
        case "rejected":
          return t("statusRejected");
        case "completed":
          return t("statusCompleted");
      }
    };
    const groups = new Map<string, Task[]>();
    if (groupBy === "status") {
      const order: Task["status"][] = [
        "not_taken",
        "rejected",
        "in_progress",
        "pending_review",
        "approved",
      ];
      for (const s of order) groups.set(statusLabel(s), []);
      for (const task of filteredTasks) {
        const key = statusLabel(task.status);
        const arr = groups.get(key) ?? [];
        arr.push(task);
        groups.set(key, arr);
      }
    } else {
      // groupBy = journal
      for (const task of filteredTasks) {
        const arr = groups.get(task.journalLabel) ?? [];
        arr.push(task);
        groups.set(task.journalLabel, arr);
      }
    }
    return [...groups.entries()].filter(([, arr]) => arr.length > 0);
  }, [filteredTasks, groupBy, t]);

  // Первая загрузка — тот же скелет, что у `loading.tsx`: серверный скелет
  // сменяется клиентским незаметно. Раньше между ними на секунду-две вставал
  // пустой блок с крутилкой — экран «прыгал» дважды.
  if (loading && !data) return <ControlBoardLoading />;
  if (!data) return null;

  const s = data.summary;
  const compliance =
    s.total === 0
      ? 100
      : Math.round(((s.approved + s.pendingReview) / s.total) * 100);

  return (
    <div className="space-y-6">
      {/* В шапке оставляем только прогресс дня и просрочку — это то, ради
          чего заведующая открывает доску. Остальная разбивка по статусам
          живёт в светлой карточке ниже. */}
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <>
            <PageHeaderStat tone={compliance === 100 ? "ok" : "neutral"}>
              {/* Раньше здесь стояло просто «Прогресс дня: 0% (0 из 38)»,
                  и это число путали с «сколько журналов заполнено».
                  Считаем именно задачи смены, а не журналы. */}
              {t("progress", { done: s.approved + s.pendingReview, total: s.total, percent: compliance })}
            </PageHeaderStat>
            {s.overdue > 0 ? (
              <PageHeaderStat tone="warn">
                {t("overdue", { count: s.overdue })}
              </PageHeaderStat>
            ) : null}
          </>
        }
      />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label={t("statNotTaken")} value={s.notTaken} accent={s.notTaken > 0 ? "warn" : "ok"} />
        <Stat label={t("statInProgress")} value={s.inProgress} accent="info" />
        <Stat label={t("statPending")} value={s.pendingReview} accent={s.pendingReview > 0 ? "warn" : "ok"} />
        <Stat label={t("statOverdue")} value={s.overdue} accent={s.overdue > 0 ? "danger" : "ok"} />
      </div>

      {(s.notStartedCount > 0 || s.noTelegramCount > 0) ? (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-[#f3d9a8] bg-[#fffaf0] px-4 py-3">
          <AlertTriangle className="size-4 shrink-0 text-[#b8791f]" />
          <div className="text-[13px] text-[#0b1024]">
            {s.notStartedCount > 0
              ? t("notStartedLine", { count: s.notStartedCount })
              : ""}
            {s.notStartedCount > 0 && s.noTelegramCount > 0 ? " · " : ""}
            {s.noTelegramCount > 0
              ? t("noTelegramLine", { count: s.noTelegramCount })
              : ""}
          </div>
          {s.notStartedCount > 0 ? (
            <button
              type="button"
              onClick={remindAll}
              disabled={busyButton === "remind-all"}
              className="ml-auto inline-flex h-10 items-center gap-2 rounded-2xl bg-[#5566f6] px-4 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors hover:bg-[#4a5bf0]"
            >
              {busyButton === "remind-all" ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Bell className="size-3.5" />
              )}
              {t("remindAll")}
            </button>
          ) : null}
        </div>
      ) : null}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-[#ececf4] bg-white px-3 py-2">
        <Filter className="size-4 shrink-0 text-[#9b9fb3]" />
        <FilterPill cur={filter} v="problems" onClick={setFilter} label={t("filterProblems")} />
        <FilterPill cur={filter} v="not_taken" onClick={setFilter} label={t("filterNotTaken")} />
        <FilterPill cur={filter} v="in_progress" onClick={setFilter} label={t("filterInProgress")} />
        <FilterPill cur={filter} v="pending_review" onClick={setFilter} label={t("filterForReview")} />
        <FilterPill cur={filter} v="all" onClick={setFilter} label={t("filterAll")} />
        <div className="flex-1" />
        <span className="text-[11px] text-[#9b9fb3]">{t("groupLabel")}</span>
        <button
          type="button"
          onClick={() => setGroupBy(groupBy === "status" ? "journal" : "status")}
          className="text-[12px] font-medium text-[#3848c7] hover:underline"
        >
          {groupBy === "status" ? t("groupByStatus") : t("groupByJournal")}
        </button>
      </div>

      {/* Sections */}
      {grouped.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-6 py-14 text-center text-[14px] text-[#6f7282]">
          {filter === "problems"
            ? t("noProblems")
            : t("noTasks")}
        </div>
      ) : null}

      {grouped.map(([groupLabel, arr]) => (
        <section key={groupLabel} className="space-y-2">
          <div className="px-1 text-[12px] font-semibold uppercase tracking-[0.16em] text-[#9b9fb3]">
            {groupLabel} ({arr.length})
          </div>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {arr.map((task) => (
              <TaskCard
                key={task.scopeKey + task.journalCode}
                task={task}
                onRemind={() => task.assigneeId && remindOne(task.assigneeId, task.scopeLabel)}
                busy={busyButton === `remind-${task.assigneeId}`}
              />
            ))}
          </div>
        </section>
      ))}

      {/* Subordinates summary */}
      {data.subordinates.length > 0 ? (
        <section className="space-y-2">
          <div className="flex items-baseline justify-between px-1">
            <div className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#9b9fb3]">
              {t("bySubordinates", { count: data.subordinates.length })}
            </div>
            <Link href="/team" className="text-[12px] font-medium text-[#3848c7] hover:underline">
              {t("openTeam")}
            </Link>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {data.subordinates.map((sub) => (
              <SubCard
                key={sub.id}
                sub={sub}
                onRemind={() => remindOne(sub.id)}
                busy={busyButton === `remind-${sub.id}`}
              />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent: "ok" | "info" | "warn" | "danger";
}) {
  // Плитки переехали из тёмного hero на белый фон страницы — поэтому
  // палитра светлая, из дизайн-системы, а не полупрозрачно-белая.
  const colors = {
    ok: "border-[#ececf4] bg-white text-[#0b1024]",
    info: "border-[#dfe3ff] bg-[#f5f6ff] text-[#3848c7]",
    warn: "border-[#f3d9a8] bg-[#fffaf0] text-[#8a5a12]",
    danger: "border-[#f6cfc8] bg-[#fff4f2] text-[#a13a32]",
  };
  return (
    <div className={`rounded-2xl border px-4 py-3 ${colors[accent]}`}>
      <div className="text-[11px] uppercase tracking-[0.16em] opacity-70">{label}</div>
      <div className="mt-0.5 text-[24px] font-semibold leading-none tabular-nums">{value}</div>
    </div>
  );
}

function FilterPill({
  cur,
  v,
  onClick,
  label,
}: {
  cur: StatusFilter;
  v: StatusFilter;
  onClick: (v: StatusFilter) => void;
  label: string;
}) {
  const active = cur === v;
  return (
    <button
      type="button"
      onClick={() => onClick(v)}
      className={`inline-flex h-8 items-center rounded-full px-3 text-[12px] font-medium transition-colors ${
        active
          ? "bg-[#5566f6] text-white"
          : "bg-[#fafbff] text-[#6f7282] hover:bg-[#eef1ff] hover:text-[#3848c7]"
      }`}
    >
      {label}
    </button>
  );
}

function TaskCard({
  task,
  onRemind,
  busy,
}: {
  task: Task;
  onRemind: () => void;
  busy: boolean;
}) {
  const t = useTranslations("controlBoardUi.controlBoardClient");
  const { timeAgo, sinceText } = useTimeFormat();
  const meta = STATUS_META[task.status];
  const Icon = meta.icon;
  return (
    <div
      className={`rounded-2xl border ${meta.border} ${meta.bg} p-3 transition-colors`}
    >
      <div className="flex items-start gap-2">
        <span className={`flex size-8 shrink-0 items-center justify-center rounded-xl bg-white ${meta.text}`}>
          <Icon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium leading-tight text-[#0b1024]">
            {task.scopeLabel}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px] text-[#6f7282]">
            <span>{task.journalLabel}</span>
            {task.assigneeName ? (
              <>
                <span>·</span>
                <span className={meta.text}>{task.assigneeName}</span>
              </>
            ) : null}
            {task.claimedAt && task.status === "in_progress" ? (
              <>
                <span>·</span>
                <Clock className="size-3" />
                <span className={task.overdueInProgress ? "text-[#a13a32] font-medium" : ""}>
                  {timeAgo(task.claimedAt)}
                </span>
              </>
            ) : null}
            {task.completedAt && task.status === "pending_review" ? (
              <>
                <span>·</span>
                <span>{t("doneAgo", { value: sinceText(task.completedAt) })}</span>
              </>
            ) : null}
          </div>
          {task.overdueInProgress ? (
            <div className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-[10px] font-medium text-[#a13a32]">
              <AlertTriangle className="size-3" /> {t("stuck")}
            </div>
          ) : null}
        </div>
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {task.status === "in_progress" && task.assigneeId ? (
          <button
            type="button"
            onClick={onRemind}
            disabled={busy}
            className="inline-flex h-7 items-center gap-1 rounded-lg border border-[#dcdfed] bg-white px-2 text-[11px] text-[#3c4053] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
          >
            {busy ? <Loader2 className="size-3 animate-spin" /> : <Bell className="size-3" />}
            {t("remind")}
          </button>
        ) : null}
        {task.status === "pending_review" ? (
          <Link
            href="/verifications"
            className="inline-flex h-7 items-center gap-1 rounded-lg bg-[#5566f6] px-2 text-[11px] font-medium text-white"
          >
            <ClipboardCheck className="size-3" />
            {t("review")}
          </Link>
        ) : null}
      </div>
    </div>
  );
}

function SubCard({
  sub,
  onRemind,
  busy,
}: {
  sub: Sub;
  onRemind: () => void;
  busy: boolean;
}) {
  const t = useTranslations("controlBoardUi.controlBoardClient");
  const total =
    sub.inProgressCount + sub.pendingReviewCount + sub.approvedCount + sub.rejectedCount;
  // Человек в отпуске / на больничном / в выходной — не проблема, а
  // спокойная серая строка. Раньше он висел красным «не взял задачи».
  const isProblem = !sub.absence && (sub.notStarted || !sub.hasTelegram);
  return (
    <div
      className={`rounded-2xl border p-3 ${
        isProblem
          ? "border-[#ffd2cd] bg-[#fff4f2]"
          : sub.inProgressCount > 0
            ? "border-[#5566f6]/30 bg-[#eef1ff]"
            : "border-[#ececf4] bg-white"
      }`}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium text-[#0b1024]">{sub.name}</div>
          <div className="mt-0.5 text-[11px] text-[#6f7282]">
            {sub.positionLabel}
            {sub.absence ? t("todayAbsence", { absence: sub.absence }) : ""}
          </div>
        </div>
        {sub.hasTelegram && sub.notStarted && !sub.absence ? (
          <button
            type="button"
            onClick={onRemind}
            disabled={busy}
            className="inline-flex h-7 items-center gap-1 rounded-lg bg-white px-2 text-[11px] text-[#a13a32] border border-[#ffd2cd]"
            title={t("remindStart")}
          >
            {busy ? <Loader2 className="size-3 animate-spin" /> : <Bell className="size-3" />}
            {t("nudge")}
          </button>
        ) : null}
      </div>
      <div className="mt-2 flex flex-wrap gap-1 text-[11px]">
        {sub.inProgressCount > 0 ? (
          <span className="rounded-full bg-[#eef1ff] px-2 py-0.5 text-[#3848c7]">
            {t("subInProgress", { count: sub.inProgressCount })}
          </span>
        ) : null}
        {sub.pendingReviewCount > 0 ? (
          <span className="rounded-full bg-[#f5f0ff] px-2 py-0.5 text-[#5d3ab3]">
            {t("subPending", { count: sub.pendingReviewCount })}
          </span>
        ) : null}
        {sub.approvedCount > 0 ? (
          <span className="rounded-full bg-[#ecfdf5] px-2 py-0.5 text-[#136b2a]">
            {t("subApproved", { count: sub.approvedCount })}
          </span>
        ) : null}
        {sub.rejectedCount > 0 ? (
          <span className="rounded-full bg-[#fff4f2] px-2 py-0.5 text-[#a13a32]">
            {t("subRejected", { count: sub.rejectedCount })}
          </span>
        ) : null}
        {total === 0 && sub.hasTelegram ? (
          <span className="rounded-full bg-[#fff8eb] px-2 py-0.5 text-[#a13a32]">
            {t("noTasksToday")}
          </span>
        ) : null}
        {!sub.hasTelegram ? (
          <span className="rounded-full bg-[#ffe1dc] px-2 py-0.5 text-[#a13a32]">
            {t("noTelegram")}
          </span>
        ) : null}
      </div>
    </div>
  );
}

