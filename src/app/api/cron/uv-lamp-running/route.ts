import { NextResponse } from "next/server";

import { deliverableEmail, notifyCoreJournalRecipients } from "@/lib/core-journal-keepers";
import { checkCronSecret } from "@/lib/cron-auth";
import { db } from "@/lib/db";
import { getPrimarySlotId } from "@/lib/journal-responsible-schemas";
import { UV_LAMP_RUNTIME_TEMPLATE_CODE } from "@/lib/uv-lamp-runtime-document";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FORGOTTEN_AFTER_MS = 12 * 60 * 60 * 1000;

/**
 * GET|POST /api/cron/uv-lamp-running?secret=… — раз в час (2026-09-22).
 * УФ-лампа «включена» дольше 12 часов — вероятно, забыли нажать «Я
 * выключил». Ответственному журнала УФ-ламп (или руководству) —
 * напоминание, по разу на каждое включение. Сами сеансы не закрываем:
 * настоящее время выключения знает только человек.
 */
async function handle(request: Request) {
  const denied = checkCronSecret(request);
  if (denied) return denied;
  const lamps = await db.equipment.findMany({
    where: { runningSince: { lt: new Date(Date.now() - FORGOTTEN_AFTER_MS) } },
    select: { id: true, name: true, runningSince: true, area: { select: { organizationId: true } } },
  });
  let notified = 0;
  for (const lamp of lamps) {
    const organizationId = lamp.area.organizationId;
    const org = await db.organization.findUnique({ where: { id: organizationId }, select: { journalResponsibleUsersJson: true } });
    const slots = ((org?.journalResponsibleUsersJson ?? {}) as Record<string, Record<string, string | null> | undefined>)[UV_LAMP_RUNTIME_TEMPLATE_CODE] ?? {};
    const responsibleId = slots[getPrimarySlotId(UV_LAMP_RUNTIME_TEMPLATE_CODE)] ?? null;
    const users = await db.user.findMany({
      where: responsibleId
        ? { id: responsibleId, organizationId, isActive: true }
        : { organizationId, isActive: true, archivedAt: null, isRoot: false, role: { in: ["manager", "head_chef", "owner", "technologist"] } },
      select: { id: true, name: true, email: true, contactEmail: true },
    });
    const dedupeKey = `uv-lamp-running:${lamp.id}:${lamp.runningSince?.toISOString() ?? ""}`;
    const already = await db.notification.findFirst({ where: { organizationId, dedupeKey }, select: { id: true } });
    if (already) continue;
    const hours = Math.floor((Date.now() - (lamp.runningSince?.getTime() ?? Date.now())) / 3_600_000);
    const title = `${lamp.name}: облучатель включён уже ${hours} ч — не забыли выключить?`;
    await notifyCoreJournalRecipients({
      organizationId,
      recipients: users.map((user) => ({ id: user.id, name: user.name, email: deliverableEmail(user) })),
      kind: "uv-lamp-running",
      // Один раз на каждое включение.
      dedupeKey,
      title,
      items: [{ id: lamp.id, label: lamp.name, hint: `включён ${hours} ч` }],
      linkHref: "/settings/equipment",
      linkLabel: "Открыть оборудование",
      telegramText: `💡 ${title}\nЕсли облучатель выключен — нажмите «Я выключил» на наклейке лампы, время можно поправить в журнале.`,
      emailSubject: title,
      emailBodyHtml: `<p>${title}</p><p>Если облучатель уже выключен — нажмите «Я выключил» на наклейке лампы; фактическое время можно поправить в журнале учёта работы.</p>`,
    }).catch(() => null);
    notified += 1;
  }
  return NextResponse.json({ ok: true, lamps: lamps.length, notified });
}

export const GET = handle;
export const POST = handle;
