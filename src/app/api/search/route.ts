import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/server-session";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { getDisabledJournalCodes } from "@/lib/disabled-journals";
import {
  customJournalName,
  journalDisplayName,
  journalMatchesCustomQuery,
} from "@/lib/custom-names";
import { getOrgCustomNames } from "@/lib/org-custom-names";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/search?q=...
 *
 * Полу-универсальный поиск для command palette (⌘K). Ищет одновременно
 * по нескольким сущностям и возвращает топ-5 каждой категории. Все
 * запросы — case-insensitive contains через Prisma `mode: insensitive`,
 * MySQL/Postgres-универсально, без full-text-индексов.
 *
 * Категории:
 *   - users         — сотрудники: name, email, phone
 *   - templates     — шаблоны журналов: name, code (полный список из
 *                     enabled-set организации)
 *   - documents     — JournalDocument: title (текущие active+closed)
 *   - equipment     — Equipment: name, type, serialNumber
 *
 * Все результаты включают `kind`, `label`, `href`, `hint` — палитра
 * рисует их через одну общую item-разметку, не зная типа.
 *
 * Доступ: любой авторизованный (включая cook/waiter); они видят
 * только свою организацию. Management-роли видят всё; обычные
 * сотрудники видят только сущности своей организации (тоже всё, но
 * для employee-роли это идентично — мы не фильтруем по permissions
 * здесь, чтобы не делать палитру тяжёлой; полный ACL пройдёт на
 * соответствующей странице).
 */

type Hit = {
  kind: "user" | "template" | "document" | "equipment";
  label: string;
  hint?: string;
  href: string;
};

const LIMIT_PER_KIND = 5;

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim();
  if (q.length < 2) {
    return NextResponse.json({ q, hits: [] });
  }

  const organizationId = getActiveOrgId(session);
  const isMgr = hasFullWorkspaceAccess({
    role: session.user.role,
    isRoot: session.user.isRoot,
  });
  // Палитра не должна возвращать журналы, которые org отключила в
  // /settings/journals — клик по такому результату вёл бы на
  // disabled-страницу, и сотрудник терял бы 5 секунд на возврат.
  const disabledCodes = await getDisabledJournalCodes(organizationId);
  // Журнал ищется и по своему названию организации, и по официальному.
  // Своё живёт в Organization.customNamesJson, а не в шаблоне, поэтому
  // журналы (их меньше полусотни) фильтруем здесь общим матчером поиска
  // журналов: он же не зависит от локали базы — ILIKE с локалью «C» не
  // знает, что «Г» и «г» одна буква, и «гигиенический» не находил ничего.
  const customNames = await getOrgCustomNames(organizationId);

  const [users, templates, documents, equipment] = await Promise.all([
    // Сотрудники только management-ролям; обычным юзерам список
    // коллег скрыт по умолчанию.
    isMgr
      ? db.user.findMany({
          where: {
            organizationId,
            archivedAt: null,
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { email: { contains: q, mode: "insensitive" } },
              { phone: { contains: q, mode: "insensitive" } },
            ],
          },
          select: {
            id: true,
            name: true,
            role: true,
            positionTitle: true,
            jobPosition: { select: { name: true } },
          },
          take: LIMIT_PER_KIND,
          orderBy: { name: "asc" },
        })
      : Promise.resolve([]),
    db.journalTemplate
      .findMany({
        where: {
          isActive: true,
          ...(disabledCodes.size > 0
            ? { code: { notIn: Array.from(disabledCodes) } }
            : {}),
        },
        select: { code: true, name: true, isMandatorySanpin: true },
        orderBy: { sortOrder: "asc" },
      })
      .then((rows) =>
        rows
          .filter((t) => journalMatchesCustomQuery(customNames, t.code, t.name, q, t.code))
          .slice(0, LIMIT_PER_KIND)
      ),
    db.journalDocument.findMany({
      where: {
        organizationId,
        title: { contains: q, mode: "insensitive" },
      },
      select: {
        id: true,
        title: true,
        status: true,
        template: { select: { code: true, name: true } },
        building: { select: { name: true } },
      },
      take: LIMIT_PER_KIND,
      orderBy: { createdAt: "desc" },
    }),
    db.equipment.findMany({
      where: {
        area: { organizationId },
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { type: { contains: q, mode: "insensitive" } },
          { serialNumber: { contains: q, mode: "insensitive" } },
        ],
      },
      select: {
        id: true,
        name: true,
        type: true,
        serialNumber: true,
        area: { select: { name: true } },
      },
      take: LIMIT_PER_KIND,
      orderBy: { name: "asc" },
    }),
  ]);

  const hits: Hit[] = [];
  for (const u of users) {
    const positionLabel =
      u.jobPosition?.name?.trim() ||
      (typeof u.positionTitle === "string" ? u.positionTitle.trim() : "") ||
      u.role;
    hits.push({
      kind: "user",
      label: u.name,
      hint: positionLabel,
      href: `/settings/users#user-${u.id}`,
    });
  }
  for (const t of templates) {
    const kindHint = t.isMandatorySanpin ? "СанПиН · Журнал" : "Журнал";
    const custom = customJournalName(customNames, t.code);
    hits.push({
      kind: "template",
      // Своё название — главным, официальное — справа, чтобы было ясно,
      // что это один и тот же журнал.
      label: custom ?? t.name,
      hint: custom ? `${kindHint} · ${t.name}` : kindHint,
      href: `/journals/${t.code}`,
    });
  }
  for (const d of documents) {
    hits.push({
      kind: "document",
      label: d.title,
      hint: [
        journalDisplayName(customNames, d.template.code, d.template.name),
        d.building?.name,
        d.status === "closed" ? "Закрыт" : "Активный",
      ]
        .filter(Boolean)
        .join(" · "),
      href: `/journals/${d.template.code}/documents/${d.id}`,
    });
  }
  for (const e of equipment) {
    const hint = [e.type, e.area?.name, e.serialNumber]
      .filter(Boolean)
      .join(" · ");
    hits.push({
      kind: "equipment",
      label: e.name,
      hint,
      href: `/settings/equipment#equipment-${e.id}`,
    });
  }

  return NextResponse.json({ q, hits });
}
