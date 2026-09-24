import { NextResponse } from "next/server";

import { checkCronSecret } from "@/lib/cron-auth";
import { db } from "@/lib/db";
import { sendRawEmail } from "@/lib/email";
import { notifyOrganization } from "@/lib/telegram";
import { buildWeeklyDigestData, weeklyDigestRecipients } from "@/lib/weekly-digest/build";
import { renderWeeklyDigestEmail, renderWeeklyDigestTelegram } from "@/lib/weekly-digest/render";
import { isDigestSlot, shouldSendWeeklyDigest } from "@/lib/weekly-digest/schedule";
import { sendRootHealthEmail } from "@/lib/root-health-email";
import { NOT_DIRECTORY_ORG_WHERE } from "@/lib/master-directory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Еженедельная сводка руководству: письмо и сообщение в Telegram.
 *
 *   GET/POST /api/cron/weekly-digest            (Authorization: Bearer $CRON_SECRET)
 *
 * Крон дёргает маршрут каждый час; отправка — в понедельник в 08:00 по
 * часовому поясу организации (`Organization.timezone`), не чаще раза в
 * шесть дней (`weeklyDigestSentAt`). Что внутри: заполнено/пропущено,
 * отклонения температуры, кто не отмечался, что истекает (медкнижки,
 * поверки, партии, подписка), TasksFlow. Письмо каждый руководитель
 * выключает в «Настройки → Уведомления»; Telegram — по подписке на
 * оповещения «compliance».
 *
 * Для проверки: `?orgId=<id>&force=1` — одна организация сейчас,
 * `&to=<email>` — письмо только на этот адрес (отметка об отправке при
 * этом не ставится).
 */
async function handle(request: Request) {
  const cronAuth = checkCronSecret(request);
  if (cronAuth) return cronAuth;
  const { searchParams } = new URL(request.url);
  const orgIdFilter = searchParams.get("orgId");
  const force = searchParams.get("force") === "1";
  const toOverride = orgIdFilter ? searchParams.get("to")?.trim() || null : null;
  const now = new Date();
  const baseUrl = process.env.NEXTAUTH_URL || "https://wesetup.ru";

  const orgs = await db.organization.findMany({
    where: orgIdFilter ? { id: orgIdFilter, ...NOT_DIRECTORY_ORG_WHERE } : NOT_DIRECTORY_ORG_WHERE,
    select: { id: true, timezone: true, weeklyDigestSentAt: true },
  });

  const results: Array<{ orgId: string; reason: string; emails?: string[]; emailOk?: boolean; telegram?: boolean }> = [];
  let sent = 0;
  let skipped = 0;
  let errors = 0;

  for (const org of orgs) {
    const decision = shouldSendWeeklyDigest({ now, timeZone: org.timezone, lastSentAt: org.weeklyDigestSentAt, force });
    if (!decision.send) {
      skipped += 1;
      results.push({ orgId: org.id, reason: decision.reason });
      continue;
    }
    try {
      const data = await buildWeeklyDigestData(org.id, now);
      if (!data || data.totalSlots === 0) {
        skipped += 1;
        results.push({ orgId: org.id, reason: "no-journals" });
        continue;
      }

      const recipients = toOverride ? [toOverride] : await weeklyDigestRecipients(org.id);
      const email = renderWeeklyDigestEmail(data, baseUrl);
      let emailOk = false;
      for (const to of recipients) {
        if (await sendRawEmail(to, email.subject, email.html)) emailOk = true;
      }

      let telegram = false;
      if (!toOverride) {
        await notifyOrganization(org.id, renderWeeklyDigestTelegram(data), ["owner", "manager"], "compliance", {
          label: "📊 Открыть дашборд",
          miniAppUrl: `${baseUrl}/dashboard`,
        });
        telegram = true;
        await db.organization.update({ where: { id: org.id }, data: { weeklyDigestSentAt: now } });
      }
      sent += 1;
      results.push({ orgId: org.id, reason: decision.reason, emails: recipients, emailOk, telegram });
    } catch (err) {
      errors += 1;
      results.push({ orgId: org.id, reason: "error" });
      console.error("[weekly-digest] org error", org.id, err);
    }
  }

  // Письмо ROOT «здоровье клиентов» — в тот же понедельничный слот по Москве
  // (или ?rootHealth=1 для проверки; с orgId не шлём — это разовая отладка).
  const rootHealthForce = searchParams.get("rootHealth") === "1";
  const rootHealth =
    rootHealthForce || (!orgIdFilter && isDigestSlot(now, "Europe/Moscow"))
      ? await sendRootHealthEmail({ now, force: rootHealthForce, to: rootHealthForce ? searchParams.get("to")?.trim() || null : null }).catch((error) => ({ sent: false, reason: `error: ${String(error).slice(0, 120)}` }))
      : { sent: false, reason: "not-slot" };

  return NextResponse.json({ ok: true, now: now.toISOString(), sent, skipped, errors, total: orgs.length, results, rootHealth });
}

export const GET = handle;
export const POST = handle;
