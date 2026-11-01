import { forbidden } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { loadCabinetInspectorData } from "@/lib/inspector-qr-service";
import { inspectorPointName, resolveInspectorIssuePointForSession } from "@/lib/inspector-point.server";
import { buildingTargets } from "@/lib/building-targets";
import { parsePointScope } from "@/lib/point-scope";
import { InspectorPortalClient } from "./inspector-portal-client";

export const dynamic = "force-dynamic";

export default async function InspectorPortalPage() {
  const t = await getTranslations("settingsUi.inspectorPortalPage");
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) {
    forbidden();
  }
  const orgId = getActiveOrgId(session);
  // Руководитель точки — ссылки своих точек; новые ссылки — на точку из шапки (2026-11-01).
  const [{ tokens, activity }, issuePoint, targets] = await Promise.all([
    loadCabinetInspectorData(orgId, { pointScope: parsePointScope(session.user.pointScope) }),
    resolveInspectorIssuePointForSession(session, orgId, undefined),
    buildingTargets(orgId),
  ]);
  const issueTargetName = await inspectorPointName(orgId, issuePoint.ok ? issuePoint.buildingId : null);

  return (
    <div className="space-y-5">
      <div className="mt-4 flex items-start gap-4">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#3848c7]">
          <ShieldCheck className="size-5" />
        </span>
        <div className="min-w-0">
          <h1 className="text-[clamp(1.75rem,2vw+1rem,2rem)] leading-tight font-bold tracking-[-0.02em] text-[#0b1024]">
            {t("title")}
          </h1>
          <p className="mt-1.5 max-w-[680px] text-[14px] leading-relaxed text-[#6f7282]">
            {t("description")}
          </p>
        </div>
      </div>

      <InspectorPortalClient
        initialTokens={tokens}
        initialActivity={activity}
        pointsEnabled={targets.some(Boolean)}
        issueTargetName={issueTargetName}
      />
    </div>
  );
}
