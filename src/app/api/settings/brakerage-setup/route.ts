import { NextResponse } from "next/server";
import { z } from "zod";
import { getActiveOrgId, requireApiAuth } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { hasCapability } from "@/lib/permission-presets";
import { ORG_SIGNER_WHERE } from "@/lib/journal-roster";
import { cascadeResponsibleToActiveDocuments } from "@/lib/journal-responsibles-cascade";
import { readOrgCommission, saveOrgCommission } from "@/lib/brakerage-commission-org";
import { updateJournalControls } from "@/lib/journal-controls.server";
import { recordAuditLog } from "@/lib/audit-log";

export const dynamic = "force-dynamic";
const schema = z.object({ responsibleUserId: z.string().min(1), memberIds: z.array(z.string().min(1)).min(1).max(30) }).strict();

export async function GET() {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  if (!hasCapability(auth.session.user, "admin.full")) return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  const organizationId = getActiveOrgId(auth.session);
  const [users, org, members] = await Promise.all([
    db.user.findMany({ where: { organizationId, ...ORG_SIGNER_WHERE }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.organization.findUnique({ where: { id: organizationId }, select: { journalResponsibleUsersJson: true } }),
    readOrgCommission(organizationId, "finished_product"),
  ]);
  const defaults = org?.journalResponsibleUsersJson as Record<string, Record<string, string>> | null;
  return NextResponse.json({ users, members, responsibleUserId: defaults?.finished_product?.chef ?? "" });
}

export async function PUT(request: Request) {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  if (!hasCapability(auth.session.user, "admin.full")) return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Выберите ответственного и хотя бы одного члена комиссии" }, { status: 400 });
  const organizationId = getActiveOrgId(auth.session);
  const { responsibleUserId, memberIds } = parsed.data;
  const ids = [...new Set([responsibleUserId, ...memberIds])];
  const users = await db.user.findMany({ where: { organizationId, id: { in: ids }, ...ORG_SIGNER_WHERE }, select: { id: true } });
  if (users.length !== ids.length) return NextResponse.json({ error: "Выберите действующих сотрудников этой организации" }, { status: 400 });
  const template = await db.journalTemplate.findUnique({ where: { code: "finished_product" }, select: { id: true } });
  if (!template) return NextResponse.json({ error: "Журнал не найден" }, { status: 404 });
  await saveOrgCommission(organizationId, "finished_product", [...new Set(memberIds)].map((employeeId) => ({ employeeId })));
  await cascadeResponsibleToActiveDocuments({ organizationId, templateId: template.id, journalCode: "finished_product", positionIds: [], slotUsers: { chef: responsibleUserId }, scope: "active-any" });
  const controls = await updateJournalControls(organizationId, { brakerageSetup: { finished_product: "configured" } });
  await recordAuditLog({ request, session: auth.session, organizationId, action: "journal.brakerage_setup", entity: "Organization", entityId: organizationId, details: { responsibleUserId, memberIds } });
  return NextResponse.json(controls);
}
