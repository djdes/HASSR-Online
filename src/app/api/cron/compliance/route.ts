import { NextResponse } from "next/server";
import { resolveLocale } from "@/i18n/locales";
import { db } from "@/lib/db";
import { checkCronSecret } from "@/lib/cron-auth";
import { notifyOrganization, escapeTelegramHtml as esc } from "@/lib/telegram";
import { sendComplianceReminderEmail } from "@/lib/email";
import { getDbRoleValuesWithLegacy, MANAGEMENT_ROLES } from "@/lib/user-roles";
import { getTemplatesFilledToday } from "@/lib/today-compliance";
import { getDisabledJournalCodes, parseDisabledCodes } from "@/lib/disabled-journals";
import { buildingTargets } from "@/lib/building-targets";
import { worksAtBuilding } from "@/lib/building-settings";
import { journalDisplayName, parseCustomNames } from "@/lib/custom-names";
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
      select: { id: true, name: true, disabledJournalCodes: true, customNamesJson: true, locale: true },
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
      // Точки: напоминание по каждой точке отдельно — её набор журналов,
      // её документы и её руководители (слитая организация, 2026-10-26).
      // Без точек — одно напоминание на организацию, как раньше.
      const targets = await buildingTargets(org.id);
      const pointIds = targets.filter((id): id is string => Boolean(id));
      const pointNames = new Map(
        (pointIds.length > 0
          ? await db.building.findMany({ where: { id: { in: pointIds } }, select: { id: true, name: true } })
          : []
        ).map((building) => [building.id, building.name])
      );
      const managers = stageCfg.emailEnabled
        ? await db.user.findMany({
            where: {
              organizationId: org.id,
              role: { in: getDbRoleValuesWithLegacy(MANAGEMENT_ROLES) },
              isActive: true,
            },
            select: { email: true, locale: true, buildingIds: true },
          })
        : [];

      for (const buildingId of targets) {
      const disabledCodes = buildingId
        ? await getDisabledJournalCodes(org.id, buildingId)
        : parseDisabledCodes(org.disabledJournalCodes);

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
        { treatAperiodicAsFilled: false, buildingId }
      );

      const missingTemplates = mandatoryTemplates.filter(
        (t) => !filledTemplateIds.has(t.id) && !disabledCodes.has(t.code)
      );

      if (missingTemplates.length === 0) continue;

      // Своё название журнала организации — так его зовут в заведении.
      const customNames = parseCustomNames(org.customNamesJson);
      const missingNames = missingTemplates.map((t) =>
        journalDisplayName(customNames, t.code, t.name)
      );
      const pointName = buildingId ? pointNames.get(buildingId) ?? null : null;
      const placeName = pointName ? `${org.name} · ${pointName}` : org.name;

      results.push({ org: placeName, missing: missingNames });

      // Эскалация: контент сообщения зависит от stage (soft / warn / urgent).
      const telegramMsg =
        `${stageCfg.emoji} <b>${stageCfg.prefix}: незаполненные журналы за сегодня</b>\n` +
        (pointName ? `Точка: ${esc(pointName)}\n` : "") +
        `\n` +
        missingNames.map((n) => `• ${esc(n)}`).join("\n") +
        `\n\nВсего не заполнено: ${missingNames.length} из ${mandatoryTemplates.length}`;

      // type оставляем "compliance" (enum в notifyOrganization), а уровень
      // эскалации передаём через сам текст (emoji + prefix). Если позже
      // потребуется отдельный канал per-stage — расширим NotificationType.
      notifyOrganization(
        org.id,
        telegramMsg,
        ["owner", "technologist"],
        "compliance",
        undefined,
        { buildingId }
      ).catch((err) =>
        console.error(`Compliance telegram error (${placeName}):`, err)
      );

      // Email шлём только начиная со stage `warn`. На stage `soft`
      // (12:00) — только Telegram, чтобы не спамить почту. Руководителю
      // точки — только про его точку.
      if (stageCfg.emailEnabled) {
        for (const user of managers.filter((manager) => worksAtBuilding(manager, buildingId))) {
          sendComplianceReminderEmail({
            to: user.email,
            missingJournals: missingNames,
            organizationName: placeName,
            organizationId: org.id,
            locale: resolveLocale({ authenticated: true, userLocale: user.locale, organizationLocale: org.locale }),
          }).catch((err) =>
            console.error(`Compliance email error:`, err)
          );
        }
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
