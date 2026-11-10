import { db } from "@/lib/db";

import { offlineDeviceState, type OfflineDeviceState } from "./devices";
import { offlineRecordRows, type OfflineRecordRow } from "./overview";
import { OFFLINE_MAX_AGE_DAYS } from "./record-time";

export const OFFLINE_RECORDS_LIMIT = 200;
const DAY_MS = 24 * 60 * 60 * 1000;

export type OfflineDeviceRow = {
  id: string;
  label: string;
  userName: string;
  lastSeenAt: Date;
  packAt: Date | null;
  pendingCount: number;
  stuckCount: number;
  state: OfflineDeviceState;
};

/** Devices and offline records of one organization for the manager's page. */
export async function loadOfflineOverview(organizationId: string, now: Date = new Date()): Promise<{ devices: OfflineDeviceRow[]; records: OfflineRecordRow[]; timeZone: string }> {
  const since = new Date(now.getTime() - OFFLINE_MAX_AGE_DAYS * DAY_MS);
  const [org, devices, audit] = await Promise.all([
    db.organization.findUnique({ where: { id: organizationId }, select: { timezone: true } }),
    db.offlineDevice.findMany({
      where: { organizationId, lastSeenAt: { gte: since } },
      select: { id: true, label: true, lastSeenAt: true, packAt: true, pendingCount: true, stuckCount: true, user: { select: { name: true } } },
      orderBy: { lastSeenAt: "desc" },
      take: 200,
    }),
    db.auditLog.findMany({
      where: { organizationId, action: "journal.qr_fill", createdAt: { gte: since }, details: { path: ["offline", "recordedAt"], string_starts_with: "2" } },
      select: { id: true, userName: true, details: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: OFFLINE_RECORDS_LIMIT,
    }),
  ]);
  return {
    timeZone: org?.timezone || "Europe/Moscow",
    devices: devices.map((device) => ({
      id: device.id,
      label: device.label,
      userName: device.user.name,
      lastSeenAt: device.lastSeenAt,
      packAt: device.packAt,
      pendingCount: device.pendingCount,
      stuckCount: device.stuckCount,
      state: offlineDeviceState({ ...device, now }),
    })),
    records: offlineRecordRows(audit),
  };
}
