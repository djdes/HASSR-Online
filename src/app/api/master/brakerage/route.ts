import { NextResponse } from "next/server";
import { z } from "zod";

import { recordAuditLog } from "@/lib/audit-log";
import { addMasterBrakerageToPool } from "@/lib/master-brakerage";
import {
  isValidIsoDate,
  MASTER_BRAKERAGE_ROWS_MAX,
  normalizeMasterBrakerageRows,
  productionDateTimeFor,
} from "@/lib/master-brakerage-plan";
import { normalizeTypedTime } from "@/lib/finished-product-bulk";
import { requireMasterDirectorySession } from "@/lib/master-directory-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * «Добавить в журналы на дату»: строки бракеража готовой продукции — в БЖГП
 * всех пищеблоков пула мастер-кабинета.
 *   POST { date, rows, common, dryRun: true }  — предпросмотр: куда и сколько;
 *   POST { … , dryRun: false }                 — запись (+ AuditLog у мастера и пищеблоков).
 */

const rowSchema = z.object({
  name: z.string().max(500),
  yield: z.string().max(100).default(""),
  time: z.string().max(20).default(""),
});
const bodySchema = z.object({
  date: z.string().max(10),
  rows: z.array(rowSchema).max(MASTER_BRAKERAGE_ROWS_MAX * 2),
  common: z.object({
    time: z.string().max(20).default(""),
    organoleptic: z.string().max(80).default(""),
    releaseAllowed: z.enum(["yes", "no"]).default("yes"),
    productTemp: z.string().max(20).default(""),
    note: z.string().max(500).default(""),
  }),
  dryRun: z.boolean().default(true),
});

export async function POST(request: Request) {
  const auth = await requireMasterDirectorySession();
  if (!auth.ok) return auth.response;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Не удалось прочитать список. Обновите страницу и попробуйте ещё раз." }, { status: 400 });
  }
  const { date, dryRun } = parsed.data;
  if (!isValidIsoDate(date)) {
    return NextResponse.json({ error: "Выберите дату изготовления" }, { status: 400 });
  }
  const rows = normalizeMasterBrakerageRows(parsed.data.rows);
  if (rows.length === 0) {
    return NextResponse.json({ error: "Впишите хотя бы одно наименование" }, { status: 400 });
  }
  if (rows.length > MASTER_BRAKERAGE_ROWS_MAX) {
    return NextResponse.json(
      { error: `За один раз можно добавить не больше ${MASTER_BRAKERAGE_ROWS_MAX} строк` },
      { status: 400 }
    );
  }
  const common = { ...parsed.data.common, date, time: normalizeTypedTime(parsed.data.common.time) };
  const withoutTime = rows.filter((row) => !productionDateTimeFor(row, common)).map((row) => row.name);
  if (withoutTime.length > 0) {
    return NextResponse.json(
      {
        error: `Укажите время изготовления: общее «Время для всех строк» или у строк — ${withoutTime.slice(0, 5).join(", ")}${
          withoutTime.length > 5 ? "…" : ""
        }`,
      },
      { status: 400 }
    );
  }

  const result = await addMasterBrakerageToPool({ masterOrgId: auth.masterOrgId, rows, common, dryRun });
  console.info(dryRun ? "[master-brakerage] preview" : "[master-brakerage] added", {
    masterOrgId: auth.masterOrgId,
    date,
    rows: rows.length,
    ...result.totals,
  });

  if (!dryRun) {
    await recordAuditLog({
      request,
      session: auth.session,
      organizationId: auth.masterOrgId,
      action: "master_brakerage.added",
      entity: "JournalDocument",
      entityId: auth.masterOrgId,
      details: {
        date,
        rows: rows.length,
        ...result.totals,
        organizations: result.organizations.map((org) => ({
          organizationId: org.organizationId,
          documentId: org.documentId,
          documentCreated: org.documentCreated,
          added: org.added,
          skipped: org.skipped,
          error: org.error,
        })),
      },
    });
    // Пищеблок видит в своём журнале действий, откуда пришли строки.
    for (const org of result.organizations) {
      if (org.added === 0 || !org.documentId) continue;
      await recordAuditLog({
        request,
        session: auth.session,
        organizationId: org.organizationId,
        action: "master_brakerage.received",
        entity: "JournalDocument",
        entityId: org.documentId,
        details: { date, added: org.added, skipped: org.skipped, documentCreated: org.documentCreated, masterOrgId: auth.masterOrgId },
      });
    }
  }

  return NextResponse.json(result);
}
