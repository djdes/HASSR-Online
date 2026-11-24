import type { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { recordAuditLog } from "@/lib/audit-log";
import { requirePpkAccess } from "@/lib/ppk/access.server";
import { IMPORTED_PRODUCT_KINDS, productsFromDirectory } from "@/lib/ppk/product-import";
import { PPK_RECORD_LIMITS, PPK_RECORD_SCHEMAS, parsePpkRecords } from "@/lib/ppk/records";
import { ppkWhere } from "@/lib/ppk/scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST — «Загрузить из справочника» (пункт 1.5): готовая продукция и
 * полуфабрикаты справочника организации становятся карточками описания
 * продукции ППК этой точки. Отвечает, сколько добавлено и сколько пропущено.
 */
export async function POST(request: Request) {
  const auth = await requirePpkAccess();
  if (!auth.ok) return auth.response;
  const { scope } = auth;

  const [directory, rows] = await Promise.all([
    db.product.findMany({
      where: { organizationId: scope.organizationId, isActive: true, kind: { in: [...IMPORTED_PRODUCT_KINDS] } },
      select: { name: true, kind: true, storageTemp: true, storageConditions: true, shelfLifeDays: true, shelfLifeHours: true },
      orderBy: [{ kind: "asc" }, { name: "asc" }],
    }),
    db.ppkRecord.findMany({
      where: { ...ppkWhere(scope), block: "products" },
      select: { id: true, data: true, sortOrder: true, updatedAt: true },
    }),
  ]);
  const existing = parsePpkRecords("products", rows).map((row) => row.data.name);
  const room = Math.max(0, PPK_RECORD_LIMITS.products - rows.length);
  const items = productsFromDirectory(directory, existing, room).filter(
    (item) => PPK_RECORD_SCHEMAS.products.safeParse(item).success,
  );

  if (items.length > 0) {
    const last = await db.ppkRecord.aggregate({ where: { ...ppkWhere(scope), block: "products" }, _max: { sortOrder: true } });
    const start = (last._max.sortOrder ?? 0) + 1;
    await db.ppkRecord.createMany({
      data: items.map((item, index) => ({
        organizationId: scope.organizationId,
        buildingId: scope.buildingId,
        block: "products",
        data: item as unknown as Prisma.InputJsonValue,
        sortOrder: start + index,
        createdById: auth.session.user.id ?? null,
      })),
    });
    await recordAuditLog({
      request,
      session: auth.session,
      organizationId: scope.organizationId,
      action: "production-control.products-import",
      entity: "PpkRecord",
      entityId: null,
      details: { added: items.length },
    });
  }
  return NextResponse.json({ added: items.length, available: directory.length });
}
