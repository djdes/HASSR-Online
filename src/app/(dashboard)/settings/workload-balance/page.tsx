import Link from "next/link";
import { redirect } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Scale,
  Users,
} from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { hasCapability } from "@/lib/permission-presets";
import { db } from "@/lib/db";
import { ACTIVE_JOURNAL_CATALOG } from "@/lib/journal-catalog";
import {
  calculatePositionWorkloads,
  calculateUserWorkloads,
  type SlotUserMap,
} from "@/lib/journal-workload";
import { PageGuide } from "@/components/ui/page-guide";

export const dynamic = "force-dynamic";

const VALID_CODES: Set<string> = new Set(
  ACTIVE_JOURNAL_CATALOG.map((j) => j.code as string),
);

export default async function WorkloadBalancePage() {
  const session = await requireAuth();
  if (!hasCapability(session.user, "admin.full")) redirect("/settings");
  const organizationId = getActiveOrgId(session);

  const [users, positions, org] = await Promise.all([
    db.user.findMany({
      where: { organizationId, isActive: true, archivedAt: null },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        jobPositionId: true,
        jobPosition: { select: { name: true } },
      },
    }),
    db.jobPosition.findMany({
      where: { organizationId },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    db.organization.findUnique({
      where: { id: organizationId },
      select: {
        journalResponsibleUsersJson: true,
        journalDifficultyJson: true,
      },
    }),
  ]);

  const slotUsersByJournal: Record<string, SlotUserMap> = {};
  const rawSlots = (org?.journalResponsibleUsersJson ?? {}) as Record<
    string,
    Record<string, unknown>
  >;
  for (const [code, slots] of Object.entries(rawSlots)) {
    if (!VALID_CODES.has(code)) continue;
    if (!slots || typeof slots !== "object") continue;
    const cleaned: SlotUserMap = {};
    for (const [slotId, uid] of Object.entries(slots)) {
      cleaned[slotId] = typeof uid === "string" && uid ? uid : null;
    }
    slotUsersByJournal[code] = cleaned;
  }

  const userWorkloads = calculateUserWorkloads({
    slotUsersByJournal,
    difficultyOverride: (org?.journalDifficultyJson ?? null) as
      | Record<string, unknown>
      | null,
    userIds: users.map((u) => u.id),
  });

  const positionWorkloads = calculatePositionWorkloads({
    userWorkloads,
    users: users.map((u) => ({
      id: u.id,
      name: u.name,
      jobPositionId: u.jobPositionId,
    })),
    positions,
  });

  const sortedUsers = [...users].sort((a, b) => {
    const wa = userWorkloads.get(a.id)?.totalWeight ?? 0;
    const wb = userWorkloads.get(b.id)?.totalWeight ?? 0;
    return wb - wa;
  });

  const maxUserWeight = Math.max(
    1,
    ...sortedUsers.map((u) => userWorkloads.get(u.id)?.totalWeight ?? 0),
  );

  const totalAssigned = Object.values(slotUsersByJournal).reduce((acc, sm) => {
    return acc + Object.values(sm).filter((v) => v).length;
  }, 0);

  const unassignedJournalsCount = ACTIVE_JOURNAL_CATALOG.filter((j) => {
    const sm = slotUsersByJournal[j.code];
    if (!sm) return true;
    return Object.values(sm).every((v) => !v);
  }).length;

  // Самые проблемные позиции — где imbalance >= 0.5 (max - min >= 50% от avg)
  const problemPositions = positionWorkloads.filter(
    (p) => p.userCount > 1 && p.imbalance >= 0.5,
  );

  return (
    <div className="space-y-5">
      {/* Тёмный hero снят: страница аналитическая, человеку нужны сразу
          цифры и таблицы. Две ссылки-«куда идти править» стали кнопками
          справа — так очевиднее, что это действия, а не текст. */}
      <PageHeader
        title="Нагрузка сотрудников"
        description="Кто сколько журналов ведёт в месяц по факту назначений. Если у поваров одинаковая зарплата, нагрузка должна быть близкой — иначе появятся обиды и текучка. Меняйте ответственных и сложность журналов — таблица обновится."
        actions={
          <>
            <Link
              href="/settings/journal-responsibles"
              className="inline-flex h-10 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
            >
              Ответственные
            </Link>
            <Link
              href="/settings/journal-difficulty"
              className="inline-flex h-10 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
            >
              Сложность журналов
            </Link>
          </>
        }
      />

      <PageGuide
        storageKey="workload-balance"
        title="Как читать эту страницу"
        bullets={[
          {
            title: "Нагрузка",
            body: "сумма по всем журналам, где сотрудник назначен. Считается как сложность (1-5) × частота заполнения в месяц × среднее число строк за раз. Не часы, а относительная единица.",
          },
          {
            title: "Перекос между сотрудниками",
            body: "ищите большой разрыв max-min внутри одной должности — там и есть проблема.",
          },
          {
            title: "Зелёный/жёлтый/красный",
            body: "коэффициент неравномерности (max-min)/avg. До 0.3 — норма, 0.3-0.5 — перекос, 0.5+ — критично, нужно перебалансировать.",
          },
          {
            title: "Не назначен",
            body: "журналы где никто не выбран в слотах — нагрузка теряется. Зайдите в Ответственные и проставьте.",
          },
        ]}
      />

      {/* Summary cards */}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-[#ececf4] bg-white p-4">
          <div className="text-[12px] font-semibold uppercase tracking-[0.12em] text-[#6f7282]">
            Сотрудников
          </div>
          <div className="mt-2 flex items-end gap-2">
            <span className="text-[28px] font-semibold leading-none tracking-[-0.02em] text-[#0b1024]">
              {users.length}
            </span>
            <span className="pb-1 text-[12px] text-[#9b9fb3]">
              на {positions.length} должностях
            </span>
          </div>
        </div>

        <div className="rounded-2xl border border-[#ececf4] bg-white p-4">
          <div className="text-[12px] font-semibold uppercase tracking-[0.12em] text-[#6f7282]">
            Журналов с ответственными
          </div>
          <div className="mt-2 flex items-end gap-2">
            <span className="text-[28px] font-semibold leading-none tracking-[-0.02em] text-[#0b1024]">
              {ACTIVE_JOURNAL_CATALOG.length - unassignedJournalsCount}
            </span>
            <span className="pb-1 text-[12px] text-[#9b9fb3]">
              из {ACTIVE_JOURNAL_CATALOG.length}
              {unassignedJournalsCount > 0
                ? ` · ${unassignedJournalsCount} без слотов`
                : ""}
            </span>
          </div>
        </div>

        <div className="rounded-2xl border border-[#ececf4] bg-white p-4">
          <div className="text-[12px] font-semibold uppercase tracking-[0.12em] text-[#6f7282]">
            Назначений
          </div>
          <div className="mt-2 flex items-end gap-2">
            <span className="text-[28px] font-semibold leading-none tracking-[-0.02em] text-[#0b1024]">
              {totalAssigned}
            </span>
            <span className="pb-1 text-[12px] text-[#9b9fb3]">
              слот-сотрудник пар
            </span>
          </div>
        </div>
      </div>

      {/* Problem positions banner */}
      {problemPositions.length > 0 ? (
        <div className="rounded-2xl border border-[#ffd2cd] bg-[#fff4f2] p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-[#a13a32]" />
            <div className="flex-1">
              <div className="text-[14px] font-semibold text-[#a13a32]">
                Перекос на {problemPositions.length}{" "}
                {problemPositions.length === 1 ? "должности" : "должностях"}
              </div>
              <ul className="mt-2 space-y-1 text-[13px] text-[#3c4053]">
                {problemPositions.map((p) => (
                  <li key={p.positionId}>
                    <strong>{p.positionName}</strong>: разрыв{" "}
                    {Math.round(p.maxPerUser)} ↔ {Math.round(p.minPerUser)} (
                    {p.maxUserName} перегружен,{" "}
                    {p.minUserName ?? "кто-то"} недогружен).
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      ) : null}

      {/* Per-position table */}
      {positionWorkloads.length > 0 ? (
        <div className="rounded-3xl border border-[#ececf4] bg-white">
          <div className="flex items-center gap-2 border-b border-[#ececf4] px-4 py-3">
            <Users className="size-4 text-[#5566f6]" />
            <h2 className="text-[14px] font-semibold uppercase tracking-[0.12em] text-[#0b1024]">
              По должностям
            </h2>
          </div>
          <table className="w-full text-[13px]">
            <thead className="bg-[#fafbff] text-[11px] uppercase tracking-[0.1em] text-[#6f7282]">
              <tr>
                <th className="px-4 py-2.5 text-left font-medium">Должность</th>
                <th className="px-4 py-2.5 text-right font-medium">Сотр.</th>
                <th className="px-4 py-2.5 text-right font-medium">Сумма</th>
                <th className="px-4 py-2.5 text-right font-medium">Среднее</th>
                <th className="px-4 py-2.5 text-right font-medium">Min ↔ Max</th>
                <th className="px-4 py-2.5 text-right font-medium">Перекос</th>
              </tr>
            </thead>
            <tbody>
              {positionWorkloads.map((p) => {
                const tone =
                  p.userCount <= 1
                    ? "text-[#9b9fb3]"
                    : p.imbalance >= 0.5
                      ? "text-[#a13a32]"
                      : p.imbalance >= 0.3
                        ? "text-[#a16d32]"
                        : "text-emerald-700";
                const bg =
                  p.userCount <= 1
                    ? "bg-[#fafbff]"
                    : p.imbalance >= 0.5
                      ? "bg-[#fff4f2]"
                      : p.imbalance >= 0.3
                        ? "bg-[#fff8eb]"
                        : "bg-emerald-50";
                return (
                  <tr
                    key={p.positionId}
                    className="border-t border-[#ececf4] hover:bg-[#fafbff]"
                  >
                    <td className="px-4 py-2.5 font-medium text-[#0b1024]">
                      {p.positionName}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-[#3c4053]">
                      {p.userCount}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-[#3c4053]">
                      {Math.round(p.totalWeight)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-[#3c4053]">
                      {Math.round(p.avgPerUser)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-[#3c4053]">
                      {p.userCount > 1
                        ? `${Math.round(p.minPerUser)} ↔ ${Math.round(p.maxPerUser)}`
                        : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${bg} ${tone}`}
                      >
                        {p.userCount <= 1
                          ? "один сотрудник"
                          : p.imbalance >= 0.5
                            ? "критично"
                            : p.imbalance >= 0.3
                              ? "перекос"
                              : "норма"}
                        {p.userCount > 1
                          ? ` · ${(p.imbalance * 100).toFixed(0)}%`
                          : ""}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {/* Per-user breakdown with bar chart */}
      <div className="rounded-3xl border border-[#ececf4] bg-white">
        <div className="flex items-center gap-2 border-b border-[#ececf4] px-4 py-3">
          <Scale className="size-4 text-[#5566f6]" />
          <h2 className="text-[14px] font-semibold uppercase tracking-[0.12em] text-[#0b1024]">
            По сотрудникам
          </h2>
          <span className="ml-auto text-[11px] text-[#9b9fb3]">
            отсортировано по нагрузке
          </span>
        </div>
        <div className="divide-y divide-[#ececf4]">
          {sortedUsers.map((u) => {
            const w = userWorkloads.get(u.id);
            const total = w?.totalWeight ?? 0;
            const pct = (total / maxUserWeight) * 100;
            const journals = w?.journals ?? [];
            return (
              <details
                key={u.id}
                className="group px-4 py-3 transition-colors hover:bg-[#fafbff]"
              >
                <summary className="flex cursor-pointer list-none items-center gap-3">
                  <div className="min-w-[180px] flex-shrink-0">
                    <div className="text-[14px] font-medium text-[#0b1024]">
                      {u.name}
                    </div>
                    {u.jobPosition?.name ? (
                      <div className="text-[11px] text-[#9b9fb3]">
                        {u.jobPosition.name}
                      </div>
                    ) : null}
                  </div>
                  <div className="relative h-7 flex-1 overflow-hidden rounded-lg bg-[#f5f6ff]">
                    <div
                      className="h-full bg-gradient-to-r from-[#5566f6] to-[#7a5cff]"
                      style={{ width: `${pct}%` }}
                    />
                    <div className="absolute inset-0 flex items-center justify-end pr-2 text-[11px] font-semibold tabular-nums text-[#0b1024]">
                      {Math.round(total)}
                    </div>
                  </div>
                  <div className="flex w-[80px] items-center justify-end gap-1.5 text-[11px] text-[#6f7282]">
                    {journals.length > 0 ? (
                      <>
                        {journals.length} жур.
                        <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" />
                      </>
                    ) : (
                      <span className="text-[#9b9fb3]">не назначен</span>
                    )}
                  </div>
                </summary>
                {journals.length > 0 ? (
                  <div className="mt-3 space-y-1 pl-[180px] text-[12px]">
                    {journals.map((j) => (
                      <div
                        key={j.code}
                        className="flex items-center justify-between gap-3 rounded-lg bg-[#fafbff] px-2.5 py-1"
                      >
                        <span className="truncate text-[#3c4053]">
                          {j.name}
                        </span>
                        <div className="flex items-center gap-2 text-[11px]">
                          <span
                            className={
                              j.role === "verifier"
                                ? "rounded-full bg-[#eef1ff] px-1.5 py-0.5 text-[#3848c7]"
                                : j.role === "both"
                                  ? "rounded-full bg-[#fff8eb] px-1.5 py-0.5 text-[#a16d32]"
                                  : "rounded-full bg-emerald-50 px-1.5 py-0.5 text-emerald-700"
                            }
                          >
                            {j.role === "verifier"
                              ? "проверяет"
                              : j.role === "both"
                                ? "и тот и тот"
                                : "заполняет"}
                          </span>
                          <span className="tabular-nums font-medium text-[#0b1024]">
                            {Math.round(j.weight)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </details>
            );
          })}

          {sortedUsers.length === 0 ? (
            <div className="flex items-center gap-3 px-4 py-8 text-[14px] text-[#6f7282]">
              <CheckCircle2 className="size-5 text-[#9b9fb3]" />
              В организации нет активных сотрудников.
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
