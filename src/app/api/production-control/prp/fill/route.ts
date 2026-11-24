import type { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { recordAuditLog } from "@/lib/audit-log";
import { requirePpkAccess } from "@/lib/ppk/access.server";
import { PRP_TABLES, isPrpTableBlock } from "@/lib/ppk/prp-tables";
import { PPK_RECORD_LIMITS, PPK_RECORD_SCHEMAS } from "@/lib/ppk/records";
import { ppkWhere } from "@/lib/ppk/scope";
import { PRP_TEMPLATES } from "@/lib/ppk/structure-templates";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST { block } — «Заполнить типовыми» для таблицы раздела 3 структуры ППК:
 * добавляет типовые строки, которых ещё нет (по первой колонке), в пределах
 * лимита блока. Свои строки не трогает.
 */
export async function POST(request: Request) {
  const auth = await requirePpkAccess();
  if (!auth.ok) return auth.response;
  const body = (await request.json().catch(() => null)) as { block?: unknown } | null;
  const block = body?.block;
  if (!isPrpTableBlock(block)) {
    return NextResponse.json({ error: "Неизвестная таблица" }, { status: 400 });
  }
  const { scope } = auth;
  const key = PRP_TABLES[block][0].key;
  const rows = await db.ppkRecord.findMany({
    where: { ...ppkWhere(scope), block },
    select: { data: true },
  });
  const taken = new Set(
    rows.map((row) => String((row.data as Record<string, unknown> | null)?.[key] ?? "").trim().toLowerCase()),
  );
  const room = Math.max(0, PPK_RECORD_LIMITS[block] - rows.length);
  const items = PRP_TEMPLATES[block]
    .filter((row) => !taken.has(row[key].trim().toLowerCase()))
    .filter((row) => PPK_RECORD_SCHEMAS[block].safeParse(row).success)
    .slice(0, room);

  if (items.length > 0) {
    const last = await db.ppkRecord.aggregate({ where: { ...ppkWhere(scope), block }, _max: { sortOrder: true } });
    const start = (last._max.sortOrder ?? 0) + 1;
    await db.ppkRecord.createMany({
      data: items.map((item, index) => ({
        organizationId: scope.organizationId,
        buildingId: scope.buildingId,
        block,
        data: item as Prisma.InputJsonValue,
        sortOrder: start + index,
        createdById: auth.session.user.id ?? null,
      })),
    });
    await recordAuditLog({
      request,
      session: auth.session,
      organizationId: scope.organizationId,
      action: "production-control.prp-fill",
      entity: "PpkRecord",
      entityId: null,
      details: { block, added: items.length },
    });
  }
  return NextResponse.json({ added: items.length });
}
