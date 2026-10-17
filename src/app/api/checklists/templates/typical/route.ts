import { NextResponse } from "next/server";

import { recordAuditLog } from "@/lib/audit-log";
import { TYPICAL_CHECKLISTS, isTypicalChecklistKey, summarizeTypicalChecklist } from "@/lib/checklist-templates";
import {
  addTypicalChecklistToOrganization,
  addedTypicalChecklistTitles,
} from "@/lib/checklist-templates/add-to-organization.server";
import { requireChecklistAccess } from "@/lib/custom-checklists.server";

export const dynamic = "force-dynamic";

/**
 * Типовые шаблоны чек-листов (`src/lib/checklist-templates`).
 *
 * GET — список типовых шаблонов с числом вопросов и отметкой «уже есть у
 * организации»; права — как у чтения чек-листов.
 * POST `{ key }` — «Добавить типовой шаблон в организацию»: копия в
 * `ChecklistTemplate`, дальше правится в конструкторе. Права — как у
 * создания шаблонов (`journals.manage`). Повторное добавление при живом
 * шаблоне с тем же названием вернёт имеющийся (`created: false`).
 */
export async function GET() {
  const auth = await requireChecklistAccess();
  if (!auth.ok) return auth.response;
  const added = await addedTypicalChecklistTitles(
    auth.organizationId,
    TYPICAL_CHECKLISTS.map((template) => template.title),
  );
  const templates = TYPICAL_CHECKLISTS.map((template) => ({
    ...summarizeTypicalChecklist(template),
    added: added.has(template.title),
  }));
  return NextResponse.json(
    { templates, canManage: auth.canManage },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

export async function POST(request: Request) {
  const auth = await requireChecklistAccess("manage");
  if (!auth.ok) return auth.response;
  const body = (await request.json().catch(() => null)) as { key?: unknown } | null;
  const key = body?.key;
  if (!isTypicalChecklistKey(key)) {
    return NextResponse.json({ error: "Неизвестный типовой шаблон" }, { status: 400 });
  }
  const { template, created } = await addTypicalChecklistToOrganization(auth.organizationId, key);
  if (created) {
    await recordAuditLog({
      request,
      session: auth.session,
      organizationId: auth.organizationId,
      action: "checklist.template_create",
      entity: "ChecklistTemplate",
      entityId: template.id,
      details: { title: template.title, typical: key },
    });
  }
  return NextResponse.json({ template, created }, { status: created ? 201 : 200 });
}
