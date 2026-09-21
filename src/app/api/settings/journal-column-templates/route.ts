import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";

import { getActiveOrgId } from "@/lib/auth-helpers";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  builtInTemplates,
  sanitizeTemplateName,
  type JournalColumnTemplate,
} from "@/lib/journal-column-templates";
import { hasColumnRegistry, sanitizeColumnsConfig } from "@/lib/journal-columns";
import { getServerSession } from "@/lib/server-session";
import { isManagementRole } from "@/lib/user-roles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OWN_TEMPLATES_MAX = 30;

/**
 * Шаблоны колонок журнала.
 *   GET  ?code=finished_product — встроенные + свои шаблоны организации;
 *   POST { code, name, columns } — сохранить свой шаблон (руководитель).
 */
export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  const code = new URL(request.url).searchParams.get("code") ?? "";
  if (!hasColumnRegistry(code)) {
    return NextResponse.json({ error: "У этого журнала колонки не настраиваются" }, { status: 404 });
  }
  const own = await db.journalColumnTemplate.findMany({
    where: { organizationId: getActiveOrgId(session), journalCode: code },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, columns: true },
  });
  const templates: JournalColumnTemplate[] = [
    ...builtInTemplates(code),
    ...own.flatMap((item) => {
      const columns = sanitizeColumnsConfig(code, item.columns);
      return columns ? [{ id: item.id, name: item.name, journalCode: code, builtIn: false, columns }] : [];
    }),
  ];
  return NextResponse.json({ templates });
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  if (!isManagementRole(session.user.role) && !session.user.isRoot) {
    return NextResponse.json({ error: "Сохранять шаблоны может руководитель" }, { status: 403 });
  }
  const body = (await request.json().catch(() => null)) as { code?: unknown; name?: unknown; columns?: unknown } | null;
  const code = typeof body?.code === "string" ? body.code : "";
  if (!hasColumnRegistry(code)) {
    return NextResponse.json({ error: "У этого журнала колонки не настраиваются" }, { status: 404 });
  }
  const name = sanitizeTemplateName(body?.name);
  if (!name) return NextResponse.json({ error: "Назовите шаблон" }, { status: 400 });
  const columns = sanitizeColumnsConfig(code, body?.columns);
  if (!columns) return NextResponse.json({ error: "Набор колонок не распознан" }, { status: 400 });

  const organizationId = getActiveOrgId(session);
  const count = await db.journalColumnTemplate.count({ where: { organizationId, journalCode: code } });
  if (count >= OWN_TEMPLATES_MAX) {
    return NextResponse.json({ error: `Своих шаблонов не больше ${OWN_TEMPLATES_MAX} — удалите ненужный` }, { status: 400 });
  }
  // Шаблон с тем же названием перезаписываем: «Сохранить как шаблон» ещё раз.
  const existing = await db.journalColumnTemplate.findFirst({
    where: { organizationId, journalCode: code, name },
    select: { id: true },
  });
  const saved = existing
    ? await db.journalColumnTemplate.update({
        where: { id: existing.id },
        data: { columns: columns as Prisma.InputJsonValue },
        select: { id: true, name: true },
      })
    : await db.journalColumnTemplate.create({
        data: {
          organizationId,
          journalCode: code,
          name,
          columns: columns as Prisma.InputJsonValue,
          createdById: session.user.id,
        },
        select: { id: true, name: true },
      });
  return NextResponse.json({ template: { ...saved, journalCode: code, builtIn: false, columns } });
}
