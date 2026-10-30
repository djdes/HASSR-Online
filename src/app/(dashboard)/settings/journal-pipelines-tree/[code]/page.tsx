import { forbidden, redirect } from "next/navigation";
import { getServerSession } from "@/lib/server-session";
import { authOptions } from "@/lib/auth";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { db } from "@/lib/db";
import { loadPipelineTree } from "@/lib/journal-pipeline-tree";
import { TreeEditorClient } from "./tree-editor";

export const dynamic = "force-dynamic";

/**
 * P1.3 wave-a — read-only Pipeline tree editor для нового
 * `JournalPipelineTemplate`. Показывает дерево узлов, кнопку «Создать
 * из колонок журнала» (seed), и Add Custom modal. DnD-reorder и
 * split-pinned добавим в wave-c, live-preview — wave-d.
 *
 * Пока существует параллельно с legacy `/settings/journal-pipelines`,
 * не ломая её. После того как tree закроет фичи легаси — legacy
 * редирект сюда.
 */
export default async function JournalPipelineTreePage({
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
    select: { code: true, name: true, fields: true },
  });
  if (!journalTemplate) redirect("/settings/journal-pipelines");

  const tree = await loadPipelineTree(organizationId, code);
  const fields = Array.isArray(journalTemplate.fields)
    ? (journalTemplate.fields as Array<{ key?: unknown; label?: unknown }>)
        .filter((f) => typeof f?.key === "string")
        .map((f) => ({
          key: String(f.key),
          label: typeof f?.label === "string" ? f.label : String(f.key),
        }))
    : [];

  return (
    <TreeEditorClient
      code={code}
      journalName={journalTemplate.name}
      fields={fields}
      initialTree={tree}
    />
  );
}
