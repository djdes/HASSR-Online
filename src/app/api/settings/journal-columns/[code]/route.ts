import { NextResponse } from "next/server";

import { getActiveOrgId } from "@/lib/auth-helpers";
import { authOptions } from "@/lib/auth";
import { recordAuditLog } from "@/lib/audit-log";
import { db } from "@/lib/db";
import {
  applyColumnsToConfig,
  hasColumnRegistry,
  sanitizeColumnsConfig,
} from "@/lib/journal-columns";
import { setOrgColumnDefault } from "@/lib/journal-columns-org";
import { getServerSession } from "@/lib/server-session";
import { isManagementRole } from "@/lib/user-roles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SCOPES = ["new-only", "active-any", "all"] as const;
type Scope = (typeof SCOPES)[number];

/**
 * PUT /api/settings/journal-columns/[code] — «Применить ко всем документам журнала».
 *
 * Тело: `{ columns: { hidden, labels }, applyTo: "new-only" | "active-any" | "all" }`.
 *
 *   1. Набор становится общим для журнала: `Organization.journalColumnsJson[code]`,
 *      его получит каждый новый документ.
 *   2. В документах выбранного объёма (`active-any` — активные, `all` — все,
 *      `new-only` — ни одного) набор записывается в `config.columns` вместе со
 *      старыми флагами `showX`, заменяя личные настройки документа. Данные
 *      строк не трогаются: скрытая колонка просто не показывается.
 *
 * Права — как у правки документа журнала (управление журналами).
 */
export async function PUT(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  if (!isManagementRole(session.user.role) && !session.user.isRoot) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }

  const { code } = await params;
  if (!hasColumnRegistry(code)) {
    return NextResponse.json({ error: "У этого журнала колонки не настраиваются" }, { status: 404 });
  }

  const body = (await request.json().catch(() => null)) as { columns?: unknown; applyTo?: unknown } | null;
  const applyTo = SCOPES.find((scope) => scope === body?.applyTo) as Scope | undefined;
  if (!applyTo) {
    return NextResponse.json({ error: "Выберите, к каким документам применить набор" }, { status: 400 });
  }
  const columns = sanitizeColumnsConfig(code, body?.columns);
  if (!columns) {
    return NextResponse.json({ error: "Набор колонок не распознан" }, { status: 400 });
  }

  const organizationId = getActiveOrgId(session);
  await setOrgColumnDefault(organizationId, code, columns);

  let documentsUpdated = 0;
  if (applyTo !== "new-only") {
    const documents = await db.journalDocument.findMany({
      where: {
        organizationId,
        template: { code },
        ...(applyTo === "active-any" ? { status: "active" } : {}),
      },
      select: { id: true, config: true },
    });
    for (const document of documents) {
      await db.journalDocument.update({
        where: { id: document.id },
        data: { config: applyColumnsToConfig(code, document.config, columns) as object },
      });
      documentsUpdated += 1;
    }
  }

  await recordAuditLog({
    request,
    session,
    organizationId,
    action: "journal.columns_applied",
    entity: "journal_template",
    entityId: code,
    details: { applyTo, documentsUpdated, hidden: columns.hidden, labels: columns.labels },
  });

  return NextResponse.json({ ok: true, columns, applyTo, documentsUpdated });
}
