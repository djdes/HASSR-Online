import { randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { recordAuditLog } from "@/lib/audit-log";
import { requirePpkAccess } from "@/lib/ppk/access.server";
import { flowchartTemplate } from "@/lib/ppk/diagram";
import { policyTemplate } from "@/lib/ppk/haccp";
import { STARTER_BLOCKS, isStarterKind, starterPack, type StarterBlock } from "@/lib/ppk/starter-packs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST { kind } — заполняет типовыми данными только пустые блоки ППК: продукция,
 * опасности, блок-схемы, планы лаборатории и дезинсекции, нормативы, текст политики
 * (без утверждения). Блоки с данными пропускаются. Всё — одной транзакцией.
 */
export async function POST(request: Request) {
  const auth = await requirePpkAccess();
  if (!auth.ok) return auth.response;
  const body = await request.json().catch(() => null);
  const kind = body?.kind;
  if (!isStarterKind(kind)) {
    return NextResponse.json({ error: "Неизвестный тип заведения" }, { status: 400 });
  }

  const organizationId = auth.organizationId;
  const createdById = auth.session.user.id ?? null;
  const pack = starterPack(kind);
  const organization = await db.organization.findUnique({
    where: { id: organizationId },
    select: { name: true },
  });

  const rows: Record<StarterBlock, Record<string, unknown>[]> = {
    products: pack.products,
    hazards: pack.hazards,
    flowchart: pack.flowcharts.map((chart) => ({ ...flowchartTemplate(chart.template), title: chart.title })),
    "lab-plan": pack.labPlan,
    "pest-plan": pack.pestPlan,
    norms: [{ selected: pack.norms, custom: [] }],
    policy: [
      {
        text: policyTemplate(organization?.name ?? ""),
        approvedById: null,
        approvedAt: null,
        // Токен ставит сервер: по нему открывается публичная страница политики.
        token: randomBytes(16).toString("base64url"),
      },
    ],
  };

  try {
    const result = await db.$transaction(async (tx) => {
      const created: Partial<Record<StarterBlock, number>> = {};
      const skipped: StarterBlock[] = [];
      for (const block of STARTER_BLOCKS) {
        const existing = await tx.ppkRecord.count({ where: { organizationId, block } });
        if (existing > 0) {
          skipped.push(block);
          continue;
        }
        const singleton = block === "policy" || block === "norms" ? block : null;
        await tx.ppkRecord.createMany({
          data: rows[block].map((data, index) => ({
            organizationId,
            block,
            data: data as Prisma.InputJsonValue,
            sortOrder: index + 1,
            createdById,
            singleton,
          })),
        });
        created[block] = rows[block].length;
      }
      return { created, skipped };
    });

    await recordAuditLog({
      request,
      session: auth.session,
      organizationId,
      action: "production-control.starter",
      entity: "PpkRecord",
      entityId: organizationId,
      details: { kind, created: result.created, skipped: result.skipped },
    });
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    // P2002 — параллельный запрос успел создать политику или нормативы.
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
      return NextResponse.json({ error: "Заполнение уже идёт, обновите страницу" }, { status: 409 });
    }
    throw error;
  }
}
