import { randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { Session } from "next-auth";
import { loadBuildingContext } from "@/lib/active-building";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { buildingTargets } from "@/lib/building-targets";
import { isOfficeBuilding, viewedPointId } from "@/lib/building-scope";
import { db } from "@/lib/db";
import { ppkDocKindKey, ppkDocKindOf, ppkSingletonKey, remapPpkIds, type PpkScope } from "./scope";

/**
 * Область ППК запроса (2026-11-01, «ППК на точку»): торговая точка из шапки —
 * ППК этой точки; уровень организации (офис, «Вся организация», точки
 * выключены) — ППК организации. Руководитель точки всегда смотрит свою точку.
 * Первое открытие ППК точки копирует ей ППК организации (`ensurePointPpk`).
 */
export async function ppkScopeForSession(session: Session): Promise<PpkScope> {
  const scope = { organizationId: getActiveOrgId(session), buildingId: viewedPointId(await loadBuildingContext(session)) };
  await ensurePointPpk(scope);
  return scope;
}

/**
 * Область ППК без сессии (ссылка проверяющего, бот, кроны): точка — только
 * торговая точка организации в режиме точек, иначе уровень организации.
 */
export async function ppkScopeForPoint(organizationId: string, buildingId: string | null | undefined): Promise<PpkScope> {
  if (!buildingId) return { organizationId, buildingId: null };
  const [targets, building] = await Promise.all([
    buildingTargets(organizationId),
    db.building.findFirst({ where: { id: buildingId, organizationId }, select: { kind: true } }),
  ]);
  const point = building && !isOfficeBuilding(building) && targets.includes(buildingId) ? buildingId : null;
  const scope = { organizationId, buildingId: point };
  await ensurePointPpk(scope);
  return scope;
}

/** Id новой записи в духе cuid (25 символов, буквы и цифры). */
function newPpkId(): string {
  return `c${randomBytes(12).toString("hex")}`;
}

/**
 * Первое открытие ППК точки: точка получает копию ППК организации — записи
 * всех блоков (ссылки между ними — на копии), загруженные «ППК» / «ХАССП-план»
 * и файлы папок. Дальше копии независимы. Один раз на точку: отметка
 * `Building.ppkSeededAt` ставится в той же транзакции, поэтому одновременные
 * открытия не дублируют записи, а точка, удалившая всё, не получит копию снова.
 */
export async function ensurePointPpk(scope: PpkScope): Promise<void> {
  const buildingId = scope.buildingId;
  if (!buildingId) return;
  const point = await db.building.findFirst({
    where: { id: buildingId, organizationId: scope.organizationId },
    select: { ppkSeededAt: true },
  });
  if (!point || point.ppkSeededAt) return;
  await db.$transaction(
    async (tx) => {
      const claimed = await tx.building.updateMany({
        where: { id: buildingId, organizationId: scope.organizationId, ppkSeededAt: null },
        data: { ppkSeededAt: new Date() },
      });
      if (claimed.count !== 1) return;
      await copyOrganizationPpk(tx, scope.organizationId, buildingId);
    },
    { maxWait: 15_000, timeout: 120_000 },
  );
}

async function copyOrganizationPpk(tx: Prisma.TransactionClient, organizationId: string, buildingId: string): Promise<void> {
  const records = await tx.ppkRecord.findMany({
    where: { organizationId, buildingId: null },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const ids = new Map(records.map((record) => [record.id, newPpkId()]));
  if (records.length > 0) {
    await tx.ppkRecord.createMany({
      data: records.map((record) => {
        let data = remapPpkIds(record.data, ids) as Prisma.InputJsonValue;
        // Публичная ссылка политики — своя у точки: QR организации ведёт на её текст.
        if (record.block === "policy" && data && typeof data === "object" && !Array.isArray(data)) {
          data = { ...(data as Record<string, unknown>), token: randomBytes(16).toString("base64url") } as Prisma.InputJsonValue;
        }
        return {
          id: ids.get(record.id)!,
          organizationId,
          buildingId,
          block: record.block,
          data,
          sortOrder: record.sortOrder,
          createdById: record.createdById,
          singleton: record.singleton ? ppkSingletonKey(record.singleton, buildingId) : null,
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
        };
      }),
    });
  }

  const documents = await tx.knowledgeDocument.findMany({
    where: {
      organizationId,
      buildingId: null,
      OR: [{ kind: { in: ["ppk", "haccp_plan"] } }, { folder: { not: null } }],
    },
  });
  for (const document of documents) {
    const kind = ppkDocKindOf(document.kind);
    await tx.knowledgeDocument.create({
      data: {
        organizationId,
        buildingId,
        title: document.title,
        fileName: document.fileName,
        mimeType: document.mimeType,
        sizeBytes: document.sizeBytes,
        content: document.content,
        uploadedByName: document.uploadedByName,
        kind: kind ? ppkDocKindKey(kind, buildingId) : null,
        folder: document.folder,
        createdAt: document.createdAt,
      },
    });
  }
}
