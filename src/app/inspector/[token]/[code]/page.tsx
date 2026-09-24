import Link from "next/link";
import { notFound } from "next/navigation";

import { ElectronicMark } from "@/components/inspector/electronic-mark";
import { Desk, Sheet, StatusSheet, SERIF } from "@/components/inspector/paper";
import { PeriodPicker, periodQuery } from "@/components/inspector/period-picker";
import { SheetImage } from "@/components/inspector/sheet-viewer";
import { db } from "@/lib/db";
import { logInspectorEvent } from "@/lib/inspector-access";
import { getInspectorDocPdf, inspectorDocVersion } from "@/lib/inspector-doc-sheets";
import { loadInspectorPage } from "@/lib/inspector-page";
import { listOrderScans } from "@/lib/journal-order-scans-db";
import { dayKeyOf, formatDayKeyRu, periodBounds } from "@/lib/inspector-qr";
import { buildOrgSnapshot } from "@/lib/orders/org-snapshot";
import { resolveOrgJournalName } from "@/lib/org-journal-name";
import { buildingPrintName } from "@/lib/building-scope";
import { describeSignature, loadSignatureEvidence, matchSignature } from "@/lib/signature-evidence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Журнал для проверяющих",
  robots: { index: false, follow: false },
};

/** Больше документов за раз не собираем: каждый — отдельный PDF на сервере. */
const MAX_DOCS = 12;

/**
 * Журнал для проверяющего — «листами бумаги»: документы журнала,
 * пересекающиеся с выбранным периодом, каждый показан страницами той же
 * печатной формы, что у кнопки «Печать» в кабинете, и закрыт
 * электронной отметкой с контрольным кодом.
 */
export default async function InspectorJournalPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string; code: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { token, code } = await params;
  const ctx = await loadInspectorPage(token, await searchParams);
  if (ctx.kind === "status") {
    if (ctx.notFound) notFound();
    return <StatusSheet title={ctx.title} message={ctx.message} />;
  }
  const { access, period, viewer } = ctx;

  // Отключённый журнал для проверяющего не существует — как чужой.
  if (access.disabledCodes.has(code)) notFound();
  const template = await db.journalTemplate.findFirst({
    where: { code, isActive: true },
    select: { id: true, code: true, name: true, fields: true },
  });
  if (!template) notFound();

  const bounds = periodBounds(period.from, period.to);
  const orgId = access.token.organizationId;
  const [documentsAll, legacyEntries] = await Promise.all([
    db.journalDocument.findMany({
      where: {
        organizationId: orgId,
        templateId: template.id,
        dateFrom: { lte: bounds.lte },
        dateTo: { gte: bounds.gte },
      },
      select: {
        id: true,
        title: true,
        dateFrom: true,
        dateTo: true,
        status: true,
        updatedAt: true,
        responsibleTitle: true,
        responsibleUserId: true,
        building: { select: { name: true, journalName: true } },
      },
      orderBy: { dateFrom: "desc" },
    }),
    db.journalEntry.findMany({
      where: { organizationId: orgId, templateId: template.id, createdAt: bounds },
      select: { id: true, createdAt: true, data: true, filledById: true, filledBy: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: 500,
    }),
  ]);
  const documents = documentsAll.slice(0, MAX_DOCS);
  // Приказы к журналу (гигиена, БЖГП): список сверху; листами они же идут
  // после страниц каждого документа (печатная форма).
  const orderScans = await listOrderScans(orgId, template.code);

  const responsibleIds = [...new Set(documents.map((d) => d.responsibleUserId).filter((v): v is string => Boolean(v)))];
  const responsibles = responsibleIds.length
    ? await db.user.findMany({ where: { id: { in: responsibleIds }, organizationId: orgId }, select: { id: true, name: true } })
    : [];
  const responsibleName = new Map(responsibles.map((u) => [u.id, u.name]));

  const snapshot = buildOrgSnapshot({
    name: access.org.name,
    inn: access.org.inn,
    address: access.org.address,
    legalProfileJson: access.org.legalProfileJson,
  });
  const orgTitle = resolveOrgJournalName(access.org);
  const tz = access.org.timezone || "Europe/Moscow";
  const generatedAt = new Date().toLocaleString("ru-RU", { dateStyle: "long", timeStyle: "short", timeZone: tz });

  const prepared = await Promise.all(
    documents.map(async (d) => {
      try {
        const version = await inspectorDocVersion(d);
        const { pageCount } = await getInspectorDocPdf(d.id, orgId, version);
        return { doc: d, version, pageCount, error: false as const };
      } catch (err) {
        console.error("[inspector] document render failed", d.id, err);
        return { doc: d, version: null, pageCount: 0, error: true as const };
      }
    })
  );

  const evidence = legacyEntries.length
    ? await loadSignatureEvidence({
        organizationId: orgId,
        userIds: legacyEntries.map((e) => e.filledById),
        from: bounds.gte,
        to: bounds.lte,
      })
    : null;
  const fieldLabels = readFieldLabels(template.fields);

  await logInspectorEvent({
    access,
    headers: ctx.headers,
    action: "inspector.view",
    viewer,
    details: {
      kind: "journal_page",
      code: template.code,
      journal: template.name,
      from: period.from,
      to: period.to,
      documents: documents.map((d) => d.id),
    },
  });

  const q = periodQuery(period);
  const base = `/inspector/${token}`;

  return (
    <Desk>
      <div className="mx-auto flex w-full max-w-[1040px] flex-col gap-6 sm:gap-8">
        <Sheet className="max-w-none px-5 pb-6 pt-5 sm:px-10 sm:pb-8 sm:pt-7">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-[#141821] pb-2 text-[12.5px] text-[#5b6170]">
            <Link
              href={`${base}${q}`}
              className="underline-offset-4 transition-colors duration-150 hover:text-[#141821] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1f3a8a]/35"
              data-back
            >
              ← Опись журналов
            </Link>
            <span className="min-w-0 truncate">{orgTitle}</span>
          </div>
          <h1 className={`${SERIF} mt-5 text-[24px] leading-[1.2] sm:text-[30px]`} data-journal-title>
            {template.name}
          </h1>
          <p className="mt-1.5 text-[14px] tabular-nums text-[#5b6170]">
            Период: {formatDayKeyRu(period.from)} - {formatDayKeyRu(period.to)}
            {documentsAll.length > 0 ? `, документов: ${documentsAll.length}` : ""}
          </p>
          <div className="mt-5 border-t border-[#e3e5ea] pt-4">
            <PeriodPicker basePath={`${base}/${template.code}`} period={period} window={access.window} />
          </div>
        </Sheet>

        {orderScans.length > 0 ? (
          <Sheet className="max-w-none px-5 py-5 sm:px-10 sm:py-6">
            <h2 className={`${SERIF} text-[19px] leading-snug`} data-order-scans>Приказы к журналу</h2>
            <p className="mt-1 text-[13px] leading-relaxed text-[#5b6170]">
              Сканы, приложенные организацией. Они же напечатаны листами после страниц каждого документа.
            </p>
            <ul className="mt-3 divide-y divide-[#e3e5ea] border-t border-[#e3e5ea]">
              {orderScans.map((scan) => (
                <li key={scan.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-[15px] leading-snug text-[#141821]">{scan.title}</p>
                    <p className="text-[12.5px] tabular-nums text-[#5b6170]">
                      {scan.mimeType === "application/pdf" ? "PDF" : "Изображение"}, загружен{" "}
                      {new Date(scan.createdAt).toLocaleDateString("ru-RU", { timeZone: tz })}
                    </p>
                  </div>
                  <a
                    href={`/api/inspector/${token}/orders/${scan.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex h-10 shrink-0 items-center justify-center self-start rounded-[4px] border border-[#141821] bg-white px-4 text-[14px] font-medium text-[#141821] transition-colors duration-150 hover:bg-[#141821] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1f3a8a]/35 sm:self-auto"
                    data-order-scan-open
                  >
                    Открыть
                  </a>
                </li>
              ))}
            </ul>
          </Sheet>
        ) : null}

        {documents.length === 0 && legacyEntries.length === 0 ? (
          <Sheet className="max-w-none px-6 py-12 text-center">
            <p className={`${SERIF} text-[20px]`}>За выбранный период записей нет</p>
            <p className="mx-auto mt-2 max-w-[460px] text-[14px] leading-relaxed text-[#5b6170]">
              Журнал не вёлся в эти даты или заполняется по событию (при инциденте, поставке, поломке).
              Выберите другой период выше.
            </p>
          </Sheet>
        ) : null}

        {prepared.map(({ doc, version, pageCount, error }, i) => {
          const docFrom = dayKeyOf(doc.dateFrom);
          const docTo = dayKeyOf(doc.dateTo) > access.today ? access.today : dayKeyOf(doc.dateTo);
          const building = buildingPrintName(doc.building);
          const responsible = [doc.responsibleTitle, doc.responsibleUserId ? responsibleName.get(doc.responsibleUserId) : null]
            .filter(Boolean)
            .join(", ");
          return (
            <article key={doc.id} className="flex flex-col gap-4" data-document={doc.id}>
              <header className="flex flex-col gap-2 px-1 sm:flex-row sm:items-end sm:justify-between">
                <div className="min-w-0">
                  <p className="text-[12.5px] tabular-nums text-[#5b6170]">
                    Документ {i + 1} из {documentsAll.length}
                    {doc.status === "closed" ? ", закрыт" : ", ведётся"}
                  </p>
                  <h2 className={`${SERIF} text-[19px] leading-snug`}>{doc.title}</h2>
                  <p className="text-[13px] tabular-nums text-[#5b6170]">
                    {formatDayKeyRu(docFrom)} - {formatDayKeyRu(docTo)}
                    {building ? `, ${building}` : ""}
                  </p>
                </div>
                <a
                  href={`/api/inspector/${token}/documents/${doc.id}/pdf`}
                  className="inline-flex h-10 shrink-0 items-center justify-center self-start rounded-[4px] border border-[#141821] bg-white px-4 text-[14px] font-medium text-[#141821] transition-colors duration-150 hover:bg-[#141821] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1f3a8a]/35 sm:self-auto"
                  data-document-pdf
                >
                  Скачать PDF
                </a>
              </header>

              {error ? (
                <Sheet className="max-w-none px-6 py-10 text-center text-[14px] text-[#5b6170]">
                  Этот документ не удалось показать листами. Скачайте PDF кнопкой выше.
                </Sheet>
              ) : (
                <div className="flex flex-col gap-5">
                  {Array.from({ length: pageCount }, (_, p) => (
                    <SheetImage
                      key={p}
                      src={`/api/inspector/${token}/documents/${doc.id}/pages/${p + 1}.png?v=${version!.controlCode}`}
                      alt={`${template.name}, лист ${p + 1}`}
                      caption={`Лист ${p + 1} из ${pageCount}`}
                    />
                  ))}
                </div>
              )}

              {version ? (
                <div className="border-t border-dashed border-[#c3c7cf] pt-5">
                  <ElectronicMark
                    orgName={snapshot.orgShortName}
                    inn={snapshot.orgInn}
                    journal={template.name}
                    period={`${formatDayKeyRu(docFrom)} - ${formatDayKeyRu(docTo)}`}
                    generatedAt={generatedAt}
                    responsible={responsible || null}
                    controlCode={version.controlCode}
                  />
                </div>
              ) : null}
            </article>
          );
        })}

        {documentsAll.length > MAX_DOCS ? (
          <p className="text-center text-[13px] text-[#5b6170]">
            Показаны {MAX_DOCS} последних документов из {documentsAll.length}. Сузьте период, чтобы увидеть остальные.
          </p>
        ) : null}

        {legacyEntries.length > 0 ? (
          <Sheet className="max-w-none px-5 py-6 sm:px-10 sm:py-8">
            <h2 className={`${SERIF} text-[20px]`}>Записи журнала</h2>
            <p className="mt-1 text-[13px] text-[#5b6170]">Записей за период: {legacyEntries.length}</p>
            <ol className="mt-4 border-t border-[#141821]">
              {legacyEntries.map((e) => {
                const sig = evidence ? matchSignature(evidence.events, e.filledById, e.createdAt, { entryId: e.id }) : null;
                return (
                  <li key={e.id} className="border-b border-[#e3e5ea] py-3" data-legacy-entry>
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-[14px]">
                      <span className="tabular-nums text-[#141821]">
                        {e.createdAt.toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short", timeZone: tz })}
                      </span>
                      <span className="text-[#5b6170]">{e.filledBy?.name ?? "сотрудник не указан"}</span>
                    </div>
                    <dl className="mt-1.5 grid gap-x-4 gap-y-0.5 text-[13.5px] sm:grid-cols-2">
                      {formatEntryData(e.data, fieldLabels).map(([k, v]) => (
                        <div key={k} className="flex min-w-0 gap-2">
                          <dt className="shrink-0 text-[#8a8f9c]">{k}:</dt>
                          <dd className="min-w-0 break-words text-[#141821]">{v}</dd>
                        </div>
                      ))}
                    </dl>
                    {sig && evidence ? (
                      <p className="mt-1.5 text-[12.5px] text-[#1f3a8a]">
                        Подпись: {describeSignature(sig, evidence.deviceLabels)}
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          </Sheet>
        ) : null}
      </div>
    </Desk>
  );
}

function readFieldLabels(fields: unknown): Map<string, string> {
  const map = new Map<string, string>();
  if (!Array.isArray(fields)) return map;
  for (const f of fields) {
    if (f && typeof f === "object" && typeof (f as { key?: unknown }).key === "string") {
      const { key, label } = f as { key: string; label?: unknown };
      map.set(key, typeof label === "string" ? label : key);
    }
  }
  return map;
}

/** Данные старой записи — «Поле: значение» по подписям шаблона, без сырого JSON. */
function formatEntryData(data: unknown, labels: Map<string, string>): Array<[string, string]> {
  if (!data || typeof data !== "object" || Array.isArray(data)) return [];
  const out: Array<[string, string]> = [];
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (key.startsWith("_") || value === null || value === undefined || value === "") continue;
    const label = labels.get(key) ?? key;
    let text: string;
    if (typeof value === "boolean") text = value ? "да" : "нет";
    else if (typeof value === "string" || typeof value === "number") text = String(value);
    else if (Array.isArray(value)) text = value.map((v) => (typeof v === "object" ? JSON.stringify(v) : String(v))).join(", ");
    else text = JSON.stringify(value);
    out.push([label, text.length > 300 ? `${text.slice(0, 300)}…` : text]);
  }
  return out;
}
