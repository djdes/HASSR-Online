import { redirect } from "next/navigation";
import { CloudUpload } from "lucide-react";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { db } from "@/lib/db";
import { YandexBackupClient } from "./yandex-backup-client";
import { ExportJournalsCard } from "@/components/settings/export-journals-card";
import { DomainMessagesBoundary } from "@/components/i18n/domain-messages-boundary";
import { getTranslations } from "next-intl/server";

export const dynamic = "force-dynamic";

export default async function BackupSettingsPage() {
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) {
    redirect("/settings");
  }
  const orgId = getActiveOrgId(session);
  const t = await getTranslations("yandexBackup");

  const org = await db.organization.findUnique({
    where: { id: orgId },
    select: {
      yandexDiskFolder: true,
      yandexDiskLastBackupAt: true,
      yandexDiskToken: true,
    },
  });

  const recentLogs = await db.auditLog.findMany({
    where: {
      organizationId: orgId,
      entity: "yandex_backup",
    },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: {
      id: true,
      action: true,
      details: true,
      createdAt: true,
    },
  });

  return (
    <div className="space-y-5">
      <div>

        <div className="mt-4 flex items-start gap-4">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#3848c7]">
            <CloudUpload className="size-5" />
          </span>
          <div>
            <h1 className="text-[clamp(1.75rem,2vw+1rem,2rem)] leading-tight font-bold tracking-[-0.02em] text-[#0b1024]">
              {t("title")}
            </h1>
            <p className="mt-1.5 max-w-[680px] text-[14px] leading-relaxed text-[#6f7282]">
              {t("description")}
            </p>
          </div>
        </div>
      </div>

      <DomainMessagesBoundary namespaces={["archiveExport"]}>
        <ExportJournalsCard />
      </DomainMessagesBoundary>


      <DomainMessagesBoundary namespaces={["yandexBackup"]}>
      <YandexBackupClient
        initialState={{
          connected: Boolean(org?.yandexDiskToken),
          folder: org?.yandexDiskFolder ?? "/WeSetup",
          lastBackupAt: org?.yandexDiskLastBackupAt
            ? org.yandexDiskLastBackupAt.toISOString()
            : null,
        }}
        recentLogs={recentLogs.map((l) => ({
          id: l.id,
          action: l.action,
          details: (l.details as Record<string, unknown> | null) ?? null,
          createdAt: l.createdAt.toISOString(),
        }))}
      />
      </DomainMessagesBoundary>
    </div>
  );
}
