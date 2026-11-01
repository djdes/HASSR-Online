import Link from "next/link";
import { forbidden } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Sparkles } from "lucide-react";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { hasCapability } from "@/lib/permission-presets";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import {
  PRODUCTION_DOC_KINDS,
  productionDocServiceKey,
} from "@/lib/production-control-docs";
import { PPK_MENU_GROUPS, ppkBlockHref, ppkMenuBlocks } from "@/lib/ppk/registry";
import { loadPpkStatuses } from "@/lib/ppk/facts.server";
import { ppkNextStep, ppkProgress } from "@/lib/ppk/status";
import { STARTER_BLOCKS } from "@/lib/ppk/starter-packs";
import { DocumentSlot } from "@/components/production-control/document-slot";
import { PpkStarterWizard } from "@/components/production-control/ppk-starter-wizard";
import { PpkNextStep } from "@/components/production-control/ppk-next-step";
import { PpkProgressBar } from "@/components/production-control/ppk-progress-bar";
import { PpkStatusDot } from "@/components/production-control/ppk-status-dot";
import { SectionPageHeader } from "@/components/layout/section-page-header";
import { PpkIndividualOrder } from "@/components/production-control/ppk-individual-order";
import { ppkPageScope } from "@/lib/ppk/access.server";
import { ppkDocKindKeys, ppkDocKindOf, ppkWhere } from "@/lib/ppk/scope";

export const dynamic = "force-dynamic";

/**
 * «Производственный контроль → Обзор»: шапка программы с прогрессом, два
 * главных документа (свой файл или заказ у специалиста), следующий шаг и
 * карта разделов с точками статуса.
 */
export default async function ProductionControlPage() {
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) forbidden();
  const organizationId = getActiveOrgId(session);
  // ППК на точку (2026-11-01): ППК точки из шапки или организации.
  const scope = await ppkPageScope(session);
  const canManage = hasCapability(session.user, "admin.full");

  const [rows, statuses, t, nav, blockCounts] = await Promise.all([
    db.knowledgeDocument
      .findMany({
        where: { organizationId, kind: { in: ppkDocKindKeys(scope.buildingId) } },
        select: { kind: true, fileName: true, mimeType: true, sizeBytes: true, updatedAt: true },
      })
      // Документ точки хранится как `<kind>@<точка>` — дальше вид без точки.
      .then((docs) => docs.map((doc) => ({ ...doc, kind: ppkDocKindOf(doc.kind) }))),
    loadPpkStatuses(scope),
    getTranslations("productionControl"),
    getTranslations("navigation"),
    db.ppkRecord.groupBy({
      by: ["block"],
      where: { ...ppkWhere(scope), block: { in: [...STARTER_BLOCKS] } },
      _count: { _all: true },
    }),
  ]);
  // Блоки, где уже есть данные: мастер «типовыми за 10 минут» их не тронет.
  const filledBlocks = STARTER_BLOCKS.filter((block) => blockCounts.some((row) => row.block === block));

  const { done, total } = ppkProgress(statuses);
  const next = ppkNextStep(statuses);
  const progress = t("overview.progress", { done: String(done), total: String(total) });

  return (
    <div className="space-y-5">
      {/* Один заголовок и пояснение (руководитель 2026-10-18: «дубль
          заголовков»): название компании и её монограмма уже стоят слева
          вверху, раздел и пункт — в меню слева. */}
      <div className="space-y-3">
        <SectionPageHeader
          title={t("overview.title")}
          description={t("overview.lead")}
          actions={
            <Link
              href="/settings/services?order=ppk-development"
              className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
            >
              <Sparkles className="size-4 text-[#5566f6]" />
              {t("overview.fillForYou")}
            </Link>
          }
        />
        <div className="flex max-w-[520px] items-center gap-3">
          <PpkProgressBar done={done} total={total} label={progress} className="min-w-0 flex-1" />
          <span className="shrink-0 text-[13px] tabular-nums text-[#6f7282]">{progress}</span>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {PRODUCTION_DOC_KINDS.map((kind) => {
          const row = rows.find((doc) => doc.kind === kind);
          return (
            <DocumentSlot
              key={kind}
              kind={kind}
              document={
                row
                  ? { fileName: row.fileName, sizeBytes: row.sizeBytes, updatedAt: row.updatedAt.toISOString() }
                  : null
              }
              canManage={canManage}
              orderHref={`/settings/services?order=${productionDocServiceKey(kind)}`}
              assembleHref={kind === "ppk" ? "/production-control/program" : "/production-control/haccp-plan"}
            />
          );
        })}
      </div>

      {total > 0 && done / total < 0.4 ? <PpkStarterWizard filled={filledBlocks} /> : null}

      {next ? <PpkNextStep blockKey={next.key} /> : null}

      <section className="space-y-3">
        <h2 className="text-[17px] font-semibold tracking-[-0.01em] text-[#0b1024]">{t("overview.mapTitle")}</h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {PPK_MENU_GROUPS.map((group) => {
            // «Программа» — это сам обзор, отдельной строкой она не нужна.
            const blocks = ppkMenuBlocks(group.key).filter((block) => block.key !== "program");
            if (blocks.length === 0) return null;
            const counted = blocks.filter((block) => block.counted);
            const groupDone = counted.filter((block) => statuses[block.key] === "done").length;
            return (
              <div
                key={group.key}
                className="rounded-3xl border border-[#ececf4] bg-white p-5 transition-shadow duration-150 hover:shadow-[0_16px_40px_-24px_rgba(85,102,246,0.35)]"
              >
                <h3 className="flex items-baseline justify-between gap-2 text-[16px] font-semibold text-[#0b1024]">
                  <span>{group.key === "main" ? t("overview.mapMain") : nav(`shell.menus.productionControl.groups.${group.key}`)}</span>
                  {counted.length > 0 ? (
                    <span className="text-[13px] font-normal tabular-nums text-[#9b9fb3]">
                      {groupDone}/{counted.length}
                    </span>
                  ) : null}
                </h3>
                <ul className="mt-2">
                  {blocks.map((block) => (
                    <li key={block.key}>
                      <Link
                        href={ppkBlockHref(block)}
                        className="-mx-2 flex min-h-[36px] items-center gap-2 rounded-xl px-2 text-[14px] text-[#3c4053] transition-colors duration-150 hover:bg-[#fafbff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
                      >
                        <span className="min-w-0 flex-1">{nav(`shell.menus.productionControl.items.${block.key}`)}</span>
                        <PpkStatusDot status={statuses[block.key]} />
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </section>

      {/* «Заказать индивидуально» внизу раздела — у любого тарифа; цены нет, «Свяжитесь с нами». */}
      <PpkIndividualOrder />
    </div>
  );
}
