import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/server-session";
import { authOptions } from "@/lib/auth";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { buildDateKeys } from "@/lib/hygiene-document";
import {
  applyStaffJournalAutoFill,
  limitDateKeysToToday,
} from "@/lib/staff-journal-autofill";
import { ORG_ROSTER_WHERE } from "@/lib/journal-roster";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import {
  getJournalAutomation,
  isPerEmployeeJournal,
} from "@/lib/journal-automation";
import { resolveAutomationStaff } from "@/lib/journal-automation-staff";
import {
  recordAutoFillUndo,
  revertAutoFill,
  snapshotBeforeAutoFill,
} from "@/lib/journal-autofill-undo";

type StaffAction =
  | "add_employee"
  | "fill_from_list"
  | "apply_auto_fill"
  | "revert_auto_fill";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Не авторизован" }, { status: 401 });

  // Через единый helper hasFullWorkspaceAccess — поддерживает и
  // canonical (manager/head_chef), и legacy (owner/technologist) роли,
  // и ROOT-impersonation. Раньше inline-list пропускал ROOT (он
  // импесонировал org и получал 403 здесь).
  if (
    !hasFullWorkspaceAccess({
      role: session.user.role,
      isRoot: session.user.isRoot === true,
    })
  ) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }

  const { id: documentId } = await params;
  const document = await db.journalDocument.findUnique({
    where: { id: documentId },
    include: {
      template: true,
      entries: true,
    },
  });

  if (!document || document.organizationId !== getActiveOrgId(session)) {
    return NextResponse.json({ error: "Документ не найден" }, { status: 404 });
  }

  if (document.status === "closed") {
    return NextResponse.json({ error: "Документ закрыт" }, { status: 400 });
  }

  const body = (await request.json()) as {
    action?: StaffAction;
    employeeId?: string;
    category?: string;
  };

  const action = body.action;
  if (!action) {
    return NextResponse.json({ error: "Не указано действие" }, { status: 400 });
  }

  // Ростер документа — живые сотрудники этой организации, без ROOT.
  const users = await db.user.findMany({
    where: {
      organizationId: getActiveOrgId(session),
      ...ORG_ROSTER_WHERE,
    },
    select: { id: true, role: true },
  });

  const dateKeys = buildDateKeys(document.dateFrom, document.dateTo);

  /**
   * Состав сотрудников для «заполнить всех». Если у журнала задана
   * политика списка (`journalAutomationJson[code].staff`) — берём её:
   * иначе ручная кнопка ломала бы custom-список, добавляя весь ростер.
   * Политики нет — прежнее поведение (все активные сотрудники).
   */
  const templateCode = document.template.code;
  const organizationId = getActiveOrgId(session);
  const allUserIds = users.map((user) => user.id);

  async function resolveTargetUserIds(): Promise<string[]> {
    if (!isPerEmployeeJournal(templateCode)) return allUserIds;
    const org = await db.organization.findUnique({
      where: { id: organizationId },
      select: { journalAutomationJson: true, autoJournalCodes: true },
    });
    const staffPolicy = getJournalAutomation(org, templateCode).staff;
    if (!staffPolicy) return allUserIds;
    const resolved = await resolveAutomationStaff(db, {
      organizationId,
      templateCode,
      staffPolicy,
    });
    return resolved.employeeIds.length > 0 ? resolved.employeeIds : allUserIds;
  }

  if (action === "revert_auto_fill") {
    // Тумблер автозаполнения в самом документе выключили с согласием
    // «убрать заполненное»: проигрываем журнал отката назад.
    const result = await revertAutoFill(db, {
      documentId,
      config: document.config,
    });
    return NextResponse.json(result);
  }

  if (action === "apply_auto_fill") {
    // Общая логика с ежедневным cron'ом (/api/cron/auto-fill-journals):
    // тот же helper, разница только в наборе дат (здесь — весь период
    // документа, в cron — сегодняшний день).
    const before = await snapshotBeforeAutoFill(db, {
      documentId,
      dateKeys,
      config: document.config,
    });
    const result = await applyStaffJournalAutoFill(db, {
      documentId,
      organizationId,
      templateCode: document.template.code,
      employeeIds: await resolveTargetUserIds(),
      dateKeys,
      entries: document.entries,
    });
    // Журнал отката: выключение тумблера сможет вернуть как было.
    await recordAutoFillUndo(db, {
      documentId,
      dateKeys,
      before,
      configAfter: document.config,
    }).catch(() => 0);

    return NextResponse.json({ updated: result.updated, created: result.created });
  }

  let targetUserIds: string[] = [];

  if (action === "add_employee") {
    if (!body.employeeId) {
      return NextResponse.json({ error: "Не указан сотрудник" }, { status: 400 });
    }

    const user = users.find((item) => item.id === body.employeeId);
    if (!user) {
      return NextResponse.json({ error: "Сотрудник не найден" }, { status: 404 });
    }

    targetUserIds = [user.id];
  }

  if (action === "fill_from_list") {
    const category = body.category || "all";
    if (category === "all") {
      targetUserIds = await resolveTargetUserIds();
    } else if (category.startsWith("role:")) {
      const role = category.replace("role:", "");
      targetUserIds = users.filter((user) => user.role === role).map((user) => user.id);
    }
  }

  if (targetUserIds.length === 0) {
    return NextResponse.json({ created: 0, skipped: true });
  }

  // Строки на весь период — пустые: будущие дни никогда не заполняются
  // заранее. При включённом автозаполнении отметки до сегодня ставит тот же
  // helper, что и ежедневный cron (он же учитывает выходные и отпуска).
  const rows = targetUserIds.flatMap((employeeId) =>
    dateKeys.map((dateKey) => ({
      documentId,
      employeeId,
      date: new Date(dateKey),
      data: {},
    }))
  );

  const result = await db.journalDocumentEntry.createMany({
    data: rows,
    skipDuplicates: true,
  });

  let filled = { created: 0, updated: 0 };
  if (document.autoFill) {
    const currentEntries = await db.journalDocumentEntry.findMany({
      where: { documentId, employeeId: { in: targetUserIds } },
      select: { id: true, employeeId: true, date: true, data: true },
    });
    filled = await applyStaffJournalAutoFill(db, {
      documentId,
      organizationId,
      templateCode,
      employeeIds: targetUserIds,
      dateKeys: limitDateKeysToToday(dateKeys),
      entries: currentEntries,
    });
  }

  return NextResponse.json({
    created: result.count,
    filled: filled.created + filled.updated,
  });
}
