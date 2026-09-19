import Link from "next/link";
import { AlertTriangle, Plus } from "lucide-react";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";

const STATUS_INFO: Record<string, { label: string; className: string }> = {
  received: { label: "Принята", className: "bg-[#eef1ff] text-[#3848c7]" },
  in_production: { label: "В производстве", className: "bg-[#f5f6ff] text-[#5566f6]" },
  finished: { label: "Готова", className: "bg-[#ecfdf5] text-[#116b2a]" },
  shipped: { label: "Отгружена", className: "bg-[#fafbff] text-[#6f7282]" },
  expired: { label: "Просрочена", className: "bg-[#fff4f2] text-[#a13a32]" },
  written_off: { label: "Списана", className: "bg-[#fff4f2] text-[#a13a32]" },
};

const FILTER_LABELS: Record<string, string> = {
  all: "Все",
  received: "Принято",
  in_production: "В работе",
  finished: "Готово",
  shipped: "Отгружено",
  expired: "Просрочено",
  // Статус «Списана» показывался в таблице, но отфильтровать по нему
  // было нечем — кнопки в списке фильтров не было.
  written_off: "Списано",
};

function daysUntilExpiry(date: Date | null, now: Date): number | null {
  if (!date) return null;
  return Math.ceil((date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

export default async function BatchesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const filters = await searchParams;
  const session = await requireAuth();
  const now = new Date();
  // Граница «просрочено» — начало сегодняшнего дня: партия со сроком
  // «сегодня» ещё годна, в таблице она подписана «сегодня», а не
  // «просрочена».
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);

  const where: Record<string, unknown> = {
    organizationId: getActiveOrgId(session),
  };
  if (filters.status === "expired") {
    // «Просрочено» — это факт по сроку годности, а не статус в базе:
    // статус `expired` никто не проставляет, и фильтр всегда был пустым.
    where.expiryDate = { lt: todayStart };
    where.status = { notIn: ["written_off", "shipped"] };
  } else if (filters.status && filters.status !== "all") {
    where.status = filters.status;
  }

  const [batches, stats] = await Promise.all([
    db.batch.findMany({ where, orderBy: { createdAt: "desc" }, take: 100 }),
    Promise.all([
      db.batch.count({
        where: {
          organizationId: getActiveOrgId(session),
          status: "received",
        },
      }),
      db.batch.count({
        where: {
          organizationId: getActiveOrgId(session),
          status: "in_production",
        },
      }),
      // «Истекает ≤3 дня» — именно ещё НЕ просроченные: раньше сюда
      // попадали и партии с давно прошедшим сроком, и цифра на плитке
      // не сходилась с тем, что показано в таблице.
      db.batch.count({
        where: {
          organizationId: getActiveOrgId(session),
          expiryDate: {
            gte: todayStart,
            lte: new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000),
          },
          status: { notIn: ["expired", "written_off", "shipped"] },
        },
      }),
    ]),
  ]);

  const [receivedCount, inProductionCount, expiringCount] = stats;
  const activeFilter = filters.status ?? "all";

  // Откуда партия: `sourceEntryId` партий, заведённых из журнала приёмки,
  // указывает на документ. Одним запросом на всю страницу.
  const sourceIds = [
    ...new Set(batches.map((batch) => batch.sourceEntryId).filter((id): id is string => !!id)),
  ];
  const sourceDocuments = sourceIds.length
    ? await db.journalDocument.findMany({
        where: { id: { in: sourceIds }, organizationId: getActiveOrgId(session) },
        select: {
          id: true,
          dateFrom: true,
          template: { select: { code: true, name: true } },
        },
      })
    : [];
  const sourceById = new Map(sourceDocuments.map((doc) => [doc.id, doc]));

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-[clamp(1.75rem,2vw+1rem,2rem)] leading-tight font-bold tracking-[-0.02em] text-[#0b1024]">
            Партии
          </h1>
          <p className="mt-1.5 text-[14px] text-[#6f7282]">
            Партионный учёт и прослеживаемость
          </p>
        </div>
        <Link
          href="/batches/new"
          className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-2xl bg-[#5566f6] px-4 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors hover:bg-[#4a5bf0] sm:w-auto sm:justify-start sm:self-start"
        >
          <Plus className="size-4" />
          Новая партия
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <StatCard label="На складе" value={receivedCount} />
        <StatCard label="В производстве" value={inProductionCount} />
        <StatCard
          label="Истекает ≤3 дня"
          value={expiringCount}
          tone={expiringCount > 0 ? "warn" : "default"}
        />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        {Object.entries(FILTER_LABELS).map(([key, label]) => {
          const isActive = activeFilter === key;
          return (
            <Link
              key={key}
              href={key === "all" ? "/batches" : `/batches?status=${key}`}
              className={
                isActive
                  ? "inline-flex h-9 items-center rounded-2xl bg-[#0b1024] px-4 text-[13px] font-medium text-white"
                  : "inline-flex h-9 items-center rounded-2xl border border-[#dcdfed] bg-white px-4 text-[13px] font-medium text-[#3c4053] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
              }
            >
              {label}
            </Link>
          );
        })}
      </div>

      {/* Table */}
      <div className="overflow-x-auto -mx-4 px-4 lg:mx-0 lg:px-0 lg:overflow-visible">
        <div className="min-w-[980px] overflow-hidden rounded-3xl border border-[#ececf4] bg-white shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
          <table className="w-full border-collapse text-[14px]">
            <thead>
              <tr className="border-b border-[#ececf4] bg-[#fafbff] text-left text-[12px] uppercase tracking-wider text-[#6f7282]">
                <th className="px-5 py-3 font-medium">Код</th>
                <th className="px-5 py-3 font-medium">Продукт</th>
                <th className="px-5 py-3 font-medium">Поставщик</th>
                <th className="px-5 py-3 font-medium">Кол-во</th>
                <th className="px-5 py-3 font-medium">Срок годности</th>
                <th className="px-5 py-3 font-medium">Статус</th>
                <th className="px-5 py-3 font-medium">Откуда</th>
              </tr>
            </thead>
            <tbody>
              {batches.map((batch: (typeof batches)[number]) => {
                const days = daysUntilExpiry(batch.expiryDate, now);
                const isExpiring = days !== null && days <= 3 && days >= 0;
                const isExpired = days !== null && days < 0;
                const status = STATUS_INFO[batch.status] ?? {
                  label: batch.status,
                  className: "bg-[#f5f6ff] text-[#6f7282]",
                };
                const source = batch.sourceEntryId
                  ? sourceById.get(batch.sourceEntryId)
                  : undefined;
                const rowTint = isExpired
                  ? "bg-[#fff4f2]"
                  : isExpiring
                  ? "bg-[#fff8eb]"
                  : "";

                return (
                  <tr
                    key={batch.id}
                    className={`border-b border-[#ececf4] last:border-b-0 hover:bg-[#fafbff] ${rowTint}`}
                  >
                    <td className="px-5 py-3">
                      <Link
                        href={`/batches/${batch.id}`}
                        className="font-mono text-[13px] font-medium text-[#3848c7] hover:underline"
                      >
                        {batch.code}
                      </Link>
                    </td>
                    <td className="px-5 py-3 font-medium text-[#0b1024]">
                      {batch.productName}
                    </td>
                    <td className="px-5 py-3 text-[13px] text-[#6f7282]">
                      {batch.supplier || "—"}
                    </td>
                    <td className="px-5 py-3 tabular-nums text-[#0b1024]">
                      {batch.quantity} {batch.unit}
                    </td>
                    <td className="px-5 py-3">
                      {batch.expiryDate ? (
                        <div className="flex items-center gap-1.5 text-[13px]">
                          {(isExpiring || isExpired) && (
                            <AlertTriangle className="size-3.5 text-[#a13a32]" />
                          )}
                          <span
                            className={
                              isExpired
                                ? "font-medium text-[#a13a32]"
                                : isExpiring
                                ? "font-medium text-[#b25f00]"
                                : "text-[#0b1024]"
                            }
                          >
                            {batch.expiryDate.toLocaleDateString("ru-RU")}
                          </span>
                          {days !== null && (
                            <span className="text-[11px] text-[#9b9fb3]">
                              (
                              {days > 0
                                ? `${days} дн`
                                : days === 0
                                ? "сегодня"
                                : "просрочена"}
                              )
                            </span>
                          )}
                        </div>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[12px] font-medium ${status.className}`}
                      >
                        {status.label}
                      </span>
                    </td>
                    {/* Откуда партия: заведена из строки журнала приёмки
                        или руками. Ссылка ведёт в тот самый документ. */}
                    <td className="px-5 py-3 text-[13px]">
                      {source ? (
                        <Link
                          href={`/journals/${source.template.code}/documents/${source.id}`}
                          className="text-[#3848c7] hover:underline"
                        >
                          из приёмки от{" "}
                          {source.dateFrom.toLocaleDateString("ru-RU")}
                        </Link>
                      ) : (
                        <span className="text-[#9b9fb3]">вручную</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {batches.length === 0 && (
                <tr>
                  <td
                    colSpan={7}
                    className="px-5 py-10 text-center text-[14px] text-[#9b9fb3]"
                  >
                    Партий пока нет
                  </td>
                </tr>
              )}
            </tbody>
          </table>
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
  tone?: "default" | "warn";
}) {
  return (
    <div
      className={`rounded-2xl border p-3 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] sm:p-5 ${
        tone === "warn"
          ? "border-[#ffd2cd] bg-[#fff4f2]"
          : "border-[#ececf4] bg-white"
      }`}
    >
      <div className="text-[12px] font-medium text-[#6f7282]">{label}</div>
      <div
        className={`mt-1 text-[28px] font-semibold tabular-nums ${
          tone === "warn" ? "text-[#a13a32]" : "text-[#0b1024]"
        }`}
      >
        {value}
      </div>
    </div>
  );
}
