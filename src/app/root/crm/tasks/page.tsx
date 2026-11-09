import Link from "next/link";

import { requireRoot } from "@/lib/auth-helpers";
import { mskDay } from "@/lib/crm/lifecycle/calendar";
import { loadTasks, type TaskRow } from "@/lib/crm/lifecycle/queries.server";
import { listCrmOwners } from "@/lib/crm/queries.server";
import { platformViewerForSession } from "@/lib/platform-access.server";
import { cn } from "@/lib/utils";
import { CrmHeader, ZONE_TITLE } from "../crm-ui";
import { NewTaskButton, TaskCard } from "../pipeline-ui";

export const dynamic = "force-dynamic";

export const metadata = { title: "Задачи — CRM" };

type Search = Record<string, string | string[] | undefined>;

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function groupOf(task: TaskRow, now: Date): "overdue" | "today" | "tomorrow" | "later" {
  const due = new Date(task.dueAt);
  if (due.getTime() < now.getTime()) return "overdue";
  const today = mskDay(now);
  const day = mskDay(due);
  if (day === today) return "today";
  const tomorrow = mskDay(new Date(now.getTime() + 86_400_000));
  return day === tomorrow ? "tomorrow" : "later";
}

const GROUPS = [
  { key: "overdue", title: "Просрочено" },
  { key: "today", title: "Сегодня" },
  { key: "tomorrow", title: "Завтра" },
  { key: "later", title: "Позже" },
] as const;

export default async function CrmTasksPage({ searchParams }: { searchParams: Promise<Search> }) {
  const session = await requireRoot();
  const viewer = await platformViewerForSession(session);
  const own = viewer.scope === "own";
  const params = await searchParams;
  const who = own ? "me" : (one(params.who) ?? "me");
  const kind = one(params.kind) ?? "all";
  const [tasks, owners] = await Promise.all([loadTasks({ who, kind }, { userId: session.user.id, own }), listCrmOwners({ userId: session.user.id, own })]);
  const now = new Date();
  const nowIso = now.toISOString();
  const people = owners.map((owner) => ({ id: owner.id, name: owner.name }));
  const link = (patch: { who?: string; kind?: string }) => {
    const next = { who, kind, ...patch };
    const query = new URLSearchParams(Object.entries(next).filter(([key, value]) => value && !(key === "kind" && value === "all") && !(key === "who" && value === "me")) as [string, string][]);
    return `/root/crm/tasks${query.size ? `?${query}` : ""}`;
  };
  const chip = (active: boolean) =>
    cn(
      "inline-flex h-8 items-center rounded-xl px-3 text-[13px] transition-colors",
      active ? "bg-[#0b1024] font-medium text-white" : "border border-[#ececf4] bg-white text-[#3c4053] hover:border-[#5566f6]/40",
    );
  const grouped = GROUPS.map((group) => ({ ...group, list: tasks.open.filter((task) => groupOf(task, now) === group.key) }));
  return (
    <div className="space-y-6" data-crm-tasks-page>
      <CrmHeader
        active="/root/crm/tasks"
        own={own}
        title="Задачи"
        description="Звонки, сообщения, спец-КП и согласования скидок. Автоворонка ставит их сама — за 4 и 2 дня до конца пробного или оплаты, в грейс, по неоплаченным счетам. Итог задачи пишется в переписку и двигает сделку в воронке."
        actions={<NewTaskButton people={people} defaultAssigneeId={session.user.id} canAssign={!own} />}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Link className={chip(who === "me")} href={link({ who: "me" })}>
          Мои
        </Link>
        {!own ? (
          <>
            <Link className={chip(who === "all")} href={link({ who: "all" })}>
              Все
            </Link>
            <Link className={chip(who === "none")} href={link({ who: "none" })}>
              Без ответственного
            </Link>
          </>
        ) : null}
        <span className="mx-1 h-5 w-px bg-[#ececf4]" />
        <Link className={chip(kind === "all")} href={link({ kind: "all" })}>
          Все виды
        </Link>
        <Link className={chip(kind === "call")} href={link({ kind: "call" })}>
          Звонки
        </Link>
        <Link className={chip(kind === "approval")} href={link({ kind: "approval" })}>
          Согласования
        </Link>
        <Link className={chip(kind === "offer")} href={link({ kind: "offer" })}>
          Отправить КП
        </Link>
        <Link className={chip(kind === "invoice")} href={link({ kind: "invoice" })}>
          Счета
        </Link>
      </div>
      {tasks.open.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-[#dcdfed] bg-white px-6 py-10 text-center text-[14px] text-[#6f7282]">Открытых задач нет.</div>
      ) : null}
      {grouped
        .filter((group) => group.list.length)
        .map((group) => (
          <section key={group.key} className="space-y-2" data-task-group={group.key}>
            <h2 className={cn(ZONE_TITLE, group.key === "overdue" && "text-[#c0392b]")}>
              {group.title} · {group.list.length}
            </h2>
            <ul className="space-y-2">
              {group.list.map((task) => (
                <TaskCard key={task.id} task={task} nowIso={nowIso} people={people} canAssign={!own} />
              ))}
            </ul>
          </section>
        ))}
      {tasks.done.length ? (
        <details className="group">
          <summary className={cn(ZONE_TITLE, "cursor-pointer list-none")}>Закрыто за 7 дней · {tasks.done.length}</summary>
          <ul className="mt-2 space-y-2">
            {tasks.done.map((task) => (
              <TaskCard key={task.id} task={task} nowIso={nowIso} people={people} canAssign={false} />
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
