import { NextResponse } from "next/server";

import { checkCronSecret } from "@/lib/cron-auth";
import { runBillingTransitionJob } from "@/lib/billing.server";
import { runNewcomerJourney } from "@/lib/newcomer-journey.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET/POST /api/cron/billing-transition — ежедневная задача тарифов 2026-10
 * (настройки — ROOT → «Тарифы»).
 *
 *   • за 3 дня до конца пробного — одно напоминание владельцу;
 *   • после пробного в пределах бесплатного (1 сотрудник и 1 журнал), но
 *     тариф ещё записан платным — молча бесплатный, одно уведомление;
 *   • сверх бесплатного и срок выбора идёт — одно предупреждение «выберите до …»;
 *   • сверх бесплатного и срок выбора прошёл — автопереход: остаются владелец
 *     аккаунта и самый заполняемый журнал, остальные сотрудники в архив,
 *     остальные журналы выключаются, уведомление в Telegram и на почту.
 *
 * Здесь же — письма первых шагов новичкам (`runNewcomerJourney`, до трёх
 * писем на организацию за 2–14 дни): у этой задачи уже есть расписание.
 *
 * С выключенным переходом лимиты не применяет. Реально оплаченные аккаунты
 * не трогает. Повторный запуск безопасен. `?dryRun=1` — только посчитать.
 *
 * Crontab (раз в сутки, после полуночи МСК):
 *   15 3 * * * curl -s -H "Authorization: Bearer $CRON_SECRET" https://wesetup.ru/api/cron/billing-transition
 */
async function handle(request: Request) {
  const cronAuth = checkCronSecret(request);
  if (cronAuth) return cronAuth;
  const dryRun = new URL(request.url).searchParams.get("dryRun") === "1";
  const report = await runBillingTransitionJob({ dryRun });
  // Письма новичкам не должны ронять биллинг — и наоборот.
  const journey = await runNewcomerJourney({ dryRun }).catch((error: unknown) => {
    console.error("[billing-transition] newcomer journey failed", error);
    return null;
  });
  return NextResponse.json({ ...report, journey });
}

export const GET = handle;
export const POST = handle;
