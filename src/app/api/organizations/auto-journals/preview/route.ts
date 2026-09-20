import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/server-session";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { getActiveBuildingId } from "@/lib/active-building";
import { buildingWhere } from "@/lib/building-scope";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import {
  parseJournalPeriodsJson,
  resolveJournalPeriod,
} from "@/lib/journal-period";
import {
  getJournalAutomation,
  isPerEmployeeJournal,
  isAutomationSupported,
} from "@/lib/journal-automation";
import { resolveAutomationStaff } from "@/lib/journal-automation-staff";
import { prefillResponsiblesForNewDocument } from "@/lib/journal-responsibles-cascade";
import {
  getPrimarySlotId,
  getVerifierSlotId,
} from "@/lib/journal-responsible-schemas";
import { getUserPositionLabel } from "@/lib/user-roles";
import { isDocumentTemplate } from "@/lib/journal-document-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/organizations/auto-journals/preview?code=<journalCode>
 *
 * Всё, что нужно модалке включения автоматики, одним запросом: реальные
 * подписи периодов этого журнала, кто станет ответственным при каждом из
 * режимов, список сотрудников для чек-листа и текущая сохранённая
 * политика.
 *
 * Смысл: человек включает автоматику один раз и должен видеть, ЧТО
 * именно произойдёт — с настоящими датами и фамилиями, а не с общими
 * словами «документ создастся сам».
 */

type PersonPreview = { id: string; name: string; positionTitle: string };

const RU_DAY_MONTH = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Не авторизован" }, { status: 401 });
  }
  if (
    !hasFullWorkspaceAccess({
      role: session.user.role,
      isRoot: session.user.isRoot,
    })
  ) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }

  const code = new URL(request.url).searchParams.get("code")?.trim() ?? "";
  if (!code) {
    return NextResponse.json({ error: "Не указан журнал" }, { status: 400 });
  }

  const template = await db.journalTemplate.findUnique({
    where: { code },
    select: { id: true, name: true },
  });
  if (!template) {
    return NextResponse.json({ error: "Журнал не найден" }, { status: 404 });
  }

  const organizationId = getActiveOrgId(session);
  const org = await db.organization.findUnique({
    where: { id: organizationId },
    select: {
      timezone: true,
      journalPeriods: true,
      journalAutomationJson: true,
      autoJournalCodes: true,
    },
  });
  const automation = getJournalAutomation(org, code);
  const perEmployee = isPerEmployeeJournal(code);

  const now = new Date();
  const overrides = parseJournalPeriodsJson(org?.journalPeriods ?? null);
  const currentPeriod = resolveJournalPeriod(code, now, overrides);

  // Следующий период считаем так же, как это делает автосоздание: от дня
  // после конца текущего. Совпал с текущим — журнал бессрочный, новых
  // периодов не будет (тот же guard `no-next-period`).
  const nextStart = new Date(
    currentPeriod.dateTo.getTime() + 24 * 60 * 60 * 1000
  );
  const nextResolved = resolveJournalPeriod(code, nextStart, overrides);
  const hasNextPeriod =
    nextResolved.dateFrom.getTime() > currentPeriod.dateTo.getTime();

  const todayUtcStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );
  const [activeDocument, users] = await Promise.all([
    db.journalDocument.findFirst({
      where: {
        organizationId,
        templateId: template.id,
        status: "active",
        dateFrom: { lte: todayUtcStart },
        dateTo: { gte: todayUtcStart },
        ...buildingWhere(await getActiveBuildingId(session)),
      },
      select: { id: true },
    }),
    db.user.findMany({
      where: { organizationId, isActive: true, archivedAt: null },
      select: {
        id: true,
        name: true,
        role: true,
        positionTitle: true,
        jobPosition: { select: { name: true, categoryKey: true } },
      },
      orderBy: { name: "asc" },
    }),
  ]);

  const byId = new Map(users.map((user) => [user.id, user] as const));
  function toPerson(userId: string | null | undefined): PersonPreview | null {
    if (!userId) return null;
    const user = byId.get(userId);
    if (!user) return null;
    return {
      id: user.id,
      name: user.name,
      positionTitle: getUserPositionLabel(user),
    };
  }

  // «Как в последнем журнале»: ответственные последнего документа, если
  // они ещё работают. Уволенных не показываем — их подставит каскад.
  const lastDocument = await db.journalDocument.findFirst({
    where: { organizationId, templateId: template.id },
    orderBy: [{ dateFrom: "desc" }, { createdAt: "desc" }],
    select: { responsibleUserId: true, verifierUserId: true },
  });

  // «Подберём по должностям»: сухой прогон штатного каскада. Config он
  // тоже вернёт, но нам нужны только выбранные люди.
  const autoPick = await prefillResponsiblesForNewDocument({
    organizationId,
    journalCode: code,
    baseConfig: {},
  }).catch(() => ({ responsibleUserId: null, verifierUserId: null }));

  let staff: {
    inherit: { count: number; names: string[] };
    selectedUserIds: string[];
  } | null = null;
  if (perEmployee) {
    const inherited = await resolveAutomationStaff(db, {
      organizationId,
      templateCode: code,
      staffPolicy: { mode: "inherit" },
    });
    const inheritIds = inherited.employeeIds;
    const savedCustom =
      automation.staff?.mode === "custom" ? automation.staff.userIds : null;
    staff = {
      inherit: {
        count: inheritIds.length,
        names: inheritIds
          .map((id) => byId.get(id)?.name)
          .filter((name): name is string => Boolean(name)),
      },
      // Чек-лист открывается предзаполненным: свой сохранённый список,
      // иначе тот же набор, что дало бы наследование.
      selectedUserIds: savedCustom ?? inheritIds,
    };
  }

  return NextResponse.json({
    code,
    journalName: template.name,
    isDocumentJournal: isDocumentTemplate(code),
    autofillSupported: isAutomationSupported(code),
    isPerEmployee: perEmployee,
    hasActiveDocument: Boolean(activeDocument),
    currentPeriod: { label: currentPeriod.label },
    nextPeriod: hasNextPeriod
      ? {
          label: nextResolved.label,
          startsAtLabel: RU_DAY_MONTH.format(nextResolved.dateFrom),
        }
      : null,
    responsibles: {
      inherit: {
        responsible: toPerson(lastDocument?.responsibleUserId),
        verifier: toPerson(lastDocument?.verifierUserId),
      },
      auto: {
        responsible: toPerson(autoPick.responsibleUserId),
        verifier: toPerson(autoPick.verifierUserId),
      },
      saved: automation.responsibles ?? null,
      primarySlotId: getPrimarySlotId(code),
      verifierSlotId: getVerifierSlotId(code),
    },
    staff,
    savedStaff: automation.staff ?? null,
    users,
  });
}
