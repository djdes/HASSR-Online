import { getServerSession } from "@/lib/server-session";
import { authOptions } from "@/lib/auth";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { emitWebhook } from "@/lib/webhooks/dispatch";
import { NextRequest, NextResponse } from "next/server";
import { isManagementRole } from "@/lib/user-roles";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

  // GET CAPA-list возвращает все тикеты org-и (включая чужих
  // подразделений) — management-only. Раньше любой staff мог увидеть
  // полный список тикетов своей org-и.
  if (!isManagementRole(session.user.role) && !session.user.isRoot) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const priority = searchParams.get("priority");

  const where: Record<string, unknown> = {
    organizationId: getActiveOrgId(session),
  };
  if (status && status !== "all") where.status = status;
  if (priority && priority !== "all") where.priority = priority;

  const tickets = await db.capaTicket.findMany({
    where,
    orderBy: [{ priority: "asc" }, { createdAt: "desc" }],
    take: 100,
  });

  return NextResponse.json(tickets);
}

const VALID_PRIORITIES = ["low", "medium", "high", "critical"];
const VALID_CATEGORIES = [
  "hygiene",
  "quality",
  "process",
  "equipment",
  "training",
  "other",
];

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

  // Создавать CAPA могут только management — раньше любой staff мог
  // через прямой fetch создать тикет (например, sourceType / sourceEntryId
  // привязал к чужой entry, чтобы засветить отклонение).
  if (!isManagementRole(session.user.role) && !session.user.isRoot) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const orgId = getActiveOrgId(session);

  // Базовая валидация input — раньше принимали любой мусор.
  if (!body || typeof body.title !== "string" || body.title.trim().length === 0) {
    return NextResponse.json({ error: "Заголовок обязателен" }, { status: 400 });
  }
  const title = body.title.trim().slice(0, 200);
  const priority =
    typeof body.priority === "string" && VALID_PRIORITIES.includes(body.priority)
      ? body.priority
      : "medium";
  const category =
    typeof body.category === "string" && VALID_CATEGORIES.includes(body.category)
      ? body.category
      : "other";

  // SLA: положительное число от 1 до 720 часов (= 30 дней).
  let slaHours = 24;
  if (typeof body.slaHours === "number" && body.slaHours > 0 && body.slaHours <= 720) {
    slaHours = Math.floor(body.slaHours);
  }

  // assignedToId — должен быть юзером той же org. Раньше принимался
  // любой UUID → cross-tenant FK.
  let assignedToId: string | null = null;
  if (typeof body.assignedToId === "string" && body.assignedToId) {
    const assignee = await db.user.findFirst({
      where: { id: body.assignedToId, organizationId: orgId },
      select: { id: true },
    });
    if (!assignee) {
      return NextResponse.json(
        { error: "Сотрудник не найден" },
        { status: 404 }
      );
    }
    assignedToId = assignee.id;
  }

  const ticket = await db.capaTicket.create({
    data: {
      organizationId: orgId,
      title,
      description:
        typeof body.description === "string" ? body.description.slice(0, 5000) : null,
      priority,
      category,
      sourceType: typeof body.sourceType === "string" ? body.sourceType : null,
      sourceEntryId: typeof body.sourceEntryId === "string" ? body.sourceEntryId : null,
      assignedToId,
      slaHours,
      dueDate: body.dueDate ? new Date(body.dueDate) : null,
      createdById: session.user.id,
    },
  });

  emitWebhook(orgId, "capa.created", { id: ticket.id, title: ticket.title, priority: ticket.priority, category: ticket.category, dueDate: ticket.dueDate?.toISOString() ?? null });
  return NextResponse.json(ticket, { status: 201 });
}
