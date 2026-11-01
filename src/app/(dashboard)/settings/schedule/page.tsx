import { forbidden } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { CalendarRange } from "lucide-react";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { ScheduleEditor } from "@/components/settings/schedule-editor";
import { NOT_COMMISSION_WHERE } from "@/lib/journal-roster";
import { visibleStaffWhere } from "@/lib/people-scope.server";

export const dynamic = "force-dynamic";

function weekAnchor(now: Date): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );
}

export default async function ScheduleSettingsPage() {
  const t = await getTranslations("settingsUi.schedulePage");
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) {
    forbidden();
  }
  const organizationId = getActiveOrgId(session);
  const now = new Date();
  const start = weekAnchor(now);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 13);

  // Руководитель точки — график людей своих точек (фаза 2 «Офис и точки»),
  // точка в шапке — её людей (2026-11-01); смены — только людей списка.
  const staffWhere = await visibleStaffWhere(session);
  const [users, positions] = await Promise.all([
    db.user.findMany({
      where: {
        // NOT_COMMISSION_WHERE и условие точки оба занимают `AND` — кладём рядом.
        AND: [{ organizationId, isActive: true, archivedAt: null, ...NOT_COMMISSION_WHERE }, staffWhere],
      },
      orderBy: [{ name: "asc" }],
      select: {
        id: true,
        name: true,
        role: true,
        jobPositionId: true,
        jobPosition: {
          select: { id: true, name: true, categoryKey: true },
        },
      },
    }),
    db.jobPosition.findMany({
      where: { organizationId },
      orderBy: [{ categoryKey: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true, categoryKey: true },
    }),
  ]);
  const shifts = await db.workShift.findMany({
    where: {
      organizationId,
      userId: { in: users.map((user) => user.id) },
      date: { gte: start, lte: end },
    },
    select: {
      userId: true,
      date: true,
      status: true,
      jobPositionId: true,
    },
  });

  const shiftsInitial = shifts.map((s) => ({
    userId: s.userId,
    date: s.date.toISOString().slice(0, 10),
    status: s.status,
    jobPositionId: s.jobPositionId,
  }));

  return (
    <div className="space-y-5">
      <div>

        <div className="mt-4 flex items-start gap-4">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#5566f6]">
            <CalendarRange className="size-5" />
          </span>
          <div>
            <h1 className="text-[clamp(1.75rem,2vw+1rem,2rem)] leading-tight font-bold tracking-[-0.02em] text-[#0b1024]">
              {t("title")}
            </h1>
            <p className="mt-1.5 max-w-[680px] text-[14px] leading-relaxed text-[#6f7282]">
              {t("intro")}
            </p>
            {/* Честно про границу: журналы читают не WorkShift, а отпуска и
                выходные из карточки сотрудника. Раньше здесь было обещание
                «назначаем задачи по этому расписанию», и управляющая ставила
                «Отпуск» тут, а гигиенический журнал всё равно требовал
                отметку. */}
            {/* Текст спорил сам с собой: обещал, что отпуск и больничный
                ставятся «не здесь», а переключатель на этой же странице
                предлагал ровно «Отпуск» и «Больничный». Пишем честно,
                чем одно отличается от другого. */}
            <p className="mt-2 max-w-[680px] rounded-2xl border border-[#dcdfed] bg-[#f8f9fc] px-4 py-3 text-[13px] leading-relaxed text-[#6f7282]">
              <strong className="font-semibold text-[#0b1024]">
                {t("noteDay")}
              </strong>{" "}
              {t("noteDayBody")}
              <br />
              <strong className="font-semibold text-[#0b1024]">
                {t("noteLong")}
              </strong>{" "}
              {t.rich("noteLongBody", {
                link: (chunks) => (
                  <a
                    href="/settings/users"
                    className="font-medium text-[#5566f6] transition-colors duration-150 hover:text-[#4a5bf0]"
                  >
                    {chunks}
                  </a>
                ),
              })}
            </p>
          </div>
        </div>
      </div>

      <ScheduleEditor
        startYmd={start.toISOString().slice(0, 10)}
        endYmd={end.toISOString().slice(0, 10)}
        users={users.map((u) => ({
          id: u.id,
          name: u.name,
          role: u.role,
          jobPositionId: u.jobPositionId,
          jobPositionName: u.jobPosition?.name ?? null,
          categoryKey: u.jobPosition?.categoryKey ?? null,
        }))}
        positions={positions}
        shifts={shiftsInitial}
      />
    </div>
  );
}
