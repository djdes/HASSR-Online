import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { PageHeader, PageHeaderStat } from "@/components/ui/page-header";
import { getActiveOrgId, requireAuth } from "@/lib/auth-helpers";
import { collectCalendarEvents } from "@/lib/calendar/events";
import { type CalendarEventKind } from "@/lib/calendar/ics";
import { calendarFeedUrl } from "@/lib/calendar/token";
import { db } from "@/lib/db";
import { hasFullWorkspaceAccess } from "@/lib/role-access";

import { CalendarClient, type CalendarPreviewGroup } from "./calendar-client";

export const dynamic = "force-dynamic";

const PREVIEW_DAYS = 90;
const KIND_ORDER: CalendarEventKind[] = ["medbook", "calibration", "subscription", "competency", "capa", "batch"];

/**
 * Календарь сроков: личная ссылка на iCalendar-ленту организации. Только
 * руководство — в ленте сроки медкнижек сотрудников.
 */
export default async function CalendarSettingsPage() {
  const session = await requireAuth();
  if (!hasFullWorkspaceAccess(session.user)) redirect("/journals");
  const t = await getTranslations("settingsUi.calendarPage");
  const kindLabel = (kind: CalendarEventKind): string => {
    switch (kind) {
      case "medbook":
        return t("kindMedbook");
      case "calibration":
        return t("kindCalibration");
      case "subscription":
        return t("kindSubscription");
      case "competency":
        return t("kindCompetency");
      case "capa":
        return t("kindCapa");
      case "batch":
        return t("kindBatch");
      default:
        return kind;
    }
  };
  const now = new Date();
  const [me, events] = await Promise.all([
    db.user.findUnique({ where: { id: session.user.id }, select: { calendarToken: true } }),
    collectCalendarEvents(getActiveOrgId(session), now),
  ]);
  const token = me?.calendarToken ?? null;

  const today = now.toISOString().slice(0, 10);
  const horizon = new Date(now.getTime() + PREVIEW_DAYS * 86_400_000).toISOString().slice(0, 10);
  const groups: CalendarPreviewGroup[] = KIND_ORDER.map((kind) => {
    const all = events.filter((e) => e.kind === kind);
    const upcoming = all.filter((e) => e.date >= today && e.date <= horizon).sort((a, b) => (a.date < b.date ? -1 : 1));
    const overdue = all.filter((e) => e.date < today).length;
    return { kind, label: kindLabel(kind), total: all.length, overdue, upcoming: upcoming.slice(0, 5).map((e) => ({ date: e.date, title: e.title })) };
  }).filter((g) => g.total > 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={<PageHeaderStat>{t("eventsPerYear", { count: events.length })}</PageHeaderStat>}
      />
      <CalendarClient initialToken={token} initialUrl={token ? calendarFeedUrl(token) : null} groups={groups} previewDays={PREVIEW_DAYS} />
    </div>
  );
}
