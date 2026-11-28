import type { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  VISION_MAX_PHOTO_BYTES,
  VISION_MAX_PHOTOS,
} from "@/lib/ai-vision/shared";
import { sniffImageMime } from "@/lib/ai-vision/temp-store";
import { audit } from "@/lib/audit-helper";
import { requireRoot } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import {
  extractSimilarwebSnapshotFromImages,
  GglAiError,
  type ParsedSimilarwebSnapshot,
} from "@/lib/seo/gogetlinks-article-ai.server";
import {
  buildDefaultCandidateSitePages,
  type CandidateSitePage,
  type CompetitorClusterInput,
  normalizeDomainName,
  normalizeWesetupPath,
  scoreTargetPages,
  type TopvisorPositionInput,
} from "@/lib/seo/gogetlinks-planner";
import { ensureDefaultSimilarwebSnapshots } from "@/lib/seo/similarweb-seed";
import {
  buildCompetitorBenchmarkReport,
  decodeSimilarwebClustersPayload,
  encodeSimilarwebClustersPayload,
  type SimilarwebConnectionStatus,
} from "@/lib/seo/similarweb-client";
import {
  fetchSimilarwebSnapshotViaApiAnything,
  getSimilarwebConnectionStatus,
  saveSimilarwebConnection,
  SimilarwebAuthError,
  SimilarwebCallError,
} from "@/lib/seo/similarweb-client.server";
import {
  getPositionsHistory,
  isTopvisorConfigured,
  type PositionMatrix,
} from "@/lib/topvisor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const platformOrgId = () => process.env.PLATFORM_ORG_ID?.trim() || "platform";

const clusterInputSchema = z.object({
  phrase: z.string().trim().min(1, "Укажите поисковую фразу кластера").max(200),
  trafficSharePct: z.number().min(0).max(100),
  channel: z.enum(["organic", "paid"]),
  mappedTargetUrl: z.string().trim().min(1).max(300),
  notes: z.string().trim().max(400).optional(),
});

const jsonSnapshotSchema = z.object({
  domain: z.string().trim().min(2, "Укажите домен сайта").max(200),
  periodLabel: z.string().trim().min(2, "Укажите период среза").max(100),
  visitsMonthly: z.number().int().min(0).max(1_000_000_000),
  organicSharePct: z.number().min(0).max(100).nullable().optional(),
  paidSharePct: z.number().min(0).max(100).nullable().optional(),
  bouncePct: z.number().min(0).max(100).nullable().optional(),
  pagesPerVisit: z.number().min(0).max(1000).nullable().optional(),
  sourceKind: z
    .enum(["agent_import", "screenshot_ocr", "manual"])
    .optional()
    .default("manual"),
  clusters: z.array(clusterInputSchema).max(100).default([]),
});

const syncDomainActionSchema = z.object({
  action: z.literal("sync_domain"),
  domain: z.string().trim().min(2).max(200).optional(),
  domains: z.array(z.string().trim().min(2).max(200)).min(1).max(10).optional(),
  periodLabel: z.string().trim().min(2).max(100).optional(),
});

const saveConnectionActionSchema = z.object({
  action: z.literal("save_connection"),
  cookieInput: z.string().max(50_000).nullable().optional(),
  apiKey: z.string().max(500).nullable().optional(),
  clear: z.boolean().optional(),
});

function isFileLike(value: FormDataEntryValue): value is File {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Blob).arrayBuffer === "function"
  );
}

function collectUploadedFiles(form: FormData): File[] {
  const seen = new Set<File>();
  const files: File[] = [];
  for (const field of ["photo", "images", "image", "file"]) {
    for (const entry of form.getAll(field)) {
      if (isFileLike(entry) && entry.size > 0 && !seen.has(entry)) {
        seen.add(entry);
        files.push(entry);
      }
    }
  }
  return files;
}

function toIso(date: Date | string | null | undefined): string | null {
  if (!date) return null;
  return new Date(date).toISOString();
}

function serializeSnapshot(snap: {
  id: string;
  domain: string;
  periodLabel: string;
  visitsMonthly: number;
  organicSharePct: number | null;
  paidSharePct: number | null;
  bouncePct: number | null;
  pagesPerVisit: number | null;
  clusters: unknown;
  sourceKind: string;
  createdByUserId: string | null;
  createdAt: Date | string;
}) {
  return {
    id: snap.id,
    domain: snap.domain,
    periodLabel: snap.periodLabel,
    visitsMonthly: snap.visitsMonthly,
    organicSharePct: snap.organicSharePct,
    paidSharePct: snap.paidSharePct,
    bouncePct: snap.bouncePct,
    pagesPerVisit: snap.pagesPerVisit,
    clusters: snap.clusters,
    sourceKind: snap.sourceKind,
    createdByUserId: snap.createdByUserId,
    createdAt: toIso(snap.createdAt),
  };
}

function parseSnapshotClusters(
  snapshotId: string,
  domain: string,
  rawClusters: unknown,
): CompetitorClusterInput[] {
  const { clusters } = decodeSimilarwebClustersPayload(rawClusters);
  return clusters.map((item) => ({
    snapshotId,
    domain,
    phrase: item.phrase,
    trafficSharePct: item.trafficSharePct,
    channel: item.channel,
    mappedTargetUrl: item.mappedTargetUrl,
    notes: item.notes ?? null,
  }));
}

async function loadLiveTopvisorRows(): Promise<{
  configured: boolean;
  rows: TopvisorPositionInput[];
  error: string | null;
}> {
  if (!isTopvisorConfigured()) {
    return { configured: false, rows: [], error: null };
  }

  const now = new Date();
  const from = new Date(now.getTime() - 30 * 86_400_000);
  const dateFrom = from.toISOString().slice(0, 10);
  const dateTo = now.toISOString().slice(0, 10);

  let yandexMatrix: PositionMatrix | null = null;
  let googleMatrix: PositionMatrix | null = null;
  let errorMsg: string | null = null;

  const [yandexRes, googleRes] = await Promise.allSettled([
    getPositionsHistory({ regionIndex: 1, dateFrom, dateTo }),
    getPositionsHistory({ regionIndex: 2, dateFrom, dateTo }),
  ]);

  if (yandexRes.status === "fulfilled") {
    yandexMatrix = yandexRes.value;
  } else {
    errorMsg =
      yandexRes.reason instanceof Error
        ? yandexRes.reason.message
        : "Не удалось загрузить позиции Яндекса из Topvisor";
  }

  if (googleRes.status === "fulfilled") {
    googleMatrix = googleRes.value;
  }

  const mergedByPhrase = new Map<string, TopvisorPositionInput>();

  for (const row of yandexMatrix?.rows ?? []) {
    const key = row.phrase.trim().toLowerCase();
    if (!key) continue;
    mergedByPhrase.set(key, {
      phrase: row.phrase,
      yandexPos: row.latest !== null ? String(row.latest) : "--",
      googlePos: "--",
      relevantUrl: row.latestUrl,
    });
  }

  for (const row of googleMatrix?.rows ?? []) {
    const key = row.phrase.trim().toLowerCase();
    if (!key) continue;
    const existing = mergedByPhrase.get(key);
    if (existing) {
      existing.googlePos = row.latest !== null ? String(row.latest) : "--";
      if (!existing.relevantUrl && row.latestUrl) {
        existing.relevantUrl = row.latestUrl;
      }
    } else {
      mergedByPhrase.set(key, {
        phrase: row.phrase,
        yandexPos: "--",
        googlePos: row.latest !== null ? String(row.latest) : "--",
        relevantUrl: row.latestUrl,
      });
    }
  }

  return {
    configured: true,
    rows: [...mergedByPhrase.values()],
    error: errorMsg,
  };
}

export async function GET(_request: Request) {
  await requireRoot();

  await ensureDefaultSimilarwebSnapshots(db);

  const [snapshotsRaw, ordersRaw, blogArticles, topvisor] = await Promise.all([
    db.seoCompetitorSnapshot.findMany({
      orderBy: [{ createdAt: "desc" }, { domain: "asc" }],
    }),
    db.gglOrder.findMany({
      where: { campaign: { isWesetup: true } },
      select: {
        targetUrl: true,
        anchor: true,
        status: true,
      },
    }),
    db.article
      ? db.article
          .findMany({
            where: { publishedAt: { not: null } },
            select: { slug: true, title: true, excerpt: true, tags: true },
          })
          .catch(() => [])
      : Promise.resolve([]),
    loadLiveTopvisorRows(),
  ]);

  // Use the freshest snapshot per domain for active scoring
  const seenDomains = new Set<string>();
  const activeClusters: CompetitorClusterInput[] = [];
  for (const snap of snapshotsRaw) {
    const normDomain = normalizeDomainName(snap.domain);
    if (!normDomain || seenDomains.has(normDomain)) continue;
    seenDomains.add(normDomain);
    activeClusters.push(
      ...parseSnapshotClusters(snap.id, normDomain, snap.clusters),
    );
  }

  const extraPages: CandidateSitePage[] = [
    ...blogArticles.map((art) => ({
      url: `/blog/${art.slug}`,
      title: art.title,
      facts: art.excerpt ? [art.excerpt] : [],
      keywords: art.tags ?? [],
    })),
    ...activeClusters
      .map((cluster) => normalizeWesetupPath(cluster.mappedTargetUrl))
      .filter((url): url is string => Boolean(url))
      .map((url) => ({ url, title: url })),
  ];

  const candidatePages = buildDefaultCandidateSitePages(extraPages);
  const priorityMatrix = scoreTargetPages({
    clusters: activeClusters,
    topvisorRows: topvisor.rows,
    existingOrders: ordersRaw,
    candidatePages,
  });

  let similarwebConnection: SimilarwebConnectionStatus | null = null;
  try {
    similarwebConnection = getSimilarwebConnectionStatus();
  } catch {
    similarwebConnection = null;
  }

  const serializedSnapshots = snapshotsRaw.map(serializeSnapshot);
  const benchmark = buildCompetitorBenchmarkReport({
    snapshots: serializedSnapshots,
    topvisorRows: topvisor.rows,
    existingOrders: ordersRaw,
  });

  return NextResponse.json({
    snapshots: serializedSnapshots,
    priorityMatrix,
    benchmark,
    topvisor: {
      configured: topvisor.configured,
      error: topvisor.error,
    },
    similarwebConnection,
  });
}

export async function POST(request: Request) {
  const session = await requireRoot();
  const contentType = (request.headers.get("content-type") ?? "").toLowerCase();

  let payload: ParsedSimilarwebSnapshot & {
    sourceKind: "agent_import" | "screenshot_ocr" | "manual";
  };

  try {
    if (contentType.includes("multipart/form-data")) {
      let form: FormData;
      try {
        form = await request.formData();
      } catch {
        return NextResponse.json(
          { error: "Не удалось прочитать загруженный скриншот Similarweb" },
          { status: 400 },
        );
      }

      const files = collectUploadedFiles(form);
      if (files.length === 0) {
        return NextResponse.json(
          { error: "Прикрепите скриншот Similarweb (JPG, PNG или WEBP)" },
          { status: 400 },
        );
      }
      if (files.length > VISION_MAX_PHOTOS) {
        return NextResponse.json(
          { error: `Не больше ${VISION_MAX_PHOTOS} скриншотов за один раз` },
          { status: 400 },
        );
      }

      const images: Uint8Array[] = [];
      for (const file of files) {
        if (file.size > VISION_MAX_PHOTO_BYTES) {
          return NextResponse.json(
            { error: "Скриншот больше 6 МБ — загрузите изображение меньшего размера" },
            { status: 413 },
          );
        }
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (!sniffImageMime(bytes)) {
          return NextResponse.json(
            { error: "Нужен скриншот в формате JPG, PNG или WEBP" },
            { status: 415 },
          );
        }
        images.push(bytes);
      }

      const extracted = await extractSimilarwebSnapshotFromImages({
        images,
        user: {
          id: session.user.id,
          name: session.user.name ?? session.user.email ?? null,
        },
      });

      const domainOverride = form.get("domain");
      const periodOverride = form.get("periodLabel");
      const cleanDomain =
        typeof domainOverride === "string" && domainOverride.trim()
          ? normalizeDomainName(domainOverride)
          : extracted.domain;
      const cleanPeriod =
        typeof periodOverride === "string" && periodOverride.trim()
          ? periodOverride.trim().slice(0, 100)
          : extracted.periodLabel;

      payload = {
        ...extracted,
        domain: cleanDomain || extracted.domain,
        periodLabel: cleanPeriod || extracted.periodLabel,
        sourceKind: "screenshot_ocr",
      };
    } else {
      const rawJson = await request.json().catch(() => null);

      // 1. Handle api-anything session/connection configuration save
      if (
        rawJson &&
        typeof rawJson === "object" &&
        (rawJson as { action?: unknown }).action === "save_connection"
      ) {
        const parsedConn = saveConnectionActionSchema.safeParse(rawJson);
        if (!parsedConn.success) {
          return NextResponse.json(
            {
              error:
                parsedConn.error.issues[0]?.message ??
                "Некорректные параметры сессии Similarweb",
            },
            { status: 400 },
          );
        }

        const connection = saveSimilarwebConnection({
          cookieInput: parsedConn.data.cookieInput,
          apiKey: parsedConn.data.apiKey,
          clear: parsedConn.data.clear,
        });

        await audit({
          orgId: platformOrgId(),
          action: "ggl.similarweb.connection",
          entity: "SeoCompetitorSnapshot",
          entityId: "similarweb-api-anything",
          actor: {
            id: session.user.id,
            name: session.user.name ?? session.user.email ?? "root",
          },
          details: {
            configured: connection.configured,
            cookieCount: connection.cookieCount,
            hasApiKey: connection.hasApiKey,
            cleared: Boolean(parsedConn.data.clear),
          },
        });

        return NextResponse.json({
          similarwebConnection: connection,
        });
      }

      // 2. Handle live domain sync via api-anything
      if (
        rawJson &&
        typeof rawJson === "object" &&
        (rawJson as { action?: unknown }).action === "sync_domain"
      ) {
        const parsedSync = syncDomainActionSchema.safeParse(rawJson);
        if (!parsedSync.success) {
          return NextResponse.json(
            {
              error:
                parsedSync.error.issues[0]?.message ??
                "Укажите домен для синхронизации через api-anything",
            },
            { status: 400 },
          );
        }

        const requestedDomains = [
          ...(parsedSync.data.domains ?? []),
          ...(parsedSync.data.domain ? [parsedSync.data.domain] : []),
        ]
          .map((d) => normalizeDomainName(d))
          .filter((d) => Boolean(d && d.includes(".")));

        const uniqueDomains = [...new Set(requestedDomains)];
        if (uniqueDomains.length === 0) {
          return NextResponse.json(
            { error: "Укажите корректный домен сайта (например, haccp-online.ru)" },
            { status: 400 },
          );
        }

        const blogArticles = db.article
          ? await db.article
              .findMany({
                where: { publishedAt: { not: null } },
                select: { slug: true, title: true, excerpt: true, tags: true },
              })
              .catch(() => [])
          : [];

        const candidatePages = buildDefaultCandidateSitePages(
          blogArticles.map((art) => ({
            url: `/blog/${art.slug}`,
            title: art.title,
            facts: art.excerpt ? [art.excerpt] : [],
            keywords: art.tags ?? [],
          })),
        );

        const savedSnapshots = [];
        for (const targetDomain of uniqueDomains) {
          const fetched = await fetchSimilarwebSnapshotViaApiAnything(
            targetDomain,
            { candidatePages },
          );
          const periodLabel =
            parsedSync.data.periodLabel?.trim() || fetched.periodLabel;
          const clustersJson = encodeSimilarwebClustersPayload(
            fetched.clusters,
            fetched.telemetry,
          ) as unknown as Prisma.InputJsonValue;

          const saved = await db.seoCompetitorSnapshot.upsert({
            where: {
              domain_periodLabel: {
                domain: fetched.domain,
                periodLabel,
              },
            },
            create: {
              domain: fetched.domain,
              periodLabel,
              visitsMonthly: fetched.visitsMonthly,
              organicSharePct: fetched.organicSharePct,
              paidSharePct: fetched.paidSharePct,
              bouncePct: fetched.bouncePct,
              pagesPerVisit: fetched.pagesPerVisit,
              clusters: clustersJson,
              sourceKind: "agent_import",
              createdByUserId: session.user.id ?? null,
            },
            update: {
              visitsMonthly: fetched.visitsMonthly,
              organicSharePct: fetched.organicSharePct,
              paidSharePct: fetched.paidSharePct,
              bouncePct: fetched.bouncePct,
              pagesPerVisit: fetched.pagesPerVisit,
              clusters: clustersJson,
              sourceKind: "agent_import",
              createdByUserId: session.user.id ?? null,
            },
          });

          await audit({
            orgId: platformOrgId(),
            action: "ggl.similarweb.import",
            entity: "SeoCompetitorSnapshot",
            entityId: saved.id,
            actor: {
              id: session.user.id,
              name: session.user.name ?? session.user.email ?? "root",
            },
            details: {
              domain: saved.domain,
              periodLabel: saved.periodLabel,
              visitsMonthly: saved.visitsMonthly,
              clustersCount: fetched.clusters.length,
              sourceKind: "agent_import",
              via: "api-anything",
            },
          });

          savedSnapshots.push(serializeSnapshot(saved));
        }

        return NextResponse.json({
          snapshot: savedSnapshots[0] ?? null,
          snapshots: savedSnapshots,
          similarwebConnection: getSimilarwebConnectionStatus(),
        });
      }

      const parsed = jsonSnapshotSchema.safeParse(rawJson);
      if (!parsed.success) {
        return NextResponse.json(
          {
            error:
              parsed.error.issues[0]?.message ??
              "Некорректные данные среза Similarweb",
          },
          { status: 400 },
        );
      }

      const cleanDomain = normalizeDomainName(parsed.data.domain);
      if (!cleanDomain || !cleanDomain.includes(".")) {
        return NextResponse.json(
          { error: "Укажите корректный домен сайта (например, haccp-online.ru)" },
          { status: 400 },
        );
      }

      payload = {
        domain: cleanDomain,
        periodLabel: parsed.data.periodLabel,
        visitsMonthly: parsed.data.visitsMonthly,
        organicSharePct: parsed.data.organicSharePct ?? null,
        paidSharePct: parsed.data.paidSharePct ?? null,
        bouncePct: parsed.data.bouncePct ?? null,
        pagesPerVisit: parsed.data.pagesPerVisit ?? null,
        sourceKind: parsed.data.sourceKind,
        clusters: parsed.data.clusters.map((cluster) => ({
          phrase: cluster.phrase,
          trafficSharePct: Math.round(cluster.trafficSharePct * 100) / 100,
          channel: cluster.channel,
          mappedTargetUrl:
            normalizeWesetupPath(cluster.mappedTargetUrl) ?? "/journals-info",
          ...(cluster.notes ? { notes: cluster.notes } : {}),
        })),
      };
    }

    const clustersJson = encodeSimilarwebClustersPayload(
      payload.clusters,
      payload.telemetry,
    ) as unknown as Prisma.InputJsonValue;

    const saved = await db.seoCompetitorSnapshot.upsert({
      where: {
        domain_periodLabel: {
          domain: payload.domain,
          periodLabel: payload.periodLabel,
        },
      },
      create: {
        domain: payload.domain,
        periodLabel: payload.periodLabel,
        visitsMonthly: payload.visitsMonthly,
        organicSharePct: payload.organicSharePct,
        paidSharePct: payload.paidSharePct,
        bouncePct: payload.bouncePct,
        pagesPerVisit: payload.pagesPerVisit,
        clusters: clustersJson,
        sourceKind: payload.sourceKind,
        createdByUserId: session.user.id ?? null,
      },
      update: {
        visitsMonthly: payload.visitsMonthly,
        organicSharePct: payload.organicSharePct,
        paidSharePct: payload.paidSharePct,
        bouncePct: payload.bouncePct,
        pagesPerVisit: payload.pagesPerVisit,
        clusters: clustersJson,
        sourceKind: payload.sourceKind,
        createdByUserId: session.user.id ?? null,
      },
    });

    await audit({
      orgId: platformOrgId(),
      action: "ggl.similarweb.import",
      entity: "SeoCompetitorSnapshot",
      entityId: saved.id,
      actor: {
        id: session.user.id,
        name: session.user.name ?? session.user.email ?? "root",
      },
      details: {
        domain: saved.domain,
        periodLabel: saved.periodLabel,
        visitsMonthly: saved.visitsMonthly,
        clustersCount: payload.clusters.length,
        sourceKind: payload.sourceKind,
      },
    });

    return NextResponse.json({
      snapshot: serializeSnapshot(saved),
    });
  } catch (err) {
    if (err instanceof GglAiError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.status },
      );
    }
    if (err instanceof SimilarwebAuthError) {
      return NextResponse.json(
        { error: err.message, code: "SIMILARWEB_AUTH" },
        { status: 401 },
      );
    }
    if (err instanceof SimilarwebCallError) {
      const status =
        err.swClass === "input"
          ? 400
          : err.swClass === "rate"
            ? 429
            : err.swClass === "blocked"
              ? 502
              : 502;
      return NextResponse.json(
        { error: err.message, code: err.swClass ?? "SIMILARWEB_CALL" },
        { status },
      );
    }
    console.error("[ggl-similarweb] unexpected error:", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Не удалось импортировать срез Similarweb",
      },
      { status: 500 },
    );
  }
}
