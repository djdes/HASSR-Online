import { NextResponse } from "next/server";

import { checkCronSecret } from "@/lib/cron-auth";
import { syncSberInvoicePayments } from "@/lib/sber/invoice-payments.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET/POST /api/cron/sber-payments — сверка выписки СберБизнес со счетами
 * (src/lib/sber/invoice-payments.server.ts): оплаченные счета отмечаются сами.
 *
 * Crontab (каждые 10 минут):
 *   0-59/10 * * * * curl -s -H "Authorization: Bearer $CRON_SECRET" https://wesetup.ru/api/cron/sber-payments
 */
async function handle(request: Request) {
  const cronAuth = checkCronSecret(request);
  if (cronAuth) return cronAuth;
  const result = await syncSberInvoicePayments({ trigger: "cron" });
  return NextResponse.json(result);
}

export const GET = handle;
export const POST = handle;
