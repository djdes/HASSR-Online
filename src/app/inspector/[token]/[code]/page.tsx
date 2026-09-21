import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Calendar, ClipboardCheck } from "lucide-react";
import { db } from "@/lib/db";
import { hashInspectorToken } from "@/lib/inspector-tokens";
import { NOT_AUTO_SEEDED } from "@/lib/journal-entry-filters";
import { describeSignature, loadSignatureEvidence, matchSignature } from "@/lib/signature-evidence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Read-only view of a single template's documents for the inspector,
 * scoped to the token's period. We render a flat list of documents +
 * their entries — no edit handles, no per-row dialogs. PDF for the
 * single template available via /api/inspector/<token>/pdf?code=…
 */
export default async function InspectorTemplatePage({
  params,
}: {
  params: Promise<{ token: string; code: string }>;
}) {
  const { token, code } = await params;
  const tokenHash = hashInspectorToken(token);
  const record = await db.inspectorToken.findUnique({
    where: { tokenHash },
  });
  if (!record || record.revokedAt || record.expiresAt < new Date()) {
    notFound();
  }

  const template = await db.journalTemplate.findFirst({
    where: { code, isActive: true },
    select: { id: true, code: true, name: true },
  });
  if (!template) notFound();

  const periodFrom = record.periodFrom;
  const periodToInclusive = new Date(record.periodTo);
  periodToInclusive.setUTCHours(23, 59, 59, 999);

  const documents = await db.journalDocument.findMany({
    where: {
      organizationId: record.organizationId,
      templateId: template.id,
      OR: [
        { dateFrom: { gte: periodFrom, lte: periodToInclusive } },
        { dateTo: { gte: periodFrom, lte: periodToInclusive } },
        { AND: [{ dateFrom: { lte: periodFrom } }, { dateTo: { gte: periodToInclusive } }] },
      ],
    },
    select: {
      id: true,
      title: true,
      dateFrom: true,
      dateTo: true,
      status: true,
      building: { select: { name: true } },
      // Тот же фикс что в /api/inspector/[token]/pdf — не считать
      // _autoSeeded плейсхолдеры как «заполненные записи». Иначе
      // инспектор видит inflated счёт «300 записей за месяц», когда
      // реально сотрудник заполнил 30.
      _count: { select: { entries: { where: NOT_AUTO_SEEDED } } },
    },
    orderBy: { dateFrom: "desc" },
  });

  // Pull legacy JournalEntry rows for templates that don't use documents.
  const legacyEntries = await db.journalEntry.findMany({
    where: {
      organizationId: record.organizationId,
      templateId: template.id,
      createdAt: { gte: periodFrom, lte: periodToInclusive },
    },
    select: {
      id: true,
      createdAt: true,
      data: true,
      filledById: true,
      filledBy: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  // Подписи: под каким входом внесена запись (ПИН на общем планшете и т.п.).
  // Для бланков-документов строк здесь нет — показываем сводку по журналу.
  const evidence = await loadSignatureEvidence({
    organizationId: record.organizationId,
    userIds: legacyEntries.map((e) => e.filledById),
    from: periodFrom,
    to: periodToInclusive,
  });
  const kioskSignaturesInPeriod = await db.signatureEvent.count({
    where: {
      organizationId: record.organizationId,
      method: "kiosk_pin",
      createdAt: { gte: periodFrom, lte: periodToInclusive },
    },
  });

  return (
    <main className="min-h-screen bg-[#fafbff]">
      <section className="mx-auto max-w-5xl px-5 py-8 md:px-8 md:py-10">
        <Link
          href={`/inspector/${token}`}
          className="inline-flex items-center gap-1 text-[13px] text-[#6f7282] hover:text-[#0b1024]"
        >
          <ArrowLeft className="size-4" />
          К списку журналов
        </Link>
        <div className="mt-4 flex items-start gap-4">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#3848c7]">
            <ClipboardCheck className="size-5" />
          </span>
          <div>
            <h1 className="text-[clamp(1.5rem,2vw+1rem,2rem)] font-semibold tracking-[-0.02em] text-[#0b1024]">
              {template.name}
            </h1>
            {kioskSignaturesInPeriod > 0 ? (
              <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-[#ecfdf5] px-3 py-1 text-[12px] text-[#116b2a]">
                Подписей сотрудников по ПИН на общем планшете за период: {kioskSignaturesInPeriod}
              </div>
            ) : null}
            <div className="mt-1.5 flex items-center gap-2 text-[14px] text-[#6f7282]">
              <Calendar className="size-4" />
              {formatRange(periodFrom, record.periodTo)}
            </div>
          </div>
        </div>

        <div className="mt-6 space-y-4">
          {documents.length === 0 && legacyEntries.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-6 py-14 text-center">
              <div className="text-[15px] font-medium text-[#0b1024]">
                За указанный период записей нет
              </div>
              <p className="mx-auto mt-1.5 max-w-[420px] text-[13px] text-[#6f7282]">
                Возможно, организация не вела этот журнал в выбранный период,
                либо журнал — событийный (заполняется при инциденте).
              </p>
            </div>
          ) : null}

          {documents.map((doc) => (
            <div
              key={doc.id}
              className="rounded-2xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-[15px] font-semibold text-[#0b1024]">
                    {doc.title}
                  </div>
                  <div className="mt-1 text-[12px] text-[#6f7282]">
                    {doc.building ? <>{doc.building.name} ·{" "}</> : null}
                    {formatRange(doc.dateFrom, doc.dateTo)} ·{" "}
                    {doc.status === "active" ? "активен" : "закрыт"} · записей:{" "}
                    {doc._count.entries}
                  </div>
                </div>
              </div>
            </div>
          ))}

          {legacyEntries.length > 0 ? (
            <div className="rounded-2xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
              <div className="mb-3 text-[15px] font-semibold text-[#0b1024]">
                Записи журнала ({legacyEntries.length})
              </div>
              <div className="divide-y divide-[#ececf4]">
                {legacyEntries.map((entry) => (
                  <div key={entry.id} className="py-3">
                    <div className="flex items-center justify-between gap-3 text-[13px]">
                      <span className="text-[#0b1024]">
                        {entry.createdAt.toLocaleString("ru-RU", {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                      </span>
                      <span className="text-[#6f7282]">
                        {entry.filledBy?.name ?? "—"}
                      </span>
                    </div>
                    {(() => {
                      const sig = matchSignature(evidence.events, entry.filledById, entry.createdAt, { entryId: entry.id });
                      return sig ? (
                        <div className="mt-1 inline-flex items-center gap-2 rounded-full bg-[#ecfdf5] px-2.5 py-0.5 text-[12px] text-[#116b2a]">
                          Подпись: {describeSignature(sig, evidence.deviceLabels)}
                          {sig.photoUrl ? (
                            <a href={sig.photoUrl} target="_blank" rel="noreferrer" className="underline decoration-dotted">
                              фото
                            </a>
                          ) : null}
                        </div>
                      ) : null;
                    })()}
                    <pre className="mt-2 overflow-x-auto rounded-xl bg-[#fafbff] p-3 text-[12px] leading-relaxed text-[#3c4053]">
                      {JSON.stringify(entry.data, null, 2)}
                    </pre>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </section>
    </main>
  );
}

function formatRange(from: Date, to: Date): string {
  const fmt = (d: Date) =>
    d.toLocaleDateString("ru-RU", { day: "2-digit", month: "long", year: "numeric" });
  return `${fmt(from)} — ${fmt(to)}`;
}
