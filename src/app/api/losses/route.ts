import { getServerSession } from "@/lib/server-session";
import { authOptions } from "@/lib/auth";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  const where: Record<string, unknown> = {
    organizationId: getActiveOrgId(session),
  };
  if (from || to) {
    const dateFilter: Record<string, Date> = {};
    if (from) dateFilter.gte = new Date(from);
    if (to) { const d = new Date(to); d.setHours(23, 59, 59); dateFilter.lte = d; }
    where.date = dateFilter;
  }

  const records = await db.lossRecord.findMany({
    where,
    orderBy: { date: "desc" },
    take: 200,
  });

  return NextResponse.json(records);
}

/**
 * L9 — авто-классификация writeoff causes по ключевым словам.
 * Если менеджер не выбрал категорию (или выбрал "other"), а в
 * `cause` или `productName` есть характерное слово — мы
 * подменяем category. Без AI — keyword-matching.
 */
function autoCategorize(
  category: string | undefined,
  cause: string | undefined,
  productName: string | undefined
): string {
  const initial = (category ?? "").trim();
  if (initial && initial !== "other") return initial;
  const haystack = `${cause ?? ""} ${productName ?? ""}`.toLowerCase();
  const matches: Array<{ cat: string; words: string[] }> = [
    { cat: "writeoff", words: ["просроч", "истёк", "испорч", "плесен", "запах"] },
    { cat: "packaging_defect", words: ["упаков", "тара", "вмятин", "разрыв"] },
    { cat: "rework", words: ["перераб", "повтор"] },
    { cat: "overweight", words: ["перевес"] },
    { cat: "underweight", words: ["недовес"] },
    { cat: "bottleneck_idle", words: ["простой", "ожидан"] },
    { cat: "raw_material_variance", words: ["сырь", "разброс"] },
  ];
  for (const m of matches) {
    if (m.words.some((w) => haystack.includes(w))) return m.cat;
  }
  return "other";
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (
    !body ||
    typeof body.productName !== "string" ||
    body.productName.trim().length === 0
  ) {
    return NextResponse.json(
      { error: "productName обязателен" },
      { status: 400 }
    );
  }
  const quantity = Number(body.quantity);
  if (!Number.isFinite(quantity) || quantity < 0) {
    return NextResponse.json(
      { error: "quantity должен быть положительным числом" },
      { status: 400 }
    );
  }
  let costRub: number | null = null;
  if (body.costRub !== undefined && body.costRub !== null) {
    const cost = Number(body.costRub);
    if (!Number.isFinite(cost) || cost < 0) {
      return NextResponse.json(
        { error: "costRub должен быть положительным числом" },
        { status: 400 }
      );
    }
    costRub = cost;
  }

  // Дата потери приходит из акта списания — иначе запись по акту от
  // прошлой недели попадала бы в сегодняшний день.
  let date: Date | null = null;
  if (body.date) {
    const d = new Date(body.date);
    if (Number.isNaN(d.getTime())) {
      return NextResponse.json({ error: "Некорректная дата" }, { status: 400 });
    }
    date = d;
  }

  const orgId = getActiveOrgId(session);

  // areaId — должна принадлежать той же org. Иначе менеджер компании
  // A мог привязать loss-record к area компании B (cross-tenant FK,
  // analytics ломается).
  let areaId: string | null = null;
  if (typeof body.areaId === "string" && body.areaId) {
    const area = await db.area.findFirst({
      where: { id: body.areaId, organizationId: orgId },
      select: { id: true },
    });
    if (!area) {
      return NextResponse.json(
        { error: "Помещение не найдено" },
        { status: 404 }
      );
    }
    areaId = area.id;
  }

  const category = autoCategorize(body.category, body.cause, body.productName);
  const record = await db.lossRecord.create({
    data: {
      organizationId: orgId,
      category,
      productName: body.productName.trim().slice(0, 200),
      quantity,
      unit: typeof body.unit === "string" ? body.unit.slice(0, 20) : "kg",
      costRub,
      cause: typeof body.cause === "string" ? body.cause.slice(0, 2000) : null,
      areaId,
      ...(date ? { date } : {}),
      // Откуда запись: id документа-источника (акта списания).
      sourceEntryId:
        typeof body.sourceEntryId === "string" && body.sourceEntryId
          ? body.sourceEntryId
          : null,
      createdById: session.user.id,
    },
  });

  return NextResponse.json(record, { status: 201 });
}
