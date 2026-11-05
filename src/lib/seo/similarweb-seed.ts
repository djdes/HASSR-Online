import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

export interface SimilarwebClusterSeed {
  phrase: string;
  trafficSharePct: number;
  channel: "organic" | "paid";
  mappedTargetUrl: string;
  notes?: string;
}

export interface SimilarwebSnapshotSeed {
  domain: string;
  periodLabel: string;
  visitsMonthly: number;
  organicSharePct: number | null;
  paidSharePct: number | null;
  bouncePct: number | null;
  pagesPerVisit: number | null;
  sourceKind: "agent_import" | "screenshot_ocr" | "manual";
  clusters: readonly SimilarwebClusterSeed[];
}

export const DEFAULT_SIMILARWEB_SNAPSHOTS: readonly SimilarwebSnapshotSeed[] = [
  {
    domain: "wesetup.ru",
    periodLabel: "Jul–Sep 2026",
    visitsMonthly: 736,
    organicSharePct: null,
    paidSharePct: null,
    bouncePct: 40.42,
    pagesPerVisit: 1.02,
    sourceKind: "agent_import",
    clusters: [
      {
        phrase: "бактерицидный журнал",
        trafficSharePct: 8.19,
        channel: "organic",
        mappedTargetUrl: "/journals-info/uv_lamp_runtime",
        notes: "Лидирующий органический кластер в Jul–Sep 2026",
      },
    ],
  },
  {
    domain: "haccp-online.ru",
    periodLabel: "Jul–Sep 2026",
    visitsMonthly: 14240,
    organicSharePct: 9.8,
    paidSharePct: 23.27,
    bouncePct: null,
    pagesPerVisit: null,
    sourceKind: "agent_import",
    clusters: [
      {
        phrase: "хассп журналы и их заполнение",
        trafficSharePct: 40.14,
        channel: "paid",
        mappedTargetUrl: "/journals-info",
        notes: "Главный платный кластер конкурента",
      },
      {
        phrase: "бракеражный журнал готовой продукции",
        trafficSharePct: 17.61,
        channel: "paid",
        mappedTargetUrl: "/zhurnal-brakerazha-gotovoy-produkcii",
        notes: "Высококоммерческий платный запрос",
      },
      {
        phrase: "журнал проведения генеральных уборок",
        trafficSharePct: 16.9,
        channel: "paid",
        mappedTargetUrl: "/zhurnal-generalnyh-uborok",
        notes: "Платный спрос по генеральным уборкам",
      },
      {
        phrase: "санпин",
        trafficSharePct: 16.9,
        channel: "paid",
        mappedTargetUrl: "/sanpin-2-3-2-4-4282-26",
        notes: "Нормативный спрос СанПиН 2.3/2.4",
      },
      {
        phrase: "журналы по хассп для пищевого производства",
        trafficSharePct: 5.63,
        channel: "paid",
        mappedTargetUrl: "/calc/journals",
        notes: "Подбор комплекта журналов под цех/общепит",
      },
    ],
  },
  {
    domain: "checkoffice.ru",
    periodLabel: "Jul–Sep 2026",
    visitsMonthly: 36287,
    organicSharePct: 65.14,
    paidSharePct: null,
    bouncePct: null,
    pagesPerVisit: null,
    sourceKind: "agent_import",
    clusters: [
      {
        phrase: "чек-лист приемки сырья в ресторане",
        trafficSharePct: 11.26,
        channel: "organic",
        mappedTargetUrl: "/blog/chek-list-priemki-syrya-v-restorane",
        notes: "Органический кластер входного контроля сырья",
      },
      {
        phrase: "условия хранения продукции",
        trafficSharePct: 8.19,
        channel: "organic",
        mappedTargetUrl: "/blog/usloviya-i-sroki-hraneniya-produktov-obshchepit",
        notes: "Органический кластер сроков и условий хранения",
      },
    ],
  },
];

/**
 * Idempotently seeds the Jul–Sep 2026 Similarweb competitor audit baseline
 * into `SeoCompetitorSnapshot` without overwriting existing rows.
 */
export async function ensureDefaultSimilarwebSnapshots(
  prismaClient: Pick<typeof db, "seoCompetitorSnapshot"> = db,
): Promise<number> {
  let count = 0;
  for (const snap of DEFAULT_SIMILARWEB_SNAPSHOTS) {
    await prismaClient.seoCompetitorSnapshot.upsert({
      where: {
        domain_periodLabel: {
          domain: snap.domain,
          periodLabel: snap.periodLabel,
        },
      },
      create: {
        domain: snap.domain,
        periodLabel: snap.periodLabel,
        visitsMonthly: snap.visitsMonthly,
        organicSharePct: snap.organicSharePct,
        paidSharePct: snap.paidSharePct,
        bouncePct: snap.bouncePct,
        pagesPerVisit: snap.pagesPerVisit,
        clusters: snap.clusters as unknown as Prisma.InputJsonValue,
        sourceKind: snap.sourceKind,
      },
      update: {},
    });
    count += 1;
  }
  return count;
}
