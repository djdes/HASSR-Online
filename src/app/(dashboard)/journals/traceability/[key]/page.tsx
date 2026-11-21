import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { Package, Clock, FileCheck2, Boxes, User as UserIcon } from "lucide-react";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { loadBuildingContext } from "@/lib/active-building";
import { batchUnitCode, isBatchStatus } from "@/components/batches/batch-presentation";
import { traceSummary, traceVsdRows } from "@/lib/batch-traceability";
import { db } from "@/lib/db";
import { pointRecordVisible } from "@/lib/point-records";
import { canAccessWebPath } from "@/lib/role-access";
import { PageHeader } from "@/components/ui/page-header";

export const dynamic = "force-dynamic";

/**
 * Просмотр истории партии (ХАССП traceability).
 *
 * URL: /journals/traceability/<batchKey>
 *
 * Показывает партию (`Batch.code`), приёмку по ВСД из Меркурия
 * (`MercuryVetDocument.batchKey`) и все JournalEntry с этим batchKey в
 * текущей организации. Записи — в хронологическом порядке: приёмка наверху,
 * списание/отпуск внизу. Партия и ВСД чужой точки не показываются — как на
 * странице партии.
 */
export default async function TraceabilityPage({
  params,
}: {
  params: Promise<{ key: string }>;
}) {
  const { key: rawKey } = await params;
  const batchKey = decodeURIComponent(rawKey).trim();
  if (!batchKey || batchKey.length > 100) notFound();

  const t = await getTranslations("journals.ui.traceabilityPage");
  const tBatches = await getTranslations("productionBatches");
  const format = await getFormatter();
  const session = await requireAuth();
  const organizationId = getActiveOrgId(session);

  const [entries, vsdRows, batchRow, buildingContext] = await Promise.all([
    db.journalEntry.findMany({
      where: {
        organizationId,
        batchKey,
      },
      select: {
        id: true,
        data: true,
        createdAt: true,
        filledBy: { select: { name: true } },
        template: { select: { code: true, name: true } },
      },
      orderBy: { createdAt: "asc" },
      take: 100,
    }),
    db.mercuryVetDocument.findMany({
      where: { organizationId, batchKey },
      select: {
        id: true,
        uuid: true,
        number: true,
        productName: true,
        volume: true,
        unit: true,
        consignorName: true,
        deliveryDate: true,
        processedAt: true,
        firstSeenAt: true,
        journalDocumentId: true,
        buildingId: true,
      },
      take: 20,
    }),
    db.batch.findUnique({
      where: { organizationId_code: { organizationId, code: batchKey } },
      select: {
        id: true,
        productName: true,
        supplier: true,
        quantity: true,
        unit: true,
        receivedAt: true,
        status: true,
        buildingId: true,
      },
    }),
    loadBuildingContext(session),
  ]);

  const visibleVsd = vsdRows.filter((row) => pointRecordVisible(buildingContext, row.buildingId));
  const batch = batchRow && pointRecordVisible(buildingContext, batchRow.buildingId) ? batchRow : null;
  // Ссылка на журнал — по коду шаблона документа своей организации.
  const journalDocIds = [...new Set(visibleVsd.map((row) => row.journalDocumentId).filter((id): id is string => Boolean(id)))];
  const journalDocs = journalDocIds.length
    ? await db.journalDocument.findMany({
        where: { organizationId, id: { in: journalDocIds } },
        select: { id: true, template: { select: { code: true } } },
      })
    : [];
  const vsd = traceVsdRows(visibleVsd, new Map(journalDocs.map((doc) => [doc.id, doc.template.code])));
  const summary = traceSummary({ entries: entries.length, vsd: vsd.length, batch: Boolean(batch) });
  // «Партии» — раздел руководства; сотруднику ссылку не показываем.
  const canOpenBatch = canAccessWebPath(session.user, "/batches");

  const unitLabel = (unit: string | null) => {
    const code = batchUnitCode(unit);
    return code ? tBatches(`units.${code}`) : (unit ?? "");
  };
  const amountLabel = (value: number | null, unit: string | null) =>
    value === null ? null : `${format.number(value, { maximumFractionDigits: 3 })} ${unitLabel(unit)}`.trim();
  const dayLabel = (date: Date) => format.dateTime(date, { day: "numeric", month: "long", year: "numeric" });
  const batchStatusLabel = (status: string) =>
    status === "rejected" ? t("batchRejected") : isBatchStatus(status) ? tBatches(`statuses.${status}`) : status;

  return (
    <div className="mx-auto max-w-3xl space-y-5 px-1 sm:space-y-6">
      {/* Тёмный hero снят: история партии — это цепочка записей, её и
          нужно видеть первой. */}
      <PageHeader
        eyebrow={t("eyebrow")}
        title={
          <>
            {t("batch")}{" "}
            <span className="font-mono text-[#3848c7]">{batchKey}</span>
          </>
        }
        description={
          summary.kind === "found"
            ? t("foundDescription", { count: summary.count })
            : summary.kind === "batchOnly"
              ? t("batchOnlyDescription")
              : t("emptyDescription")
        }
      />

      {batch ? (
        <section className="rounded-2xl border border-[#ececf4] bg-white p-4" aria-label={t("batchSection")}>
          <div className="flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#eef1ff] text-[#3848c7]">
              <Boxes className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[15px] font-semibold leading-tight text-[#0b1024]">{batch.productName}</span>
                <span className="rounded-full bg-[#f5f6ff] px-2 py-0.5 text-[11px] font-semibold text-[#3848c7]">
                  {batchStatusLabel(batch.status)}
                </span>
              </div>
              <div className="mt-1 text-[13px] text-[#3c4053]">
                {[
                  batch.supplier ? t("supplierLabel", { name: batch.supplier }) : null,
                  amountLabel(batch.quantity, batch.unit),
                  t("receivedOn", { date: dayLabel(batch.receivedAt) }),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
              {canOpenBatch ? (
                <Link
                  href={`/batches/${batch.id}`}
                  className="mt-2 inline-flex text-[13px] font-medium text-[#3848c7] hover:underline"
                >
                  {t("openBatch")}
                </Link>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}

      {vsd.length > 0 ? (
        <section className="space-y-2.5" aria-label={t("vsdSection")}>
          <h2 className="text-[13px] font-semibold uppercase tracking-wide text-[#6f7282]">{t("vsdSection")}</h2>
          {vsd.map((row) => (
            <div key={row.id} className="flex items-start gap-3 rounded-2xl border border-[#ececf4] bg-white p-4">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#eef1ff] text-[#3848c7]">
                <FileCheck2 className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-semibold leading-tight text-[#0b1024]">
                  {row.product ?? t("vsdUntitled")}
                </div>
                <div className="mt-1 text-[13px] text-[#3c4053]">
                  {[row.supplier ? t("supplierLabel", { name: row.supplier }) : null, amountLabel(row.volume, row.unit)]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[11.5px] text-[#9b9fb3]">
                  <span>{t("vsdNumber", { number: row.number })}</span>
                  <span className="inline-flex items-center gap-1">
                    <Clock className="size-3.5" />
                    {dayLabel(row.date)}
                  </span>
                </div>
                {row.journalHref ? (
                  <Link href={row.journalHref} className="mt-2 inline-flex text-[13px] font-medium text-[#3848c7] hover:underline">
                    {t("openAcceptanceJournal")}
                  </Link>
                ) : null}
              </div>
            </div>
          ))}
        </section>
      ) : null}

      {entries.length === 0 ? (
        summary.kind === "empty" ? (
          <div className="rounded-3xl border border-dashed border-[#dcdfed] bg-[#fafbff] p-8 text-center text-[14px] text-[#6f7282]">
            {t("emptyBox", { key: batchKey })}
          </div>
        ) : null
      ) : (
        <div className="space-y-3">
          {vsd.length > 0 || batch ? (
            <h2 className="text-[13px] font-semibold uppercase tracking-wide text-[#6f7282]">{t("entriesSection")}</h2>
          ) : null}
          {entries.map((e, i) => {
            const data = (e.data ?? {}) as Record<string, unknown>;
            const productName =
              typeof data.productName === "string"
                ? data.productName
                : typeof data.product === "string"
                  ? data.product
                  : null;
            const supplier =
              typeof data.supplier === "string" ? data.supplier : null;
            const dateLabel = format.dateTime(new Date(e.createdAt), {
              day: "numeric",
              month: "long",
              hour: "2-digit",
              minute: "2-digit",
            });
            return (
              <Link
                key={e.id}
                href={`/journals/${e.template.code}`}
                className="flex items-stretch gap-3 rounded-2xl border border-[#ececf4] bg-white p-4 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] transition-all hover:border-[#5566f6]/40 hover:shadow-[0_8px_20px_-12px_rgba(85,102,246,0.25)]"
              >
                <div className="flex flex-col items-center gap-1.5">
                  <span className="flex size-9 items-center justify-center rounded-xl bg-[#eef1ff] text-[#3848c7]">
                    <Package className="size-4" />
                  </span>
                  {i < entries.length - 1 ? (
                    <div className="h-full min-h-[20px] w-px flex-1 bg-[#dcdfed]" />
                  ) : null}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-[#f5f6ff] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#3848c7]">
                      {t("step", { number: i + 1 })}
                    </span>
                    <span className="text-[15px] font-semibold leading-tight text-[#0b1024]">
                      {e.template.name}
                    </span>
                  </div>
                  {productName ? (
                    <div className="mt-1 text-[13px] text-[#3c4053]">
                      {productName}
                      {supplier ? (
                        <span className="text-[#9b9fb3]">
                          {" "}
                          {t("supplier", { name: supplier })}
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                  <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[11.5px] text-[#9b9fb3]">
                    <span className="inline-flex items-center gap-1">
                      <Clock className="size-3.5" />
                      {dateLabel}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <UserIcon className="size-3.5" />
                      {e.filledBy.name}
                    </span>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      <div className="rounded-2xl border border-[#5566f6]/15 bg-[#f5f6ff]/50 p-4 text-[12.5px] leading-relaxed text-[#3848c7]">
        <strong>{t("noteTitle")}</strong> {t("noteBody")}
      </div>
    </div>
  );
}
