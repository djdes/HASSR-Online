import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { decryptSecret } from "@/lib/integration-crypto";
import { getAdapter } from "@/lib/tasksflow-adapters";
import { toDateKey } from "@/lib/hygiene-document";
import { buildTasksflowJournalUi } from "@/lib/tasksflow-journal-ui";
import { getUserDisplayTitle } from "@/lib/user-roles";
import { sortJournalsByName } from "@/lib/journal-sort";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Universal catalog: every active journal in the org is exposed so
 * TasksFlow's «Журнальный» mode can offer all 35.
 *
 * Two flavours per journal:
 *   1. **Adapter-rich** — the journal has a registered adapter
 *      (`src/lib/tasksflow-adapters/`). Catalog returns adapter rows
 *      (e.g. cleaning's responsiblePairs) so the picker shows existing
 *      assignable things.
 *   2. **Generic / free-text** — no adapter yet. Catalog still lists
 *      the journal + its active documents so the admin can create a
 *      «свободная задача» (free-text title + chosen worker). Such
 *      tasks land as JournalDocumentEntry on completion.
 *
 * Auth: Bearer key resolved against integration's encrypted secret.
 */
export async function GET(request: Request) {
  const auth = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(tfk_[A-Za-z0-9_-]+)$/.exec(auth);
  if (!match) {
    return NextResponse.json({ error: "Missing Bearer key" }, { status: 401 });
  }
  const presented = match[1];
  const prefix = presented.slice(0, 12);

  const candidates = await db.tasksFlowIntegration.findMany({
    where: { enabled: true, apiKeyPrefix: prefix },
    select: {
      id: true,
      organizationId: true,
      apiKeyEncrypted: true,
    },
  });
  let resolved: { id: string; organizationId: string } | null = null;
  for (const cand of candidates) {
    try {
      if (decryptSecret(cand.apiKeyEncrypted) === presented) {
        resolved = { id: cand.id, organizationId: cand.organizationId };
        break;
      }
    } catch {
      /* skip */
    }
  }
  if (!resolved) {
    return NextResponse.json({ error: "Invalid key" }, { status: 401 });
  }

  // What the org actually wants to see (disabledJournalCodes is the
  // opt-out set chosen on /settings/journals).
  const org = await db.organization.findUnique({
    where: { id: resolved.organizationId },
    select: { disabledJournalCodes: true },
  });
  const disabledRaw = (org?.disabledJournalCodes ?? []) as unknown;
  const disabled = new Set<string>(
    Array.isArray(disabledRaw)
      ? disabledRaw.filter((x): x is string => typeof x === "string")
      : []
  );

  const templates = await db.journalTemplate.findMany({
    where: { isActive: true },
    select: { code: true, name: true, description: true, sortOrder: true },
    orderBy: { sortOrder: "asc" },
  });
  // Журналы по алфавиту — в таком порядке их показывает TasksFlow.
  const usableTemplates = sortJournalsByName(
    templates.filter((t) => !disabled.has(t.code)),
    (t) => t.name
  );

  // All active documents for the org, grouped by templateCode → docs.
  const docs = await db.journalDocument.findMany({
    where: {
      organizationId: resolved.organizationId,
      status: "active",
    },
    select: {
      id: true,
      title: true,
      dateFrom: true,
      dateTo: true,
      template: { select: { code: true } },
    },
    orderBy: { dateFrom: "desc" },
  });
  const docsByJournal = new Map<
    string,
    Array<{ id: string; title: string; dateFrom: Date; dateTo: Date }>
  >();
  for (const d of docs) {
    const code = d.template.code;
    const list = docsByJournal.get(code) ?? [];
    list.push({
      id: d.id,
      title: d.title,
      dateFrom: d.dateFrom,
      dateTo: d.dateTo,
    });
    docsByJournal.set(code, list);
  }

  // Pre-load TaskLinks once so we can mark «уже привязано» rows in
  // the UI without a per-document round trip.
  const taskLinks = await db.tasksFlowTaskLink.findMany({
    where: { integrationId: resolved.id },
    select: {
      journalCode: true,
      journalDocumentId: true,
      rowKey: true,
      tasksflowTaskId: true,
    },
  });
  const takenByJournal = new Map<string, Map<string, Map<string, number>>>();
  for (const tl of taskLinks) {
    let perJournal = takenByJournal.get(tl.journalCode);
    if (!perJournal) {
      perJournal = new Map();
      takenByJournal.set(tl.journalCode, perJournal);
    }
    let perDoc = perJournal.get(tl.journalDocumentId);
    if (!perDoc) {
      perDoc = new Map();
      perJournal.set(tl.journalDocumentId, perDoc);
    }
    perDoc.set(tl.rowKey, tl.tasksflowTaskId);
  }

  const userLinks = await db.tasksFlowUserLink.findMany({
    where: {
      integrationId: resolved.id,
      tasksflowUserId: { not: null },
    },
    select: {
      wesetupUserId: true,
      tasksflowUserId: true,
    },
  });
  const linkedWesetupUserIds = userLinks.map((link) => link.wesetupUserId);
  const linkedUsers = linkedWesetupUserIds.length
    ? await db.user.findMany({
        where: {
          id: { in: linkedWesetupUserIds },
          organizationId: resolved.organizationId,
          isActive: true,
          archivedAt: null,
        },
        select: {
          id: true,
          name: true,
          role: true,
          positionTitle: true,
          jobPosition: {
            select: { name: true },
          },
        },
      })
    : [];
  const linkedUsersById = new Map(linkedUsers.map((user) => [user.id, user]));
  const assignableUsers: Array<{
    userId: string;
    name: string;
    positionTitle: string | null;
    tasksflowUserId: number;
  }> = [];
  for (const link of userLinks) {
    const user = linkedUsersById.get(link.wesetupUserId);
    if (!user || !link.tasksflowUserId) continue;
    assignableUsers.push({
      userId: user.id,
      name: user.name,
      positionTitle: getUserDisplayTitle(user),
      tasksflowUserId: link.tasksflowUserId,
    });
  }
  assignableUsers.sort((a, b) => a.name.localeCompare(b.name, "ru"));

  const journals = await Promise.all(
    usableTemplates.map(async (template) => {
      const adapter = getAdapter(template.code);
      const journalDocs = docsByJournal.get(template.code) ?? [];
      const perJournalTaken = takenByJournal.get(template.code);

      // Adapter rows (if any) per document.
      let adapterDocsById: Map<
        string,
        Awaited<
          ReturnType<typeof adapter extends infer A
            ? A extends { listDocumentsForOrg: (...args: never) => infer R }
              ? () => R
              : never
            : never>
        >[number]["rows"]
      > | null = null;
      if (adapter) {
        try {
          const adapterDocs = await adapter.listDocumentsForOrg(
            resolved!.organizationId
          );
          adapterDocsById = new Map(
            adapterDocs.map((d) => [d.documentId, d.rows])
          );
        } catch (err) {
          console.error(
            `[journals-catalog] adapter ${template.code} failed`,
            err
          );
        }
      }

      const documents = journalDocs.map((d) => {
        const taken = perJournalTaken?.get(d.id) ?? new Map<string, number>();
        const rows = (adapterDocsById?.get(d.id) ?? []).map((row) => ({
          ...row,
          existingTasksflowTaskId: taken.get(row.rowKey) ?? null,
        }));
        return {
          documentId: d.id,
          documentTitle: d.title,
          period: {
            from: toDateKey(d.dateFrom),
            to: toDateKey(d.dateTo),
          },
          rows,
        };
      });

      // Form schema preview for the admin create-task screen. One
      // representative form per journal — specific row intros are
      // resolved later at completion time via
      // `/api/integrations/tasksflow/task-form?taskId=…`.
      let taskFormPreview = null;
      if (adapter?.getTaskForm && (adapterDocsById?.size ?? 0) > 0) {
        const firstDoc = journalDocs[0];
        const firstRow = adapterDocsById!.get(firstDoc.id)?.[0];
        if (firstRow) {
          try {
            taskFormPreview = await adapter.getTaskForm({
              documentId: firstDoc.id,
              rowKey: firstRow.rowKey,
            });
          } catch (err) {
            console.error(
              `[journals-catalog] ${template.code} getTaskForm failed`,
              err
            );
          }
        }
      }

      return {
        templateCode: template.code,
        label: template.name,
        description: template.description ?? null,
        iconName: adapter?.meta.iconName ?? null,
        /** True if a registered adapter handles this journal. UI uses
         *  this to show «реальный round-trip» badge vs the lighter
         *  «свободная задача» path. */
        hasAdapter: Boolean(adapter),
        /** Declarative form the employee fills on completion. Null for
         *  journals without an adapter — those use free-text tasks. */
        taskForm: taskFormPreview,
        ui: buildTasksflowJournalUi({
          code: template.code,
          label: template.name,
          hasAdapter: Boolean(adapter),
        }),
        documents,
      };
    })
  );

  return NextResponse.json({ journals, assignableUsers });
}
