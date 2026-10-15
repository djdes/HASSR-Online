import { NextResponse } from "next/server";
import { z } from "zod";
import { requireMasterDirectorySession } from "@/lib/master-directory-guard";
import { masterBrakerageHistoryInputSchema } from "@/lib/master-brakerage-history";
import { MasterCorrectionError } from "@/lib/master-brakerage-correction";
import { correctMasterDistribution } from "@/lib/master-brakerage-correction.server";

export const dynamic = "force-dynamic";
const schema = z.object({ input: masterBrakerageHistoryInputSchema, updatedAt: z.iso.datetime(), scope: z.enum(["history", "all", "selected"]), organizationIds: z.array(z.string().min(1).max(100)).max(50).default([]) }).strict().refine(body => body.scope !== "selected" || body.organizationIds.length > 0);
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireMasterDirectorySession();
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Проверьте ввод" }, { status: 400 });
  try {
    const result = await correctMasterDistribution({ ...parsed.data, batchId: id, masterOrgId: auth.masterOrgId, userId: auth.session.user.id, userName: auth.session.user.name ?? "" });
    if (!result) return NextResponse.json({ error: "Выгрузка не найдена" }, { status: 404 });
    return NextResponse.json({ batch: { id: result.batch.id, updatedAt: result.batch.updatedAt }, changed: result.changed });
  } catch (error) {
    if (error instanceof MasterCorrectionError) return NextResponse.json({ error: error.message }, { status: 409 });
    throw error;
  }
}
