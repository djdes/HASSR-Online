import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  ClipboardList,
  FileDown,
  FileSignature,
  FileText,
  Filter,
  Handshake,
  Hourglass,
  Inbox,
  KanbanSquare,
  LayoutDashboard,
  ListChecks,
  type LucideIcon,
  Mail,
  MailCheck,
  Megaphone,
  MessageSquareText,
  Receipt,
  TrendingUp,
  UserPlus,
  UsersRound,
  Workflow,
  BadgePercent,
} from "lucide-react";

import { requireRoot } from "@/lib/auth-helpers";
import { CRM_STAGES } from "@/lib/crm/constants";
import { listSalesHeads } from "@/lib/crm/notify.server";
import { loadCrmSummary, type CrmContactRow } from "@/lib/crm/queries.server";
import { countCrmTasks } from "@/lib/crm/tasks.server";
import { countDeals } from "@/lib/lifecycle/deals.server";
import { canAccessPlatformPath } from "@/lib/platform-access";
import { platformViewerForSession } from "@/lib/platform-access.server";
import { cn } from "@/lib/utils";
import { channelLabel, displayName, formatAgo, formatDateTime, formatDue, itemHeadline } from "./crm-format";
import { AddLeadButton, SyncButton } from "./crm-toolbar";
import { CARD, ChannelIcon, CrmHeader, StageBadge, ZONE_TITLE } from "./crm-ui";

export const dynamic = "force-dynamic";

export const metadata = { title: "CRM" };

type Tool = { href: string; label: string; hint: string; icon: LucideIcon };

const TOOLS: Tool[] = [
  { href: "/root/crm/funnel", label: "Воронка продаж", hint: "Пробные и продления по колонкам: договор, письмо, звонок, оплата", icon: KanbanSquare },
  { href: "/root/crm/tasks", label: "Задачи", hint: "Звонки, согласования скидок, просроченные оплаты", icon: ListChecks },
  { href: "/root/crm/automation", label: "Автоворонка", hint: "Письма и задачи сценария «пробный и оплата», прогноз на неделю", icon: Workflow },
  { href: "/root/crm/contacts", label: "Контакты и переписка", hint: "Вся переписка с человеком по всем каналам", icon: Inbox },
  { href: "/root/feedback", label: "Онлайн-чат и обращения", hint: "Ответить в чате поддержки и на обращения с сайта", icon: MessageSquareText },
  { href: "/root/service-requests", label: "Заявки и показы", hint: "Услуги и «Покажите за 15 минут»", icon: ClipboardList },
  { href: "/root/proposals", label: "Коммерческие предложения", hint: "Собрать и отправить КП", icon: FileText },
  { href: "/root/invoices", label: "Счета гостей", hint: "Счета по ИНН без регистрации", icon: Receipt },
  { href: "/root/mailing", label: "Рассылки", hint: "Письма по базе контактов", icon: Megaphone },
  { href: "/root/funnel", label: "Воронка регистраций", hint: "Откуда приходят и где отваливаются", icon: Filter },
  { href: "/root/blank-downloads", label: "Скачивания шаблонов", hint: "Кто скачал шаблоны журналов с сайта", icon: FileDown },
  { href: "/root", label: "Клиенты платформы", hint: "Карточки организаций, договор, оплаты", icon: LayoutDashboard },
  { href: "/root/partners", label: "Партнёры", hint: "Заявки партнёров и их клиенты", icon: Handshake },
  { href: "/root/edo", label: "ЭДО", hint: "Договоры, счета и УПД через Saby", icon: FileSignature },
  { href: "/root/me", label: "Моя почта", hint: "С какого адреса уходят письма клиентам", icon: MailCheck },
  { href: "/root/crm/mail", label: "Почта и фильтры", hint: "Ящики IMAP, отсеянные письма, правила", icon: Mail },
  { href: "/root/team", label: "Команда и РОП", hint: "Кто видит CRM и кому идут напоминания", icon: UsersRound },
];

function Tile({ href, label, value, sub, tone, icon: Icon }: { href: string; label: string; value: number; sub?: string; tone: "alert" | "warn" | "calm"; icon: LucideIcon }) {
  return (
    <Link
      href={href}
      className={cn(
        CARD,
        "group flex flex-col gap-2 p-4 transition-colors duration-150 hover:border-[#5566f6]/40 sm:p-5",
        tone === "alert" && "border-[#f3d0cb] bg-[#fff4f2]",
        tone === "warn" && "border-[#f4e3c4] bg-[#fff8eb]",
      )}
      data-crm-tile={label}
    >
      <span className="flex items-center gap-2 text-[13px] text-[#6f7282]">
        <Icon className={cn("size-4", tone === "alert" ? "text-[#a13a32]" : tone === "warn" ? "text-[#a16d32]" : "text-[#5566f6]")} />
        {label}
      </span>
      <span className={cn("text-[30px] font-semibold tabular-nums leading-none tracking-[-0.02em]", tone === "alert" ? "text-[#a13a32]" : "text-[#0b1024]")}>{value}</span>
      {sub ? <span className="text-[12.5px] text-[#6f7282]">{sub}</span> : null}
    </Link>
  );
}

function ContactLine({ row, right, rightTone }: { row: CrmContactRow; right: string; rightTone?: "alert" | "warn" }) {
  return (
    <li>
      <Link href={`/root/crm/contacts/${row.id}`} className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-[#fafbff] sm:px-5">
        <span className="min-w-0">
          <span className="flex items-center gap-2">
            <span className="truncate text-[14px] font-medium text-[#0b1024]">{displayName(row)}</span>
            {row.company && row.name ? <span className="hidden truncate text-[12.5px] text-[#9b9fb3] sm:inline">{row.company}</span> : null}
          </span>
          <span className="mt-0.5 block truncate text-[12.5px] text-[#6f7282]">
            {row.last ? `${channelLabel(row.last.channel)}: ${row.last.body}` : channelLabel(row.source)}
          </span>
        </span>
        <span
          className={cn(
            "shrink-0 rounded-full px-2 py-0.5 text-[12px] font-medium tabular-nums",
            rightTone === "alert" ? "bg-[#fff4f2] text-[#a13a32]" : rightTone === "warn" ? "bg-[#fff8eb] text-[#7a4a00]" : "bg-[#f5f6ff] text-[#3848c7]",
          )}
        >
          {right}
        </span>
      </Link>
    </li>
  );
}

export default async function CrmSummaryPage() {
  const session = await requireRoot();
  const now = new Date();
  const viewer = await platformViewerForSession(session);
  const own = viewer.scope === "own";
  const scope = own ? session.user.id : null;
  const [summary, heads, tasks, deals] = await Promise.all([
    loadCrmSummary(now, { userId: session.user.id, own }),
    listSalesHeads(),
    countCrmTasks({ ownScopeId: scope, now }).catch(() => ({ today: 0, overdue: 0, approvals: 0 })),
    countDeals({ ownScopeId: scope, now }).catch(() => ({ open: 0, dueSoon: 0 })),
  ]);
  const { digest } = summary;
  const tools = TOOLS.filter((tool) => canAccessPlatformPath(viewer, tool.href));
  const maxChannel = Math.max(1, ...summary.channels.map((item) => item.count));
  const attention = summary.awaiting.length > 0 || summary.nextSteps.length > 0;
  const mailIssue = summary.mailboxes.find((mailbox) => mailbox.lastError);

  return (
    <div className="space-y-8" data-crm-summary>
      <CrmHeader
        active="/root/crm"
        title="CRM"
        description="Все обращения — формы сайта, онлайн-чат, Telegram-бот, рабочая почта, заявки, регистрации и лиды из мессенджеров — в одном месте. РОП и ответственным приходят напоминания, если клиенту не ответили или он замолчал."
        actions={
          <>
            <SyncButton />
            <AddLeadButton primary />
          </>
        }
      />

      <section className="space-y-3" aria-labelledby="crm-now">
        <h2 id="crm-now" className={ZONE_TITLE}>
          Что сделать сейчас
        </h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Tile
            href="/root/crm/contacts?queue=awaiting"
            label="Ждут ответа"
            value={digest.awaiting}
            sub={digest.overdue ? `дольше 4 часов — ${digest.overdue}` : digest.awaiting ? "ответьте до 30 минут" : "всем ответили"}
            tone={digest.overdue ? "alert" : digest.awaiting ? "warn" : "calm"}
            icon={Hourglass}
          />
          <Tile
            href="/root/crm/contacts?queue=next"
            label="Шаги на сегодня"
            value={digest.nextToday + digest.nextOverdue}
            sub={digest.nextOverdue ? `просрочено — ${digest.nextOverdue}` : "звонки, КП, встречи"}
            tone={digest.nextOverdue ? "alert" : "calm"}
            icon={CalendarClock}
          />
          <Tile
            href="/root/crm/contacts?queue=waiting"
            label="Молчат после ответа"
            value={digest.silent}
            sub="3+ дня без ответа клиента"
            tone={digest.silent ? "warn" : "calm"}
            icon={TrendingUp}
          />
          <Tile href="/root/crm/contacts?queue=leads" label="Новых за сутки" value={digest.newLeads} sub={`всего контактов: ${summary.total}`} tone="calm" icon={UserPlus} />
        </div>
      </section>

      <section className="space-y-3" aria-labelledby="crm-sales">
        <h2 id="crm-sales" className={ZONE_TITLE}>
          Продажи и оплаты
        </h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-crm-sales-tiles>
          <Tile
            href="/root/crm/tasks"
            label="Задачи на сегодня"
            value={tasks.today + tasks.overdue}
            sub={tasks.overdue ? `просрочено — ${tasks.overdue}` : tasks.today ? "звонки и КП" : "на сегодня всё"}
            tone={tasks.overdue ? "alert" : tasks.today ? "warn" : "calm"}
            icon={ListChecks}
          />
          <Tile
            href="/root/crm/tasks?kind=approve_discount"
            label="Скидки на согласовании"
            value={tasks.approvals}
            sub={tasks.approvals ? "менеджер ждёт решения" : "ничего не ждёт"}
            tone={tasks.approvals ? "warn" : "calm"}
            icon={BadgePercent}
          />
          <Tile href="/root/crm/funnel" label="Сделки в работе" value={deals.open} sub="пробные и продления" tone="calm" icon={KanbanSquare} />
          <Tile
            href="/root/crm/funnel?soon=1"
            label="Срок за 7 дней"
            value={deals.dueSoon}
            sub={deals.dueSoon ? "пробный или оплата кончаются" : "ближайшая неделя спокойная"}
            tone={deals.dueSoon ? "warn" : "calm"}
            icon={CalendarClock}
          />
        </div>
      </section>

      {attention ? (
        <section className="space-y-3" aria-labelledby="crm-attention">
          <h2 id="crm-attention" className={ZONE_TITLE}>
            Требует внимания
          </h2>
          <div className="grid gap-4 lg:grid-cols-2">
            {summary.awaiting.length ? (
              <div className={CARD}>
                <div className="flex items-center justify-between gap-2 border-b border-[#eef0f6] px-4 py-3 sm:px-5">
                  <span className="text-[15px] font-semibold text-[#0b1024]">Клиент ждёт ответа</span>
                  <Link href="/root/crm/contacts?queue=awaiting" className="inline-flex items-center gap-1 text-[13px] text-[#3848c7] hover:underline">
                    Все <ArrowRight className="size-3.5" />
                  </Link>
                </div>
                <ul className="divide-y divide-[#eef0f6]">
                  {summary.awaiting.map((row) => (
                    <ContactLine
                      key={row.id}
                      row={row}
                      right={formatAgo(row.awaitingSince, now)}
                      rightTone={row.awaitingSince && row.awaitingSince <= summary.overdueBefore ? "alert" : "warn"}
                    />
                  ))}
                </ul>
              </div>
            ) : null}
            {summary.nextSteps.length ? (
              <div className={CARD}>
                <div className="flex items-center justify-between gap-2 border-b border-[#eef0f6] px-4 py-3 sm:px-5">
                  <span className="text-[15px] font-semibold text-[#0b1024]">Следующие шаги на сегодня</span>
                  <Link href="/root/crm/contacts?queue=next" className="inline-flex items-center gap-1 text-[13px] text-[#3848c7] hover:underline">
                    Все <ArrowRight className="size-3.5" />
                  </Link>
                </div>
                <ul className="divide-y divide-[#eef0f6]">
                  {summary.nextSteps.map((row) => {
                    const due = formatDue(row.nextActionAt, now);
                    return <ContactLine key={row.id} row={row} right={due?.label ?? "—"} rightTone={due?.tone === "overdue" ? "alert" : undefined} />;
                  })}
                </ul>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      <section className="space-y-3" aria-labelledby="crm-flow">
        <h2 id="crm-flow" className={ZONE_TITLE}>
          Поток обращений
        </h2>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <div className={CARD}>
            <div className="border-b border-[#eef0f6] px-4 py-3 text-[15px] font-semibold text-[#0b1024] sm:px-5">Последние обращения</div>
            {summary.recent.length ? (
              <ul className="divide-y divide-[#eef0f6]">
                {summary.recent.map((item) => {
                  return (
                    <li key={item.id}>
                      <Link href={`/root/crm/contacts/${item.contact?.id ?? ""}`} className="flex gap-3 px-4 py-3 transition-colors hover:bg-[#fafbff] sm:px-5">
                        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl bg-[#eef1ff] text-[#5566f6]">
                          <ChannelIcon channel={item.channel} className="size-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                            <span className="truncate text-[14px] font-medium text-[#0b1024]">{item.contact ? displayName(item.contact) : "—"}</span>
                            <span className="shrink-0 text-[12px] text-[#9b9fb3]">{formatDateTime(item.occurredAt)}</span>
                          </span>
                          <span className="mt-0.5 block truncate text-[12.5px] text-[#6f7282]">
                            {itemHeadline(item.channel, item.subject)} — {item.body}
                          </span>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="px-5 py-6 text-[13.5px] text-[#6f7282]">
                Обращений пока нет. Нажмите «Обновить сейчас» — CRM соберёт заявки, чаты и обращения за 90 дней.
              </p>
            )}
          </div>
          <div className="space-y-4">
            <div className={cn(CARD, "p-4 sm:p-5")}>
              <div className="text-[15px] font-semibold text-[#0b1024]">За 30 дней по каналам</div>
              {summary.channels.length ? (
                <ul className="mt-3 space-y-2">
                  {summary.channels.slice(0, 10).map((item) => (
                    <li key={item.channel}>
                      <Link href={`/root/crm/contacts?channel=${item.channel}`} className="block">
                        <span className="flex items-baseline justify-between gap-2 text-[13px]">
                          <span className="text-[#3c4053]">{channelLabel(item.channel)}</span>
                          <span className="tabular-nums text-[#0b1024]">{item.count}</span>
                        </span>
                        <span className="mt-1 block h-1.5 rounded-full bg-[#f0f1f8]">
                          <span className="block h-1.5 rounded-full bg-[#5566f6]" style={{ width: `${Math.max(4, Math.round((item.count / maxChannel) * 100))}%` }} />
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-[13px] text-[#6f7282]">Пока пусто.</p>
              )}
            </div>
            <div className={cn(CARD, "p-4 sm:p-5")}>
              <div className="text-[15px] font-semibold text-[#0b1024]">Стадии</div>
              <div className="mt-3 flex flex-wrap gap-2">
                {CRM_STAGES.map((stage) => (
                  <Link key={stage} href={`/root/crm/contacts?stage=${stage}`} className="inline-flex items-center gap-1.5 rounded-2xl border border-[#ececf4] px-3 py-1.5 text-[13px] hover:bg-[#fafbff]">
                    <StageBadge stage={stage} />
                    <span className="tabular-nums text-[#0b1024]">{summary.stages[stage] ?? 0}</span>
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="space-y-3" aria-labelledby="crm-tools">
        <h2 id="crm-tools" className={ZONE_TITLE}>
          Инструменты и настройка
        </h2>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <div className="grid gap-2 sm:grid-cols-2">
            {tools.map((tool) => (
              <Link key={tool.href} href={tool.href} className={cn(CARD, "flex items-start gap-3 p-3.5 transition-colors hover:border-[#5566f6]/40 hover:bg-[#fafbff]")}>
                <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#eef1ff] text-[#5566f6]">
                  <tool.icon className="size-4" />
                </span>
                <span className="min-w-0">
                  <span className="block text-[14px] font-medium text-[#0b1024]">{tool.label}</span>
                  <span className="block text-[12.5px] leading-snug text-[#6f7282]">{tool.hint}</span>
                </span>
              </Link>
            ))}
          </div>
          {own ? (
            <div className={cn(CARD, "h-fit space-y-2 p-4 sm:p-5")} data-crm-status>
              <div className="text-[13px] font-semibold uppercase tracking-[0.12em] text-[#6f7282]">Ваши клиенты</div>
              <p className="text-[13.5px] leading-snug text-[#3c4053]">
                Видны ваши контакты и свободные лиды без ответственного — откройте свободный и нажмите «Взять себе». Клиентов за вами закрепляет РОП
                {heads.length ? ` (${heads.map((head) => head.name).join(", ")})` : ""}.
              </p>
            </div>
          ) : (
          <div className={cn(CARD, "h-fit space-y-4 p-4 sm:p-5")} data-crm-status>
            <div>
              <div className="text-[13px] font-semibold uppercase tracking-[0.12em] text-[#6f7282]">РОП</div>
              {heads.length ? (
                <p className="mt-1 text-[14px] text-[#0b1024]">{heads.map((head) => head.name).join(", ")}</p>
              ) : (
                <p className="mt-1 text-[13.5px] text-[#7a4a00]">Не назначен — напоминания уходят администраторам. Назначьте в «Команде и доступах».</p>
              )}
            </div>
            <div>
              <div className="text-[13px] font-semibold uppercase tracking-[0.12em] text-[#6f7282]">Рабочая почта</div>
              {summary.mailboxes.length ? (
                <ul className="mt-1 space-y-1">
                  {summary.mailboxes.map((mailbox) => (
                    <li key={mailbox.id} className="text-[13.5px] text-[#0b1024]">
                      {mailbox.username}
                      <span className={cn("ml-2 text-[12.5px]", mailbox.lastError ? "text-[#a13a32]" : "text-[#6f7282]")}>
                        {mailbox.lastError ? `ошибка: ${mailbox.lastError}` : mailbox.lastSyncAt ? `проверена ${formatDateTime(mailbox.lastSyncAt)}` : "ещё не проверялась"}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-[13.5px] text-[#6f7282]">
                  Не подключена. <Link href="/root/crm/mail" className="text-[#3848c7] hover:underline">Подключить ящик</Link> — письма на admin@wesetup.ru попадут в CRM.
                </p>
              )}
              {mailIssue ? (
                <p className="mt-2 flex items-start gap-1.5 text-[12.5px] text-[#a13a32]">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                  Почта не читается — проверьте пароль в «Почте и фильтрах».
                </p>
              ) : null}
            </div>
            <div>
              <div className="text-[13px] font-semibold uppercase tracking-[0.12em] text-[#6f7282]">Автосбор</div>
              {summary.cron ? (
                <p className={cn("mt-1 text-[13.5px]", summary.cron.failStreak ? "text-[#a13a32]" : "text-[#0b1024]")}>
                  {summary.cron.failStreak ? `сбои подряд: ${summary.cron.failStreak} — ${summary.cron.lastError ?? ""}` : `последний прогон ${formatDateTime(summary.cron.updatedAt)}`}
                </p>
              ) : (
                <p className="mt-1 text-[13.5px] text-[#6f7282]">Ещё не запускался — нажмите «Обновить сейчас». Крон раз в 5 минут описан в docs/crm.md.</p>
              )}
            </div>
            <p className="border-t border-[#ececf4] pt-3 text-[12px] leading-snug text-[#9b9fb3]">
              Напоминания: нет ответа 30 мин — ответственному, 4 ч — РОП; клиент молчит 3 дня — «напомните о себе»; сводка в 9:00. Только с 9 до 21 по
              Москве. Стадия «Клиент» — человек уже пользуется платформой.
            </p>
          </div>
          )}
        </div>
      </section>
    </div>
  );
}
