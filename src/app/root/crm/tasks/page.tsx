import Link from "next/link";
import { CalendarClock, CheckCircle2, Hourglass, ShieldCheck } from "lucide-react";

import { requireRoot } from "@/lib/auth-helpers";
import { CRM_TASK_KIND_LABELS, listCrmTasks, listTaskAssignees, readLifecycleSettings, type TaskRow } from "@/lib/crm/tasks.server";
import { mskDateKey } from "@/lib/lifecycle/calendar";
import { canAccessPlatformPath } from "@/lib/platform-access";
import { platformViewerForSession } from "@/lib/platform-access.server";
import { cn } from "@/lib/utils";
import { formatDateTime, formatDue } from "../crm-format";
import { CARD, CrmHeader, ZONE_TITLE } from "../crm-ui";
import { LifecycleSettingsForm, NewTaskButton, TaskActions } from "./tasks-client";

export const dynamic = "force-dynamic";

export const metadata = { title: "Задачи CRM" };

/**
 * Задачи CRM (2026-11-09): что сделать, кому и к какому сроку. Большую часть
 * ставит сценарий «пробный и оплата» (`src/lib/lifecycle`): позвонить перед
 * концом пробного, согласовать скидку большому клиенту, оплата просрочена.
 * Менеджер с охватом «свои» видит только свои задачи.
 */
export default async function CrmTasksPage({ searchParams }: { searchParams: Promise<{ closed?: string }> }) {
  const session = await requireRoot();
  const { closed } = await searchParams;
  const showClosed = closed === "1";
  const viewer = await platformViewerForSession(session);
  const own = viewer.scope === "own";
  const now = new Date();
  const [tasks, people, settings] = await Promise.all([
    listCrmTasks({ includeClosed: showClosed, assigneeId: own ? session.user.id : null }),
    listTaskAssignees(),
    readLifecycleSettings(),
  ]);
  const canSetup = canAccessPlatformPath(viewer, "/api/root/crm/tasks/settings", "PUT");

  const approvals = tasks.filter((task) => task.kind === "approve_discount" && task.approvalStatus === "pending" && task.status === "open");
  const open = tasks.filter((task) => task.status === "open" && !approvals.includes(task));
  const waiting = tasks.filter((task) => task.status === "waiting");
  const overdue = open.filter((task) => task.dueAt.getTime() <= now.getTime());
  const upcoming = open.filter((task) => task.dueAt.getTime() > now.getTime());
  const done = tasks.filter((task) => task.status === "done" || task.status === "cancelled");

  return (
    <div className="space-y-8" data-crm-tasks>
      <CrmHeader
        active="/root/crm/tasks"
        title="Задачи"
        description="Кому позвонить и что согласовать. Задачи по оплате ставятся сами: за 4 и 2 рабочих дня до конца пробного, когда оплата просрочена и когда пробный закончился без оплаты. Оплатил клиент — его задачи закрываются сами."
        actions={<NewTaskButton people={people} me={session.user.id} tomorrow={mskDateKey(new Date(now.getTime() + 24 * 60 * 60 * 1000))} />}
      />

      <div className="flex flex-wrap gap-2 text-[13px]">
        <Link
          href="/root/crm/tasks"
          className={cn("rounded-full px-3 py-1.5 transition-colors", !showClosed ? "bg-[#eef1ff] font-medium text-[#3848c7]" : "text-[#6f7282] hover:bg-[#f5f6ff]")}
        >
          В работе
        </Link>
        <Link
          href="/root/crm/tasks?closed=1"
          className={cn("rounded-full px-3 py-1.5 transition-colors", showClosed ? "bg-[#eef1ff] font-medium text-[#3848c7]" : "text-[#6f7282] hover:bg-[#f5f6ff]")}
        >
          Закрытые за 30 дней
        </Link>
      </div>

      {showClosed ? (
        <Zone title="Закрытые" icon={CheckCircle2} tasks={done} now={now} empty="За 30 дней закрытых задач нет." />
      ) : (
        <>
          {approvals.length ? <Zone title="Ждут согласования скидки" icon={ShieldCheck} tasks={approvals} now={now} tone="warn" /> : null}
          <Zone title="Просрочено" icon={CalendarClock} tasks={overdue} now={now} tone="alert" empty="Просроченных задач нет." hideEmpty />
          <Zone title="Сделать" icon={CalendarClock} tasks={upcoming} now={now} empty="Задач нет — все клиенты в порядке." />
          {waiting.length ? <Zone title="Ждут решения по скидке" icon={Hourglass} tasks={waiting} now={now} /> : null}
        </>
      )}

      {canSetup ? (
        <section className={cn(CARD, "p-5 sm:p-6")} data-crm-lifecycle-settings>
          <div className={ZONE_TITLE}>Сценарий «пробный и оплата»</div>
          <p className="mt-2 max-w-[760px] text-[13.5px] leading-relaxed text-[#6f7282]">
            Письма клиенту со счётом за {settings.trialFirstWorkdays} и {settings.trialSecondWorkdays} рабочих дня до конца пробного; задача менеджеру — только по живым
            аккаунтам (от {settings.activeMinUsers} сотрудников или записи в журналах за неделю). У клиента с закреплённым менеджером задачи идут ему.
          </p>
          <LifecycleSettingsForm settings={settings} people={people} />
        </section>
      ) : null}
    </div>
  );
}

function Zone({
  title,
  icon: Icon,
  tasks,
  now,
  tone,
  empty,
  hideEmpty,
}: {
  title: string;
  icon: typeof CalendarClock;
  tasks: TaskRow[];
  now: Date;
  tone?: "alert" | "warn";
  empty?: string;
  hideEmpty?: boolean;
}) {
  if (!tasks.length && hideEmpty) return null;
  return (
    <section className="space-y-3">
      <h2 className={cn(ZONE_TITLE, "flex items-center gap-2", tone === "alert" && "text-[#a13a32]")}>
        <Icon className="size-4" />
        {title} · {tasks.length}
      </h2>
      {tasks.length ? (
        <ul className={cn(CARD, "divide-y divide-[#ececf4]")}>
          {tasks.map((task) => (
            <TaskItem key={task.id} task={task} now={now} />
          ))}
        </ul>
      ) : (
        <div className="rounded-3xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-6 py-8 text-center text-[13.5px] text-[#6f7282]">{empty}</div>
      )}
    </section>
  );
}

function TaskItem({ task, now }: { task: TaskRow; now: Date }) {
  const due = task.status === "open" || task.status === "waiting" ? formatDue(task.dueAt.toISOString(), now) : null;
  const closed = task.status === "done" || task.status === "cancelled";
  return (
    <li id={task.id} className="scroll-mt-24 px-4 py-4 sm:px-5" data-crm-task={task.kind}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-[#f5f6ff] px-2 py-0.5 text-[12px] text-[#3848c7]">{CRM_TASK_KIND_LABELS[task.kind] ?? task.kind}</span>
            {due ? (
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[12px] font-medium tabular-nums",
                  due.tone === "overdue" ? "bg-[#fff4f2] text-[#a13a32]" : due.tone === "today" ? "bg-[#fff8eb] text-[#7a4a00]" : "bg-[#f5f6ff] text-[#3848c7]",
                )}
              >
                {due.label}
              </span>
            ) : null}
            {closed ? <span className="text-[12px] text-[#9b9fb3]">{task.status === "done" ? "Выполнено" : "Отменено"} {formatDateTime(task.closedAt?.toISOString())}</span> : null}
          </div>
          <div className={cn("mt-1.5 text-[15px] font-medium text-[#0b1024]", closed && "text-[#6f7282]")}>{task.title}</div>
          {task.note ? <p className="mt-1 whitespace-pre-line text-[13px] leading-relaxed text-[#3c4053] [overflow-wrap:anywhere]">{task.note}</p> : null}
          {task.result ? <p className="mt-1.5 text-[13px] text-[#116b2a]">Итог: {task.result}</p> : null}
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-[#6f7282]">
            <span>Исполнитель: {task.assigneeName ?? "РОП"}</span>
            {task.organizationId ? (
              <Link href={`/root/organizations/${task.organizationId}`} className="text-[#3848c7] hover:underline">
                {task.organizationName ?? "Карточка клиента"}
              </Link>
            ) : null}
            {task.contactId ? (
              <Link href={`/root/crm/contacts/${task.contactId}`} className="text-[#3848c7] hover:underline">
                Переписка
              </Link>
            ) : null}
          </div>
        </div>
        {!closed ? <TaskActions task={{ id: task.id, kind: task.kind, status: task.status, discountPercent: task.discountPercent, approvalPending: task.approvalStatus === "pending" }} /> : null}
      </div>
    </li>
  );
}
