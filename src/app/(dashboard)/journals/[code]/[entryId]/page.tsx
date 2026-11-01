import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { User, MapPin, Wrench, Clock, Wifi, CheckCircle2, XCircle } from "lucide-react";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { resolveJournalDisplayName } from "@/lib/org-custom-names";
import { db } from "@/lib/db";
import { Badge } from "@/components/ui/badge";
import { EntryApprovalActions } from "@/components/journals/entry-approval";
import { resolveJournalCodeAlias } from "@/lib/source-journal-map";
import { PageHeader } from "@/components/ui/page-header";
import { JournalPageCrumbs } from "@/components/journals/journal-breadcrumbs";
import { getJournalCrumbMenu } from "@/lib/journal-crumb-menu";
import { getCrumbOrganizationName } from "@/lib/crumb-organization";
import { canSeeDocumentPoint, journalEntryPointId } from "@/lib/document-point-access";

function formatValue(
  value: unknown,
  labels: { yes: string; no: string; dateLocale: string }
): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? labels.yes : labels.no;
  if (typeof value === "number") return String(value);
  if (typeof value === "string") {
    // Try to detect date strings
    if (/^\d{4}-\d{2}-\d{2}/.test(value)) {
      try {
        return new Date(value).toLocaleDateString(labels.dateLocale);
      } catch {
        return value;
      }
    }
    return value;
  }
  return JSON.stringify(value);
}

function StatusBadge({
  status,
  labels,
}: {
  status: string;
  labels: { draft: string; submitted: string; approved: string };
}) {
  switch (status) {
    case "draft":
      return <Badge variant="outline" className="text-sm">{labels.draft}</Badge>;
    case "submitted":
      return <Badge variant="secondary" className="text-sm">{labels.submitted}</Badge>;
    case "approved":
      return <Badge className="bg-green-600 text-sm">{labels.approved}</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

export default async function EntryDetailPage({
  params,
}: {
  params: Promise<{ code: string; entryId: string }>;
}) {
  const { code, entryId } = await params;
  const t = await getTranslations("journalUi.entryDetail");
  const common = await getTranslations("common");
  const locale = await getLocale();
  const dateLocale = locale === "en" ? "en-GB" : locale === "uz" ? "uz-UZ" : "ru-RU";
  // Labels for known field keys
  const fieldLabels: Record<string, string> = {
    temperature: t("fields.temperature"),
    humidity: t("fields.humidity"),
    productName: t("fields.productName"),
    supplier: t("fields.supplier"),
    quantity: t("fields.quantity"),
    unit: t("fields.unit"),
    manufactureDate: t("fields.manufactureDate"),
    expiryDate: t("fields.expiryDate"),
    decision: t("fields.decision"),
    temperatureOnArrival: t("fields.temperatureOnArrival"),
    packagingCondition: t("fields.packagingCondition"),
    batchNumber: t("fields.batchNumber"),
    appearance: t("fields.appearance"),
    taste: t("fields.taste"),
    smell: t("fields.smell"),
    consistency: t("fields.consistency"),
    servingTemperature: t("fields.servingTemperature"),
    employeeName: t("fields.employeeName"),
    noSkinDiseases: t("fields.noSkinDiseases"),
    noRespiratorySymptoms: t("fields.noRespiratorySymptoms"),
    noGastrointestinalIssues: t("fields.noGastrointestinalIssues"),
    cleanUniform: t("fields.cleanUniform"),
    admittedToWork: t("fields.admittedToWork"),
    ccpName: t("fields.ccpName"),
    parameter: t("fields.parameter"),
    criticalLimit: t("fields.criticalLimit"),
    measuredValue: t("fields.measuredValue"),
    withinLimits: t("fields.withinLimits"),
    correctiveAction: t("fields.correctiveAction"),
    source: t("fields.source"),
    reason: t("fields.reason"),
    disposalMethod: t("fields.disposalMethod"),
    targetTemp: t("fields.targetTemp"),
    actualTemp: t("fields.actualTemp"),
    coreTemp: t("fields.coreTemp"),
    duration: t("fields.duration"),
    detergent: t("fields.detergent"),
    concentration: t("fields.concentration"),
    exposureTime: t("fields.exposureTime"),
    vehicleTemp: t("fields.vehicleTemp"),
    vehicleCondition: t("fields.vehicleCondition"),
    nextCalibrationDate: t("fields.nextCalibrationDate"),
    notes: t("fields.notes"),
    ocrUsed: t("fields.ocrUsed"),
    ocrConfidence: t("fields.ocrConfidence"),
    barcode: t("fields.barcode"),
    storageTemp: t("fields.storageTemp"),
    composition: t("fields.composition"),
  };
  const resolvedCode = resolveJournalCodeAlias(code);
  const session = await requireAuth();

  const entry = await db.journalEntry.findUnique({
    where: { id: entryId },
    include: {
      template: true,
      filledBy: { select: { name: true } },
      area: { select: { name: true, buildingId: true } },
      equipment: { select: { name: true, area: { select: { buildingId: true } } } },
    },
  });

  if (
    !entry ||
    entry.organizationId !== getActiveOrgId(session) ||
    // Запись цеха / оборудования чужой точки — «не найдена» (2026-11-01).
    !(await canSeeDocumentPoint(session, journalEntryPointId(entry)))
  ) {
    notFound();
  }

  const data = (entry.data && typeof entry.data === "object" && !Array.isArray(entry.data))
    ? (entry.data as Record<string, unknown>)
    : {};

  const source = data.source as string | undefined;
  const isIoT = source === "tuya_auto" || source === "tuya_sensor";

  // Filter out internal fields
  const displayFields = Object.entries(data).filter(
    ([key]) => !["ocrUsed", "ocrConfidence", "source"].includes(key)
  );

  // Рукописная ссылка «← К журналу» убрана: наверх ведут крошки, назад —
  // общая кнопка из layout'а раздела.
  const [crumbOrganizationName, journalMenu] = await Promise.all([
    getCrumbOrganizationName(getActiveOrgId(session)),
    getJournalCrumbMenu(session, resolvedCode),
  ]);

  return (
    <div className="space-y-5">
      <JournalPageCrumbs
        organizationName={crumbOrganizationName}
        journalName={entry.template.name}
        journalCode={resolvedCode}
        journalMenu={journalMenu}
        tail={[
          {
            label: t("entryFrom", {
              date: entry.createdAt.toLocaleDateString(dateLocale),
            }),
          },
        ]}
      />

      {/* Тёмный hero снят: карточка записи — это данные, а не баннер. */}
      <PageHeader
        eyebrow={t("eyebrow")}
        // Своё название журнала организации (официальное — в печати).
        title={await resolveJournalDisplayName(getActiveOrgId(session), resolvedCode, entry.template.name)}
        description={t("fromDateTime", {
          datetime: entry.createdAt.toLocaleString(dateLocale),
        })}
        actions={
          <StatusBadge
            status={entry.status}
            labels={{
              draft: t("statusDraft"),
              submitted: t("statusSubmitted"),
              approved: t("statusApproved"),
            }}
          />
        }
      />

      {/* Metadata */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex items-center gap-3 rounded-2xl border border-[#ececf4] bg-white p-3 text-sm shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
          <span className="flex size-9 items-center justify-center rounded-xl bg-[#eef1ff] text-[#5566f6]">
            <User className="size-4" />
          </span>
          <div>
            <div className="text-[12px] text-[#6f7282]">{t("filledBy")}</div>
            <div className="font-medium text-[#0b1024]">{entry.filledBy.name}</div>
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-2xl border border-[#ececf4] bg-white p-3 text-sm shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
          <span className="flex size-9 items-center justify-center rounded-xl bg-[#eef1ff] text-[#5566f6]">
            <Clock className="size-4" />
          </span>
          <div>
            <div className="text-[12px] text-[#6f7282]">{t("dateTime")}</div>
            <div className="font-medium text-[#0b1024]">
              {entry.createdAt.toLocaleString(dateLocale, {
                day: "2-digit", month: "2-digit", year: "numeric",
                hour: "2-digit", minute: "2-digit",
              })}
            </div>
          </div>
        </div>
        {entry.area && (
          <div className="flex items-center gap-3 rounded-2xl border border-[#ececf4] bg-white p-3 text-sm shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
            <span className="flex size-9 items-center justify-center rounded-xl bg-[#eef1ff] text-[#5566f6]">
              <MapPin className="size-4" />
            </span>
            <div>
              <div className="text-[12px] text-[#6f7282]">{t("area")}</div>
              <div className="font-medium text-[#0b1024]">{entry.area.name}</div>
            </div>
          </div>
        )}
        {entry.equipment && (
          <div className="flex items-center gap-3 rounded-2xl border border-[#ececf4] bg-white p-3 text-sm shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
            <span className="flex size-9 items-center justify-center rounded-xl bg-[#eef1ff] text-[#5566f6]">
              <Wrench className="size-4" />
            </span>
            <div>
              <div className="text-[12px] text-[#6f7282]">{t("equipment")}</div>
              <div className="font-medium text-[#0b1024]">{entry.equipment.name}</div>
            </div>
          </div>
        )}
      </div>

      {/* Data source indicator */}
      {isIoT && (
        <div className="flex items-center gap-2 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
          <Wifi className="size-4" />
          <span>
            {t("iotNote", {
              mode: source === "tuya_auto" ? t("iotAuto") : t("iotManual"),
            })}
          </span>
        </div>
      )}

      {/* Entry data */}
      <div className="rounded-3xl border border-[#ececf4] bg-white p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] md:p-7">
        <div className="mb-4 text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
          {t("entryData")}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {displayFields.map(([key, value]) => (
            <div
              key={key}
              className="rounded-2xl border border-[#ececf4] bg-[#fafbff] px-4 py-3"
            >
              <div className="text-[12px] text-[#6f7282]">
                {fieldLabels[key] || key}
              </div>
              <div className="mt-1 flex items-center gap-1.5 text-[14px] font-medium text-[#0b1024]">
                {typeof value === "boolean" ? (
                  value ? (
                    <>
                      <CheckCircle2 className="size-4 text-[#116b2a]" /> {common("yes")}
                    </>
                  ) : (
                    <>
                      <XCircle className="size-4 text-[#a13a32]" /> {common("no")}
                    </>
                  )
                ) : (
                  formatValue(value, {
                    yes: common("yes"),
                    no: common("no"),
                    dateLocale,
                  })
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Approval actions */}
      <EntryApprovalActions
        entryId={entry.id}
        currentStatus={entry.status}
        userRole={session.user.role}
        journalCode={resolvedCode}
      />
    </div>
  );
}
