import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { TrackedDocumentClient } from "@/components/journals/tracked-document-client";
import { ScanJournalDocumentClient } from "@/components/journals/scan-journal-document-client";
import { ColdEquipmentDocumentClient } from "@/components/journals/cold-equipment-document-client";
import {
  COLD_EQUIPMENT_DOCUMENT_TEMPLATE_CODE,
  normalizeColdEquipmentDocumentConfig,
  normalizeColdEquipmentEntryData,
} from "@/lib/cold-equipment-document";
import { ClimateDocumentClient } from "@/components/journals/climate-document-client";
import {
  CLIMATE_DOCUMENT_TEMPLATE_CODE,
  normalizeClimateDocumentConfig,
  normalizeClimateEntryData,
} from "@/lib/climate-document";
import { CleaningDocumentClient } from "@/components/journals/cleaning-document-client";
import {
  CLEANING_DOCUMENT_TEMPLATE_CODE,
  normalizeCleaningDocumentConfig,
  normalizeCleaningEntryData,
} from "@/lib/cleaning-document";
import { FinishedProductDocumentClient } from "@/components/journals/finished-product-document-client";
import {
  FINISHED_PRODUCT_DOCUMENT_TEMPLATE_CODE,
  normalizeFinishedProductDocumentConfig,
} from "@/lib/finished-product-document";
import { AcceptanceDocumentClient } from "@/components/journals/acceptance-document-client";
import { SanitationDayDocumentClient } from "@/components/journals/sanitation-day-document-client";
import { HealthDocumentClient } from "@/components/journals/health-document-client";
import { HygieneDocumentClient } from "@/components/journals/hygiene-document-client";
import { readControlPeriodicity } from "@/lib/control-periodicity";
import { isJournalAutomationEnabled } from "@/lib/journal-automation";
import {
  getHygieneDemoTeamUsers,
  normalizeHealthEntryData,
  normalizeHygieneEntryData,
  toDateKey,
} from "@/lib/hygiene-document";
import {
  ACCEPTANCE_DOCUMENT_TEMPLATE_CODE,
  isAcceptanceDocumentTemplate,
  normalizeAcceptanceDocumentConfig,
} from "@/lib/acceptance-document";
import {
  PPE_ISSUANCE_TEMPLATE_CODE,
  normalizePpeIssuanceConfig,
} from "@/lib/ppe-issuance-document";
import { PpeIssuanceDocumentClient } from "@/components/journals/ppe-issuance-document-client";
import { isRegisterDocumentTemplate } from "@/lib/register-document";
import { ORG_NAME_FALLBACK } from "@/lib/journal-constants";
import { ORG_ROSTER_WHERE } from "@/lib/journal-roster";
import { withBuildingLabel } from "@/lib/building-scope";
import { JournalHeaderEditProvider } from "@/components/journals/journal-header-edit";
import { readHeaderTitleOverride } from "@/lib/journal-header-title";
import { readHeaderOrgNameOverride, resolveOrgJournalName } from "@/lib/org-journal-name";
import { hasCapability } from "@/lib/permission-presets";
import { isManagementRole } from "@/lib/user-roles";
import { isTrackedDocumentTemplate } from "@/lib/tracked-document";
import { resolveJournalCodeAlias } from "@/lib/source-journal-map";
import { SANITATION_DAY_TEMPLATE_CODE } from "@/lib/sanitation-day-document";
import { loadDirectoryBuildings } from "@/lib/room-directory";
import { isScanOnlyDocumentTemplate } from "@/lib/scan-journal-config";
import { getScanJournalPageCount } from "@/lib/scan-journal-pages";
import { TRAINING_PLAN_TEMPLATE_CODE } from "@/lib/training-plan-document";
import { TrainingPlanDocumentClient } from "@/components/journals/training-plan-document-client";
import {
  AUDIT_PLAN_DOCUMENT_TITLE,
  AUDIT_PLAN_TEMPLATE_CODE,
  normalizeAuditPlanConfig,
} from "@/lib/audit-plan-document";
import { AuditPlanDocumentClient } from "@/components/journals/audit-plan-document-client";
import {
  AUDIT_PROTOCOL_DOCUMENT_TITLE,
  AUDIT_PROTOCOL_TEMPLATE_CODE,
  normalizeAuditProtocolConfig,
  type AuditProtocolPlanSource,
} from "@/lib/audit-protocol-document";
import { AuditProtocolDocumentClient } from "@/components/journals/audit-protocol-document-client";
import {
  AUDIT_REPORT_TEMPLATE_CODE,
  normalizeAuditReportConfig,
  type AuditReportProtocolSource,
} from "@/lib/audit-report-document";
import { AuditReportDocumentClient } from "@/components/journals/audit-report-document-client";
import { DISINFECTANT_TEMPLATE_CODE } from "@/lib/disinfectant-document";
import { DisinfectantDocumentClient } from "@/components/journals/disinfectant-document-client";
import { BREAKDOWN_HISTORY_TEMPLATE_CODE } from "@/lib/breakdown-history-document";
import { BreakdownHistoryDocumentClient } from "@/components/journals/breakdown-history-document-client";
import { IntensiveCoolingDocumentClient } from "@/components/journals/intensive-cooling-document-client";
import { ACCIDENT_DOCUMENT_TEMPLATE_CODE } from "@/lib/accident-document";
import { AccidentDocumentClient } from "@/components/journals/accident-document-client";
import { UvLampRuntimeDocumentClient } from "@/components/journals/uv-lamp-runtime-document-client";
import {
  UV_LAMP_RUNTIME_TEMPLATE_CODE,
  buildUvRuntimeDocumentTitle,
  normalizeUvRuntimeDocumentConfig,
  toIsoDate,
} from "@/lib/uv-lamp-runtime-document";
import { MedBookDocumentClient } from "@/components/journals/med-book-document-client";
import {
  MED_BOOK_TEMPLATE_CODE,
  normalizeMedBookConfig,
  normalizeMedBookEntryData,
} from "@/lib/med-book-document";
import { FryerOilDocumentClient } from "@/components/journals/fryer-oil-document-client";
import {
  FRYER_OIL_TEMPLATE_CODE,
  normalizeFryerOilDocumentConfig,
  normalizeFryerOilEntryData,
} from "@/lib/fryer-oil-document";
import {
  INTENSIVE_COOLING_DEFAULT_DOCUMENT_NAME,
  INTENSIVE_COOLING_TEMPLATE_CODE,
} from "@/lib/intensive-cooling-document";
import { PerishableRejectionDocumentClient } from "@/components/journals/perishable-rejection-document-client";
import {
  PERISHABLE_REJECTION_TEMPLATE_CODE,
  normalizePerishableRejectionConfig,
} from "@/lib/perishable-rejection-document";
import { ProductWriteoffDocumentClient } from "@/components/journals/product-writeoff-document-client";
import {
  PRODUCT_WRITEOFF_TEMPLATE_CODE,
  normalizeProductWriteoffConfig,
} from "@/lib/product-writeoff-document";
import { GlassListDocumentClient } from "@/components/journals/glass-list-document-client";
import {
  GLASS_LIST_TEMPLATE_CODE,
  normalizeGlassListConfig,
} from "@/lib/glass-list-document";
import { GlassControlDocumentClient } from "@/components/journals/glass-control-document-client";
import {
  GLASS_CONTROL_TEMPLATE_CODE,
  normalizeGlassControlConfig,
  normalizeGlassControlEntryData,
} from "@/lib/glass-control-document";
import { StaffTrainingDocumentClient } from "@/components/journals/staff-training-document-client";
import {
  STAFF_TRAINING_TEMPLATE_CODE,
  normalizeStaffTrainingConfig,
} from "@/lib/staff-training-document";
import { EquipmentMaintenanceDocumentClient } from "@/components/journals/equipment-maintenance-document-client";
import {
  EQUIPMENT_MAINTENANCE_TEMPLATE_CODE,
  normalizeEquipmentMaintenanceConfig,
} from "@/lib/equipment-maintenance-document";
import { CleaningVentilationChecklistDocumentClient } from "@/components/journals/cleaning-ventilation-checklist-document-client";
import {
  CLEANING_VENTILATION_CHECKLIST_TEMPLATE_CODE,
  CLEANING_VENTILATION_CHECKLIST_TITLE,
  normalizeCleaningVentilationConfig,
  normalizeCleaningVentilationEntryData,
} from "@/lib/cleaning-ventilation-checklist-document";
import { SanitaryDayChecklistDocumentClient } from "@/components/journals/sanitary-day-checklist-document-client";
import {
  SANITARY_DAY_CHECKLIST_TEMPLATE_CODE,
  isSanitaryDayChecklistTemplate,
  normalizeSdcConfig,
  normalizeSdcEntryData,
} from "@/lib/sanitary-day-checklist-document";
import { EquipmentCalibrationDocumentClient } from "@/components/journals/equipment-calibration-document-client";
import {
  EQUIPMENT_CALIBRATION_TEMPLATE_CODE,
  normalizeEquipmentCalibrationConfig,
} from "@/lib/equipment-calibration-document";
import { TraceabilityDocumentClient } from "@/components/journals/traceability-document-client";
import {
  TRACEABILITY_DOCUMENT_TEMPLATE_CODE,
  normalizeTraceabilityDocumentConfig,
} from "@/lib/traceability-document";
import { MetalImpurityDocumentClient } from "@/components/journals/metal-impurity-document-client";
import {
  METAL_IMPURITY_TEMPLATE_CODE,
  normalizeMetalImpurityConfig,
} from "@/lib/metal-impurity-document";
import { EquipmentCleaningDocumentClient } from "@/components/journals/equipment-cleaning-document-client";
import {
  EQUIPMENT_CLEANING_TEMPLATE_CODE,
  normalizeEquipmentCleaningConfig,
  normalizeEquipmentCleaningRowData,
} from "@/lib/equipment-cleaning-document";
import { ComplaintDocumentClient } from "@/components/journals/complaint-document-client";
import { COMPLAINT_REGISTER_TEMPLATE_CODE, normalizeComplaintConfig } from "@/lib/complaint-document";
import { isIntegrationCryptoConfigured } from "@/lib/integration-crypto";

import { orgTodayKey } from "@/lib/timezone";
import { TodayKeyProvider } from "@/lib/today-key-context";
export const dynamic = "force-dynamic";

type TrackedFieldOption = {
  value: string;
  label: string;
};

type TrackedField = {
  key: string;
  label: string;
  type: string;
  options: TrackedFieldOption[];
};

/**
 * Публичная обёртка страницы документа.
 *
 * Внутренний `JournalDocumentBody` — это старый dispatcher на ~35
 * return-веток (по одной на шаблон журнала). Вместо того чтобы
 * оборачивать каждую ветку в крошки, оборачиваем dispatcher целиком:
 * крошки рендерятся ДО него, из отдельного лёгкого запроса.
 *
 * `chrome: "mini"` — Mini App (`/mini/documents/[id]`) вызывает эту
 * страницу как обычную async-функцию и передаёт этот флаг, чтобы НЕ
 * получить крошки дашборда: у него своя навигация (MiniTopBar + MiniNav).
 */
export default async function JournalDocumentPage(props: {
  params: Promise<{ code: string; docId: string }>;
  searchParams: Promise<{ page?: string }>;
  chrome?: "mini";
}) {
  if (props.chrome === "mini") {
    return (
      <JournalHeaderEditBoundary params={props.params}>
        <JournalDocumentBody {...props} />
      </JournalHeaderEditBoundary>
    );
  }

  // Крошки и маркер печати переехали в layout.tsx: они обязаны быть ВНЕ
  // зоны горизонтальной прокрутки бланка, иначе уезжают вместе с ним.
  return (
    <JournalHeaderEditBoundary params={props.params}>
      <JournalDocumentBody {...props} />
    </JournalHeaderEditBoundary>
  );
}

/**
 * Правка шапки прямо в документе: название организации (во всех журналах
 * или только здесь), название документа и периодичность контроля.
 *
 * Один провайдер на все ~35 клиентов журналов — сами клиенты про правку
 * не знают, ячейки шапки читают контекст. Mini App зовёт эту страницу как
 * функцию и получает то же самое. Лёгкий отдельный запрос, чтобы не
 * трогать ветки диспетчера ниже.
 */
async function JournalHeaderEditBoundary({
  params,
  children,
}: {
  params: Promise<{ code: string; docId: string }>;
  children: ReactNode;
}) {
  const { docId } = await params;
  const session = await requireAuth();
  const organizationId = getActiveOrgId(session);
  const [document, organization] = await Promise.all([
    db.journalDocument.findUnique({
      where: { id: docId },
      select: {
        id: true,
        organizationId: true,
        status: true,
        config: true,
        template: { select: { code: true } },
      },
    }),
    db.organization.findUnique({
      where: { id: organizationId },
      select: { name: true, journalShortName: true, legalProfileJson: true },
    }),
  ]);
  if (!document || document.organizationId !== organizationId) return <>{children}</>;

  // Те же права, что у PATCH документа (управление журналами), и общее
  // название — у PATCH /api/settings/organization (администратор).
  const canManageJournals =
    isManagementRole(session.user.role) && hasCapability(session.user, "journals.manage");
  return (
    <JournalHeaderEditProvider
      value={{
        documentId: document.id,
        canEditDocument: canManageJournals && document.status !== "closed",
        canEditOrganization: hasCapability(session.user, "admin.full"),
        organizationJournalName: resolveOrgJournalName(organization),
        organizationDefaultName: resolveOrgJournalName({
          ...(organization ?? {}),
          journalShortName: null,
        }),
        documentOrgName: readHeaderOrgNameOverride(document.config),
        headerTitle: readHeaderTitleOverride(document.config),
        controlPeriodicity: readControlPeriodicity(document.config, document.template.code),
      }}
    >
      {children}
    </JournalHeaderEditProvider>
  );
}

async function JournalDocumentBody({
  params,
  searchParams,
}: {
  params: Promise<{ code: string; docId: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { code, docId } = await params;
  const resolvedCode = resolveJournalCodeAlias(code);
  const query = await searchParams;
  const session = await requireAuth();

  const [document, organization, employees, equipment, tasksFlowIntegration] =
    await Promise.all([
      db.journalDocument.findUnique({
        where: { id: docId },
        include: {
          template: true,
          building: { select: { name: true, address: true, journalName: true } },
          entries: {
            orderBy: [{ employeeId: "asc" }, { date: "asc" }],
          },
        },
      }),
      db.organization.findUnique({
        where: { id: getActiveOrgId(session) },
        select: {
          name: true,
          journalShortName: true,
          legalProfileJson: true,
          isDemo: true,
          timezone: true,
          disabledJournalCodes: true,
          experimentalUiV2: true,
          journalAutomationJson: true,
          autoJournalCodes: true,
        },
      }),
      // Ростер документа: живые сотрудники этой организации без ROOT.
      db.user.findMany({
        where: {
          organizationId: getActiveOrgId(session),
          ...ORG_ROSTER_WHERE,
        },
        select: { id: true, name: true, role: true, email: true, positionTitle: true, jobPosition: { select: { name: true, categoryKey: true } } },
        orderBy: [{ role: "asc" }, { name: "asc" }],
      }),
      db.equipment.findMany({
        where: {
          area: {
            organizationId: getActiveOrgId(session),
          },
        },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
      // Lightweight integration check — only exposed to journals that
      // actually integrate with TasksFlow (cleaning today; we'll widen
      // it as more journals get hooks). The cleaning client uses this
      // to decide whether to auto-poll for completions and whether to
      // render the «Sync from TasksFlow» button.
      db.tasksFlowIntegration.findUnique({
        where: { organizationId: getActiveOrgId(session) },
        select: { enabled: true },
      }),
    ]);
  const hasTasksFlowIntegration = Boolean(
    tasksFlowIntegration?.enabled && isIntegrationCryptoConfigured()
  );

  // Должность на экране — из справочника должностей (jobPosition.name), как
  // это делает загрузчик PDF: иначе гигиена и журнал здоровья откатывались
  // на лейбл роли («Повар» вместо «Уборщица»).
  function withDirectoryTitle<
    T extends {
      positionTitle?: string | null;
      jobPosition?: { name?: string | null } | null;
    },
  >(employee: T): T {
    const directoryTitle = employee.jobPosition?.name?.trim();
    return directoryTitle
      ? { ...employee, positionTitle: directoryTitle }
      : employee;
  }

  // Должности демо-команды подставляются только в демо-организации: раньше
  // сотруднику реальной организации, чьи ФИО совпали с демо-ростером,
  // молча меняли должность.
  const demoEmployees =
    organization?.isDemo === true ? getHygieneDemoTeamUsers(employees) : [];
  const enrichedEmployees = employees.map((employee) => {
    const demo = demoEmployees.find((item) => item.id === employee.id);
    return demo || withDirectoryTitle(employee);
  });

  if (
    !document ||
    document.organizationId !== getActiveOrgId(session) ||
    document.template.code !== resolvedCode
  ) {
    notFound();
  }

  // Уволенные / архивные сотрудники, на которых ссылаются записи этого
  // документа. Ростер выше берёт только активных (ORG_ROSTER_WHERE), и
  // после увольнения строка задним числом пропадала из журнала и печати.
  // Эти люди нужны ТОЛЬКО для отображения — в списки выбора новых
  // ответственных (`enrichedEmployees`) они не попадают.
  const rosterIds = new Set(employees.map((user) => user.id));
  const inactiveReferencedIds = [
    ...new Set(document.entries.map((entry) => entry.employeeId)),
  ].filter((id) => id && !rosterIds.has(id));
  const inactiveEmployees =
    inactiveReferencedIds.length > 0
      ? await db.user.findMany({
          where: {
            id: { in: inactiveReferencedIds },
            organizationId: getActiveOrgId(session),
          },
          select: {
            id: true,
            name: true,
            role: true,
            email: true,
            positionTitle: true,
            jobPosition: { select: { name: true, categoryKey: true } },
          },
        })
      : [];
  /** Ростер + уволенные: только для рендера ФИО и должностей. */
  const displayEmployees = [
    ...enrichedEmployees,
    ...inactiveEmployees.map(withDirectoryTitle),
  ];

  // Точки: в шапке бланка под организацией — точка с адресом.
  // Название — сокращённое для журналов (своё у документа → общее →
  // ЕГРЮЛ → полное), см. src/lib/org-journal-name.ts.
  const organizationName = withBuildingLabel(
    resolveOrgJournalName(organization, document.config),
    document.building,
  );

  // Org-level toggle. If the journal was disabled in /settings/journals,
  // surface the soft disabled screen instead of silently rendering the
  // editor — otherwise a stale deep-link would keep working after the
  // manager deliberately turned the journal off.
  const disabledJournalCodes = Array.isArray(organization?.disabledJournalCodes)
    ? (organization?.disabledJournalCodes as string[])
    : [];
  if (disabledJournalCodes.includes(resolvedCode)) {
    return (
      <div className="mx-auto max-w-[640px] space-y-6 rounded-3xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-6 py-16 text-center">
        <div className="text-[20px] font-semibold text-[#0b1024]">
          Этот журнал отключён
        </div>
        <p className="text-[14px] leading-[1.6] text-[#6f7282]">
          «{document.template.name}» отключён для вашей организации. Старые
          записи сохранены — включите журнал в настройках, чтобы продолжить
          их редактирование.
        </p>
        <a
          href="/settings/journals"
          className="inline-flex h-11 items-center gap-2 rounded-2xl bg-[#5566f6] px-5 text-[15px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors hover:bg-[#4a5bf0]"
        >
          Открыть настройки набора журналов
        </a>
      </div>
    );
  }

  // «Периодичность контроля» — общий для всех 13 обязательных журналов текст
  // второй строки бумажной шапки. Читается из config документа, back-compat
  // fallback — дефолт шаблона (см. src/lib/control-periodicity.ts).
  const controlPeriodicity = readControlPeriodicity(
    document.config,
    document.template.code
  );

  // «Изменения день в день»: документ ведёт автоматика ⇒ прошлые дни
  // закрыты на редактирование. Сегодняшний день считаем на СЕРВЕРЕ —
  // в рендере клиента `new Date()` запрещён (react-hooks/purity).
  const automationLocked =
    document.autoFill === true &&
    isJournalAutomationEnabled(organization, document.template.code);
  // Дата считается в зоне организации, а не в UTC процесса: иначе до
  // 03:00 МСК «сегодня» на сервере — вчерашний день (см. orgTodayKey).
  const todayKey = orgTodayKey(organization?.timezone);

  if (document.template.code === "hygiene") {
    return (
      <HygieneDocumentClient
        documentId={document.id}
        controlPeriodicity={controlPeriodicity}
        routeCode={code}
        title={document.title}
        organizationName={organizationName}
        dateFrom={toDateKey(document.dateFrom)}
        dateTo={toDateKey(document.dateTo)}
        responsibleTitle={document.responsibleTitle}
        responsibleUserId={document.responsibleUserId}
        responsibleName={null}
        status={document.status}
        autoFill={document.autoFill}
        employees={enrichedEmployees}
        inactiveEmployees={inactiveEmployees}
        initialEntries={document.entries.map((entry) => ({
          employeeId: entry.employeeId,
          date: toDateKey(entry.date),
          data: normalizeHygieneEntryData(entry.data),
        }))}
        useV2={organization?.experimentalUiV2 ?? true}
        pastDaysLocked={automationLocked}
        todayKey={todayKey}
        viewer={{
          id: session.user.id,
          role: session.user.role,
          isRoot: session.user.isRoot === true,
        }}
      />
    );
  }

  if (document.template.code === "health_check") {
    return (
      <HealthDocumentClient
        documentId={document.id}
        controlPeriodicity={controlPeriodicity}
        title={document.title}
        organizationName={organizationName}
        dateFrom={toDateKey(document.dateFrom)}
        dateTo={toDateKey(document.dateTo)}
        responsibleTitle={document.responsibleTitle}
        responsibleUserId={document.responsibleUserId}
        status={document.status}
        autoFill={document.autoFill}
        employees={enrichedEmployees}
        inactiveEmployees={inactiveEmployees}
        printEmptyRows={
          document.config &&
          typeof document.config === "object" &&
          !Array.isArray(document.config) &&
          typeof (document.config as { printEmptyRows?: unknown }).printEmptyRows === "number"
            ? Math.max(0, (document.config as { printEmptyRows: number }).printEmptyRows)
            : 0
        }
        initialEntries={document.entries.map((entry) => ({
          employeeId: entry.employeeId,
          date: toDateKey(entry.date),
          data: normalizeHealthEntryData(entry.data),
        }))}
        useV2={organization?.experimentalUiV2 ?? true}
        // «Сегодня» и права — с сервера, как у гигиены: без них журнал
        // здоровья нельзя было заполнить вообще.
        todayKey={todayKey}
        pastDaysLocked={automationLocked}
        viewer={{
          id: session.user.id,
          role: session.user.role,
          isRoot: session.user.isRoot === true,
        }}
      />
    );
  }

  if (isScanOnlyDocumentTemplate(document.template.code)) {
    const pageCount = await getScanJournalPageCount(resolvedCode);
    if (pageCount === 0) {
      notFound();
    }

    const requestedPage = Number(query.page || "1");
    const currentPage = Number.isFinite(requestedPage) ? Math.max(1, requestedPage) : 1;
    const safePage = Math.min(currentPage, pageCount);

    return (
      <ScanJournalDocumentClient
        templateCode={resolvedCode}
        templateName={document.title || document.template.name}
        documentId={document.id}
        pageCount={pageCount}
        currentPage={safePage}
      />
    );
  }

  if (document.template.code === EQUIPMENT_CLEANING_TEMPLATE_CODE) {
    return (
      <EquipmentCleaningDocumentClient
        documentId={document.id}
        routeCode={code}
        title={document.title}
        templateCode={resolvedCode}
        organizationName={organizationName}
        status={document.status as "active" | "closed"}
        dateFrom={toDateKey(document.dateFrom)}
        config={normalizeEquipmentCleaningConfig(document.config)}
        users={enrichedEmployees}
        equipmentOptions={equipment.map((item) => item.name)}
        equipmentDirectory={equipment}
        initialRows={document.entries.map((entry) => ({
          id: entry.id,
          data: normalizeEquipmentCleaningRowData(entry.data),
        }))}
        useV2={organization?.experimentalUiV2 ?? true}
      />
    );
  }

  if (document.template.code === MED_BOOK_TEMPLATE_CODE) {
    const medConfig = normalizeMedBookConfig(document.config);

    const rowMap = new Map<
      string,
      { id: string; employeeId: string; data: ReturnType<typeof normalizeMedBookEntryData> }
    >();
    for (const entry of document.entries) {
      rowMap.set(entry.employeeId, {
        id: entry.id,
        employeeId: entry.employeeId,
        data: normalizeMedBookEntryData(entry.data),
      });
    }

    const medRows = Array.from(rowMap.values()).map((entry) => {
      // Ищем в displayEmployees: у уволенного сотрудника вместо ФИО
      // в журнале появлялось слово «Сотрудник».
      const emp = displayEmployees.find((e) => e.id === entry.employeeId);
      return {
        id: entry.id,
        employeeId: entry.employeeId,
        name: emp?.name || "Сотрудник",
        data: entry.data,
      };
    });

    return (
      <MedBookDocumentClient
        documentId={document.id}
        controlPeriodicity={controlPeriodicity}
        title={document.title}
        templateCode={code}
        organizationName={organizationName}
        status={document.status}
        config={medConfig}
        employees={enrichedEmployees}
        initialRows={medRows}
        documentDateKey={toDateKey(document.dateFrom)}
        useV2={organization?.experimentalUiV2 ?? true}
      />
    );
  }

  if (document.template.code === PERISHABLE_REJECTION_TEMPLATE_CODE) {
    return (
      <PerishableRejectionDocumentClient
        documentId={document.id}
        controlPeriodicity={controlPeriodicity}
        title={document.title}
        organizationName={organizationName}
        dateFrom={toDateKey(document.dateFrom)}
        status={document.status}
        initialConfig={normalizePerishableRejectionConfig(document.config)}
        users={enrichedEmployees}
        responsibleUserId={document.responsibleUserId}
      />
    );
  }

  if (document.template.code === PRODUCT_WRITEOFF_TEMPLATE_CODE) {
    return (
      <ProductWriteoffDocumentClient
        documentId={document.id}
        title={document.title}
        organizationName={organizationName}
        dateFrom={toDateKey(document.dateFrom)}
        status={document.status}
        initialConfig={normalizeProductWriteoffConfig(document.config)}
        users={enrichedEmployees}
        useV2={organization?.experimentalUiV2 ?? true}
      />
    );
  }

  if (document.template.code === GLASS_LIST_TEMPLATE_CODE) {
    return (
      <GlassListDocumentClient
        documentId={document.id}
        title={document.title}
        organizationName={organizationName}
        status={document.status}
        initialConfig={normalizeGlassListConfig(document.config)}
        users={enrichedEmployees}
        useV2={organization?.experimentalUiV2 ?? true}
      />
    );
  }

  if (document.template.code === GLASS_CONTROL_TEMPLATE_CODE) {
    return (
      <GlassControlDocumentClient
        documentId={document.id}
        routeCode={code}
        title={document.title}
        organizationName={organizationName}
        dateFrom={toDateKey(document.dateFrom)}
        dateTo={toDateKey(document.dateTo)}
        responsibleTitle={document.responsibleTitle}
        responsibleUserId={document.responsibleUserId}
        status={document.status}
        autoFill={document.autoFill}
        users={enrichedEmployees}
        config={normalizeGlassControlConfig(document.config)}
        initialEntries={document.entries.map((entry) => ({
          id: entry.id,
          employeeId: entry.employeeId,
          date: toDateKey(entry.date),
          data: normalizeGlassControlEntryData(entry.data),
        }))}
        itemSuggestions={equipment.map((item) => item.name)}
        useV2={organization?.experimentalUiV2 ?? true}
      />
    );
  }

  if (document.template.code === STAFF_TRAINING_TEMPLATE_CODE) {
    return (
      <StaffTrainingDocumentClient
        documentId={document.id}
        title={document.title}
        organizationName={organizationName}
        dateFrom={toDateKey(document.dateFrom)}
        status={document.status}
        initialConfig={normalizeStaffTrainingConfig(document.config)}
        users={enrichedEmployees}
        useV2={organization?.experimentalUiV2 ?? true}
      />
    );
  }

  if (document.template.code === EQUIPMENT_MAINTENANCE_TEMPLATE_CODE) {
    return (
      <EquipmentMaintenanceDocumentClient
        documentId={document.id}
        title={document.title}
        organizationName={organizationName}
        dateFrom={toDateKey(document.dateFrom)}
        status={document.status}
        initialConfig={normalizeEquipmentMaintenanceConfig(document.config)}
        users={enrichedEmployees}
        equipmentDirectory={equipment}
        useV2={organization?.experimentalUiV2 ?? true}
      />
    );
  }

  if (document.template.code === EQUIPMENT_CALIBRATION_TEMPLATE_CODE) {
    return (
      <EquipmentCalibrationDocumentClient
        documentId={document.id}
        title={document.title}
        organizationName={organizationName}
        dateFrom={toDateKey(document.dateFrom)}
        status={document.status}
        initialConfig={normalizeEquipmentCalibrationConfig(document.config)}
        users={enrichedEmployees}
        equipmentDirectory={equipment}
        useV2={organization?.experimentalUiV2 ?? true}
      />
    );
  }

  if (document.template.code === TRACEABILITY_DOCUMENT_TEMPLATE_CODE) {
    return (
      <TraceabilityDocumentClient
        documentId={document.id}
        title={document.title}
        routeCode={code}
        organizationName={organizationName}
        dateFrom={toDateKey(document.dateFrom)}
        status={document.status}
        initialConfig={normalizeTraceabilityDocumentConfig(document.config)}
        users={enrichedEmployees}
        useV2={organization?.experimentalUiV2 ?? true}
      />
    );
  }

  if (document.template.code === COMPLAINT_REGISTER_TEMPLATE_CODE) {
    return (
      <ComplaintDocumentClient
        documentId={document.id}
        title={document.title}
        organizationName={organizationName}
        dateFrom={toDateKey(document.dateFrom)}
        status={document.status}
        initialConfig={normalizeComplaintConfig(document.config)}
        users={enrichedEmployees}
        useV2={organization?.experimentalUiV2 ?? true}
      />
    );
  }

  if (document.template.code === COLD_EQUIPMENT_DOCUMENT_TEMPLATE_CODE) {
    return (
      // «Сегодня» — из пояса организации, а не из часов устройства:
      // иначе сервер отвергал заполнение с «только сегодняшний день».
      <TodayKeyProvider value={todayKey}>
      <ColdEquipmentDocumentClient
        documentId={document.id}
        controlPeriodicity={controlPeriodicity}
        title={document.title}
        organizationName={organizationName}
        dateFrom={toDateKey(document.dateFrom)}
        dateTo={toDateKey(document.dateTo)}
        responsibleTitle={document.responsibleTitle}
        responsibleUserId={document.responsibleUserId}
        status={document.status}
        autoFill={document.autoFill}
        employees={enrichedEmployees}
        config={normalizeColdEquipmentDocumentConfig(document.config)}
        initialEntries={document.entries.map((entry) => ({
          id: entry.id,
          employeeId: entry.employeeId,
          date: toDateKey(entry.date),
          data: normalizeColdEquipmentEntryData(entry.data),
        }))}
        useV2={organization?.experimentalUiV2 ?? true}
        viewer={{
          id: session.user.id,
          role: session.user.role,
          isRoot: session.user.isRoot === true,
        }}
      />
      </TodayKeyProvider>
    );
  }

  if (document.template.code === SANITATION_DAY_TEMPLATE_CODE) {
    // 2026-09-04: единый справочник помещений — строки графика связаны с
    // Room; карточка помещения открывается прямо из журнала.
    const directoryBuildings = await loadDirectoryBuildings(getActiveOrgId(session));
    return (
      <SanitationDayDocumentClient
        documentId={document.id}
        controlPeriodicity={controlPeriodicity}
        title={document.title}
        organizationName={organizationName}
        status={document.status}
        users={enrichedEmployees}
        buildings={directoryBuildings}
        config={document.config}
        useV2={organization?.experimentalUiV2 ?? true}
      />
    );
  }

  if (document.template.code === DISINFECTANT_TEMPLATE_CODE) {
    return (
      <DisinfectantDocumentClient
        documentId={document.id}
        title={document.title}
        organizationName={organizationName}
        status={document.status}
        users={enrichedEmployees}
        config={document.config}
        useV2={organization?.experimentalUiV2 ?? true}
      />
    );
  }

  if (document.template.code === TRAINING_PLAN_TEMPLATE_CODE) {
    return (
      <TrainingPlanDocumentClient
        documentId={document.id}
        title={document.title}
        organizationName={organizationName}
        status={document.status}
        users={enrichedEmployees}
        config={document.config}
        useV2={organization?.experimentalUiV2 ?? true}
      />
    );
  }

  if (document.template.code === AUDIT_PLAN_TEMPLATE_CODE) {
    return (
      <AuditPlanDocumentClient
        documentId={document.id}
        title={document.title}
        organizationName={organizationName}
        status={document.status}
        users={enrichedEmployees}
        config={normalizeAuditPlanConfig(document.config, {
          organizationName: organization?.name || ORG_NAME_FALLBACK,
          users: enrichedEmployees,
        })}
        useV2={organization?.experimentalUiV2 ?? true}
      />
    );
  }

  if (document.template.code === AUDIT_PROTOCOL_TEMPLATE_CODE) {
    // Планы аудитов организации — источник для «Заполнить из плана».
    // Связь односторонняя: требования копируются, протокол потом живёт
    // сам по себе (см. fillAuditProtocolFromPlan).
    const planDocuments = await db.journalDocument.findMany({
      where: {
        organizationId: getActiveOrgId(session),
        template: { code: AUDIT_PLAN_TEMPLATE_CODE },
      },
      select: { id: true, title: true, config: true, dateFrom: true },
      orderBy: { dateFrom: "desc" },
      take: 30,
    });
    const planSources: AuditProtocolPlanSource[] = planDocuments.map((plan) => {
      const planConfig = normalizeAuditPlanConfig(plan.config, {
        organizationName: organization?.name || ORG_NAME_FALLBACK,
        users: enrichedEmployees,
      });
      return {
        documentId: plan.id,
        title: plan.title || AUDIT_PLAN_DOCUMENT_TITLE,
        sections: planConfig.sections.map((section) => ({
          id: section.id,
          title: section.title,
        })),
        rows: planConfig.rows.map((row) => ({
          id: row.id,
          sectionId: row.sectionId,
          text: row.text,
        })),
      };
    });

    return (
      <AuditProtocolDocumentClient
        documentId={document.id}
        title={document.title}
        organizationName={organizationName}
        status={document.status}
        config={normalizeAuditProtocolConfig(document.config)}
        planSources={planSources}
        useV2={organization?.experimentalUiV2 ?? true}
      />
    );
  }

  if (document.template.code === AUDIT_REPORT_TEMPLATE_CODE) {
    // Протоколы аудита организации — источник для «Перенести
    // несоответствия». В список попадают только строки с «Нет».
    const protocolDocuments = await db.journalDocument.findMany({
      where: {
        organizationId: getActiveOrgId(session),
        template: { code: AUDIT_PROTOCOL_TEMPLATE_CODE },
      },
      select: { id: true, title: true, config: true, dateFrom: true },
      orderBy: { dateFrom: "desc" },
      take: 30,
    });
    const protocolSources: AuditReportProtocolSource[] = protocolDocuments.map(
      (protocol) => {
        const protocolConfig = normalizeAuditProtocolConfig(protocol.config);
        return {
          documentId: protocol.id,
          title: protocol.title || AUDIT_PROTOCOL_DOCUMENT_TITLE,
          rows: protocolConfig.rows
            .filter((row) => row.result === "no")
            .map((row) => ({ id: row.id, text: row.text, note: row.note })),
        };
      }
    );

    return (
      <AuditReportDocumentClient
        documentId={document.id}
        title={document.title}
        organizationName={organizationName}
        status={document.status}
        config={normalizeAuditReportConfig(document.config)}
        protocolSources={protocolSources}
        useV2={organization?.experimentalUiV2 ?? true}
      />
    );
  }

  if (document.template.code === METAL_IMPURITY_TEMPLATE_CODE) {
    return (
      <MetalImpurityDocumentClient
        documentId={document.id}
        title={document.title}
        organizationName={organizationName}
        status={document.status}
        config={normalizeMetalImpurityConfig(document.config)}
        users={enrichedEmployees}
        useV2={organization?.experimentalUiV2 ?? true}
      />
    );
  }

  if (document.template.code === BREAKDOWN_HISTORY_TEMPLATE_CODE) {
    return (
      <BreakdownHistoryDocumentClient
        documentId={document.id}
        title={document.title}
        organizationName={organizationName}
        dateFrom={toDateKey(document.dateFrom)}
        status={document.status}
        config={document.config}
        equipmentDirectory={equipment}
        useV2={organization?.experimentalUiV2 ?? true}
      />
    );
  }

  if (document.template.code === ACCIDENT_DOCUMENT_TEMPLATE_CODE) {
    return (
      <AccidentDocumentClient
        documentId={document.id}
        title={document.title}
        organizationName={organizationName}
        dateFrom={toDateKey(document.dateFrom)}
        status={document.status}
        config={document.config}
        useV2={organization?.experimentalUiV2 ?? true}
      />
    );
  }

  if (document.template.code === INTENSIVE_COOLING_TEMPLATE_CODE) {
    return (
      <IntensiveCoolingDocumentClient
        routeCode={code}
        documentId={document.id}
        title={document.title || INTENSIVE_COOLING_DEFAULT_DOCUMENT_NAME}
        organizationName={organizationName}
        dateFrom={toDateKey(document.dateFrom)}
        dateTo={toDateKey(document.dateTo)}
        status={document.status}
        config={document.config}
        users={enrichedEmployees}
        useV2={organization?.experimentalUiV2 ?? true}
      />
    );
  }

  if (isAcceptanceDocumentTemplate(document.template.code)) {
    return (
      <AcceptanceDocumentClient
        documentId={document.id}
        controlPeriodicity={controlPeriodicity}
        routeCode={code}
        title={document.title}
        organizationName={organizationName}
        dateFrom={toDateKey(document.dateFrom)}
        dateTo={toDateKey(document.dateTo)}
        status={document.status}
        users={enrichedEmployees}
        config={normalizeAcceptanceDocumentConfig(document.config, enrichedEmployees)}
        useV2={organization?.experimentalUiV2 ?? true}
      />
    );
  }

  if (document.template.code === PPE_ISSUANCE_TEMPLATE_CODE) {
    return (
      <PpeIssuanceDocumentClient
        documentId={document.id}
        title={document.title || "Журнал учета выдачи СИЗ"}
        organizationName={organizationName}
        dateFrom={toDateKey(document.dateFrom)}
        status={document.status}
        users={enrichedEmployees}
        config={normalizePpeIssuanceConfig(document.config, enrichedEmployees)}
        useV2={organization?.experimentalUiV2 ?? true}
      />
    );
  }

  if (
    isTrackedDocumentTemplate(document.template.code) &&
    !isRegisterDocumentTemplate(document.template.code)
  ) {
    if (document.template.code === FRYER_OIL_TEMPLATE_CODE) {
      const fryerConfig = normalizeFryerOilDocumentConfig(document.config);
      return (
        // «Сегодня» — из пояса организации (см. TodayKeyProvider).
        <TodayKeyProvider value={todayKey}>
        <FryerOilDocumentClient
          documentId={document.id}
          currentUserId={session.user.id}
          controlPeriodicity={controlPeriodicity}
          title={document.title || "Журнал учета использования фритюрных жиров"}
          organizationName={organizationName}
          status={document.status}
          dateFrom={toIsoDate(document.dateFrom)}
          dateTo={toIsoDate(document.dateTo)}
          config={fryerConfig}
          users={enrichedEmployees}
          initialEntries={document.entries.map((entry) => ({
            id: entry.id,
            date: toIsoDate(entry.date),
            data: normalizeFryerOilEntryData(entry.data),
          }))}
          routeCode={code}
          useV2={organization?.experimentalUiV2 ?? true}
        />
        </TodayKeyProvider>
      );
    }

    if (document.template.code === UV_LAMP_RUNTIME_TEMPLATE_CODE) {
      const uvConfig = normalizeUvRuntimeDocumentConfig(document.config);
      return (
        <UvLampRuntimeDocumentClient
          key={`${document.id}:${document.updatedAt.toISOString()}:${document.entries.length}:${document.status}:${document.dateFrom.toISOString()}:${document.dateTo.toISOString()}`}
          documentId={document.id}
          controlPeriodicity={controlPeriodicity}
          routeCode={code}
          title={buildUvRuntimeDocumentTitle(uvConfig)}
          organizationName={organizationName}
          status={document.status}
          dateFrom={toIsoDate(document.dateFrom)}
          dateTo={toIsoDate(document.dateTo)}
          responsibleTitle={document.responsibleTitle}
          responsibleUserId={document.responsibleUserId}
          users={enrichedEmployees}
          config={uvConfig}
          initialEntries={document.entries.map((entry) => ({
            id: entry.id,
            employeeId: entry.employeeId,
            date: toIsoDate(entry.date),
            data: ((entry.data as Record<string, unknown>) || {}) as Record<string, unknown>,
          }))}
          useV2={organization?.experimentalUiV2 ?? true}
        />
      );
    }

    if (document.template.code === CLEANING_VENTILATION_CHECKLIST_TEMPLATE_CODE) {
      return (
        <CleaningVentilationChecklistDocumentClient
          documentId={document.id}
          controlPeriodicity={controlPeriodicity}
          title={document.title || CLEANING_VENTILATION_CHECKLIST_TITLE}
          organizationName={organizationName}
          status={document.status}
          dateFrom={toIsoDate(document.dateFrom)}
          users={enrichedEmployees}
          config={normalizeCleaningVentilationConfig(document.config, enrichedEmployees)}
          initialEntries={document.entries.map((entry) => ({
            id: entry.id,
            date: toIsoDate(entry.date),
            data: normalizeCleaningVentilationEntryData(entry.data),
          }))}
          routeCode={code}
          useV2={organization?.experimentalUiV2 ?? true}
        />
      );
    }

    if (isSanitaryDayChecklistTemplate(document.template.code)) {
      return (
        <SanitaryDayChecklistDocumentClient
          documentId={document.id}
          title={document.title || "Чек-лист"}
          organizationName={organizationName}
          status={document.status}
          dateFrom={toIsoDate(document.dateFrom)}
          users={enrichedEmployees}
          responsibleUserId={document.responsibleUserId}
          config={normalizeSdcConfig(document.config)}
          initialEntries={document.entries.map((entry) => ({
            id: entry.id,
            date: toIsoDate(entry.date),
            data: normalizeSdcEntryData(entry.data),
          }))}
          routeCode={code}
          useV2={organization?.experimentalUiV2 ?? true}
        />
      );
    }

    const fields = Array.isArray(document.template.fields)
      ? (document.template.fields as Array<Record<string, unknown>>)
          .map((field): TrackedField | null => {
            const key = typeof field.key === "string" ? field.key : "";
            if (!key) return null;

            const type = typeof field.type === "string" ? field.type : "text";
            const options =
              type === "employee"
                ? enrichedEmployees.map((employee) => ({
                    value: employee.name,
                    label: employee.name,
                  }))
                : type === "equipment"
                  ? equipment.map((item) => ({
                      value: item.name,
                      label: item.name,
                    }))
                  : Array.isArray(field.options)
                    ? (field.options as Array<Record<string, unknown>>)
                        .map((option) => ({
                          value: typeof option.value === "string" ? option.value : "",
                          label: typeof option.label === "string" ? option.label : "",
                        }))
                        .filter((option) => option.value !== "")
                    : [];

            return {
              key,
              label: typeof field.label === "string" ? field.label : "",
              type,
              options,
            };
          })
          .filter((field): field is TrackedField => field !== null)
      : [];

    return (
      <TrackedDocumentClient
        templateCode={document.template.code}
        documentId={document.id}
        title={document.title}
        organizationName={organizationName}
        dateFrom={toDateKey(document.dateFrom)}
        dateTo={toDateKey(document.dateTo)}
        responsibleTitle={document.responsibleTitle}
        responsibleUserId={document.responsibleUserId}
        status={document.status}
        employees={enrichedEmployees}
        fields={fields}
        initialEntries={document.entries.map((entry) => ({
          id: entry.id,
          employeeId: entry.employeeId,
          date: toDateKey(entry.date),
          data: ((entry.data as Record<string, unknown>) || {}) as Record<string, unknown>,
        }))}
        useV2={organization?.experimentalUiV2 ?? true}
      />
    );
  }

  if (document.template.code === CLIMATE_DOCUMENT_TEMPLATE_CODE) {
    // 2026-09-04: единый справочник помещений — строки климата связаны с
    // Room (нормы и имя из карточки помещения).
    const directoryBuildings = await loadDirectoryBuildings(getActiveOrgId(session));
    return (
      // «Сегодня» — из пояса организации (см. TodayKeyProvider).
      <TodayKeyProvider value={todayKey}>
      <ClimateDocumentClient
        documentId={document.id}
        controlPeriodicity={controlPeriodicity}
        title={document.title}
        organizationName={organizationName}
        dateFrom={toDateKey(document.dateFrom)}
        dateTo={toDateKey(document.dateTo)}
        responsibleTitle={document.responsibleTitle}
        responsibleUserId={document.responsibleUserId}
        status={document.status}
        autoFill={document.autoFill}
        employees={enrichedEmployees}
        buildings={directoryBuildings}
        config={normalizeClimateDocumentConfig(document.config)}
        initialEntries={document.entries.map((entry) => ({
          id: entry.id,
          employeeId: entry.employeeId,
          date: toDateKey(entry.date),
          data: normalizeClimateEntryData(entry.data),
        }))}
        useV2={organization?.experimentalUiV2 ?? true}
        viewer={{
          id: session.user.id,
          role: session.user.role,
          isRoot: session.user.isRoot === true,
        }}
      />
      </TodayKeyProvider>
    );
  }

  if (document.template.code === CLEANING_DOCUMENT_TEMPLATE_CODE) {
    const buildings = await db.building.findMany({
      where: { organizationId: getActiveOrgId(session) },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      include: {
        rooms: {
          orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
          select: {
            id: true,
            name: true,
            kind: true,
            // Cleaning unification: scope/days/detergent теперь живут на Room
            // (см. docs/superpowers/specs/2026-05-08-cleaning-unification.md).
            detergent: true,
            currentScope: true,
            generalScope: true,
            currentDays: true,
            generalDays: true,
            currentScheduleType: true,
            generalScheduleType: true,
            currentMonthDays: true,
            generalMonthDays: true,
            requirePhoto: true,
            // 2026-09-04: кто убирает / кто проверяет помещение.
            cleanerUserIds: true,
            verifierUserIds: true,
          },
        },
      },
    });
    return (
      <CleaningDocumentClient
        documentId={document.id}
        controlPeriodicity={controlPeriodicity}
        title={document.title}
        organizationName={organizationName}
        dateFrom={toDateKey(document.dateFrom)}
        dateTo={toDateKey(document.dateTo)}
        responsibleTitle={document.responsibleTitle}
        responsibleUserId={document.responsibleUserId}
        status={document.status}
        autoFill={document.autoFill}
        users={enrichedEmployees}
        buildings={buildings.map((b) => ({
          id: b.id,
          name: b.name,
          rooms: b.rooms.map((r) => ({
            id: r.id,
            name: r.name,
            kind: r.kind,
            detergent: r.detergent ?? "",
            currentScope: Array.isArray(r.currentScope)
              ? (r.currentScope as string[]).filter(
                  (s) => typeof s === "string",
                )
              : [],
            generalScope: Array.isArray(r.generalScope)
              ? (r.generalScope as string[]).filter(
                  (s) => typeof s === "string",
                )
              : [],
            currentDays: r.currentDays,
            generalDays: r.generalDays,
            currentScheduleType:
              r.currentScheduleType === "monthly" ? "monthly" : "weekly",
            generalScheduleType:
              r.generalScheduleType === "monthly" ? "monthly" : "weekly",
            currentMonthDays: Array.isArray(r.currentMonthDays)
              ? (r.currentMonthDays as string[]).filter(
                  (s) => typeof s === "string",
                )
              : [],
            generalMonthDays: Array.isArray(r.generalMonthDays)
              ? (r.generalMonthDays as string[]).filter(
                  (s) => typeof s === "string",
                )
              : [],
            requirePhoto: r.requirePhoto === true,
            cleanerUserIds: r.cleanerUserIds,
            verifierUserIds: r.verifierUserIds,
          })),
        }))}
        config={normalizeCleaningDocumentConfig(document.config)}
        initialEntries={document.entries.map((entry) => ({
          id: entry.id,
          employeeId: entry.employeeId,
          date: toDateKey(entry.date),
          data: normalizeCleaningEntryData(entry.data),
        }))}
        hasTasksFlowIntegration={hasTasksFlowIntegration}
        useV2={organization?.experimentalUiV2 ?? true}
      />
    );
  }

  if (document.template.code === FINISHED_PRODUCT_DOCUMENT_TEMPLATE_CODE) {
    return (
      <FinishedProductDocumentClient
        documentId={document.id}
        controlPeriodicity={controlPeriodicity}
        title={document.title}
        organizationName={organizationName}
        dateFrom={toDateKey(document.dateFrom)}
        dateTo={toDateKey(document.dateTo)}
        status={document.status}
        initialConfig={normalizeFinishedProductDocumentConfig(document.config)}
        users={employees}
        responsibleUserId={document.responsibleUserId}
        verifierUserId={document.verifierUserId}
        useV2={organization?.experimentalUiV2 ?? true}
      />
    );
  }

  notFound();
}
