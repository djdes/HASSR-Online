import { db } from "@/lib/db";
import { notifyManagement, upsertNotification } from "@/lib/notifications";

import { isOfflineDeviceStale, OFFLINE_DEVICE_FORGET_MS, OFFLINE_DEVICE_STALE_MS, shouldNotifyStuck, type OfflineHeartbeat } from "./devices";
import { OFFLINE_APP_PATH } from "./types";

/**
 * Records what a device reports about itself while it is online and, when
 * some of its records were not accepted, tells the author and management
 * (at most once a day per device). Never throws: a heartbeat is a hint for
 * people, it must not break the cabinet page that sent it.
 */
export async function recordOfflineHeartbeat(params: {
  organizationId: string;
  userId: string;
  userName: string;
  label: string;
  heartbeat: OfflineHeartbeat;
  now?: Date;
}): Promise<{ notifiedStuck: boolean }> {
  const now = params.now ?? new Date();
  const { heartbeat } = params;
  try {
    const existing = await db.offlineDevice.findUnique({
      where: { userId_deviceKey: { userId: params.userId, deviceKey: heartbeat.deviceKey } },
      select: { id: true, stuckNotifiedAt: true },
    });
    const notify = shouldNotifyStuck({ stuck: heartbeat.stuck, stuckNotifiedAt: existing?.stuckNotifiedAt ?? null, now });
    const data = {
      organizationId: params.organizationId,
      label: params.label.slice(0, 120),
      packAt: heartbeat.packAt,
      pendingCount: heartbeat.pending,
      stuckCount: heartbeat.stuck,
      lastSeenAt: now,
      // Nothing stuck any more — the next refusal is news again.
      stuckNotifiedAt: heartbeat.stuck === 0 ? null : notify ? now : undefined,
    };
    await db.offlineDevice.upsert({
      where: { userId_deviceKey: { userId: params.userId, deviceKey: heartbeat.deviceKey } },
      create: { ...data, stuckNotifiedAt: notify ? now : null, userId: params.userId, deviceKey: heartbeat.deviceKey, deliveredCount: heartbeat.delivered },
      update: { ...data, deliveredCount: { increment: heartbeat.delivered } },
    });
    if (!notify) return { notifiedStuck: false };

    const dayKey = now.toISOString().slice(0, 10);
    const title = `Не ушло записей без связи: ${heartbeat.stuck}`;
    const items = [{ id: heartbeat.deviceKey, label: `${params.userName} · ${params.label}` }];
    await Promise.all([
      upsertNotification({
        organizationId: params.organizationId,
        userId: params.userId,
        kind: "offline-stuck",
        dedupeKey: `offline-stuck:${heartbeat.deviceKey}:${dayKey}`,
        title,
        linkHref: `${OFFLINE_APP_PATH}#queue`,
        linkLabel: "Открыть список",
        items,
      }).catch(() => null),
      notifyManagement({
        organizationId: params.organizationId,
        kind: "offline-stuck",
        dedupeKey: `offline-stuck:${heartbeat.deviceKey}:${dayKey}`,
        title: `${title} — ${params.userName}`,
        linkHref: "/settings/offline",
        linkLabel: "Работа без связи",
        items,
      }).catch(() => null),
    ]);
    return { notifiedStuck: true };
  } catch (error) {
    console.error("[offline-heartbeat] failed", error);
    return { notifiedStuck: false };
  }
}

/**
 * Devices that deliver offline records and have been silent for more than
 * a day: management gets one notification per silence. Called from an
 * existing cron (`/api/cron/shift-watcher`), so no new schedule is needed.
 */
export async function notifySilentOfflineDevices(now: Date = new Date()): Promise<number> {
  const candidates = await db.offlineDevice.findMany({
    where: {
      deliveredCount: { gt: 0 },
      lastSeenAt: { lte: new Date(now.getTime() - OFFLINE_DEVICE_STALE_MS), gte: new Date(now.getTime() - OFFLINE_DEVICE_FORGET_MS) },
    },
    select: { id: true, organizationId: true, label: true, lastSeenAt: true, deliveredCount: true, staleNotifiedAt: true, user: { select: { name: true } } },
    take: 500,
  });
  let notified = 0;
  for (const device of candidates) {
    if (!isOfflineDeviceStale({ ...device, now })) continue;
    // Mark first: a failed notification must not turn into one every half an hour.
    await db.offlineDevice.update({ where: { id: device.id }, data: { staleNotifiedAt: now } });
    await notifyManagement({
      organizationId: device.organizationId,
      kind: "offline-device-silent",
      dedupeKey: `offline-device-silent:${device.id}:${device.lastSeenAt.toISOString().slice(0, 10)}`,
      title: "Устройство не выходило на связь больше суток",
      linkHref: "/settings/offline",
      linkLabel: "Работа без связи",
      items: [{ id: device.id, label: `${device.user.name} · ${device.label} — записи без связи могли не дойти` }],
    }).catch(() => null);
    notified++;
  }
  return notified;
}
