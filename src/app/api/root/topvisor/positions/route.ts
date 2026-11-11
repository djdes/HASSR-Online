import { NextResponse } from "next/server";

import { requireRoot } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import {
  TopvisorError,
  evaluateActiveCheckStatus,
  fetchProjectCheckerProgress,
  getPositionsHistory,
  isTopvisorConfigured,
  parseStoredCheckState,
  summarize,
} from "@/lib/topvisor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Максимум окна — чтобы случайный ?days=100000 не тянул годы истории. */
const MAX_DAYS = 180;
const DEFAULT_DAYS = 30;
const CHECKER_STATE_KEY = "seo.topvisor.activeCheck";

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * GET /api/root/topvisor/positions?region=1&days=30
 *
 * Витрина, а не хранилище: ходим в Topvisor при каждом запросе, свою
 * копию истории не держим (см. спеку, раздел «Что осознанно не делаем»).
 * Ключ Topvisor остаётся на сервере — браузер видит только этот роут.
 */
export async function GET(request: Request) {
  await requireRoot();

  if (!isTopvisorConfigured()) {
    return NextResponse.json(
      {
        configured: false,
        error:
          "Topvisor не настроен: задайте TOPVISOR_API_KEY, TOPVISOR_USER_ID и TOPVISOR_PROJECT_ID",
      },
      { status: 200 }
    );
  }

  const url = new URL(request.url);
  const regionIndex = Number(url.searchParams.get("region") ?? 1);
  const requestedDays = Number(url.searchParams.get("days") ?? DEFAULT_DAYS);
  const days = Number.isFinite(requestedDays)
    ? Math.min(Math.max(Math.trunc(requestedDays), 1), MAX_DAYS)
    : DEFAULT_DAYS;

  if (!Number.isFinite(regionIndex) || regionIndex <= 0) {
    return NextResponse.json({ error: "Некорректный регион" }, { status: 400 });
  }

  const to = new Date();
  const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);

  try {
    const [matrix, storedRow, remoteProgress] = await Promise.all([
      getPositionsHistory({
        regionIndex,
        dateFrom: isoDate(from),
        dateTo: isoDate(to),
      }),
      db.platformSetting
        .findUnique({ where: { key: CHECKER_STATE_KEY } })
        .catch(() => null),
      fetchProjectCheckerProgress(),
    ]);

    const stored = parseStoredCheckState(storedRow?.value);
    const activeCheck = evaluateActiveCheckStatus({
      stored,
      remoteProgress,
      matrix,
    });

    if (!activeCheck && stored) {
      await db.platformSetting
        .deleteMany({ where: { key: CHECKER_STATE_KEY } })
        .catch(() => null);
    }

    return NextResponse.json({
      configured: true,
      regionIndex,
      days,
      matrix,
      summary: summarize(matrix),
      checking: Boolean(activeCheck),
      activeCheck,
    });
  } catch (error) {
    if (error instanceof TopvisorError) {
      return NextResponse.json(
        { error: `Topvisor: ${error.message}`, code: error.code },
        { status: 502 }
      );
    }
    throw error;
  }
}

