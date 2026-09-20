import { NextResponse } from "next/server";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { getServerSession } from "@/lib/server-session";
import { getActiveOrgId, requireApiAuth } from "@/lib/auth-helpers";
import { hasCapability } from "@/lib/permission-presets";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import {
  setPipelineForJournal,
  deletePipelineForJournal,
} from "@/lib/journal-pipelines";
import { loadPipelineTree } from "@/lib/journal-pipeline-tree";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/settings/journal-pipelines/[code]
 * → загружает дерево pipeline'а из новых таблиц (P1.1+).
 * Возвращает `{ tree: PipelineTree | null }` — null значит шаблон ещё
 * не заведён, UI покажет «Нажмите “Создать pipeline”».
 */
export async function GET(
  _request: Request,
  ctx: { params: Promise<{ code: string }> }
) {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  if (!hasFullWorkspaceAccess(auth.session.user)) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }
  const { code } = await ctx.params;
  const organizationId = getActiveOrgId(auth.session);
  const tree = await loadPipelineTree(organizationId, code);
  return NextResponse.json({ tree });
}

const stepSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1).max(100),
  instruction: z.string().max(2000).optional(),
  checklist: z.array(z.string().max(200)).optional(),
  requirePhoto: z.boolean().optional(),
});

const bodySchema = z.object({
  intro: z.string().max(500).optional(),
  steps: z.array(stepSchema).max(20),
});

/**
 * PUT /api/settings/journal-pipelines/[code] — admin сохраняет pipeline
 * для journalCode. Заменяет полностью.
 *
 * DELETE — сбрасывает на default (если есть) или убирает override.
 */
export async function PUT(
  request: Request,
  ctx: { params: Promise<{ code: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  if (!hasCapability(session.user, "admin.full")) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }
  const { code } = await ctx.params;
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Невалидный запрос" }, { status: 400 });
  }
  const organizationId = getActiveOrgId(session);
  await setPipelineForJournal(organizationId, code, body);
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _request: Request,
  ctx: { params: Promise<{ code: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  if (!hasCapability(session.user, "admin.full")) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }
  const { code } = await ctx.params;
  const organizationId = getActiveOrgId(session);
  await deletePipelineForJournal(organizationId, code);
  return NextResponse.json({ ok: true });
}
