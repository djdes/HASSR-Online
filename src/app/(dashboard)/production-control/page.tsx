import Link from "next/link";
import { cookies } from "next/headers";
import { forbidden } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Sparkles, Stamp } from "lucide-react";
import { requireAuth, getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { hasCapability } from "@/lib/permission-presets";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import {
  PRODUCTION_DOC_KINDS,
  productionDocServiceKey,
} from "@/lib/production-control-docs";
import { loadPpkStatuses } from "@/lib/ppk/facts.server";
import { ppkProgress } from "@/lib/ppk/status";
import { ALL_STARTER_BLOCKS, starterBlocksFor } from "@/lib/ppk/starter-packs";
import { loadPpkItemFacts } from "@/lib/ppk/structure-facts.server";
import { ppkItemProgress, ppkItemStatuses, ppkNextItem } from "@/lib/ppk/structure-status";
import { PPK_STRUCTURE, ppkItemHref } from "@/lib/ppk/structure";
import { PPK_OVERVIEW_COOKIE, ppkOverviewClassic } from "@/lib/ppk/overview-view";
import { loadOverviewSignals, loadStarterSphere } from "@/lib/ppk/overview.server";
import { DocumentSlot } from "@/components/production-control/document-slot";
import { PpkStarterWizard } from "@/components/production-control/ppk-starter-wizard";
import { PpkProgressBar } from "@/components/production-control/ppk-progress-bar";
import { SectionPageHeader } from "@/components/layout/section-page-header";
import { PpkIndividualOrder } from "@/components/production-control/ppk-individual-order";
import { PpkStructureOutline } from "@/components/production-control/structure/structure-outline";
import { PpkStructureRefresh } from "@/components/production-control/structure/structure-refresh";
import { PpkNextItem } from "@/components/production-control/structure/next-item";
import { PpkReadinessPanel } from "@/components/production-control/structure/readiness-panel";
import { PpkStructureExplorer, type ExplorerSection } from "@/components/production-control/structure/structure-explorer";
import { PpkViewToggle } from "@/components/production-control/structure/view-toggle";
import { ppkPageScope } from "@/lib/ppk/access.server";
import { ppkDocKindKeys, ppkDocKindOf, ppkWhere } from "@/lib/ppk/scope";

export const dynamic = "force-dynamic";

/**
 * «Производственный контроль → Обзор» (документ владельца 2026-11-24):
 * структура «Электронной программы производственного контроля, основанной на
 * принципах ХАССП» — разделы 1–3 и приложения с нумерацией; пункт — ссылка,
 * открывающая окно с его данными (`@modal/(.)item/[id]`). Ниже — два главных
 * документа (свой файл или сборка) и заказ у специалиста.
 *
 * Новый вид (2026-11-24, по умолчанию): «Готовность к проверке», фильтр
 * пунктов, переход к разделам и номера редакций. «Прежний вид» — кнопкой
 * (cookie) или у всех через `PPK_OVERVIEW_CLASSIC=1` (`overview-view.ts`).
 */
export default async function ProductionControlPage() {
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) forbidden();
  const organizationId = getActiveOrgId(session);
  // ППК на точку (2026-11-01): ППК точки из шапки или организации.
  const scope = await ppkPageScope(session);
  const canManage = hasCapability(session.user, "admin.full");
  const forcedClassic = ppkOverviewClassic(null, process.env.PPK_OVERVIEW_CLASSIC);
  const classic = forcedClassic || ppkOverviewClassic((await cookies()).get(PPK_OVERVIEW_COOKIE)?.value, null);

  const [rows, statuses, t, s, r, blockCounts, starterSphere, signals] = await Promise.all([
    db.knowledgeDocument
      .findMany({
        where: { organizationId, kind: { in: ppkDocKindKeys(scope.buildingId) } },
        select: { kind: true, fileName: true, mimeType: true, sizeBytes: true, updatedAt: true },
      })
      // Документ точки хранится как `<kind>@<точка>` — дальше вид без точки.
      .then((docs) => docs.map((doc) => ({ ...doc, kind: ppkDocKindOf(doc.kind) }))),
    loadPpkStatuses(scope),
    getTranslations("productionControl"),
    getTranslations("productionControl.structure"),
    getTranslations("productionControl.revisions"),
    db.ppkRecord.groupBy({
      by: ["block"],
      where: { ...ppkWhere(scope), block: { in: [...ALL_STARTER_BLOCKS] } },
      _count: { _all: true },
    }),
    loadStarterSphere(scope),
    // Сбой сигналов нового вида не роняет обзор: страница — в прежнем виде.
    classic
      ? Promise.resolve(null)
      : loadOverviewSignals(scope).catch((error) => {
          console.error("[ppk] overview signals failed", error);
          return null;
        }),
  ]);
  const facts = await loadPpkItemFacts(scope, statuses);
  const itemStatuses = ppkItemStatuses(facts);
  // Блоки, где уже есть данные: мастер «типовыми за 10 минут» их не тронет.
  const filledBlocks = ALL_STARTER_BLOCKS.filter((block) => blockCounts.some((row) => row.block === block));

  const blocks = ppkProgress(statuses);
  const { done, total } = ppkItemProgress(itemStatuses);
  const next = ppkNextItem(itemStatuses);
  const progress = s("progress", { done: String(done), total: String(total) });
  // Мастер — пока у сферы объекта есть что добавить (у медицины, услуг и спорта — 3 раздела).
  const starterPending = starterBlocksFor(starterSphere).some((block) => !filledBlocks.includes(block));
  const starter =
    starterPending && blocks.total > 0 && blocks.done / blocks.total < 0.4 ? (
      <PpkStarterWizard filled={filledBlocks} defaultSphere={starterSphere} />
    ) : null;
  const headerActions = (
    <div className="flex flex-wrap items-center gap-2">
      {forcedClassic ? null : <PpkViewToggle classic={classic || signals === null} />}
      <Link
        href="/settings/services?order=ppk-development"
        className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
      >
        <Sparkles className="size-4 text-[#5566f6]" />
        {t("overview.fillForYou")}
      </Link>
    </div>
  );

  const documents = (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[17px] font-semibold tracking-[-0.01em] text-[#0b1024]">{s("documentsTitle")}</h2>
        <Link
          href="/production-control/revisions"
          className="inline-flex items-center gap-1.5 text-[13.5px] font-medium text-[#3848c7] transition-colors duration-150 hover:text-[#5566f6]"
          data-ppk-revisions-link
        >
          <Stamp className="size-4" aria-hidden />
          {r("registerLink")}
        </Link>
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
    </section>
  );

  if (signals) {
    // Новый вид: готовность к проверке, фильтр и разделы, номера редакций.
    const sections: ExplorerSection[] = PPK_STRUCTURE.map((section) => {
      const appendix = section.key === "appendix";
      return {
        key: section.key,
        title: section.number ? `${section.number}. ${s(`sections.${section.key}`)}` : s(`sections.${section.key}`),
        appendix,
        items: section.items.map((item) => {
          const title = s(`items.${item.id}.title`);
          const revision = signals.revisions[item.id];
          return {
            id: item.id,
            number: appendix ? s("appendixNumber", { n: item.number }) : item.number,
            title: appendix ? `«${title}»` : title,
            href: ppkItemHref(item.id),
            status: itemStatuses[item.id] ?? "empty",
            revision: revision?.code ?? null,
            revisionPending: revision?.pending ?? false,
          };
        }),
      };
    });
    return (
      <div className="space-y-5" data-ppk-overview="new">
        <PpkStructureRefresh />
        <SectionPageHeader title={t("overview.title")} description={s("lead")} actions={headerActions} />
        <PpkReadinessPanel
          data={{
            done,
            total,
            docs: signals.docs,
            ack: facts.acquaintance.available
              ? { acknowledged: facts.acquaintance.acknowledged, total: facts.acquaintance.total }
              : null,
            review: signals.review,
          }}
        />
        {starter}
        {next ? <PpkNextItem item={next} /> : null}
        <PpkStructureExplorer sections={sections} />
        {documents}
        <PpkIndividualOrder />
      </div>
    );
  }

  return (
    <div className="space-y-5" data-ppk-overview="classic">
      <PpkStructureRefresh />
      {/* Один заголовок и пояснение (руководитель 2026-10-18: «дубль
          заголовков»): название компании и её монограмма уже стоят слева
          вверху, раздел и пункт — в меню слева. */}
      <div className="space-y-3">
        <SectionPageHeader title={t("overview.title")} description={s("lead")} actions={headerActions} />
        <div className="flex max-w-[520px] items-center gap-3">
          <PpkProgressBar done={done} total={total} label={progress} className="min-w-0 flex-1" />
          <span className="shrink-0 text-[13px] tabular-nums text-[#6f7282]">{progress}</span>
        </div>
      </div>

      {starter}

      {next ? <PpkNextItem item={next} /> : null}

      <PpkStructureOutline statuses={itemStatuses} />

      {documents}

      {/* «Заказать индивидуально» внизу раздела — у любого тарифа; цены нет, «Свяжитесь с нами». */}
      <PpkIndividualOrder />
    </div>
  );
}
