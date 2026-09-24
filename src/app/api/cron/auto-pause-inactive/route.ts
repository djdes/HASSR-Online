import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { checkCronSecret } from "@/lib/cron-auth";
import { NOT_AUTO_SEEDED } from "@/lib/journal-entry-filters";
import { INACTIVITY_PAUSE_DAYS, decideInactivity } from "@/lib/inactivity";
import { sendInactivityPausedEmail, sendInactivityWarningEmail } from "@/lib/inactivity-emails";
import { notifyOrganization } from "@/lib/telegram";
import { getDbRoleValuesWithLegacy, MANAGEMENT_ROLES } from "@/lib/user-roles";
import { platformOrgId } from "@/lib/partners/partner-hint";
import { NOT_DIRECTORY_ORG_WHERE } from "@/lib/master-directory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET/POST /api/cron/auto-pause-inactive — пауза за неактивность.
 *
 * Правило владельца (2026-09-05): организация без записей в журналах
 * 100 дней уходит в `paused`; перед этим руководству уходят письма
 * (и Telegram) за 30, 14, 7, 3, 2 и 1 день — что автозаполнение, задачи
 * и напоминания остановятся и аккаунт надо будет включить обратно в
 * «Настройки → Подписка». Каждая стадия шлётся один раз для одной и той
 * же «последней активности»: новая запись начинает серию заново.
 *
 * Точка отсчёта — последняя запись (field/document entries без
 * `_autoSeeded`), либо момент возобновления после прошлой паузы, либо
 * создание организации, если записей не было никогда.
 *
 * Запускать ежедневно (стадии 3/2/1 день иначе не сработают).
 * `?dryRun=1` — только посчитать, ничего не писать и не слать.
 */
const PROTECTED_PLANS = ["paused", "cancelled"];

const MANAGEMENT_DB_ROLES = getDbRoleValuesWithLegacy(MANAGEMENT_ROLES);

async function lastActivityAt(organizationId: string): Promise<Date | null> {
  const [field, doc] = await Promise.all([
    db.journalEntry.findFirst({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
    db.journalDocumentEntry.findFirst({
      where: { document: { organizationId }, ...NOT_AUTO_SEEDED },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
  ]);
  const dates = [field?.createdAt, doc?.createdAt].filter((d): d is Date => Boolean(d));
  if (dates.length === 0) return null;
  return new Date(Math.max(...dates.map((d) => d.getTime())));
}

async function managementRecipients(organizationId: string) {
  const users = await db.user.findMany({
    where: {
      organizationId,
      isActive: true,
      archivedAt: null,
      isRoot: false,
      role: { in: MANAGEMENT_DB_ROLES },
      email: { not: "" },
    },
    select: { email: true, name: true },
  });
  return users.filter((u) => u.email.includes("@"));
}

async function handle(request: Request) {
  const cronAuth = checkCronSecret(request);
  if (cronAuth) return cronAuth;
  const url = new URL(request.url);
  const dryRun = url.searchParams.get("dryRun") === "1";
  const now = new Date();

  const orgs = await db.organization.findMany({
    where: {
      id: { not: platformOrgId() },
      isDemo: false,
      subscriptionPlan: { notIn: PROTECTED_PLANS },
      // Мастер-кабинет справочников записей в журналы не ведёт — не пауза.
      ...NOT_DIRECTORY_ORG_WHERE,
    },
    select: {
      id: true,
      name: true,
      subscriptionPlan: true,
      createdAt: true,
      inactivityWarnedStage: true,
      inactivityWarnedForActivityAt: true,
      inactivityResumedAt: true,
    },
  });

  let paused = 0;
  let warned = 0;
  const results: Array<Record<string, unknown>> = [];

  for (const org of orgs) {
    const entryAt = await lastActivityAt(org.id);
    // Возобновление после паузы — тоже «активность»: иначе организация,
    // которую включили обратно без записей, ушла бы в паузу на следующий
    // же день.
    const resumedAt = org.inactivityResumedAt;
    const activityAt =
      entryAt && resumedAt ? (entryAt > resumedAt ? entryAt : resumedAt) : (entryAt ?? resumedAt);

    const decision = decideInactivity({
      now,
      lastActivityAt: activityAt,
      createdAt: org.createdAt,
      warnedStage: org.inactivityWarnedStage,
      warnedForActivityAt: org.inactivityWarnedForActivityAt,
    });
    if (decision.action === "none") continue;

    const recipients = await managementRecipients(org.id);

    if (decision.action === "warn") {
      warned += 1;
      results.push({
        orgId: org.id,
        name: org.name,
        action: "warn",
        stage: decision.stage,
        daysLeft: decision.daysLeft,
        recipients: recipients.map((r) => r.email),
      });
      if (dryRun) continue;

      await Promise.all(
        recipients.map((r) =>
          sendInactivityWarningEmail({
            to: r.email,
            organizationId: org.id,
            organizationName: org.name,
            daysLeft: decision.daysLeft,
            pauseAt: decision.pauseAt,
          })
        )
      );
      await notifyOrganization(
        org.id,
        `⏸ Через ${decision.daysLeft} дн. аккаунт «${org.name}» будет приостановлен: ${INACTIVITY_PAUSE_DAYS} дней без записей в журналах. Остановятся автозаполнение, задачи и напоминания. Чтобы этого не случилось — сделайте любую запись.`,
        ["owner"],
        undefined,
        { label: "Открыть журналы", miniAppUrl: "/mini" }
      ).catch(() => undefined);
      await db.organization.update({
        where: { id: org.id },
        data: {
          inactivityWarnedStage: decision.stage,
          inactivityWarnedForActivityAt: activityAt,
        },
      });
      continue;
    }

    // pause
    paused += 1;
    results.push({
      orgId: org.id,
      name: org.name,
      action: "pause",
      oldPlan: org.subscriptionPlan,
      recipients: recipients.map((r) => r.email),
    });
    if (dryRun) continue;

    await db.organization.update({
      where: { id: org.id },
      data: {
        subscriptionPlan: "paused",
        pausedFromPlan: org.subscriptionPlan,
        inactivityWarnedStage: null,
        inactivityWarnedForActivityAt: null,
      },
    });
    await db.auditLog.create({
      data: {
        organizationId: org.id,
        action: "subscription.auto_paused",
        entity: "organization",
        entityId: org.id,
        details: {
          reason: `Нет активности > ${INACTIVITY_PAUSE_DAYS} дней`,
          lastActivity: activityAt?.toISOString() ?? null,
          previousPlan: org.subscriptionPlan,
        },
      },
    });
    await Promise.all(
      recipients.map((r) =>
        sendInactivityPausedEmail({
          to: r.email,
          organizationId: org.id,
          organizationName: org.name,
        })
      )
    );
    await notifyOrganization(
      org.id,
      `⏸ Аккаунт «${org.name}» приостановлен: ${INACTIVITY_PAUSE_DAYS} дней без записей. Автозаполнение и задачи остановлены, данные сохранены. Включить обратно: Настройки → Подписка → «Возобновить работу».`,
      ["owner"]
    ).catch(() => undefined);
  }

  return NextResponse.json({
    ok: true,
    dryRun,
    organizationsScanned: orgs.length,
    warned,
    paused,
    pauseAfterDays: INACTIVITY_PAUSE_DAYS,
    results,
  });
}

export const GET = handle;
export const POST = handle;
