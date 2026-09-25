import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { JournalPageCrumbs } from "@/components/journals/journal-breadcrumbs";
import { getJournalCrumbMenu } from "@/lib/journal-crumb-menu";
import { getCrumbOrganizationName } from "@/lib/crumb-organization";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { resolveJournalDisplayName } from "@/lib/org-custom-names";
import { loadGuideNodesForUI } from "@/lib/journal-guide-tree";
import { db } from "@/lib/db";
import { DynamicForm } from "@/components/journals/dynamic-form";
import { FinishedProductPipeline } from "@/components/journals/finished-product-pipeline";
import { hasDocumentFillUi } from "@/lib/journal-document-helpers";
import { resolveJournalCodeAlias } from "@/lib/source-journal-map";
import { isScanOnlyDocumentTemplate } from "@/lib/scan-journal-config";
import { getEffectiveTaskMode } from "@/lib/journal-task-modes";
import { getJournalSpec } from "@/lib/journal-specs";
import { countRollingToday } from "@/lib/journal-rolling";

export default async function NewJournalEntryPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const resolvedCode = resolveJournalCodeAlias(code);
  const session = await requireAuth();

  const template = await db.journalTemplate.findUnique({
    where: { code: resolvedCode },
  });

  if (!template) {
    notFound();
  }

  if (hasDocumentFillUi(resolvedCode) || isScanOnlyDocumentTemplate(resolvedCode)) {
    notFound();
  }

  // If the manager disabled this journal, don't let users create new
  // entries. Existing ones stay in the DB (reversible via settings).
  const org = await db.organization.findUnique({
    where: { id: getActiveOrgId(session) },
    select: { disabledJournalCodes: true },
  });
  const disabledCodes = Array.isArray(org?.disabledJournalCodes)
    ? (org?.disabledJournalCodes as string[])
    : [];
  if (disabledCodes.includes(resolvedCode)) {
    return (
      <div className="mx-auto max-w-[640px] space-y-6 rounded-3xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-6 py-16 text-center">
        <div className="text-[20px] font-semibold text-[#0b1024]">
          Журнал отключён
        </div>
        <p className="text-[14px] leading-[1.6] text-[#6f7282]">
          Нельзя создать запись для отключённого журнала. Включите его в
          настройках набора журналов, чтобы продолжить.
        </p>
        <Link
          href="/settings/journals"
          className="inline-flex h-11 items-center gap-2 rounded-2xl bg-[#5566f6] px-5 text-[15px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors hover:bg-[#4a5bf0]"
        >
          Открыть настройки
        </Link>
      </div>
    );
  }

  const [areas, equipment, employees, products] = await Promise.all([
    db.area.findMany({
      where: { organizationId: getActiveOrgId(session) },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    db.equipment.findMany({
      where: {
        area: { organizationId: getActiveOrgId(session) },
      },
      select: {
        id: true,
        name: true,
        type: true,
        tempMin: true,
        tempMax: true,
        tuyaDeviceId: true,
      },
      orderBy: { name: "asc" },
    }),
    db.user.findMany({
      where: {
        organizationId: getActiveOrgId(session),
        isActive: true,
      },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    db.product.findMany({
      where: {
        organizationId: getActiveOrgId(session),
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        supplier: true,
        barcode: true,
        unit: true,
        storageTemp: true,
        shelfLifeDays: true,
      },
      orderBy: { name: "asc" },
    }),
  ]);

  const fields = template.fields as Array<{
    key: string;
    label: string;
    type: "text" | "number" | "date" | "boolean" | "select" | "equipment" | "employee";
    required?: boolean;
    options?: Array<{ value: string; label: string }>;
    step?: number;
    auto?: boolean;
    showIf?: { field: string; equals: unknown };
  }>;

  // Phase R: rolling-режим. Если у журнала distribution=rolling —
  // включаем ему UI с двумя кнопками + счётчик.
  const orgForMode = await db.organization.findUnique({
    where: { id: getActiveOrgId(session) },
    select: { journalTaskModesJson: true },
  });
  const taskMode = getEffectiveTaskMode(
    resolvedCode,
    orgForMode?.journalTaskModesJson,
  );
  const rollingMode = taskMode.distribution === "rolling";
  const spec = getJournalSpec(resolvedCode);
  const dailyCountInitial = rollingMode
    ? await countRollingToday({
        organizationId: getActiveOrgId(session),
        journalCode: resolvedCode,
        userId: session.user.id,
      })
    : 0;
  const customGuideNodes =
    (await loadGuideNodesForUI(getActiveOrgId(session), resolvedCode)) ??
    undefined;

  // Рукописная ссылка «← К журналу» убрана: наверх ведут крошки, назад —
  // общая кнопка из layout'а раздела.
  const [crumbOrganizationName, journalMenu] = await Promise.all([
    getCrumbOrganizationName(getActiveOrgId(session)),
    getJournalCrumbMenu(session, resolvedCode),
  ]);

  return (
    <div className="mx-auto max-w-3xl space-y-5 px-1 sm:space-y-6">
      <JournalPageCrumbs
        organizationName={crumbOrganizationName}
        journalName={template.name}
        journalCode={resolvedCode}
        journalMenu={journalMenu}
        tail={[{ label: "Новая запись" }]}
      />

      {/* Тёмный hero снят: форма — главное на этом экране, заголовку
          достаточно одной строки. */}
      <PageHeader
        eyebrow="Новая запись"
        // Своё название журнала организации; в форму и данные — официальное.
        title={await resolveJournalDisplayName(getActiveOrgId(session), resolvedCode, template.name)}
        description={template.description ?? undefined}
      />

      <div className="rounded-3xl border border-[#ececf4] bg-white p-4 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] sm:p-6 md:p-8">
        {resolvedCode === "finished_product" ? (
          <FinishedProductPipeline
            rollingMode={rollingMode}
            dailyCountInitial={dailyCountInitial}
            rollingDailyCap={spec.rolling?.dailyCap ?? 50}
            rollingContinueLabel="Сохранить и следующее блюдо"
            rollingDoneLabel={spec.rolling?.doneLabel ?? "Готово на сегодня"}
          />
        ) : (
          <DynamicForm
            templateCode={resolvedCode}
            templateName={template.name}
            fields={fields}
            areas={areas}
            equipment={equipment}
            employees={employees}
            products={products}
            draftScope={session.user.id}
            customGuideNodes={customGuideNodes}
            rollingMode={rollingMode}
            dailyCountInitial={dailyCountInitial}
            rollingDailyCap={spec.rolling?.dailyCap ?? 50}
            rollingContinueLabel={
              spec.rolling?.continueLabel ?? "Сохранить и продолжить"
            }
            rollingDoneLabel={spec.rolling?.doneLabel ?? "Готово на сегодня"}
          />
        )}
      </div>
    </div>
  );
}
