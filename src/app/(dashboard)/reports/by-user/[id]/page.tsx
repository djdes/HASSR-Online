import { FileText } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { db } from "@/lib/db";
import { NOT_AUTO_SEEDED } from "@/lib/journal-entry-filters";
import { getUserPositionLabel } from "@/lib/user-roles";

export const dynamic = "force-dynamic";

/**
 * Пофамильный аудит — страница «что заполнял этот сотрудник за период».
 * Используется при разборе incident'ов: «кто внёс эту запись» → клик
 * по имени → видим всю его историю за 30 дней.
 *
 * Source: B5 в brainstorm.
 */
export default async function ByUserReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  // Role-gate через единый helper — все management-роли имеют доступ.
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) redirect("/journals");
  const orgId = getActiveOrgId(session);
  const { id: userId } = await params;
  const { from, to } = await searchParams;

  const user = await db.user.findFirst({
    where: { id: userId, organizationId: orgId },
    select: {
      id: true,
      name: true,
      role: true,
      positionTitle: true,
      // Должность берём тем же помощником, что и карточка сотрудника:
      // раньше в шапке отчёта стоял код роли — «cook».
      jobPosition: { select: { name: true, categoryKey: true } },
      email: true,
      phone: true,
    },
  });
  if (!user) notFound();

  const now = new Date();
  const since30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const fromDate = from ? new Date(`${from}T00:00:00Z`) : since30;
  const toDate = to ? new Date(`${to}T23:59:59Z`) : now;

  const [fieldEntries, docEntries, capaCreated, capaResolved] =
    await Promise.all([
      db.journalEntry.findMany({
        where: {
          organizationId: orgId,
          filledById: userId,
          createdAt: { gte: fromDate, lte: toDate },
        },
        orderBy: { createdAt: "desc" },
        take: 200,
        include: {
          template: { select: { name: true, code: true } },
        },
      }),
      db.journalDocumentEntry.findMany({
        where: {
          employeeId: userId,
          document: { organizationId: orgId },
          createdAt: { gte: fromDate, lte: toDate },
          ...NOT_AUTO_SEEDED,
        },
        // По дате самой записи, а не по времени сохранения: в списке
        // показана именно дата в журнале, и порядок должен ей отвечать.
        orderBy: [{ date: "desc" }, { createdAt: "desc" }],
        take: 200,
        include: {
          document: {
            select: { title: true, template: { select: { code: true } } },
          },
        },
      }),
      db.capaTicket.count({
        where: {
          organizationId: orgId,
          createdById: userId,
          createdAt: { gte: fromDate, lte: toDate },
        },
      }),
      db.capaTicket.count({
        where: {
          organizationId: orgId,
          assignedToId: userId,
          status: "closed",
          closedAt: { gte: fromDate, lte: toDate },
        },
      }),
    ]);

  const totalEntries = fieldEntries.length + docEntries.length;

  return (
    <div className="space-y-5">
      <div>

        <h1 className="mt-3 text-[clamp(1.75rem,2vw+1rem,2rem)] leading-tight font-bold tracking-[-0.02em] text-[#0b1024]">
          {user.name}
        </h1>
        <p className="mt-1 text-[14px] text-[#6f7282]">
          {getUserPositionLabel(user)} · {user.email}
          {user.phone ? ` · ${user.phone}` : ""}
        </p>
        <p className="mt-2 text-[13px] text-[#9b9fb3]">
          Период: {fromDate.toISOString().slice(0, 10)} —{" "}
          {toDate.toISOString().slice(0, 10)}
        </p>
      </div>

      {/* Сводка */}
      <div className="grid gap-3 sm:grid-cols-4">
        <StatCard label="Записей" value={totalEntries} />
        <StatCard
          label="В журналах"
          value={docEntries.length}
          hint="отметки в бланках"
        />
        <StatCard label="Открыл нарушений" value={capaCreated} />
        <StatCard label="Закрыл нарушений" value={capaResolved} />
      </div>

      {/* Document entries */}
      {docEntries.length > 0 && (
        <section className="rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
          <h2 className="text-[15px] font-semibold text-[#0b1024]">
            Записи в журнальных документах ({docEntries.length})
          </h2>
          <ul className="mt-3 divide-y divide-[#ececf4]">
            {docEntries.slice(0, 50).map((e) => (
              <li
                key={e.id}
                className="flex items-center gap-3 py-2 text-[13px]"
              >
                <FileText className="size-4 shrink-0 text-[#9b9fb3]" />
                <span className="min-w-0 flex-1 truncate text-[#0b1024]">
                  {e.document.title}
                </span>
                <span className="shrink-0 text-[12px] text-[#9b9fb3]">
                  {e.date.toISOString().slice(0, 10)}
                </span>
                <span className="shrink-0 text-[12px] text-[#6f7282]">
                  {e.createdAt
                    .toLocaleString("ru-RU", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Field entries */}
      {fieldEntries.length > 0 && (
        <section className="rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
          <h2 className="text-[15px] font-semibold text-[#0b1024]">
            Отдельные записи ({fieldEntries.length})
          </h2>
          <ul className="mt-3 divide-y divide-[#ececf4]">
            {fieldEntries.slice(0, 50).map((e) => (
              <li
                key={e.id}
                className="flex items-center gap-3 py-2 text-[13px]"
              >
                <FileText className="size-4 shrink-0 text-[#9b9fb3]" />
                <span className="min-w-0 flex-1 truncate text-[#0b1024]">
                  {e.template.name}
                </span>
                <span className="shrink-0 text-[12px] text-[#9b9fb3]">
                  {e.createdAt.toLocaleString("ru-RU", {
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {totalEntries === 0 && (
        <div className="rounded-3xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-6 py-14 text-center">
          <div className="text-[15px] font-medium text-[#0b1024]">
            Записей за период нет
          </div>
          <p className="mx-auto mt-1.5 max-w-[400px] text-[13px] text-[#6f7282]">
            Этот сотрудник не заполнял журналы в выбранном диапазоне.
          </p>
        </div>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: number;
  hint?: string;
}) {
  return (
    <div className="rounded-2xl border border-[#ececf4] bg-white p-4 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
      <div className="text-[12px] font-medium uppercase tracking-wider text-[#6f7282]">
        {label}
      </div>
      <div className="mt-1 text-[24px] font-semibold tabular-nums text-[#0b1024]">
        {value}
      </div>
      {hint && <div className="text-[11px] text-[#9b9fb3]">{hint}</div>}
    </div>
  );
}
