import { withBuildingSuffix } from "@/lib/building-scope";
import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { decryptSecret } from "@/lib/integration-crypto";
import {
  TasksFlowError,
  tasksflowClientFor,
} from "@/lib/tasksflow-client";
import { getAdapter } from "@/lib/tasksflow-adapters";
import { toDateKey } from "@/lib/hygiene-document";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Batched bind: TasksFlow asks WeSetup to attach one or many journal
 * entities to new remote tasks. Works in three modes:
 *
 *   1. **Single adapter row** — `{journalCode, documentId, rowKey}`
 *   2. **Batch adapter rows** — `{journalCode, documentId, rowKeys: [...]}`
 *      (one task per row)
 *   3. **Free-text / batch free-text** — no rowKey(s); instead
 *      `{journalCode, documentId, workerUserId(s), title}`. One task
 *      per selected worker.
 *
 * The response is always an array of per-slot results so the caller
 * can show a toast like «3 создано, 1 уже есть, 1 ошибка». Even a
 * single-slot call comes back wrapped in the same shape.
 */
const bodySchema = z
  .object({
    journalCode: z.string().min(1),
    documentId: z.string().min(1),
    rowKey: z.string().optional(),
    rowKeys: z.array(z.string().min(1)).optional(),
    title: z.string().trim().max(255).optional(),
    workerUserId: z.string().optional(),
    workerUserIds: z.array(z.string().min(1)).optional(),
    weekDays: z.array(z.number().int().min(0).max(6)).optional(),
  })
  .refine(
    (v) =>
      Boolean(v.rowKey) ||
      (v.rowKeys && v.rowKeys.length > 0) ||
      (Boolean(v.workerUserId) && Boolean(v.title)) ||
      (v.workerUserIds && v.workerUserIds.length > 0 && Boolean(v.title)),
    {
      message:
        "Нужны rowKey(s) или workerUserId(s)+title (свободная задача)",
    }
  );

type SlotResult = {
  /** For adapter rows — row label; for free-text — worker name. */
  label: string;
  rowKey: string;
  tasksflowTaskId?: number;
  created?: boolean;
  skipped?: "already-linked" | "no-worker" | "no-user-link";
  error?: string;
};

export async function POST(request: Request) {
  const auth = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(tfk_[A-Za-z0-9_-]+)$/.exec(auth);
  if (!match) {
    return NextResponse.json({ error: "Missing Bearer key" }, { status: 401 });
  }
  const presented = match[1];
  const prefix = presented.slice(0, 12);

  const candidates = await db.tasksFlowIntegration.findMany({
    where: { enabled: true, apiKeyPrefix: prefix },
  });
  let integration: (typeof candidates)[number] | null = null;
  for (const cand of candidates) {
    try {
      if (decryptSecret(cand.apiKeyEncrypted) === presented) {
        integration = cand;
        break;
      }
    } catch {
      /* skip */
    }
  }
  if (!integration) {
    return NextResponse.json({ error: "Invalid key" }, { status: 401 });
  }

  let payload: z.infer<typeof bodySchema>;
  try {
    payload = bodySchema.parse(await request.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: err.issues[0]?.message ?? "Invalid body" },
        { status: 400 }
      );
    }
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const doc = await db.journalDocument.findUnique({
    where: { id: payload.documentId },
    include: { template: true, building: { select: { name: true } } },
  });
  if (
    !doc ||
    doc.organizationId !== integration.organizationId ||
    doc.template.code !== payload.journalCode
  ) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }
  if (doc.status === "closed") {
    return NextResponse.json({ error: "Document already closed" }, { status: 400 });
  }

  const adapter = getAdapter(payload.journalCode);
  const client = tasksflowClientFor(integration);

  // Normalize into a flat work list of slots. Each slot becomes one
  // TasksFlow task + one TaskLink.
  type Slot =
    | { kind: "row"; rowKey: string }
    | { kind: "free"; workerUserId: string };
  const slots: Slot[] = [];
  const explicitRowKeys =
    payload.rowKeys ?? (payload.rowKey ? [payload.rowKey] : []);
  for (const rk of explicitRowKeys) {
    slots.push({ kind: "row", rowKey: rk });
  }
  const explicitWorkers =
    payload.workerUserIds ??
    (payload.workerUserId ? [payload.workerUserId] : []);
  for (const wid of explicitWorkers) {
    slots.push({ kind: "free", workerUserId: wid });
  }

  const adapterDocs = adapter
    ? await adapter.listDocumentsForOrg(integration.organizationId)
    : [];
  const adapterDoc = adapterDocs.find((d) => d.documentId === doc.id);
  const rowByKey = new Map(
    (adapterDoc?.rows ?? []).map((r) => [r.rowKey, r])
  );

  const results: SlotResult[] = [];
  for (const slot of slots) {
    let label: string;
    let storedRowKey: string;
    let workerWeSetupId: string | null;
    let title: string;
    let description: string | undefined;
    let weekDays: number[];
    let monthDay: number | null;

    if (slot.kind === "row") {
      const row = rowByKey.get(slot.rowKey);
      if (!adapter || !adapterDoc || !row) {
        results.push({
          label: slot.rowKey,
          rowKey: slot.rowKey,
          error: "Row not found",
        });
        continue;
      }
      workerWeSetupId = row.responsibleUserId;
      label = row.label;
      storedRowKey = row.rowKey;
      title = withBuildingSuffix(
        payload.title?.trim() ||
          adapter.titleForRow?.(row, adapterDoc) ||
          row.label,
        doc.building?.name ?? null,
      );
      description = adapter.descriptionForRow?.(row, adapterDoc);
      const sched = adapter.scheduleForRow(row, adapterDoc);
      weekDays = payload.weekDays?.length ? payload.weekDays : sched.weekDays;
      monthDay = sched.monthDay ?? null;
    } else {
      if (!payload.title) {
        results.push({
          label: slot.workerUserId,
          rowKey: slot.workerUserId,
          error: "Для свободной задачи нужно название",
        });
        continue;
      }
      const worker = await db.user.findFirst({
        where: {
          id: slot.workerUserId,
          organizationId: integration.organizationId,
          isActive: true,
        },
        select: { id: true, name: true },
      });
      if (!worker) {
        results.push({
          label: slot.workerUserId,
          rowKey: slot.workerUserId,
          error: "Сотрудник не найден",
        });
        continue;
      }
      workerWeSetupId = worker.id;
      label = worker.name;
      title = payload.title;
      description = `Свободная задача из программного модуля\nЖурнал: ${
        doc.template.name ?? payload.journalCode
      }\nДокумент: ${doc.title}`;
      weekDays = payload.weekDays?.length
        ? payload.weekDays
        : [0, 1, 2, 3, 4, 5, 6];
      monthDay = null;
      // Encode the WeSetup worker id in the rowKey so the generic
      // adapter can file the journal entry on completion without
      // needing an extra DB lookup via TaskLink. Format:
      // `freetask:<userId>:<rand>`.
      storedRowKey = `freetask:${worker.id}:${crypto.randomBytes(6).toString("base64url")}`;
    }

    if (!workerWeSetupId) {
      results.push({ label, rowKey: storedRowKey, skipped: "no-worker" });
      continue;
    }
    const userLink = await db.tasksFlowUserLink.findFirst({
      where: {
        integrationId: integration.id,
        wesetupUserId: workerWeSetupId,
      },
    });
    if (!userLink?.tasksflowUserId) {
      results.push({ label, rowKey: storedRowKey, skipped: "no-user-link" });
      continue;
    }

    const existing = await db.tasksFlowTaskLink.findFirst({
      where: {
        integrationId: integration.id,
        journalDocumentId: doc.id,
        rowKey: storedRowKey,
      },
    });
    if (existing) {
      results.push({
        label,
        rowKey: storedRowKey,
        tasksflowTaskId: existing.tasksflowTaskId,
        created: false,
        skipped: "already-linked",
      });
      continue;
    }

    const envBase = (process.env.NEXTAUTH_URL ?? "").trim();
    const requestOrigin = new URL(request.url).origin;
    const baseUrl =
      envBase && !envBase.includes("localhost") ? envBase : requestOrigin;
    const journalLink = JSON.stringify({
      kind: `wesetup-${payload.journalCode}`,
      baseUrl,
      integrationId: integration.id,
      documentId: doc.id,
      rowKey: storedRowKey,
      label: title,
      isFreeText: slot.kind === "free",
    });

    let created;
    try {
      created = await client.createTask({
        title,
        workerId: userLink.tasksflowUserId,
        requiresPhoto: false,
        isRecurring: true,
        weekDays,
        monthDay,
        category: `WeSetup · ${doc.template.name ?? payload.journalCode}`,
        description: description ?? "",
      });
    } catch (err) {
      results.push({
        label,
        rowKey: storedRowKey,
        error:
          err instanceof TasksFlowError
            ? `Ошибка программного модуля (${err.status}): ${err.message}`
            : err instanceof Error
            ? err.message
            : "Не удалось создать",
      });
      continue;
    }
    try {
      await client.updateTask(created.id, { journalLink } as never);
    } catch (err) {
      console.error("[bind-row] journalLink update failed", err);
    }
    await db.tasksFlowTaskLink.create({
      data: {
        integrationId: integration.id,
        journalCode: payload.journalCode,
        journalDocumentId: doc.id,
        rowKey: storedRowKey,
        tasksflowTaskId: created.id,
        remoteStatus: created.isCompleted ? "completed" : "active",
        lastDirection: "push",
      },
    });
    results.push({
      label,
      rowKey: storedRowKey,
      tasksflowTaskId: created.id,
      created: true,
    });
  }

  if (results.some((r) => r.created === true || r.skipped || r.error)) {
    await db.tasksFlowIntegration.update({
      where: { id: integration.id },
      data: { lastSyncAt: new Date() },
    });
  }

  const summary = {
    created: results.filter((r) => r.created === true).length,
    alreadyLinked: results.filter((r) => r.skipped === "already-linked").length,
    skipped: results.filter((r) => r.skipped && r.skipped !== "already-linked")
      .length,
    errors: results.filter((r) => Boolean(r.error)).length,
  };
  return NextResponse.json({
    results,
    summary,
    todayKey: toDateKey(new Date()),
  });
}
