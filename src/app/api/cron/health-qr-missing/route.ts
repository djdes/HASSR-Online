import { NextResponse } from "next/server";

import { listCoreJournalRecipients, notifyCoreJournalRecipients } from "@/lib/core-journal-keepers";
import { checkCronSecret } from "@/lib/cron-auth";
import { db } from "@/lib/db";
import { dayMarkFromEntry } from "@/lib/health-qr";
import { listFillEmployees } from "@/lib/journal-fill";
import { STAFF_ABSENCE_LABEL, loadStaffAbsenceForDay } from "@/lib/staff-absence";
import { orgTodayKey } from "@/lib/timezone";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Если час окончания смены не задан — проверяем в 20:00 по поясу организации. */
const DEFAULT_HEALTH_CHECK_HOUR = 20;

function localHour(timeZone: string): number {
  try {
    return Number(new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", hour12: false }).format(new Date())) % 24;
  } catch {
    return new Date().getUTCHours();
  }
}

/**
 * GET|POST /api/cron/health-qr-missing?secret=… — раз в час (2026-09-22).
 *
 * Для организаций с «Допуском по QR»: в час окончания смены
 * (`shiftEndHour`, иначе 20:00 местного) собирает сотрудников, которые
 * сегодня не отметились в QR «Гигиена и здоровье» (кроме выходных,
 * отпусков и больничных) и кого не допустили, — и отправляет список
 * ответственным за основные журналы: колокольчик, Telegram, почта.
 * Повторный запуск в тот же день ничего не шлёт (ключ дня в уведомлении).
 * `?force=1` — без проверки часа (ручной запуск).
 */
async function handle(request: Request) {
  const denied = checkCronSecret(request);
  if (denied) return denied;
  const force = new URL(request.url).searchParams.get("force") === "1";

  const orgs = await db.organization.findMany({
    where: { healthQrRequired: true },
    select: { id: true, name: true, timezone: true, shiftEndHour: true, disabledJournalCodes: true },
  });
  const report: Array<{ orgId: string; missing: number; suspended: number; sent: boolean; skipped?: string }> = [];

  for (const org of orgs) {
    const tz = org.timezone || "Europe/Moscow";
    const checkHour = org.shiftEndHour > 0 ? org.shiftEndHour : DEFAULT_HEALTH_CHECK_HOUR;
    if (!force && localHour(tz) !== checkHour) {
      report.push({ orgId: org.id, missing: 0, suspended: 0, sent: false, skipped: "not-hour" });
      continue;
    }
    if ((org.disabledJournalCodes as string[]).includes("hygiene")) {
      report.push({ orgId: org.id, missing: 0, suspended: 0, sent: false, skipped: "hygiene-disabled" });
      continue;
    }
    const todayKey = orgTodayKey(tz);
    const day = new Date(`${todayKey}T00:00:00.000Z`);
    const docs = await db.journalDocument.findMany({
      where: { organizationId: org.id, status: "active", template: { code: "hygiene" }, dateFrom: { lte: day }, dateTo: { gte: day } },
      select: { id: true },
    });
    if (docs.length === 0) {
      report.push({ orgId: org.id, missing: 0, suspended: 0, sent: false, skipped: "no-document" });
      continue;
    }
    const entries = await db.journalDocumentEntry.findMany({
      where: { documentId: { in: docs.map((doc) => doc.id) }, date: day },
      select: { employeeId: true, data: true },
    });
    // Отметка в любом документе гигиены на сегодня (у сети — по точкам).
    const byEmployee = new Map<string, unknown>();
    for (const entry of entries) {
      const prev = byEmployee.get(entry.employeeId);
      if (!prev || dayMarkFromEntry(prev, null).state === "missing") byEmployee.set(entry.employeeId, entry.data);
    }
    const people = await listFillEmployees(org.id);
    const absences = await loadStaffAbsenceForDay(db, { organizationId: org.id, employeeIds: people.map((p) => p.id), dateKey: todayKey });
    const missing: typeof people = [];
    const suspended: typeof people = [];
    for (const person of people) {
      const absence = absences.get(person.id);
      const mark = dayMarkFromEntry(byEmployee.get(person.id), absence ? STAFF_ABSENCE_LABEL[absence.status] : null);
      if (mark.state === "missing") missing.push(person);
      if (mark.state === "suspended") suspended.push(person);
    }
    if (missing.length === 0 && suspended.length === 0) {
      report.push({ orgId: org.id, missing: 0, suspended: 0, sent: false, skipped: "all-marked" });
      continue;
    }

    const dedupeKey = `health-qr-missing:${todayKey}`;
    const recipients = await listCoreJournalRecipients(org.id, docs[0].id);
    // Уже отправляли сегодня — не повторяем письмо и Telegram.
    const alreadySent = await db.notification.findFirst({
      where: { organizationId: org.id, dedupeKey, userId: { in: recipients.map((r) => r.id) } },
      select: { id: true },
    });
    if (alreadySent) {
      report.push({ orgId: org.id, missing: missing.length, suspended: suspended.length, sent: false, skipped: "already-sent" });
      continue;
    }
    const title =
      missing.length > 0
        ? `Не отметились по QR «Гигиена и здоровье»: ${missing.length}`
        : `Не допущены к работе сегодня: ${suspended.length}`;
    const lines = [
      ...missing.map((p) => ({ id: p.id, label: p.name, hint: "не отметился" })),
      ...suspended.map((p) => ({ id: `s-${p.id}`, label: p.name, hint: "не допущен" })),
    ];
    const listText = lines.map((line) => `• ${line.label} — ${line.hint}`).join("\n");
    const listHtml = lines.map((line) => `<li>${escapeHtml(line.label)} — ${line.hint}</li>`).join("");
    await notifyCoreJournalRecipients({
      organizationId: org.id,
      recipients,
      kind: "health-qr-missing",
      dedupeKey,
      title,
      items: lines,
      linkHref: `/journals/hygiene/documents/${docs[0].id}`,
      linkLabel: "Открыть гигиенический журнал",
      telegramText: `🩺 ${title}\n${listText}\n\nПроверьте и отметьте в журнале или по QR «Гигиена и здоровье» → «Все за сегодня».`,
      emailSubject: `${org.name}: ${title}`,
      emailBodyHtml: `<p>Итог дня по гигиене и здоровью (${todayKey}):</p><ul>${listHtml}</ul><p>Отметить или поправить можно в гигиеническом журнале или по QR «Гигиена и здоровье» → «Все за сегодня».</p>`,
    });
    report.push({ orgId: org.id, missing: missing.length, suspended: suspended.length, sent: true });
  }
  return NextResponse.json({ ok: true, orgs: report });
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export const GET = handle;
export const POST = handle;
