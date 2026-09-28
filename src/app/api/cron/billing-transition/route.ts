import { NextResponse } from "next/server";

import { checkCronSecret } from "@/lib/cron-auth";
import { runBillingTransitionJob } from "@/lib/billing.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET/POST /api/cron/billing-transition — ежедневный переход на оплату
 * после бесплатного периода (настройки — ROOT → «Тарифы»).
 *
 *   • ≤ 1 активного и тариф ещё «платный» без оплаты — молча бесплатный,
 *     одно информационное уведомление;
 *   • > 1 и срок выбора идёт — одно предупреждение «выберите до …»;
 *   • > 1 и срок выбора прошёл — автопереход: остаётся владелец аккаунта,
 *     остальные в архив, уведомление в Telegram и на почту.
 *
 * До конца периода (или с выключенным переходом) ничего не делает.
 * Реально оплаченные аккаунты не трогает. Повторный запуск безопасен.
 * `?dryRun=1` — только посчитать.
 *
 * Crontab (раз в сутки, после полуночи МСК):
 *   15 3 * * * curl -s -H "Authorization: Bearer $CRON_SECRET" https://wesetup.ru/api/cron/billing-transition
 */
async function handle(request: Request) {
  const cronAuth = checkCronSecret(request);
  if (cronAuth) return cronAuth;
  const dryRun = new URL(request.url).searchParams.get("dryRun") === "1";
  const report = await runBillingTransitionJob({ dryRun });
  return NextResponse.json(report);
}

export const GET = handle;
export const POST = handle;
