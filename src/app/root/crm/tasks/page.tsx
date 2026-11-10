import Link from "next/link";
import { Building2, CalendarClock, CheckCircle2, Hourglass, Mail, MessagesSquare, Phone, Settings2, ShieldCheck } from "lucide-react";

import { requireRoot } from "@/lib/auth-helpers";
import { CRM_TASK_KIND_LABELS, listCrmTasks, listTaskAssignees, type TaskRow } from "@/lib/crm/tasks.server";
import { mskDateKey } from "@/lib/lifecycle/calendar";
import { canAccessPlatformPath } from "@/lib/platform-access";
import { platformViewerForSession } from "@/lib/platform-access.server";
import { cn } from "@/lib/utils";
import { formatDateTime, formatDue } from "../crm-format";
import { CARD, CrmHeader, SECONDARY_BUTTON, ZONE_TITLE } from "../crm-ui";
import { OfferButton } from "../offer-dialog";
import { NewTaskButton, TaskActions } from "./tasks-client";

export const dynamic = "force-dynamic";

export const metadata = { title: "Задачи CRM" };

type Who = "mine" | "all" | "unassigned";

/** Виды для фильтра: ручные и сценарные, в порядке важности. */
const KIND_FILTERS = ["approve_discount", "offer", "last_chance", "call", "payment_overdue", "lost_reason", "winback", "manual"] as const;

/** Задачи, где уместна кнопка «КП со скидкой». */
const OFFER_KINDS = new Set(["call", "offer", "last_chance", "lost_reason", "winback", "payment_overdue"]);

/**
 * Задачи CRM (2026-11-09, доработаны 2026-11-10): что сделать, кому и к
 * какому сроку. Большую часть ставит сценарий «пробный и оплата»
 * (`src/lib/lifecycle`): позвонить перед концом пробного, согласовать
 * скидку, последний шанс, оплата просрочена. Закрываются с итогом звонка —
 * итог двигает сделку в воронке. Менеджер с охватом «свои» видит свои
 * задачи и общую очередь.
 */
export default async function CrmTasksPage({ searchParams }: { searchParams: Promise<{ closed?: string; who?: string; kind?: string }> }) {
  const session = await requireRoot();
  const params = await searchParams;
  const showClosed = params.closed === "1";
  const viewer = await platformViewerForSession(session);
  const own = viewer.scope === "own";
  const who: Who = params.who === "all" || params.who === "unassigned" || params.who === "mine" ? params.who : own ? "mine" : "all";
  const kind = KIND_FILTERS.find((item) => item === params.kind) ?? null;
  const now = new Date();
  const [tasks, people] = await Promise.all([
    listCrmTasks({ includeClosed: showClosed, ownScopeId: own ? session.user.id : null, who, me: session.user.id, kind }),
    listTaskAssignees(),
  ]);
  const canSetup = canAccessPlatformPath(viewer, "/root/crm/automation");

  const approvals = tasks.filter((task) => task.kind === "approve_discount" && task.approvalStatus === "pending" && task.status === "open");
  const open = tasks.filter((task) => task.status === "open" && !approvals.includes(task));
  const waiting = tasks.filter((task) => task.status === "waiting");
  const overdue = open.filter((task) => task.dueAt.getTime() <= now.getTime());
  const upcoming = open.filter((task) => task.dueAt.getTime() > now.getTime());
  const done = tasks.filter((task) => task.status === "done" || task.status === "cancelled");
  const href = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams();
    const merged = { closed: showClosed ? "1" : null, who, kind, ...patch };
    for (const [key, value] of Object.entries(merged)) if (value) next.set(key, value);
    const query = next.toString();
    return query ? `/root/crm/tasks?${query}` : "/root/crm/tasks";
  };
  const chip = (active: boolean) => cn("inline-flex h-8 shrink-0 items-center rounded-full px-3 text-[13px] transition-colors", active ? "bg-[#eef1ff] font-medium text-[#3848c7]" : "text-[#6f7282] hover:bg-[#f5f6ff]");
  const nothingOpen = !approvals.length && !open.length && !waiting.length;

  return (
    <div className="space-y-6" data-crm-tasks>
      <CrmHeader
        active="/root/crm/tasks"
        title="Задачи"
        description="Кому позвонить и что согласовать. Задачи по оплате ставятся сами: перед концом пробного, в последние дни отсрочки и когда оплата просрочена. Оплатил клиент — его задачи закрываются сами."
        actions={
          <>
            {canSetup ? (
              <Link href="/root/crm/automation" className={SECONDARY_BUTTON}>
                <Settings2 className="size-4" />
                Автоворонка
              </Link>
            ) : null}
            <NewTaskButton people={people} me={session.user.id} tomorrow={mskDateKey(new Date(now.getTime() + 24 * 60 * 60 * 1000))} />
          </>
        }
      />

      <div className="space-y-2" data-crm-task-filters>
        <div className="-mx-1 flex gap-1 overflow-x-auto px-1">
          <Link href={href({ closed: null })} className={chip(!showClosed)}>
            В работе
          </Link>
          <Link href={href({ closed: "1" })} className={chip(showClosed)}>
            Закрытые за 30 дней
          </Link>
          <span className="mx-1 w-px shrink-0 self-stretch bg-[#ececf4]" aria-hidden />
          <Link href={href({ who: "mine" })} className={chip(who === "mine")}>
            Мои
          </Link>
          {!own ? (
            <Link href={href({ who: "all" })} className={chip(who === "all")}>
              Все
            </Link>
          ) : null}
          <Link href={href({ who: "unassigned" })} className={chip(who === "unassigned")}>
            Без ответственного
          </Link>
        </div>
        <div className="-mx-1 flex gap-1 overflow-x-auto px-1">
          <Link href={href({ kind: null })} className={chip(!kind)}>
            Все виды
          </Link>
          {KIND_FILTERS.map((item) => (
            <Link key={item} href={href({ kind: item })} className={chip(kind === item)}>
              {CRM_TASK_KIND_LABELS[item]}
            </Link>
          ))}
        </div>
      </div>

      {showClosed ? (
        <Zone title="Закрытые" icon={CheckCircle2} tasks={done} now={now} empty="За 30 дней закрытых задач нет." />
      ) : nothingOpen ? (
        <div className="rounded-3xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-6 py-10 text-center text-[14px] text-[#6f7282]" data-crm-tasks-empty>
          {kind || who === "unassigned" ? "По этому фильтру задач нет." : who === "mine" ? "У вас задач нет — все клиенты в порядке." : "Задач нет — все клиенты в порядке."}
        </div>
      ) : (
        <>
          {approvals.length ? <Zone title="Ждут согласования скидки" icon={ShieldCheck} tasks={approvals} now={now} tone="warn" /> : null}
          {overdue.length ? <Zone title="Просрочено" icon={CalendarClock} tasks={overdue} now={now} tone="alert" /> : null}
          {upcoming.length ? <Zone title="Сделать" icon={CalendarClock} tasks={upcoming} now={now} /> : null}
          {waiting.length ? <Zone title="Ждут решения по скидке" icon={Hourglass} tasks={waiting} now={now} /> : null}
        </>
      )}
    </div>
  );
}

function Zone({ title, icon: Icon, tasks, now, tone, empty }: { title: string; icon: typeof CalendarClock; tasks: TaskRow[]; now: Date; tone?: "alert" | "warn"; empty?: string }) {
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

/** Короткие факты из заметки: «Владелец: …», цифры аккаунта; остальное — под «Подробнее». */
function splitNote(note: string | null): { lead: string[]; rest: string[] } {
  const lines = (note ?? "")
    .split("\n")
    .map((line) => line.trim())
    // Ссылки текстом не показываем — для этого кнопки.
    .filter((line) => line && !/^https?:\/\//.test(line));
  return { lead: lines.slice(0, 2), rest: lines.slice(2) };
}

const ACTION = "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-2xl border border-[#dcdfed] bg-white px-3 text-[13px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]";

function TaskItem({ task, now }: { task: TaskRow; now: Date }) {
  const due = task.status === "open" || task.status === "waiting" ? formatDue(task.dueAt.toISOString(), now) : null;
  const closed = task.status === "done" || task.status === "cancelled";
  const { lead, rest } = splitNote(task.note);
  const phone = task.client.phone?.replace(/[^\d+]/g, "") ?? "";
  return (
    <li id={task.id} className="scroll-mt-24 px-4 py-4 sm:px-5" data-crm-task={task.kind}>
      <div className="flex flex-wrap items-center gap-1.5">
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
        {task.discountPercent ? <span className="rounded-full bg-[#eef8f0] px-2 py-0.5 text-[12px] text-[#116b2a]">скидка {task.discountPercent} %</span> : null}
        <span className="rounded-full bg-[#f6f6f9] px-2 py-0.5 text-[12px] text-[#6f7282]">{task.assigneeName ?? "Без ответственного"}</span>
        {closed ? <span className="text-[12px] text-[#9b9fb3]">{task.status === "done" ? "Выполнено" : "Отменено"} {formatDateTime(task.closedAt?.toISOString())}</span> : null}
      </div>
      <div className={cn("mt-1.5 text-[15px] font-medium leading-snug text-[#0b1024] [overflow-wrap:break-word]", closed && "text-[#6f7282]")}>{task.title}</div>
      {lead.length ? (
        <div className="mt-1 space-y-0.5 text-[13px] leading-relaxed text-[#3c4053] [overflow-wrap:break-word]">
          {lead.map((line, index) => (
            <p key={index}>{line}</p>
          ))}
        </div>
      ) : null}
      {rest.length ? (
        <details className="group mt-1 text-[13px] text-[#3c4053]">
          <summary className="cursor-pointer select-none text-[12.5px] text-[#3848c7] marker:content-none hover:underline">
            <span className="group-open:hidden">Подробнее</span>
            <span className="hidden group-open:inline">Скрыть</span>
          </summary>
          <div className="mt-1 space-y-0.5 leading-relaxed [overflow-wrap:break-word]">
            {rest.map((line, index) => (
              <p key={index}>{line}</p>
            ))}
          </div>
        </details>
      ) : null}
      {task.result ? <p className="mt-1.5 text-[13px] text-[#116b2a] [overflow-wrap:break-word]">Итог: {task.result}</p> : null}
      <div className="mt-3 flex flex-wrap items-center gap-2" data-crm-task-actions>
        {!closed && phone ? (
          <a href={`tel:${phone}`} className={ACTION} data-crm-call>
            <Phone className="size-4 text-[#5566f6]" />
            Позвонить
          </a>
        ) : null}
        {!closed && task.client.email ? (
          <a href={`mailto:${task.client.email}`} className={ACTION} data-crm-mail>
            <Mail className="size-4 text-[#5566f6]" />
            Написать
          </a>
        ) : null}
        {task.organizationId ? (
          <Link href={`/root/organizations/${task.organizationId}`} className={ACTION}>
            <Building2 className="size-4 text-[#5566f6]" />
            <span className="max-w-[180px] truncate">{task.organizationName ?? "Карточка клиента"}</span>
          </Link>
        ) : null}
        {task.contactId ? (
          <Link href={`/root/crm/contacts/${task.contactId}`} className={ACTION}>
            <MessagesSquare className="size-4 text-[#5566f6]" />
            Переписка
          </Link>
        ) : null}
        {!closed && task.organizationId && OFFER_KINDS.has(task.kind) && task.status === "open" ? (
          <OfferButton organizationId={task.organizationId} taskId={task.id} label={task.kind === "offer" ? "Отправить КП" : "КП со скидкой"} compact />
        ) : null}
        {!closed ? (
          <span className="ml-auto flex flex-wrap gap-2">
            <TaskActions task={{ id: task.id, kind: task.kind, status: task.status, discountPercent: task.discountPercent, approvalPending: task.approvalStatus === "pending" }} />
          </span>
        ) : null}
      </div>
    </li>
  );
}
