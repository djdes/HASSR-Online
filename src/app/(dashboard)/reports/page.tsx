import { redirect } from "next/navigation";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { resolveSectionName } from "@/lib/org-custom-names";
import { loadBuildingContext } from "@/lib/active-building";
import { buildingWhere } from "@/lib/building-scope";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { db } from "@/lib/db";
import { NOT_AUTO_SEEDED } from "@/lib/journal-entry-filters";
import { ReportForm } from "@/components/reports/report-form";
import { ComplianceBundleCard } from "@/components/reports/compliance-bundle-card";
import { AiPeriodReportCard } from "@/components/reports/ai-period-report";
import { ComplianceHeatmap } from "@/components/reports/compliance-heatmap";
import { WeekdayHeatmap } from "@/components/reports/weekday-heatmap";
import { ComplianceTrend } from "@/components/reports/compliance-trend";
import {
  getComplianceHeatmap,
  getWeekdayHeatmap,
} from "@/lib/compliance-heatmap";
import { getComplianceTrend } from "@/lib/compliance-trend";
import { sortJournalsByName } from "@/lib/journal-sort";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  // Принимаем и новые (manager / head_chef), и легаси (owner /
  // technologist) роли — и то, и то пишет отчёты.
  // Role-gate через единый helper — manager/head_chef/owner/technologist
  // все имеют full workspace access (см. memory: feedback_manager_full_rights).
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) redirect("/journals");

  const orgId = getActiveOrgId(session);
  // Точки: графики и счётчики по документам — для активной точки; записи
  // поле-ориентированных журналов остаются на организацию.
  const buildingContext = await loadBuildingContext(session);
  const activeBuildingId = buildingContext.activeBuildingId;
  const now = new Date();
  const since30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  // E7 — compare-mode: 7 дней «эта неделя» vs предыдущие 7 дней.
  const since7 = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const since14 = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
  const [
    templates,
    areas,
    heatmap,
    weekdayHeatmap,
    trend,
    entries30Count,
    entriesWithAttachment30Count,
    thisWeekFieldEntries,
    thisWeekDocEntries,
    prevWeekFieldEntries,
    prevWeekDocEntries,
    thisWeekCapaCount,
    prevWeekCapaCount,
  ] = await Promise.all([
    db.journalTemplate.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: "asc" },
      select: { id: true, code: true, name: true },
    }),
    db.area.findMany({
      where: { organizationId: getActiveOrgId(session) },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    getComplianceHeatmap(orgId, 30, now, { buildingId: activeBuildingId }),
    getWeekdayHeatmap(orgId, 8, now, { buildingId: activeBuildingId }),
    getComplianceTrend(orgId, 12, now, { buildingId: activeBuildingId }),
    db.journalEntry.count({
      where: { organizationId: orgId, createdAt: { gte: since30 } },
    }),
    db.journalEntry.count({
      where: {
        organizationId: orgId,
        createdAt: { gte: since30 },
        attachments: { some: {} },
      },
    }),
    db.journalEntry.count({
      where: { organizationId: orgId, createdAt: { gte: since7 } },
    }),
    db.journalDocumentEntry.count({
      where: {
        document: { organizationId: orgId, ...buildingWhere(activeBuildingId) },
        createdAt: { gte: since7 },
        ...NOT_AUTO_SEEDED,
      },
    }),
    db.journalEntry.count({
      where: {
        organizationId: orgId,
        createdAt: { gte: since14, lt: since7 },
      },
    }),
    db.journalDocumentEntry.count({
      where: {
        document: { organizationId: orgId, ...buildingWhere(activeBuildingId) },
        createdAt: { gte: since14, lt: since7 },
        ...NOT_AUTO_SEEDED,
      },
    }),
    db.capaTicket.count({
      where: { organizationId: orgId, createdAt: { gte: since7 } },
    }),
    db.capaTicket.count({
      where: {
        organizationId: orgId,
        createdAt: { gte: since14, lt: since7 },
      },
    }),
  ]);

  // Период выгрузки по умолчанию — последние 30 дней по поясу организации,
  // чтобы поля дат не были пустыми.
  const orgTimezone =
    (
      await db.organization.findUnique({
        where: { id: orgId },
        select: { timezone: true },
      })
    )?.timezone || "Europe/Moscow";
  const defaultDateTo = formatYmdInZone(now, orgTimezone);
  const defaultDateFrom = formatYmdInZone(
    new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000),
    orgTimezone
  );

  const thisWeekTotal = thisWeekFieldEntries + thisWeekDocEntries;
  const prevWeekTotal = prevWeekFieldEntries + prevWeekDocEntries;
  const entriesDeltaPct =
    prevWeekTotal === 0
      ? thisWeekTotal > 0
        ? 100
        : null
      : Math.round(((thisWeekTotal - prevWeekTotal) / prevWeekTotal) * 100);
  const capaDeltaPct =
    prevWeekCapaCount === 0
      ? thisWeekCapaCount > 0
        ? 100
        : null
      : Math.round(
          ((thisWeekCapaCount - prevWeekCapaCount) / prevWeekCapaCount) * 100
        );
  const photoEvidencePct =
    entries30Count === 0
      ? null
      : Math.round((entriesWithAttachment30Count / entries30Count) * 100);

  // Подготавливаем mailto-link для шеринга отчёта.
  const subj = encodeURIComponent(
    `Отчёт по заполнению журналов — ${session.user.organizationName}`
  );
  const body = encodeURIComponent(
    `Здравствуйте,\n\n` +
      `делюсь данными о заполнении журналов из системы WeSetup.\n\n` +
      `Доля записей с фото: ${
        photoEvidencePct === null ? "нет данных" : photoEvidencePct + "%"
      } (${entriesWithAttachment30Count} из ${entries30Count} за 30 дней)\n\n` +
      `Подробный обзор и графики — в системе WeSetup на странице /reports.\n\n` +
      `Это автоматическое письмо из WeSetup.`
  );
  const mailtoHref = `mailto:?subject=${subj}&body=${body}`;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-[clamp(1.75rem,2vw+1rem,2rem)] leading-tight font-bold tracking-[-0.02em] text-[#0b1024]">
            {/* Своё название раздела организации, если его задали. */}
            {await resolveSectionName(getActiveOrgId(session), "reports")}
          </h1>
          <p className="mt-1.5 text-[14px] text-[#6f7282]">
            Выгрузки журналов за период — PDF и Excel для проверок
          </p>
        </div>
        <a
          href={mailtoHref}
          className="inline-flex h-10 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
        >
          ✉ Поделиться по email
        </a>
      </div>
      <AiPeriodReportCard />

      {/* E7 — Сравнение «эта неделя vs прошлая». Δ-стрелки + %.
          Помогает заметить тренды без ковыряния в графиках. */}
      <section className="rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] md:p-6">
        <h2 className="mb-4 text-[16px] font-semibold tracking-[-0.01em] text-[#0b1024]">
          Эта неделя и прошлая
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <CompareTile
            label="Записи в журналах"
            now={thisWeekTotal}
            prev={prevWeekTotal}
            deltaPct={entriesDeltaPct}
            betterIs="up"
          />
          <CompareTile
            label="Открыто CAPA"
            now={thisWeekCapaCount}
            prev={prevWeekCapaCount}
            deltaPct={capaDeltaPct}
            betterIs="down"
          />
        </div>
      </section>

      {photoEvidencePct !== null ? (
        <section className="rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
          <div className="flex items-baseline gap-3">
            <h2 className="text-[16px] font-semibold tracking-[-0.01em] text-[#0b1024]">
              Записей с фото
            </h2>
            <span
              className="text-[24px] font-semibold tabular-nums"
              style={{
                color:
                  photoEvidencePct >= 60
                    ? "#116b2a"
                    : photoEvidencePct >= 30
                      ? "#7a4a00"
                      : "#a13a32",
              }}
            >
              {photoEvidencePct}%
            </span>
            <span className="text-[13px] text-[#6f7282]">
              ({entriesWithAttachment30Count} из {entries30Count} за 30 дней)
            </span>
          </div>
          <p className="mt-2 text-[13px] text-[#6f7282]">
            Инспектор больше доверяет журналам с фото-доказательствами.
            Норма «хорошая» — 60% и выше.
          </p>
        </section>
      ) : null}

      <ComplianceTrend points={trend} />
      <ComplianceHeatmap rows={heatmap.rows} days={heatmap.days} />
      <WeekdayHeatmap
        rows={weekdayHeatmap.rows}
        weekdayLabels={weekdayHeatmap.weekdayLabels}
      />
      <ComplianceBundleCard />

      <div className="rounded-3xl border border-[#ececf4] bg-white p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] md:p-7">
        {buildingContext.activeBuilding ? (
          <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-[#f5f6ff] px-3 py-1.5 text-[13px] text-[#3848c7]">
            Точка: <b className="font-semibold">{buildingContext.activeBuilding.name}</b> — графики и
            счётчики по документам считаются для неё
          </div>
        ) : null}
        <ReportForm
          templates={sortJournalsByName(templates, (t) => t.name)}
          areas={areas}
          defaultDateFrom={defaultDateFrom}
          defaultDateTo={defaultDateTo}
        />
      </div>
    </div>
  );
}

function formatYmdInZone(date: Date, timeZone: string): string {
  try {
    // en-CA даёт ровно YYYY-MM-DD — формат value у <input type="date">.
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

function CompareTile({
  label,
  now,
  prev,
  deltaPct,
  betterIs,
}: {
  label: string;
  now: number;
  prev: number;
  deltaPct: number | null;
  betterIs: "up" | "down";
}) {
  const arrow =
    deltaPct === null ? "—" : deltaPct > 0 ? "↑" : deltaPct < 0 ? "↓" : "=";
  const isPositive = deltaPct !== null && deltaPct !== 0;
  const directionGood =
    deltaPct === null
      ? null
      : (betterIs === "up" && deltaPct > 0) ||
          (betterIs === "down" && deltaPct < 0)
        ? true
        : (betterIs === "up" && deltaPct < 0) ||
            (betterIs === "down" && deltaPct > 0)
          ? false
          : null;
  const deltaColor =
    !isPositive
      ? "#6f7282"
      : directionGood === true
        ? "#116b2a"
        : directionGood === false
          ? "#a13a32"
          : "#6f7282";
  return (
    <div className="rounded-2xl border border-[#ececf4] bg-[#fafbff] p-4">
      <div className="text-[12px] font-medium uppercase tracking-wider text-[#6f7282]">
        {label}
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-[28px] font-semibold tabular-nums text-[#0b1024]">
          {now}
        </span>
        <span className="text-[12px] text-[#9b9fb3]">
          было {prev}
        </span>
        {deltaPct !== null ? (
          <span
            className="ml-auto text-[14px] font-semibold tabular-nums"
            style={{ color: deltaColor }}
          >
            {arrow} {Math.abs(deltaPct)}%
          </span>
        ) : null}
      </div>
    </div>
  );
}
