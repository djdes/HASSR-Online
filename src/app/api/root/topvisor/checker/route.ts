import { NextResponse } from "next/server";

import { requireRoot } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import {
  type StoredTopvisorCheckState,
  TopvisorError,
  countFilledPositionsOnLatestDate,
  evaluateActiveCheckStatus,
  fetchProjectCheckerProgress,
  getCheckerPrice,
  getPositionsHistory,
  isTopvisorConfigured,
  parseStoredCheckState,
  runChecker,
} from "@/lib/topvisor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CHECKER_STATE_KEY = "seo.topvisor.activeCheck";

function parseRegions(raw: string | null): number[] {
  const parsed = (raw ?? "")
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isFinite(value) && value > 0);
  return [...new Set(parsed)];
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function failure(error: unknown) {
  if (error instanceof TopvisorError) {
    return NextResponse.json(
      { error: `Topvisor: ${error.message}`, code: error.code },
      { status: 502 }
    );
  }
  throw error;
}

async function readActiveCheck() {
  const row = await db.platformSetting
    .findUnique({ where: { key: CHECKER_STATE_KEY } })
    .catch(() => null);
  const stored = parseStoredCheckState(row?.value);
  const remoteProgress = await fetchProjectCheckerProgress();
  const status = evaluateActiveCheckStatus({
    stored,
    remoteProgress,
  });
  if (!status && stored) {
    await db.platformSetting
      .deleteMany({ where: { key: CHECKER_STATE_KEY } })
      .catch(() => null);
  }
  return status;
}

/**
 * GET /api/root/topvisor/checker?regions=1,5 — сколько будет стоить съём
 * и не идёт ли съём прямо сейчас.
 *
 * Съём позиций платный (0,09 ₽ за пару «фраза × регион»), поэтому цена
 * спрашивается ДО запуска и показывается в подтверждении. Списывать
 * деньги молчаливым кликом нельзя.
 */
export async function GET(request: Request) {
  await requireRoot();
  if (!isTopvisorConfigured()) {
    return NextResponse.json({ error: "Topvisor не настроен" }, { status: 400 });
  }

  const regions = parseRegions(new URL(request.url).searchParams.get("regions"));
  const activeCheck = await readActiveCheck();

  if (regions.length === 0) {
    return NextResponse.json({
      checking: Boolean(activeCheck),
      activeCheck,
    });
  }

  try {
    return NextResponse.json({
      regions,
      price: await getCheckerPrice(regions),
      checking: Boolean(activeCheck),
      activeCheck,
    });
  } catch (error) {
    return failure(error);
  }
}

/**
 * POST — поставить проверку позиций в очередь. Тратит деньги.
 *
 * Цену пересчитываем на сервере и возвращаем вместе с результатом: то,
 * что показали в диалоге, и то, что реально спишется, должно совпадать,
 * даже если вкладка висела открытой полчаса.
 */
export async function POST(request: Request) {
  await requireRoot();
  if (!isTopvisorConfigured()) {
    return NextResponse.json({ error: "Topvisor не настроен" }, { status: 400 });
  }

  const body = (await request.json().catch(() => null)) as {
    regions?: unknown;
  } | null;
  const regions = [
    ...new Set(
      (Array.isArray(body?.regions) ? body.regions : [])
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value > 0)
    ),
  ];

  if (regions.length === 0) {
    return NextResponse.json({ error: "Не выбраны регионы" }, { status: 400 });
  }

  const existing = await readActiveCheck();
  if (existing) {
    return NextResponse.json(
      {
        error: "Съём позиций уже выполняется — дождитесь завершения текущей проверки",
        checking: true,
        activeCheck: existing,
      },
      { status: 409 }
    );
  }

  try {
    const to = new Date();
    const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
    const baselineMatrix = await getPositionsHistory({
      regionIndex: regions[0] ?? 1,
      dateFrom: isoDate(from),
      dateTo: isoDate(to),
    }).catch(() => null);

    const price = await getCheckerPrice(regions);
    const queued = await runChecker(regions);

    if (queued) {
      const state: StoredTopvisorCheckState = {
        startedAt: new Date().toISOString(),
        price,
        regions,
        baselineDates: baselineMatrix?.dates ?? [],
        baselineFilledCount: baselineMatrix
          ? countFilledPositionsOnLatestDate(baselineMatrix)
          : 0,
      };
      await db.platformSetting
        .upsert({
          where: { key: CHECKER_STATE_KEY },
          create: { key: CHECKER_STATE_KEY, value: JSON.stringify(state) },
          update: { value: JSON.stringify(state) },
        })
        .catch(() => null);

      const activeCheck = evaluateActiveCheckStatus({ stored: state });
      return NextResponse.json({
        queued: true,
        price,
        checking: true,
        activeCheck,
      });
    }

    return NextResponse.json({ queued: false, price, checking: false });
  } catch (error) {
    return failure(error);
  }
}

