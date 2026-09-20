import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerSession } from "@/lib/server-session";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * График смен — таблица WorkShift.
 *
 *   GET  /api/organizations/schedule?from=YYYY-MM-DD&to=YYYY-MM-DD
 *        → { shifts: [{ userId, date, status, jobPositionId }] }
 *   PUT  /api/organizations/schedule
 *        body: { shifts: [{ userId, date, status, jobPositionId? }] }
 *        — upsert по (userId, date).
 *   DELETE /api/organizations/schedule?userId=…&date=YYYY-MM-DD
 *        — полностью снять запись (вернуть в «не запланирован»).
 */

function parseYmd(raw: string | null): Date | null {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const d = new Date(`${raw}T00:00:00.000Z`);
  return Number.isFinite(d.getTime()) ? d : null;
}

const statusSchema = z.enum(["scheduled", "off", "vacation", "sick"]);

const putBody = z.object({
  shifts: z
    .array(
      z.object({
        userId: z.string().min(1),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        status: statusSchema,
        jobPositionId: z.string().min(1).nullable().optional(),
      })
    )
    .min(1),
});

async function guard(): Promise<
  | { ok: false; response: Response }
  | { ok: true; session: Awaited<ReturnType<typeof getServerSession>>; orgId: string }
> {
  const session = await getServerSession(authOptions);
  if (!session)
    return {
      ok: false,
      response: NextResponse.json({ error: "Не авторизован" }, { status: 401 }),
    };
  if (
    !hasFullWorkspaceAccess({
      role: session.user.role,
      isRoot: session.user.isRoot,
    })
  ) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 }),
    };
  }
  return { ok: true, session, orgId: getActiveOrgId(session) };
}

export async function GET(request: Request) {
  const g = await guard();
  if (!g.ok) return g.response;
  const url = new URL(request.url);
  const now = new Date();
  const from =
    parseYmd(url.searchParams.get("from")) ??
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const to = parseYmd(url.searchParams.get("to")) ?? from;
  const toEnd = new Date(to);
  toEnd.setUTCHours(23, 59, 59, 999);

  const shifts = await db.workShift.findMany({
    where: {
      organizationId: g.orgId,
      date: { gte: from, lte: toEnd },
    },
    select: {
      userId: true,
      date: true,
      status: true,
      jobPositionId: true,
    },
    orderBy: [{ date: "asc" }, { userId: "asc" }],
  });

  return NextResponse.json({
    shifts: shifts.map((s) => ({
      userId: s.userId,
      date: s.date.toISOString().slice(0, 10),
      status: s.status,
      jobPositionId: s.jobPositionId,
    })),
  });
}

export async function PUT(request: Request) {
  const g = await guard();
  if (!g.ok) return g.response;

  let parsed;
  try {
    parsed = putBody.parse(await request.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: err.issues[0]?.message ?? "Некорректные данные" },
        { status: 400 }
      );
    }
    return NextResponse.json({ error: "Некорректные данные" }, { status: 400 });
  }

  const userIds = Array.from(new Set(parsed.shifts.map((s) => s.userId)));
  const owned = await db.user.findMany({
    where: { organizationId: g.orgId, id: { in: userIds } },
    select: { id: true },
  });
  const ownedSet = new Set(owned.map((o) => o.id));

  const positionIds = Array.from(
    new Set(
      parsed.shifts
        .map((s) => s.jobPositionId ?? null)
        .filter((id): id is string => !!id)
    )
  );
  const ownedPositions =
    positionIds.length > 0
      ? new Set(
          (
            await db.jobPosition.findMany({
              where: { organizationId: g.orgId, id: { in: positionIds } },
              select: { id: true },
            })
          ).map((p) => p.id)
        )
      : new Set<string>();

  let upserted = 0;
  await db.$transaction(async (tx) => {
    for (const entry of parsed.shifts) {
      if (!ownedSet.has(entry.userId)) continue;
      const anchor = new Date(`${entry.date}T00:00:00.000Z`);
      // Zod regex принимает `2026-13-99`, который даст Invalid Date
      // в WorkShift.date — затем выборка по графику ломается. Skip.
      if (!Number.isFinite(anchor.getTime())) continue;
      const jobPositionId =
        entry.jobPositionId && ownedPositions.has(entry.jobPositionId)
          ? entry.jobPositionId
          : null;
      await tx.workShift.upsert({
        where: { userId_date: { userId: entry.userId, date: anchor } },
        create: {
          organizationId: g.orgId,
          userId: entry.userId,
          date: anchor,
          status: entry.status,
          jobPositionId,
        },
        update: {
          status: entry.status,
          jobPositionId,
        },
      });
      upserted += 1;
    }
  });

  return NextResponse.json({ upserted });
}

export async function DELETE(request: Request) {
  const g = await guard();
  if (!g.ok) return g.response;
  const url = new URL(request.url);
  const userId = url.searchParams.get("userId");
  const date = parseYmd(url.searchParams.get("date"));
  if (!userId || !date) {
    return NextResponse.json(
      { error: "userId и date обязательны" },
      { status: 400 }
    );
  }
  const owned = await db.user.findFirst({
    where: { id: userId, organizationId: g.orgId },
    select: { id: true },
  });
  if (!owned) return NextResponse.json({ deleted: 0 });
  await db.workShift.deleteMany({
    where: { userId, date },
  });
  return NextResponse.json({ deleted: 1 });
}
