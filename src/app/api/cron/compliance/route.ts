import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { checkCronSecret } from "@/lib/cron-auth";
import { notifyOrganization, escapeTelegramHtml as esc } from "@/lib/telegram";
import { sendComplianceReminderEmail } from "@/lib/email";
import { getDbRoleValuesWithLegacy, MANAGEMENT_ROLES } from "@/lib/user-roles";
import { getTemplatesFilledToday } from "@/lib/today-compliance";
import { parseDisabledCodes } from "@/lib/disabled-journals";
import { NOT_DIRECTORY_ORG_WHERE } from "@/lib/master-directory";

const CRON_SECRET = process.env.CRON_SECRET || "";

/**
 * 3-уровневая эскалация (на основе времени дня в Europe/Moscow):
 *   STAGE_1 (рекомендуется в 12:00): мягкое напоминание управлению.
 *   STAGE_2 (рекомендуется в 17:00): повторное + email.
 *   STAGE_3 (рекомендуется в 21:00): срочное — управление + владелец.
 *
 * Cron должен дёргаться 3 раза в день (через crontab или GitHub Actions
 * schedule). Stage определяется по часу запуска. Если хочется пинговать
 * чаще — допустимо, тогда same-stage notifications будут de-duplicated
 * через `notifyOrganization` встроенным dedupe (kind + dedupeKey).
 */
type Stage = "soft" | "warn" | "urgent";

function stageFor(now: Date): Stage {
  // Europe/Moscow через UTC+3 (без учёта летнего, у РФ нет DST с 2014).
  const mskHour = (now.getUTCHours() + 3) % 24;
  if (mskHour >= 19) return "urgent";
  if (mskHour >= 15) return "warn";
  return "soft";
}

const STAGE_CONFIG: Record<Stage, {
  emoji: string;
  prefix: string;
  emailEnabled: boolean;
}> = {
  soft: {
    emoji: "📋",
    prefix: "Напоминание",
    emailEnabled: false,
  },
  warn: {
    emoji: "⚠️",
    prefix: "Внимание",
    emailEnabled: true,
  },
  urgent: {
    emoji: "🚨",
    prefix: "СРОЧНО",
    emailEnabled: true,
  },
};

async function handle(request: Request) {
  const cronAuth = checkCronSecret(request);
  if (cronAuth) return cronAuth;
  try {
    const now = new Date();
    const stage = stageFor(now);
    const stageCfg = STAGE_CONFIG[stage];

    // Get all organizations (with their disabled-journal toggle).
    const organizations = await db.organization.findMany({
      where: NOT_DIRECTORY_ORG_WHERE,
      select: { id: true, name: true, disabledJournalCodes: true },
    });

    // Get all mandatory journal templates
    const mandatoryTemplates = await db.journalTemplate.findMany({
      where: {
        isActive: true,
        OR: [
          { isMandatorySanpin: true },
          { isMandatoryHaccp: true },
        ],
      },
      select: { id: true, name: true, code: true },
    });

    const results: { org: string; missing: string[] }[] = [];

    for (const org of organizations) {
      const disabledCodes = parseDisabledCodes(org.disabledJournalCodes);

      // Use the same compliance helper the dashboard uses. Aperiodic
      // journals are already treated as filled by default, disabled
      // ones are added to the «filled» set, so what's left in
      // `missingTemplates` is «daily + enabled + not filled today» —
      // exactly what a reminder should cover.
      const filledTemplateIds = await getTemplatesFilledToday(
        org.id,
        new Date(),
        mandatoryTemplates.map((t) => ({ id: t.id, code: t.code })),
        disabledCodes,
        { treatAperiodicAsFilled: false }
      );

      const missingTemplates = mandatoryTemplates.filter(
        (t) => !filledTemplateIds.has(t.id) && !disabledCodes.has(t.code)
      );

      if (missingTemplates.length === 0) continue;

      const missingNames = missingTemplates.map((t) => t.name);

      results.push({ org: org.name, missing: missingNames });

      // Эскалация: контент сообщения зависит от stage (soft / warn / urgent).
      const telegramMsg =
        `${stageCfg.emoji} <b>${stageCfg.prefix}: незаполненные журналы за сегодня</b>\n\n` +
        missingNames.map((n) => `• ${esc(n)}`).join("\n") +
        `\n\nВсего не заполнено: ${missingNames.length} из ${mandatoryTemplates.length}`;

      // type оставляем "compliance" (enum в notifyOrganization), а уровень
      // эскалации передаём через сам текст (emoji + prefix). Если позже
      // потребуется отдельный канал per-stage — расширим NotificationType.
      notifyOrganization(
        org.id,
        telegramMsg,
        ["owner", "technologist"],
        "compliance"
      ).catch((err) =>
        console.error(`Compliance telegram error (${org.name}):`, err)
      );

      // Email шлём только начиная со stage `warn`. На stage `soft`
      // (12:00) — только Telegram, чтобы не спамить почту.
      if (stageCfg.emailEnabled) {
        const users = await db.user.findMany({
          where: {
            organizationId: org.id,
            role: { in: getDbRoleValuesWithLegacy(MANAGEMENT_ROLES) },
            isActive: true,
          },
          select: { email: true },
        });

        for (const user of users) {
          sendComplianceReminderEmail({
            to: user.email,
            missingJournals: missingNames,
            organizationName: org.name,
            organizationId: org.id,
          }).catch((err) =>
            console.error(`Compliance email error:`, err)
          );
        }
      }
    }

    return NextResponse.json({
      ok: true,
      stage,
      checked: organizations.length,
      withMissing: results.length,
      details: results,
    });
  } catch (error) {
    console.error("Compliance cron error:", error);
    return NextResponse.json(
      { error: "Internal error" },
      { status: 500 }
    );
  }
}

export const GET = handle;
export const POST = handle;
