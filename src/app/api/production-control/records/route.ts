import { randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { recordAuditLog } from "@/lib/audit-log";
import { requirePpkAccess } from "@/lib/ppk/access.server";
import { ppkSingletonKey, ppkWhere } from "@/lib/ppk/scope";
import { checkPpkRefs, checkPpkTeamGroup, ppkValidationError } from "@/lib/ppk/records.server";
import { PPK_RECORD_LIMITS, PPK_RECORD_SCHEMAS, PPK_SINGLETON_BLOCKS, isPpkRecordBlock } from "@/lib/ppk/records";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SELECT = { id: true, data: true, sortOrder: true, updatedAt: true } as const;

/** GET ?block=<блок> — записи блока раздела ППК по порядку. */
export async function GET(request: Request) {
  const auth = await requirePpkAccess();
  if (!auth.ok) return auth.response;
  const block = new URL(request.url).searchParams.get("block");
  if (!isPpkRecordBlock(block)) {
    return NextResponse.json({ error: "Неизвестный блок" }, { status: 400 });
  }
  const records = await db.ppkRecord.findMany({
    where: { ...ppkWhere(auth.scope), block },
    select: SELECT,
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  return NextResponse.json({ records }, { headers: { "Cache-Control": "private, no-store" } });
}

/** POST { block, data } — новая запись блока. */
export async function POST(request: Request) {
  const auth = await requirePpkAccess();
  if (!auth.ok) return auth.response;
  const body = await request.json().catch(() => null);
  const block = body?.block;
  if (!isPpkRecordBlock(block)) {
    return NextResponse.json({ error: "Неизвестный блок" }, { status: 400 });
  }
  const parsed = PPK_RECORD_SCHEMAS[block].safeParse(body?.data);
  if (!parsed.success) {
    return NextResponse.json({ error: ppkValidationError(parsed.error) }, { status: 400 });
  }
  // Схема блока уже проверила данные; тип в реестре общий, поэтому приводим здесь.
  const value = parsed.data as Record<string, unknown>;

  const organizationId = auth.organizationId;
  const limitError = block === "policy" ? "Политика уже создана" : "Слишком много записей";
  const count = await db.ppkRecord.count({ where: { ...ppkWhere(auth.scope), block } });
  if (count >= PPK_RECORD_LIMITS[block]) {
    return NextResponse.json({ error: limitError }, { status: 409 });
  }

  const refError = await checkPpkRefs(auth.scope, block, value);
  if (refError) return NextResponse.json({ error: refError }, { status: 400 });

  if (block === "team") {
    const groupError = await checkPpkTeamGroup(auth.scope, value);
    if (groupError) return NextResponse.json({ error: groupError }, { status: 409 });
  }

  // Токен политики ставит сервер: по нему открывается публичная страница и QR.
  const data = block === "policy" ? { ...value, token: randomBytes(16).toString("base64url") } : value;

  const last = await db.ppkRecord.aggregate({
    where: { ...ppkWhere(auth.scope), block },
    _max: { sortOrder: true },
  });
  // Блок-одиночка пишет себя в `singleton`: уникальный индекс в БД не даст
  // второй записи, даже если два запроса проверили счётчик одновременно.
  // У точки — `<block>@<точка>` (ППК на точку, 2026-11-01).
  const singleton = (PPK_SINGLETON_BLOCKS as readonly string[]).includes(block)
    ? ppkSingletonKey(block, auth.scope.buildingId)
    : null;
  let record;
  try {
    record = await db.ppkRecord.create({
      data: {
        organizationId,
        buildingId: auth.scope.buildingId,
        block,
        data: data as Prisma.InputJsonValue,
        sortOrder: (last._max.sortOrder ?? 0) + 1,
        createdById: auth.session.user.id ?? null,
        singleton,
      },
      select: SELECT,
    });
  } catch (error) {
    // P2002 — нарушение уникальности: параллельный запрос уже создал единственную запись.
    if (singleton && typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
      return NextResponse.json({ error: limitError }, { status: 409 });
    }
    throw error;
  }

  await recordAuditLog({
    request,
    session: auth.session,
    organizationId,
    action: "production-control.record-create",
    entity: "PpkRecord",
    entityId: record.id,
    details: { block },
  });
  return NextResponse.json({ record }, { status: 201 });
}
