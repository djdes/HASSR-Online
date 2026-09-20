import { NextResponse } from "next/server";
import { z } from "zod";
import { getServerSession } from "@/lib/server-session";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { getActiveOrgId } from "@/lib/auth-helpers";
import {
  isKnownPermission,
  PERMISSIONS,
  sanitizePermissionsJson,
  type Permission,
} from "@/lib/permissions";
import { sessionHasPermission } from "@/lib/permissions-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Управление матрицей прав доступа. Только пользователь с правом
 * `settings.permissions` может читать и писать матрицу.
 *
 *   GET  → { positions: [{ id, name, categoryKey, permissions: string[] | null }],
 *            users:     [{ id, name, jobPositionId, permissions: string[] | null }] }
 *   PUT  → body: { positions?: Array<{id, permissions: string[] | null}>,
 *                  users?:     Array<{id, permissions: string[] | null}> }
 */

const codeSchema = z.string().refine((value) => isKnownPermission(value), {
  message: "Unknown permission code",
});

const entrySchema = z.object({
  id: z.string().min(1),
  permissions: z.array(codeSchema).nullable(),
});

const bodySchema = z.object({
  positions: z.array(entrySchema).optional(),
  users: z.array(entrySchema).optional(),
});

function normalizePermissions(value: string[] | null): Permission[] | null {
  if (value === null) return null;
  return sanitizePermissionsJson(value);
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }
  if (!(await sessionHasPermission(session, "settings.permissions"))) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }
  const organizationId = getActiveOrgId(session);

  const [positions, users] = await Promise.all([
    db.jobPosition.findMany({
      where: { organizationId },
      orderBy: [{ categoryKey: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        categoryKey: true,
        permissionsJson: true,
        _count: { select: { users: true } },
      },
    }),
    db.user.findMany({
      where: { organizationId, isActive: true, archivedAt: null },
      orderBy: [{ name: "asc" }],
      select: {
        id: true,
        name: true,
        role: true,
        permissionsJson: true,
        jobPositionId: true,
        jobPosition: {
          select: { id: true, name: true, categoryKey: true },
        },
      },
    }),
  ]);

  return NextResponse.json({
    catalog: PERMISSIONS,
    positions: positions.map((p) => ({
      id: p.id,
      name: p.name,
      categoryKey: p.categoryKey,
      permissions: sanitizeStoredPermissions(p.permissionsJson),
      memberCount: p._count.users,
    })),
    users: users.map((u) => ({
      id: u.id,
      name: u.name,
      role: u.role,
      jobPositionId: u.jobPositionId,
      positionName: u.jobPosition?.name ?? null,
      positionCategory: u.jobPosition?.categoryKey ?? null,
      permissions: sanitizeStoredPermissions(u.permissionsJson),
    })),
  });
}

function sanitizeStoredPermissions(value: unknown): Permission[] | null {
  if (value === null || value === undefined) return null;
  return sanitizePermissionsJson(value);
}

export async function PUT(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }
  if (!(await sessionHasPermission(session, "settings.permissions"))) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }
  const organizationId = getActiveOrgId(session);
  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(await request.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: err.issues[0]?.message ?? "Некорректные данные" },
        { status: 400 }
      );
    }
    return NextResponse.json({ error: "Некорректные данные" }, { status: 400 });
  }

  await db.$transaction(async (tx) => {
    if (parsed.positions?.length) {
      const ids = parsed.positions.map((p) => p.id);
      const owned = await tx.jobPosition.findMany({
        where: { organizationId, id: { in: ids } },
        select: { id: true },
      });
      const ownedSet = new Set(owned.map((o) => o.id));
      for (const entry of parsed.positions) {
        if (!ownedSet.has(entry.id)) continue;
        const normalized = normalizePermissions(entry.permissions);
        await tx.jobPosition.update({
          where: { id: entry.id },
          data: {
            permissionsJson:
              normalized === null ? Prisma.DbNull : (normalized as Prisma.InputJsonValue),
          },
        });
      }
    }
    if (parsed.users?.length) {
      const ids = parsed.users.map((u) => u.id);
      const owned = await tx.user.findMany({
        where: { organizationId, id: { in: ids } },
        select: { id: true },
      });
      const ownedSet = new Set(owned.map((o) => o.id));
      for (const entry of parsed.users) {
        if (!ownedSet.has(entry.id)) continue;
        const normalized = normalizePermissions(entry.permissions);
        await tx.user.update({
          where: { id: entry.id },
          data: {
            permissionsJson:
              normalized === null ? Prisma.DbNull : (normalized as Prisma.InputJsonValue),
          },
        });
      }
    }
  });

  return NextResponse.json({ ok: true });
}
