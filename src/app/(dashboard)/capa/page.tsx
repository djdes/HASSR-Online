import Link from "next/link";
import { Clock, Plus } from "lucide-react";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { resolveSectionName } from "@/lib/org-custom-names";
import { db } from "@/lib/db";
import { CapaAutoDetectButton } from "@/components/capa/auto-detect-button";

const STATUS_INFO: Record<string, { label: string; className: string }> = {
  open: { label: "Открыто", className: "bg-[#fff4f2] text-[#a13a32]" },
  investigating: { label: "Расследование", className: "bg-[#fff8eb] text-[#b25f00]" },
  corrective_action: { label: "Корректировка", className: "bg-[#eef1ff] text-[#3848c7]" },
  verification: { label: "Верификация", className: "bg-[#f5f0ff] text-[#5d3ab3]" },
  closed: { label: "Закрыто", className: "bg-[#ecfdf5] text-[#116b2a]" },
};

const PRIORITY_INFO: Record<string, { label: string; className: string }> = {
  critical: { label: "Критический", className: "bg-[#a13a32] text-white" },
  high: { label: "Высокий", className: "bg-[#d95f2a] text-white" },
  medium: { label: "Средний", className: "bg-[#d9a02a] text-white" },
  low: { label: "Низкий", className: "bg-[#9b9fb3] text-white" },
};

const CATEGORY_LABELS: Record<string, string> = {
  temperature: "Температура",
  hygiene: "Гигиена",
  packaging: "Упаковка",
  quality: "Качество",
  process: "Процесс",
  equipment: "Оборудование",
  other: "Другое",
};

function isSlaBreached(
  ticket: { createdAt: Date; slaHours: number; status: string },
  now: Date
): boolean {
  if (ticket.status === "closed") return false;
  const slaDeadline = new Date(
    ticket.createdAt.getTime() + ticket.slaHours * 60 * 60 * 1000
  );
  return now.getTime() > slaDeadline.getTime();
}

export default async function CapaPage() {
  const session = await requireAuth();

  const tickets: Awaited<ReturnType<typeof db.capaTicket.findMany>> =
    await db.capaTicket.findMany({
      where: { organizationId: getActiveOrgId(session) },
      orderBy: [{ createdAt: "desc" }],
      take: 200,
    });

  const statuses = ["open", "investigating", "corrective_action", "verification", "closed"];
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  type Ticket = (typeof tickets)[number];
  const weekTickets = tickets.filter(
    (t: Ticket) => t.createdAt >= weekAgo && t.status !== "closed"
  );

  const openCount = tickets.filter((t: Ticket) => t.status !== "closed").length;
  const criticalCount = tickets.filter(
    (t: Ticket) => t.priority === "critical" && t.status !== "closed"
  ).length;
  const slaBreached = tickets.filter((t: Ticket) => isSlaBreached(t, now)).length;
  const closedWeek = tickets.filter(
    (t: Ticket) => t.status === "closed" && t.closedAt && t.closedAt >= weekAgo
  ).length;
  const hasCritical = weekTickets.some((t: Ticket) => t.priority === "critical");

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-[clamp(1.75rem,2vw+1rem,2rem)] leading-tight font-bold tracking-[-0.02em] text-[#0b1024]">
            {/* Своё название раздела организации, если его задали. */}
            {await resolveSectionName(getActiveOrgId(session), "capa")}
          </h1>
          <p className="mt-1.5 text-[14px] text-[#6f7282]">
            Корректирующие и предупреждающие действия (CAPA)
          </p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-start">
          <CapaAutoDetectButton />
          <Link
            href="/capa/new"
            className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-2xl bg-[#5566f6] px-4 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors hover:bg-[#4a5bf0] sm:w-auto sm:justify-start sm:self-start"
          >
            <Plus className="size-4" />
            Новое нарушение
          </Link>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Открыто"
          value={openCount}
          tone={hasCritical ? "warn" : "default"}
        />
        <StatCard label="Критических" value={criticalCount} tone="critical" />
        <StatCard label="Срок нарушен" value={slaBreached} tone="warn" />
        <StatCard label="Закрыто за неделю" value={closedWeek} tone="success" />
      </div>

      {/* Kanban columns — horizontal scroll on mobile */}
      <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <div className="grid min-w-[820px] grid-cols-5 gap-4 lg:min-w-0">
          {statuses.map((status) => {
            const statusTickets = tickets.filter((t: Ticket) => t.status === status);
            const info = STATUS_INFO[status];

            return (
              <div key={status} className="space-y-3">
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wider ${info.className}`}
                  >
                    {info.label}
                  </span>
                  <span className="text-[12px] text-[#9b9fb3] tabular-nums">
                    {statusTickets.length}
                  </span>
                </div>
                <div className="space-y-2">
                  {statusTickets.slice(0, 10).map((ticket: Ticket) => {
                    const pInfo = PRIORITY_INFO[ticket.priority] ?? PRIORITY_INFO.low;
                    const breached = isSlaBreached(ticket, now);

                    return (
                      <Link
                        key={ticket.id}
                        href={`/capa/${ticket.id}`}
                        className={`block rounded-2xl border bg-white p-3 transition-all hover:-translate-y-0.5 hover:border-[#5566f6]/40 hover:shadow-[0_12px_28px_-16px_rgba(85,102,246,0.22)] ${
                          breached ? "border-[#ffd2cd]" : "border-[#ececf4]"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="line-clamp-2 text-[13px] font-medium text-[#0b1024]">
                            {ticket.title}
                          </p>
                          <span
                            className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${pInfo.className}`}
                          >
                            {pInfo.label}
                          </span>
                        </div>
                        <div className="mt-2 flex items-center gap-2 text-[11px] text-[#6f7282]">
                          <span>
                            {CATEGORY_LABELS[ticket.category] || ticket.category}
                          </span>
                          {breached && (
                            <span className="flex items-center gap-0.5 text-[#a13a32]">
                              <Clock className="size-3" />
                              SLA
                            </span>
                          )}
                        </div>
                      </Link>
                    );
                  })}
                  {statusTickets.length === 0 && (
                    <div className="rounded-2xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-3 py-5 text-center text-[12px] text-[#9b9fb3]">
                      Пусто
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number;
  tone?: "default" | "warn" | "critical" | "success";
}) {
  const valueColor =
    tone === "critical"
      ? "text-[#a13a32]"
      : tone === "warn"
      ? "text-[#b25f00]"
      : tone === "success"
      ? "text-[#116b2a]"
      : "text-[#0b1024]";
  return (
    <div className="rounded-2xl border border-[#ececf4] bg-white p-4 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] sm:p-5">
      <div className="text-[12px] font-medium text-[#6f7282]">{label}</div>
      <div className={`mt-1 text-[28px] font-semibold tabular-nums ${valueColor}`}>
        {value}
      </div>
    </div>
  );
}
