import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getActiveOrgId, requireApiAuth } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import {
  TASK_DISTRIBUTION_MODES,
  TASK_VERIFICATION_MODES,
  parseTaskModesJson,
} from "@/lib/journal-task-modes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Phase D — per-org per-journal режимы раздачи и проверки задач.
 *
 *   GET  /api/settings/journal-task-mode
 *     200 → { modes: { [code]: { distribution, verification,
 *                                 siblingVisibility? } } }
 *
 *   PUT  /api/settings/journal-task-mode
 *     Body: { code: string, mode: { distribution?, verification?,
 *                                    siblingVisibility? } | null }
 *     null = удалить override (вернуться к default).
 *     200 → { ok: true, modes: ... }
 *
 * Auth: management-only.
 */

export async function GET() {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  if (!hasFullWorkspaceAccess(auth.session.user)) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }
  const orgId = getActiveOrgId(auth.session);
  const org = await db.organization.findUnique({
    where: { id: orgId },
    select: { journalTaskModesJson: true },
  });
  return NextResponse.json({
    modes: parseTaskModesJson(org?.journalTaskModesJson),
  });
}

const ModeSchema = z
  .object({
    distribution: z.enum(TASK_DISTRIBUTION_MODES).optional(),
    verification: z.enum(TASK_VERIFICATION_MODES).optional(),
    siblingVisibility: z.boolean().optional(),
  })
  .nullable();

const PutSchema = z.object({
  code: z.string().min(1).max(100),
  mode: ModeSchema,
});

export async function PUT(request: Request) {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  if (!hasFullWorkspaceAccess(auth.session.user)) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }

  let body: z.infer<typeof PutSchema>;
  try {
    body = PutSchema.parse(await request.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: err.issues[0]?.message ?? "Bad input" },
        { status: 400 },
      );
    }
    throw err;
  }

  const orgId = getActiveOrgId(auth.session);
  const org = await db.organization.findUnique({
    where: { id: orgId },
    select: { journalTaskModesJson: true },
  });
  const current = parseTaskModesJson(org?.journalTaskModesJson);

  if (body.mode === null) {
    delete current[body.code];
  } else {
    current[body.code] = {
      ...current[body.code],
      ...body.mode,
    };
  }

  await db.organization.update({
    where: { id: orgId },
    data: { journalTaskModesJson: current as never },
  });

  return NextResponse.json({ ok: true, modes: current });
}
