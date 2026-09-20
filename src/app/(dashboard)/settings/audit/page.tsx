import Link from "next/link";
import { Download } from "lucide-react";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { AuditLogViewer } from "@/components/settings/audit-log-viewer";
import { TasksflowAuditFeed } from "@/components/settings/tasksflow-audit-feed";

export default async function AuditPage() {
  // Раньше здесь стоял `requireRole(["owner"])`, и страница была недостижима
  // ни для кого: normalizeUserRole переводит legacy-«owner» в «manager»,
  // и список ["owner"] не совпадал даже с владельцем. Проверка та же, что
  // у API журнала действий (`/api/audit`).
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) {
    redirect("/settings");
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-[clamp(1.75rem,2vw+1rem,2rem)] leading-tight font-bold">Журнал действий</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            События Wesetup и TasksFlow в одном месте. Раздельно по
            системам — П-17 единой архитектуры (TF аудит хранится в TF,
            подтягивается в момент рендера).
          </p>
        </div>
        <Link
          href="/api/settings/audit/export"
          className="inline-flex h-10 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
          prefetch={false}
        >
          <Download className="size-4 text-[#5566f6]" />
          Скачать CSV (90 дней)
        </Link>
      </div>
      <AuditLogViewer />
      <TasksflowAuditFeed />
    </div>
  );
}
