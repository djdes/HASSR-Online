import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { checkCronSecret } from "@/lib/cron-auth";
import { notifyOrganization } from "@/lib/telegram";
import { NOT_DIRECTORY_ORG_WHERE } from "@/lib/master-directory";
import { buildMiniAppUrl, getMiniAppBaseUrlFromEnv } from "@/lib/journal-obligation-links";
import { PPK_RECORD_SCHEMAS, type LabPlanItem, type PestPlanItem } from "@/lib/ppk/records";
import { collectPpkReminders, ppkReminderMessage } from "@/lib/ppk/reminders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Напоминания руководству в Telegram о сроках лабораторных исследований и
 * дезмероприятий из планов «Производственного контроля» (`PpkRecord`,
 * блоки `lab-plan` и `pest-plan`): за 7, 3, 1 день, в день срока и при просрочке.
 *
 * Расписание: ежедневно 09:00 МСК. Crontab сервера живёт по Москве (как соседние задачи):
 *   0 9 * * * curl -s -m 120 -H "Authorization: Bearer <CRON_SECRET>" http://127.0.0.1:3002/api/cron/ppk-reminders
 *
 * `?dryRun=1` — ничего не отправлять, только посчитать организации и пункты.
 */

/** Сегодняшняя дата по Москве (UTC+3, без перехода на летнее время), YYYY-MM-DD. */
function moscowToday(now: Date = new Date()): string {
  return new Date(now.getTime() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

type OrgPlans = { lab: LabPlanItem[]; pest: PestPlanItem[] };

async function handle(request: Request) {
  const cronAuth = checkCronSecret(request);
  if (cronAuth) return cronAuth;

  try {
    const dryRun = new URL(request.url).searchParams.get("dryRun") === "1";
    const today = moscowToday();

    // Мастер-кабинет (directory) рассылок не получает — как в compliance.
    const records = await db.ppkRecord.findMany({
      where: {
        block: { in: ["lab-plan", "pest-plan"] },
        organization: NOT_DIRECTORY_ORG_WHERE,
      },
      select: { organizationId: true, block: true, data: true },
    });

    const byOrg = new Map<string, OrgPlans>();
    for (const row of records) {
      const parsed = PPK_RECORD_SCHEMAS[row.block as "lab-plan" | "pest-plan"].safeParse(row.data);
      if (!parsed.success) continue;
      let plans = byOrg.get(row.organizationId);
      if (!plans) {
        plans = { lab: [], pest: [] };
        byOrg.set(row.organizationId, plans);
      }
      if (row.block === "lab-plan") plans.lab.push(parsed.data as LabPlanItem);
      else plans.pest.push(parsed.data as PestPlanItem);
    }

    const miniBase = getMiniAppBaseUrlFromEnv();
    let organizations = 0;
    let itemsTotal = 0;

    for (const [orgId, plans] of byOrg) {
      try {
        const items = collectPpkReminders({ lab: plans.lab, pest: plans.pest, today });
        if (items.length === 0) continue;
        organizations += 1;
        itemsTotal += items.length;
        if (dryRun) continue;

        const path = items[0].block === "lab"
          ? "/production-control/sanitation/lab"
          : "/production-control/sanitation/pest-control";
        const miniAppUrl = buildMiniAppUrl(miniBase, path);
        await notifyOrganization(
          orgId,
          ppkReminderMessage(items),
          ["owner", "technologist"],
          "compliance",
          miniAppUrl ? { label: "Открыть план", miniAppUrl } : undefined,
        );
      } catch (error) {
        console.error(`[cron/ppk-reminders] org ${orgId}`, error);
      }
    }

    return NextResponse.json(
      dryRun
        ? { dryRun: true, organizations, items: itemsTotal }
        : { organizations, items: itemsTotal },
    );
  } catch (error) {
    console.error("[cron/ppk-reminders]", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
