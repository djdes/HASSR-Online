import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getActiveOrgId, requireApiAuth } from "@/lib/auth-helpers";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { recordAuditLog } from "@/lib/audit-log";
import { ensurePipelineTemplate } from "@/lib/journal-pipeline-tree";
import {
  PIPELINE_EXEMPT_JOURNALS,
  resolvePipelineFields,
} from "@/lib/journal-default-pipelines";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SeedSummary = {
  created: { code: string; name: string; nodeCount: number }[];
  skippedExisting: { code: string; name: string; existingNodeCount: number }[];
  skippedNoFields: { code: string; name: string }[];
  /// Журналы со своим custom-адаптером (cleaning, hygiene, …) —
  /// для них pipeline-tree не нужен. Считаем их в total и сообщаем
  /// в toast одной фразой «N со своим адаптером», но НЕ присылаем
  /// в notifications как «требует ручной настройки».
  exempt: { code: string; name: string }[];
};

/**
 * POST /api/settings/journal-pipelines/seed-all
 *
 * Bulk-seed: проходит ВСЕ активные `JournalTemplate` и для каждого
 * создаёт pipeline-tree с pinned-узлами по `template.fields[]`.
 * Эквивалентно нажатию «Создать из колонок журнала» на каждом журнале
 * по очереди в /settings/journal-pipelines-tree/[code].
 *
 * Categorisation:
 *   • created          — pipeline шаблон был пуст, создали N pinned-узлов
 *   • skippedExisting  — у шаблона уже есть pinned-узлы (не перезаписываем)
 *   • skippedNoFields  — у журнала нет описанных колонок (нечего сидить)
 *
 * После завершения отправляет уведомление управляющему с сводкой и
 * списком журналов которые НЕ удалось засидить (skippedNoFields) —
 * чтобы ему было видно что нужно настроить вручную.
 */
export async function POST(request: Request) {
  const auth = await requireApiAuth();
  if (!auth.ok) return auth.response;
  if (!hasFullWorkspaceAccess(auth.session.user)) {
    return NextResponse.json({ error: "Это действие доступно руководителю" }, { status: 403 });
  }

  const organizationId = getActiveOrgId(auth.session);
  const userId = auth.session.user.id;

  const journals = await db.journalTemplate.findMany({
    where: { isActive: true },
    select: { code: true, name: true, fields: true },
    orderBy: { sortOrder: "asc" },
  });

  const summary: SeedSummary = {
    created: [],
    skippedExisting: [],
    skippedNoFields: [],
    exempt: [],
  };

  for (const journal of journals) {
    // Exempt-журналы со своим custom-адаптером (cleaning, hygiene и т.п.)
    // Pipeline-tree им не нужен — TasksFlow-задачи строятся прямо
    // в их адаптере. Считаем в exempt, не в skippedNoFields, чтобы
    // не пугать пользователя «4 требуют ручной настройки» — на
    // самом деле они УЖЕ настроены, просто не через этот UI.
    if (PIPELINE_EXEMPT_JOURNALS.has(journal.code)) {
      summary.exempt.push({ code: journal.code, name: journal.name });
      continue;
    }

    const rawFields = Array.isArray(journal.fields)
      ? (journal.fields as unknown[])
      : [];
    // resolvePipelineFields: template.fields[] || default-registry || null
    const validFields = resolvePipelineFields(journal.code, rawFields);
    if (!validFields) {
      summary.skippedNoFields.push({ code: journal.code, name: journal.name });
      continue;
    }

    const template = await ensurePipelineTemplate(organizationId, journal.code);
    const existingPinned = await db.journalPipelineNode.count({
      where: { templateId: template.id, kind: "pinned" },
    });
    if (existingPinned > 0) {
      summary.skippedExisting.push({
        code: journal.code,
        name: journal.name,
        existingNodeCount: existingPinned,
      });
      continue;
    }

    let createdCount = 0;
    for (let index = 0; index < validFields.length; index++) {
      const field = validFields[index];
      const key = field.key;
      const label = field.label || key;
      await db.journalPipelineNode.create({
        data: {
          templateId: template.id,
          parentId: null,
          kind: "pinned",
          linkedFieldKey: key,
          title: label,
          ordering: (index + 1) * 1024,
          photoMode: "none",
          requireComment: false,
          requireSignature: false,
        },
      });
      createdCount++;
    }
    summary.created.push({
      code: journal.code,
      name: journal.name,
      nodeCount: createdCount,
    });
  }

  // Audit-log одна запись per organization про bulk-seed.
  await recordAuditLog({
    request,
    session: auth.session,
    organizationId,
    action: "settings.journal-pipelines.seed-all",
    entity: "JournalPipelineTemplate",
    entityId: null,
    details: {
      created: summary.created.length,
      skippedExisting: summary.skippedExisting.length,
      skippedNoFields: summary.skippedNoFields.length,
      exempt: summary.exempt.length,
      skippedCodes: summary.skippedNoFields.map((s) => s.code),
    },
  });

  // Уведомление: ПОЛНАЯ ПЕРЕЗАПИСЬ items (а не merge через upsertNotification),
  // чтобы при повторном клике старые позиции (которые уже засидели)
  // не оставались в списке. Один dedupeKey = одна нотификация = items
  // ровно равны текущему skippedNoFields.
  const noFieldsItems = summary.skippedNoFields.map((j) => ({
    id: j.code,
    label: j.name,
    hint: "У журнала нет описанных колонок — настрой шаги вручную",
    href: `/settings/journal-pipelines-tree/${j.code}`,
  }));

  if (noFieldsItems.length > 0) {
    const title = `Pipeline создан для ${summary.created.length} журналов, ${summary.skippedNoFields.length} требуют ручной настройки`;
    await db.notification.upsert({
      where: {
        userId_dedupeKey: {
          userId,
          dedupeKey: "pipelines.bulk-seed.skipped",
        },
      },
      create: {
        organizationId,
        userId,
        kind: "pipelines.bulk-seed.skipped",
        dedupeKey: "pipelines.bulk-seed.skipped",
        title,
        linkHref: "/settings/journal-pipelines",
        linkLabel: "Открыть настройки журналов",
        items: noFieldsItems as unknown as object,
      },
      update: {
        title,
        linkHref: "/settings/journal-pipelines",
        linkLabel: "Открыть настройки журналов",
        items: noFieldsItems as unknown as object,
        readAt: null,
        dismissedAt: null,
      },
    });
  } else {
    // Если нет skippedNoFields — старая нотификация устарела, помечаем
    // её как dismissed (если есть), чтобы не висела на дашборде.
    await db.notification.updateMany({
      where: {
        userId,
        dedupeKey: "pipelines.bulk-seed.skipped",
        dismissedAt: null,
      },
      data: { dismissedAt: new Date() },
    });
  }

  const activeCount = await db.journalPipelineTemplate.count({
    where: { organizationId },
  });

  return NextResponse.json({
    summary,
    activeTemplateCount: activeCount,
  });
}
