import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/server-session";
import { authOptions } from "@/lib/auth";
import { hasCapability } from "@/lib/permission-presets";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { getViewedPointId } from "@/lib/active-building";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { WorkerLeaderboardCards } from "@/components/dashboard/worker-leaderboard-card";
import { TeamClient } from "./team-client";

export const dynamic = "force-dynamic";

export default async function TeamPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");
  // Доступ: head_chef + admin (через staff.view ИЛИ tasks.verify ИЛИ admin.full)
  if (
    !hasCapability(session.user, "staff.view") &&
    !hasCapability(session.user, "tasks.verify") &&
    !hasCapability(session.user, "admin.full")
  ) {
    redirect("/mini/today");
  }
  // «Топ за месяц» и «Кому помочь» — руководству (раньше на главной).
  if (!hasFullWorkspaceAccess(session.user)) return <TeamClient />;
  // Точка в шапке (2026-11-01) — рейтинг только людей этой точки, как у
  // руководителя точки; «Вся организация» — все (руководитель точки — свои).
  const viewedPoint = await getViewedPointId(session);
  return (
    <div className="space-y-5">
      <TeamClient />
      <WorkerLeaderboardCards
        organizationId={getActiveOrgId(session)}
        pointScope={viewedPoint ? [viewedPoint] : session.user.pointScope}
      />
    </div>
  );
}
