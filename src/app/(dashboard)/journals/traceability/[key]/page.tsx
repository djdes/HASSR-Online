import Link from "next/link";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { Package, Clock, User as UserIcon } from "lucide-react";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/ui/page-header";

export const dynamic = "force-dynamic";

/**
 * Просмотр истории партии (ХАССП traceability).
 *
 * URL: /journals/traceability/<batchKey>
 *
 * Показывает все JournalEntry с этим batchKey в текущей организации.
 * Сортировка хронологическая — приёмка наверху, списание/отпуск внизу.
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
  const format = await getFormatter();
  const session = await requireAuth();
  const organizationId = getActiveOrgId(session);

  const entries = await db.journalEntry.findMany({
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
  });

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
          entries.length === 0
            ? t("emptyDescription")
            : t("foundDescription", { count: entries.length })
        }
      />

      {entries.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-[#dcdfed] bg-[#fafbff] p-8 text-center text-[14px] text-[#6f7282]">
          {t("emptyBox", { key: batchKey })}
        </div>
      ) : (
        <div className="space-y-3">
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
