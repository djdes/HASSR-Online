import Link from "next/link";
import { redirect } from "next/navigation";
import { Coins } from "lucide-react";
import { db } from "@/lib/db";
import { getActiveOrgId, requireAuth } from "@/lib/auth-helpers";
import { orgTodayKey } from "@/lib/timezone";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { BonusFeedTable } from "@/components/bonuses/bonus-feed-table";
import { BonusFilters } from "@/components/bonuses/bonus-filters";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Manager-feed премий + фильтр периода/сотрудника + CSV-экспорт
 * (Phase 3, шаги 3.5 + 3.6).
 *
 * Query-параметры:
 *   - `from` / `to` — границы периода claim (YYYY-MM-DD).
 *     Если не заданы, по умолчанию последние 30 дней.
 *   - `user`        — userId сотрудника, либо `all`.
 *
 * CSV-экспорт идёт через `GET /api/bonus-entries/export?...` —
 * клиентская кнопка строит ссылку с теми же query-параметрами.
 */
export default async function BonusesPage({
  searchParams,
}: {
  searchParams: Promise<{
    from?: string;
    to?: string;
    user?: string;
  }>;
}) {
  const session = await requireAuth();
  const fullAccess = hasFullWorkspaceAccess({
    role: session.user.role,
    isRoot: session.user.isRoot === true,
  });
  if (!fullAccess) {
    redirect("/dashboard");
  }

  const orgId = getActiveOrgId(session);
  const params = await searchParams;
  // «Сегодня» — по поясу организации, а не по UTC: ночью в Москве
  // период по умолчанию заканчивался вчерашним днём.
  const org = await db.organization.findUnique({
    where: { id: orgId },
    select: { timezone: true },
  });
  const filters = resolveFilters(params, org?.timezone ?? undefined);

  const [bonuses, employees] = await Promise.all([
    db.bonusEntry.findMany({
      where: {
        organizationId: orgId,
        createdAt: {
          gte: filters.fromDate,
          lt: filters.toExclusiveDate,
        },
        ...(filters.userId ? { userId: filters.userId } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 500,
      select: {
        id: true,
        status: true,
        amountKopecks: true,
        photoUrl: true,
        photoTakenAt: true,
        createdAt: true,
        rejectedAt: true,
        rejectedReason: true,
        user: { select: { id: true, name: true } },
        template: { select: { id: true, code: true, name: true } },
        obligation: { select: { id: true, claimedAt: true, status: true } },
      },
    }),
    db.user.findMany({
      where: { organizationId: orgId, isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const summary = bonuses.reduce(
    (acc, bonus) => {
      acc.total += 1;
      if (bonus.status === "pending") acc.pending += 1;
      if (bonus.status === "approved") acc.approved += 1;
      if (bonus.status === "rejected") acc.rejected += 1;
      if (bonus.status !== "rejected") {
        acc.payableKopecks += bonus.amountKopecks;
      }
      return acc;
    },
    { total: 0, pending: 0, approved: 0, rejected: 0, payableKopecks: 0 }
  );

  const items = bonuses.map((bonus) => ({
    id: bonus.id,
    status: bonus.status,
    amountKopecks: bonus.amountKopecks,
    photoUrl: bonus.photoUrl,
    photoTakenAt: bonus.photoTakenAt?.toISOString() ?? null,
    claimedAt:
      bonus.obligation?.claimedAt?.toISOString() ??
      bonus.createdAt.toISOString(),
    rejectedAt: bonus.rejectedAt?.toISOString() ?? null,
    rejectedReason: bonus.rejectedReason ?? null,
    user: { id: bonus.user.id, name: bonus.user.name ?? "—" },
    template: {
      code: bonus.template.code,
      name: bonus.template.name,
    },
  }));

  const exportQuery = new URLSearchParams({
    from: filters.fromIso,
    to: filters.toIso,
    ...(filters.userId ? { user: filters.userId } : {}),
  }).toString();

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[clamp(1.75rem,2vw+1rem,2rem)] leading-tight font-bold tracking-[-0.02em] text-[#0b1024]">
          Премии за работу
        </h1>
        <p className="mt-1.5 text-[14px] text-[#6f7282]">
          За период {formatDateRu(filters.fromIso)} —{" "}
          {formatDateRu(filters.toIso)}. CSV-выгрузка пригодна для
          ручного импорта в зарплатный сервис.
        </p>
      </div>

      <BonusFilters
        from={filters.fromIso}
        to={filters.toIso}
        userId={filters.userId ?? "all"}
        employees={employees.map((e) => ({
          id: e.id,
          name: e.name ?? "—",
        }))}
        exportHref={`/api/bonus-entries/export?${exportQuery}`}
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard
          label="Всего премий"
          value={String(summary.total)}
          tone="indigo"
        />
        <SummaryCard
          label="К оплате"
          value={formatRubles(summary.payableKopecks)}
          tone="lime"
        />
        <SummaryCard
          label="Ждут проверки"
          value={String(summary.pending)}
          tone="amber"
        />
        <SummaryCard
          label="Отозвано"
          value={String(summary.rejected)}
          tone="rose"
        />
      </div>

      {items.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-6 py-14 text-center">
          <Coins className="mx-auto size-7 text-[#9b9fb3]" strokeWidth={1.6} />
          <div className="mt-3 text-[15px] font-medium text-[#0b1024]">
            За период премий нет
          </div>
          <p className="mx-auto mt-1.5 max-w-[420px] text-[13px] text-[#6f7282]">
            Поменяйте период в фильтре или включите премию у нужного журнала —{" "}
            <Link
              href="/settings/journals"
              className="font-medium text-[#3848c7] transition-colors hover:text-[#0b1024]"
            >
              Настройки журналов
            </Link>
            .
          </p>
        </div>
      ) : (
        <BonusFeedTable items={items} />
      )}
    </div>
  );
}

type ResolvedFilters = {
  fromDate: Date;
  toExclusiveDate: Date;
  fromIso: string;
  toIso: string;
  userId: string | null;
};

function resolveFilters(
  params: {
    from?: string;
    to?: string;
    user?: string;
  },
  timezone?: string
): ResolvedFilters {
  const todayIso = orgTodayKey(timezone);
  const defaultFrom = isoDate(
    new Date(new Date(`${todayIso}T00:00:00.000Z`).getTime() - 30 * 86400000)
  );

  const fromIso = isValidIsoDate(params.from) ? params.from! : defaultFrom;
  const toIso = isValidIsoDate(params.to) ? params.to! : todayIso;

  const fromDate = new Date(`${fromIso}T00:00:00.000Z`);
  const toInclusive = new Date(`${toIso}T00:00:00.000Z`);
  const toExclusiveDate = new Date(toInclusive.getTime() + 86400000);

  const userId =
    params.user && params.user !== "all" && params.user.length > 0
      ? params.user
      : null;

  return { fromDate, toExclusiveDate, fromIso, toIso, userId };
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function isValidIsoDate(value: string | undefined): boolean {
  if (!value) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime());
}

function formatDateRu(iso: string): string {
  try {
    const d = new Date(`${iso}T00:00:00.000Z`);
    // «21 сентября 2026 г.» — сокращение уже заканчивается точкой, и
    // следом за ним в тексте шла вторая: «2026 г.. CSV-выгрузка…».
    return d
      .toLocaleDateString("ru-RU", {
        day: "2-digit",
        month: "long",
        year: "numeric",
      })
      .replace(/\s*г\.?$/, "");
  } catch {
    return iso;
  }
}

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "indigo" | "lime" | "amber" | "rose";
}) {
  const palette = {
    indigo: "bg-[#f5f6ff] text-[#3848c7]",
    lime: "bg-[#ecfdf5] text-[#116b2a]",
    amber: "bg-[#fff7ed] text-[#9a3412]",
    rose: "bg-[#fff4f2] text-[#a13a32]",
  }[tone];

  return (
    <div className="rounded-2xl border border-[#ececf4] bg-white px-4 py-3 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
      <div className="text-[12px] font-medium uppercase tracking-[0.12em] text-[#6f7282]">
        {label}
      </div>
      <div
        className={`mt-1.5 inline-flex rounded-xl px-2.5 py-0.5 text-[20px] font-semibold tabular-nums ${palette}`}
      >
        {value}
      </div>
    </div>
  );
}

function formatRubles(kopecks: number): string {
  if (!Number.isFinite(kopecks) || kopecks <= 0) return "0 ₽";
  const rubles = kopecks / 100;
  return `${rubles.toLocaleString("ru-RU", {
    minimumFractionDigits: rubles % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })} ₽`;
}
