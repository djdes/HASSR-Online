import { NextResponse } from "next/server";
import { z } from "zod";

import { logAudit } from "@/lib/audit";
import { buildingTargets } from "@/lib/building-targets";
import { db } from "@/lib/db";
import { decryptSecret } from "@/lib/integration-crypto";
import type { IikoStoredCredentials } from "@/lib/supply/connections";
import { guardSupply } from "@/lib/supply/guard.server";
import { createIikoClient, IikoError } from "@/lib/supply/iiko";
import { assertPublicServerUrl, UnsafeUrlError } from "@/lib/supply/safe-url";
import { IIKO_STORE_SKIP, iikoStoreViews, readIikoStorePoints } from "@/lib/supply/supply-points";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Склады iiko и их торговые точки (2026-11-01): накладные и акты списания
 * склада попадают на его точку.
 *
 * GET — войти в iiko, забрать склады и подразделения, запомнить список
 * (без секретов) и вернуть его с сохранённым сопоставлением.
 * PUT `{ map: { [storeId]: buildingId | "skip" } }` — сохранить; склад без
 * значения — без точки (точку выберут при приёмке).
 */
export async function GET(_request: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { organizationId, denied } = await guardSupply();
  if (denied) return denied;
  if ((await params).provider !== "iiko") return NextResponse.json({ error: "Склады есть только у iiko" }, { status: 404 });
  const row = await db.supplyConnection.findUnique({
    where: { organizationId_provider: { organizationId, provider: "iiko" } },
    select: { id: true, credentialsEnc: true, storePoints: true },
  });
  if (!row) return NextResponse.json({ error: "Сначала подключите iiko" }, { status: 400 });
  try {
    const creds = JSON.parse(decryptSecret(row.credentialsEnc)) as IikoStoredCredentials;
    const serverUrl = await assertPublicServerUrl(creds.serverUrl);
    const { stores, departments } = await createIikoClient({ ...creds, serverUrl }).withSession(async (session) => ({
      // По очереди: одна сессия iiko — один запрос за раз.
      stores: await session.stores(),
      departments: await session.departments(),
    }));
    const saved = readIikoStorePoints(row.storePoints);
    const views = iikoStoreViews(stores, departments);
    await db.supplyConnection.update({ where: { id: row.id }, data: { storePoints: { stores: views, map: saved.map } } });
    return NextResponse.json({ stores: views, map: saved.map });
  } catch (error) {
    if (error instanceof IikoError || error instanceof UnsafeUrlError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}

const putSchema = z.object({
  map: z.record(z.string().min(1).max(100), z.string().min(1).max(100)).refine((map) => Object.keys(map).length <= 500),
});

export async function PUT(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { session, organizationId, denied } = await guardSupply();
  if (denied) return denied;
  if ((await params).provider !== "iiko") return NextResponse.json({ error: "Склады есть только у iiko" }, { status: 404 });
  const parsed = putSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Некорректное сопоставление складов" }, { status: 400 });
  const row = await db.supplyConnection.findUnique({
    where: { organizationId_provider: { organizationId, provider: "iiko" } },
    select: { id: true, storePoints: true },
  });
  if (!row) return NextResponse.json({ error: "Сначала подключите iiko" }, { status: 400 });
  // Только точки этой организации (при включённых точках) или «не загружать».
  const points = new Set((await buildingTargets(organizationId)).filter((id): id is string => id !== null));
  const bad = Object.values(parsed.data.map).some((target) => target !== IIKO_STORE_SKIP && !points.has(target));
  if (bad) return NextResponse.json({ error: "Такой точки нет в организации" }, { status: 400 });
  const saved = readIikoStorePoints(row.storePoints);
  await db.supplyConnection.update({
    where: { id: row.id },
    data: { storePoints: { stores: saved.stores, map: parsed.data.map } },
  });
  await logAudit({
    organizationId,
    userId: session.user.id,
    userName: session.user.name ?? undefined,
    action: "supply.iiko_stores",
    entity: "SupplyConnection",
    entityId: row.id,
    details: { mapped: Object.keys(parsed.data.map).length },
  });
  return NextResponse.json({ ok: true, map: parsed.data.map });
}
