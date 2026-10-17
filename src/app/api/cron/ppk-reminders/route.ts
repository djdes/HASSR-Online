import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { checkCronSecret } from "@/lib/cron-auth";
import { listOrganizationRecipients, pushToOrganizationRecipients, sendTelegramMessage } from "@/lib/telegram";
import { NOT_DIRECTORY_ORG_WHERE } from "@/lib/master-directory";
import { buildMiniAppUrl, getMiniAppBaseUrlFromEnv } from "@/lib/journal-obligation-links";
import {
  PPK_RECORD_SCHEMAS,
  type DocVersion,
  type LabPlanItem,
  type PestPlanItem,
  type PolicyData,
  type TeamMeeting,
} from "@/lib/ppk/records";
import { buildPpkReminderKeyboard, collectPpkReminders, collectReviewReminders, ppkReminderMessage } from "@/lib/ppk/reminders";
import { moscowToday } from "@/lib/ppk/plan-done";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Напоминания руководству в Telegram о сроках лабораторных исследований и
 * дезмероприятий из планов «Производственного контроля» (`PpkRecord`,
 * блоки `lab-plan` и `pest-plan`): за 7, 3, 1 день, в день срока и при просрочке.
 * Туда же — пересмотр политики, ППК и ХАССП-плана (раз в год) и очередное заседание группы (раз в квартал).
 *
 * Расписание: ежедневно 09:00 МСК. Crontab сервера живёт по Москве (как соседние задачи):
 *   0 9 * * * curl -s -m 120 -H "Authorization: Bearer <CRON_SECRET>" http://127.0.0.1:3002/api/cron/ppk-reminders
 *
 * `?dryRun=1` — ничего не отправлять, только посчитать организации и пункты.
 */

type OrgPlans = {
  lab: (LabPlanItem & { id: string })[];
  pest: (PestPlanItem & { id: string })[];
  policy: PolicyData | null;
  versions: DocVersion[];
  meetings: TeamMeeting[];
  teamSize: number;
};

const BLOCKS = ["lab-plan", "pest-plan", "policy", "doc-versions", "team-meetings", "team"] as const;

async function handle(request: Request) {
  const cronAuth = checkCronSecret(request);
  if (cronAuth) return cronAuth;

  try {
    const dryRun = new URL(request.url).searchParams.get("dryRun") === "1";
    const today = moscowToday();

    // Мастер-кабинет (directory) рассылок не получает — как в compliance.
    const records = await db.ppkRecord.findMany({
      where: {
        block: { in: [...BLOCKS] },
        organization: NOT_DIRECTORY_ORG_WHERE,
      },
      select: { id: true, organizationId: true, block: true, data: true },
    });

    const byOrg = new Map<string, OrgPlans>();
    for (const row of records) {
      const parsed = PPK_RECORD_SCHEMAS[row.block as (typeof BLOCKS)[number]].safeParse(row.data);
      if (!parsed.success) continue;
      let plans = byOrg.get(row.organizationId);
      if (!plans) {
        plans = { lab: [], pest: [], policy: null, versions: [], meetings: [], teamSize: 0 };
        byOrg.set(row.organizationId, plans);
      }
      if (row.block === "lab-plan") plans.lab.push({ ...(parsed.data as LabPlanItem), id: row.id });
      else if (row.block === "pest-plan") plans.pest.push({ ...(parsed.data as PestPlanItem), id: row.id });
      else if (row.block === "policy") plans.policy = parsed.data as PolicyData;
      else if (row.block === "doc-versions") plans.versions.push(parsed.data as DocVersion);
      else if (row.block === "team-meetings") plans.meetings.push(parsed.data as TeamMeeting);
      else plans.teamSize += 1;
    }

    const miniBase = getMiniAppBaseUrlFromEnv();
    let organizations = 0;
    let itemsTotal = 0;
    let recipientsTotal = 0;

    for (const [orgId, plans] of byOrg) {
      try {
        const items = [
          ...collectPpkReminders({ lab: plans.lab, pest: plans.pest, today }),
          ...collectReviewReminders({
            policy: plans.policy,
            versions: plans.versions,
            meetings: plans.meetings,
            teamSize: plans.teamSize,
            today,
          }),
        ];
        if (items.length === 0) continue;
        organizations += 1;
        itemsTotal += items.length;

        const recipients = await listOrganizationRecipients(orgId, ["owner", "technologist"], "compliance");
        const withTelegram = recipients.filter((u) => u.telegramChatId);
        recipientsTotal += withTelegram.length;
        if (dryRun) continue;

        const PATHS = {
          lab: "/production-control/sanitation/lab",
          pest: "/production-control/sanitation/pest-control",
          review: "/production-control/program",
          meeting: "/production-control/haccp/team/meetings",
        } as const;
        const path = PATHS[items[0].block];
        const miniAppUrl = buildMiniAppUrl(miniBase, path);
        const html = ppkReminderMessage(items);
        const reply_markup = buildPpkReminderKeyboard(items, miniAppUrl ?? null);
        // Каждому — отдельное сообщение: у кнопок «✅» общий смысл, но ответ идёт по chat id.
        await Promise.allSettled(
          withTelegram.map((u) =>
            sendTelegramMessage(u.telegramChatId!, html, { userId: u.id, reply_markup }),
          ),
        );
        // Push в приложение — один на организацию, без кнопок.
        await pushToOrganizationRecipients(recipients, html, "compliance", miniAppUrl ?? null);
      } catch (error) {
        console.error(`[cron/ppk-reminders] org ${orgId}`, error);
      }
    }

    return NextResponse.json(
      dryRun
        ? { dryRun: true, organizations, items: itemsTotal, recipients: recipientsTotal }
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
