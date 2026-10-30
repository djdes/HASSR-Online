import { forbidden, redirect } from "next/navigation";
import { getServerSession } from "@/lib/server-session";
import { authOptions } from "@/lib/auth";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { db } from "@/lib/db";
import { loadGuideTree } from "@/lib/journal-guide-tree";
import { GuideTreeEditorClient } from "./tree-editor";

export const dynamic = "force-dynamic";

/**
 * P1.5 wave-b — Guide editor page. Симметрично pipeline-tree page,
 * но проще: нет seed/split/pinned. Просто tree с title+detail+photoUrl.
 *
 * После wave-c гайды реально подменят hardcoded `journal-filling-guides`
 * в FillingGuide modal'ке (`<JournalFillingGuide>`).
 */
export default async function JournalGuideTreePage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");
  if (!hasFullWorkspaceAccess(session.user)) forbidden();

  const organizationId = getActiveOrgId(session);
  const journalTemplate = await db.journalTemplate.findUnique({
    where: { code },
    select: { code: true, name: true },
  });
  if (!journalTemplate) redirect("/settings/journal-pipelines");

  const tree = await loadGuideTree(organizationId, code);

  return (
    <GuideTreeEditorClient
      code={code}
      journalName={journalTemplate.name}
      initialTree={tree}
    />
  );
}
