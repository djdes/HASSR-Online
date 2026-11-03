import { NextResponse } from "next/server";
import { z } from "zod";
import { requireMasterDirectorySession } from "@/lib/master-directory-guard";
import { masterBrakerageHistoryInputSchema } from "@/lib/master-brakerage-history";
import { MasterCorrectionError } from "@/lib/master-brakerage-correction";
import { correctMasterDistribution, sendMasterBatchToNewObjects } from "@/lib/master-brakerage-correction.server";
import { MasterBrakerageSelectionError } from "@/lib/master-brakerage";
import { recordAuditLog } from "@/lib/audit-log";

export const dynamic = "force-dynamic";
const schema = z.object({
  input: masterBrakerageHistoryInputSchema,
  updatedAt: z.iso.datetime(),
  scope: z.enum(["history", "all", "selected"]),
  organizationIds: z.array(z.string().min(1).max(100)).max(50).default([]),
  /** Объекты пула, подключённые после выгрузки: дослать им её строки. */
  addOrganizationIds: z.array(z.string().min(1).max(100)).max(50).default([]),
}).strict().refine(body => body.scope !== "selected" || body.organizationIds.length > 0);
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireMasterDirectorySession();
  if (!auth.ok) return auth.response;
  const { id } = await ctx.params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Проверьте ввод" }, { status: 400 });
  const { addOrganizationIds, ...body } = parsed.data;
  try {
    const result = await correctMasterDistribution({ ...body, batchId: id, masterOrgId: auth.masterOrgId, userId: auth.session.user.id, userName: auth.session.user.name ?? "" });
    if (!result) return NextResponse.json({ error: "Выгрузка не найдена" }, { status: 404 });
    if (!addOrganizationIds.length) {
      return NextResponse.json({ batch: { id: result.batch.id, updatedAt: result.batch.updatedAt }, changed: result.changed, sent: [] });
    }
    const sent = await sendMasterBatchToNewObjects({ batchId: id, masterOrgId: auth.masterOrgId, organizationIds: addOrganizationIds });
    for (const org of sent.organizations) {
      if (org.added === 0 || !org.documentId) continue;
      await recordAuditLog({
        request,
        session: auth.session,
        organizationId: org.organizationId,
        action: "master_brakerage.received",
        entity: "JournalDocument",
        entityId: org.documentId,
        details: { date: body.input.date, added: org.added, skipped: org.skipped, documentCreated: org.documentCreated, masterOrgId: auth.masterOrgId, batchId: id },
      });
    }
    return NextResponse.json({
      batch: { id: sent.batch.id, updatedAt: sent.batch.updatedAt },
      changed: result.changed,
      sent: sent.organizations.map(({ delivery: _delivery, ...organization }) => organization),
    });
  } catch (error) {
    if (error instanceof MasterCorrectionError) return NextResponse.json({ error: error.message }, { status: 409 });
    if (error instanceof MasterBrakerageSelectionError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
