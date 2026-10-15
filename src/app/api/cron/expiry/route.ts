import { NextResponse } from "next/server";
import { resolveLocale } from "@/i18n/locales";
import { db } from "@/lib/db";
import { checkCronSecret } from "@/lib/cron-auth";
import { notifyOrganization, escapeTelegramHtml as esc } from "@/lib/telegram";
import { sendComplianceReminderEmail } from "@/lib/email";
import { getDbRoleValuesWithLegacy, MANAGEMENT_ROLES } from "@/lib/user-roles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handle(request: Request) {
  try {
    const cronAuth = checkCronSecret(request);
    if (cronAuth) return cronAuth;
    // Find products expiring within the next 3 days
    // Look at incoming_control journal entries with expiryDate field
    const template = await db.journalTemplate.findUnique({
      where: { code: "incoming_control" },
    });

    if (!template) {
      return NextResponse.json({ message: "No incoming_control template", alerts: 0 });
    }

    const now = new Date();
    const threeDaysLater = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);

    // Find entries with expiryDate approaching
    const entries = await db.journalEntry.findMany({
      where: {
        templateId: template.id,
        createdAt: { gte: new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000) }, // last 90 days
      },
      include: {
        organization: { select: { id: true, name: true } },
        filledBy: { select: { name: true } },
      },
    });

    const alerts: Array<{ org: string; product: string; expiryDate: string }> = [];

    // Group by organization
    const byOrg = new Map<string, Array<{ product: string; expiryDate: string }>>();

    for (const entry of entries) {
      const data = entry.data as Record<string, unknown>;
      const expiryStr = data.expiryDate as string | undefined;
      if (!expiryStr) continue;

      const expiryDate = new Date(expiryStr);
      if (isNaN(expiryDate.getTime())) continue;

      // Check if expiry is within next 3 days or already expired
      if (expiryDate <= threeDaysLater) {
        const productName = (data.productName as string) || "Без названия";
        const orgId = entry.organizationId;

        if (!byOrg.has(orgId)) byOrg.set(orgId, []);
        byOrg.get(orgId)!.push({ product: productName, expiryDate: expiryStr });

        alerts.push({ org: orgId, product: productName, expiryDate: expiryStr });
      }
    }

    // Send notifications per org
    for (const [orgId, products] of byOrg) {
      const list = products
        .map(
          (p) =>
            `- ${esc(p.product)} (срок: ${esc(
              new Date(p.expiryDate).toLocaleDateString("ru-RU")
            )})`
        )
        .join("\n");

      const message =
        `<b>Внимание: истекающие сроки годности!</b>\n\n` +
        `${list}\n\n` +
        `Проверьте наличие и примите решение о списании.`;

      notifyOrganization(orgId, message, ["owner", "technologist"], "expiry").catch(
        (err) => console.error("Telegram expiry alert error:", err)
      );

      // Email
      const org = await db.organization.findUnique({
        where: { id: orgId },
        select: { name: true, locale: true },
      });

      const users = await db.user.findMany({
        where: {
          organizationId: orgId,
          role: { in: getDbRoleValuesWithLegacy(MANAGEMENT_ROLES) },
          isActive: true,
        },
        select: { email: true, locale: true },
      });

      for (const user of users) {
        sendComplianceReminderEmail({
          to: user.email,
          missingJournals: products.map((p) => `${p.product} — срок до ${new Date(p.expiryDate).toLocaleDateString("ru-RU")}`),
          organizationName: org?.name || "",
          organizationId: orgId,
          locale: resolveLocale({ authenticated: true, userLocale: user.locale, organizationLocale: org?.locale }),
        }).catch((err) => console.error("Email expiry alert error:", err));
      }
    }

    // ========================================================
    // StaffCompetency expiry — медкнижки, обучение, сертификаты.
    // Проверяем окна 30/14/3 дня, шлём push с emoji-intensity.
    //
    // По умолчанию cron дёргается ежедневно в одно и то же время —
    // за месяц до истечения медкнижки Иванова менеджер сначала
    // получит лёгкое 🟡 напоминание, за 2 недели — 🟠, за 3 дня — 🔴.
    // Дубликации нет: для каждого экземпляра StaffCompetency пуш идёт
    // только когда days-until-expiry попадает на одно из 3 значений
    // (30, 14, 3) — иначе skip.
    // ========================================================
    const staffByOrg = new Map<
      string,
      Array<{
        userName: string;
        skill: string;
        expiresAt: Date;
        daysLeft: number;
      }>
    >();

    const competencies = await db.staffCompetency.findMany({
      where: {
        expiresAt: {
          // окно: от now до now+30 дней (включая уже истёкшие в last 7 дней)
          gte: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
          lte: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
        },
      },
      include: { organization: { select: { id: true, name: true } } },
    });

    // Pre-fetch user names в одном запросе.
    const userIds = Array.from(new Set(competencies.map((c) => c.userId)));
    const users = await db.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true },
    });
    const userById = new Map(users.map((u) => [u.id, u.name]));

    const NOTIFY_WINDOWS = [3, 14, 30] as const;
    for (const comp of competencies) {
      if (!comp.expiresAt) continue;
      const msUntil = comp.expiresAt.getTime() - now.getTime();
      const daysLeft = Math.ceil(msUntil / (24 * 60 * 60 * 1000));
      // Шлём только в дни-якоря: 30, 14, 3 и в день истечения (0,
      // отрицательные = просрочено).
      const isAnchor =
        NOTIFY_WINDOWS.includes(daysLeft as 3 | 14 | 30) || daysLeft <= 0;
      if (!isAnchor) continue;

      const list = staffByOrg.get(comp.organizationId) ?? [];
      list.push({
        userName: userById.get(comp.userId) ?? "?",
        skill: comp.skill,
        expiresAt: comp.expiresAt,
        daysLeft,
      });
      staffByOrg.set(comp.organizationId, list);
    }

    let staffAlerts = 0;
    for (const [orgId, items] of staffByOrg) {
      // emoji-intensity: 30→🟡, 14→🟠, ≤3→🔴.
      const lines = items
        .sort((a, b) => a.daysLeft - b.daysLeft)
        .map((item) => {
          const emoji =
            item.daysLeft <= 3 ? "🔴" : item.daysLeft <= 14 ? "🟠" : "🟡";
          const dateLabel = item.expiresAt.toLocaleDateString("ru-RU", {
            day: "2-digit",
            month: "long",
            year: "numeric",
          });
          const suffix =
            item.daysLeft < 0
              ? `<b>просрочена ${Math.abs(item.daysLeft)} дн.</b>`
              : item.daysLeft === 0
                ? "<b>истекает сегодня</b>"
                : `через ${item.daysLeft} дн.`;
          return `${emoji} <b>${esc(item.userName)}</b> — ${esc(
            item.skill
          )} (${esc(dateLabel)}, ${suffix})`;
        });

      const message =
        `<b>Срок действия документов сотрудников</b>\n\n` +
        `${lines.join("\n")}\n\n` +
        `Запланируйте обновление до истечения, иначе сотрудник не сможет работать.`;

      notifyOrganization(
        orgId,
        message,
        ["owner", "technologist"],
        "expiry"
      ).catch((err) =>
        console.error("Telegram staff-expiry alert error:", err)
      );
      staffAlerts += items.length;
    }

    // B3 — auto-block при просрочке > 7 дней. Сотрудник с
    // просроченной медкнижкой не имеет права работать (СанПиН 2.3/2.4),
    // поэтому переводим isActive=false. Менеджер увидит это в
    // /settings/users — сможет восстановить после обновления документа.
    // Audit-row для трассируемости.
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const seriouslyExpired = await db.staffCompetency.findMany({
      where: { expiresAt: { lt: sevenDaysAgo, not: null } },
      include: { organization: { select: { id: true } } },
    });
    let blocked = 0;
    for (const c of seriouslyExpired) {
      if (!c.expiresAt) continue;
      const u = await db.user.findUnique({
        where: { id: c.userId },
        select: { isActive: true, name: true },
      });
      if (!u || !u.isActive) continue;
      await db.user.update({
        where: { id: c.userId },
        data: { isActive: false },
      });
      await db.auditLog.create({
        data: {
          organizationId: c.organizationId,
          userId: c.userId,
          userName: u.name,
          action: "user.auto_blocked_expired",
          entity: "user",
          entityId: c.userId,
          details: {
            skill: c.skill,
            expiredAt: c.expiresAt.toISOString(),
            daysOverdue: Math.ceil(
              (now.getTime() - c.expiresAt.getTime()) / (24 * 60 * 60 * 1000)
            ),
          },
        },
      });
      blocked += 1;
    }

    return NextResponse.json({
      alerts: alerts.length,
      organizations: byOrg.size,
      staffAlerts,
      staffOrgs: staffByOrg.size,
      autoBlocked: blocked,
    });
  } catch (error) {
    console.error("Expiry cron error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
