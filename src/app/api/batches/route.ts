import { getServerSession } from "@/lib/server-session";
import { authOptions } from "@/lib/auth";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const search = searchParams.get("search");

  const where: Record<string, unknown> = {
    organizationId: getActiveOrgId(session),
  };
  if (status && status !== "all") where.status = status;
  if (search) {
    where.OR = [
      { productName: { contains: search, mode: "insensitive" } },
      { code: { contains: search, mode: "insensitive" } },
      { supplier: { contains: search, mode: "insensitive" } },
    ];
  }

  const batches = await db.batch.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return NextResponse.json(batches);
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Базовая валидация — раньше принимали что угодно, productName=undefined
  // и quantity=NaN ломали Prisma и UI.
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
  let expiryDate: Date | null = null;
  if (body.expiryDate) {
    const d = new Date(body.expiryDate);
    if (Number.isNaN(d.getTime())) {
      return NextResponse.json({ error: "Некорректная дата" }, { status: 400 });
    }
    expiryDate = d;
  }
  // Дата поступления приходит из строки приёмки — без неё партия из
  // журнала за прошлую неделю датировалась бы сегодняшним днём.
  let receivedAt: Date | null = null;
  if (body.receivedAt) {
    const d = new Date(body.receivedAt);
    if (Number.isNaN(d.getTime())) {
      return NextResponse.json(
        { error: "Некорректная дата поступления" },
        { status: 400 }
      );
    }
    receivedAt = d;
  }

  const orgId = getActiveOrgId(session);

  // Generate batch code: B-YYYYMMDD-NNN. Раньше: count() + 1 → race
  // condition: два параллельных POST'а получали одинаковый count, оба
  // пробовали create с тем же кодом, второй падал на @@unique
  // (organizationId, code) с P2002 → клиент видел 500. Теперь — retry
  // loop: при коллизии повторяем с count+1, до 10 попыток. На typical-
  // load этого с запасом хватает (10 параллельных приёмок в секунду).
  const today = new Date();
  const dateStr = today.toISOString().slice(0, 10).replace(/-/g, "");
  const todayStart = new Date(today);
  todayStart.setHours(0, 0, 0, 0);
  const baseData = {
    organizationId: orgId,
    productName: body.productName.trim().slice(0, 200),
    supplier:
      typeof body.supplier === "string"
        ? body.supplier.trim().slice(0, 200)
        : null,
    quantity,
    unit: typeof body.unit === "string" ? body.unit.slice(0, 20) : "kg",
    expiryDate,
    ...(receivedAt ? { receivedAt } : {}),
    sourceEntryId:
      typeof body.sourceEntryId === "string" ? body.sourceEntryId : null,
    notes: typeof body.notes === "string" ? body.notes.slice(0, 2000) : null,
    createdById: session.user.id,
  };
  const initialCount = await db.batch.count({
    where: {
      organizationId: orgId,
      createdAt: { gte: todayStart },
    },
  });
  const MAX_RETRIES = 10;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
    const code = `B-${dateStr}-${String(initialCount + 1 + attempt).padStart(3, "0")}`;
    try {
      const batch = await db.batch.create({ data: { code, ...baseData } });
      return NextResponse.json(batch, { status: 201 });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        continue;
      }
      throw err;
    }
  }
  return NextResponse.json(
    { error: "Не удалось сгенерировать уникальный код партии. Попробуйте ещё раз." },
    { status: 503 }
  );
}
