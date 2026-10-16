import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/server-session";
import { authOptions } from "@/lib/auth";
import { hasCapability } from "@/lib/permission-presets";
import { getActiveOrgId } from "@/lib/auth-helpers";
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
  return (
    <div className="space-y-5">
      <TeamClient />
      <WorkerLeaderboardCards organizationId={getActiveOrgId(session)} />
    </div>
  );
}
