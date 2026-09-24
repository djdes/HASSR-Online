import { NextResponse } from "next/server";
import { z } from "zod";

import { recordAuditLog } from "@/lib/audit-log";
import { db } from "@/lib/db";
import {
  diffSharedItems,
  isSharedKind,
  listPoolOrganizations,
  listSharedItems,
  replaceSharedItems,
  SHARED_ITEMS_MAX,
  sharedItemsForKind,
} from "@/lib/master-directory";
import { requireMasterDirectorySession } from "@/lib/master-directory-guard";
import { pushSharedListsToPool } from "@/lib/master-directory-push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Списки мастер-кабинета справочников.
 *   GET ?kind=dish|product   — список, код пула, подключённые объекты;
 *   PUT { kind, items }      — заменить список и раздать его во все объекты пула.
 */

export async function GET(request: Request) {
  const auth = await requireMasterDirectorySession();
  if (!auth.ok) return auth.response;
  const kind = new URL(request.url).searchParams.get("kind") ?? "dish";
  if (!isSharedKind(kind)) {
    return NextResponse.json({ error: "Неизвестный список: нужен dish или product" }, { status: 400 });
  }
  const [items, organizations, org] = await Promise.all([
    listSharedItems(auth.masterOrgId, kind),
    listPoolOrganizations(auth.masterOrgId),
    db.organization.findUnique({ where: { id: auth.masterOrgId }, select: { linkedServiceCode: true, serviceCode: true } }),
  ]);
  return NextResponse.json({
    items,
    total: items.length,
    code: org?.linkedServiceCode ?? org?.serviceCode ?? null,
    organizations,
  });
}

const itemSchema = z.object({
  name: z.string().max(500),
  supplier: z.string().max(500).nullish(),
  manufacturer: z.string().max(500).nullish(),
  portion: z.string().max(100).nullish(),
  time: z.string().max(20).nullish(),
});
const putSchema = z.object({
  kind: z.enum(["dish", "product"]),
  items: z.array(itemSchema).max(SHARED_ITEMS_MAX * 2),
});

export async function PUT(request: Request) {
  const auth = await requireMasterDirectorySession();
  if (!auth.ok) return auth.response;
  const parsed = putSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Список не распознан. Загрузите файл или вставьте текст заново." }, { status: 400 });
  }
  const { kind } = parsed.data;
  const items = sharedItemsForKind(
    kind,
    parsed.data.items.map((item) => ({
      name: item.name,
      supplier: item.supplier ?? null,
      manufacturer: item.manufacturer ?? null,
      portion: item.portion ?? null,
      time: item.time ?? null,
    }))
  );

  const current = await listSharedItems(auth.masterOrgId, kind);
  const diff = diffSharedItems(current, items);
  const { total } = await replaceSharedItems(auth.masterOrgId, kind, items);
  const pushed = await pushSharedListsToPool(auth.masterOrgId);

  await recordAuditLog({
    request,
    session: auth.session,
    organizationId: auth.masterOrgId,
    action: "master_directory.updated",
    entity: "SharedDirectoryItem",
    entityId: auth.masterOrgId,
    details: {
      kind,
      total,
      added: diff.added.length,
      removed: diff.removed.length,
      changed: diff.changed.length,
      organizations: pushed.organizations,
      documents: pushed.documents,
    },
  });
  console.info("[master-directory] saved and pushed", {
    masterOrgId: auth.masterOrgId,
    kind,
    total,
    added: diff.added.length,
    removed: diff.removed.length,
    changed: diff.changed.length,
    organizations: pushed.organizations,
    documents: pushed.documents,
  });

  return NextResponse.json({
    total,
    added: diff.added.length,
    removed: diff.removed.length,
    changed: diff.changed.length,
    organizations: pushed.organizations,
    documents: pushed.documents,
  });
}
