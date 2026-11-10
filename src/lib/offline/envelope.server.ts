import { NextResponse } from "next/server";

import { authOptions } from "@/lib/auth";
import { getActiveOrgId } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import { claimIdempotency, journalIdempotencyKey, prismaIdempotencyStore } from "@/lib/idempotency";
import { ORG_ROSTER_WHERE, ORG_SIGNER_WHERE } from "@/lib/journal-roster";
import { resolveQrFillActor, type QrFillActorResult, type QrFillMode } from "@/lib/qr-fill-actor";
import { qrPinFingerprint } from "@/lib/qr-pin-pass";
import { getServerSession } from "@/lib/server-session";

import { decideOfflineTime, offlineTimeErrorText } from "./record-time";
import {
  OFFLINE_AUTH_HEADER,
  OFFLINE_DAY_HEADER,
  OFFLINE_PIN_FP_HEADER,
  OFFLINE_RECORDED_AT_HEADER,
  type OfflineAuthKind,
  type OfflineRejectCode,
} from "./types";

/**
 * A record made without network, delivered later by the device.
 *
 * The device sends the same request the QR page would send, plus headers
 * saying when the record was really made and how its author was confirmed
 * on the device. Those headers are trusted only together with a valid
 * cabinet session of the same organization — the account signed in on the
 * device vouches for what was entered on it. Without the header nothing
 * changes: the request is handled exactly as before.
 */
export type OfflineEnvelope = {
  recordedAt: Date;
  /** Journal day of the record in the organization time zone. */
  dateKey: string;
  /** True when the person edited a past day (not the day of `recordedAt`). */
  pastDayEdit: boolean;
  auth: OfflineAuthKind;
  /** Mode to pass to `resolveQrFillActor`; the PIN itself is already confirmed. */
  actorMode: QrFillMode;
  deviceUserId: string;
};

export type OfflineEnvelopeResult =
  | { ok: true; envelope: OfflineEnvelope }
  | { ok: false; status: number; error: string; code: OfflineRejectCode };

export function isOfflineRequest(request: Request): boolean {
  return Boolean(request.headers.get(OFFLINE_RECORDED_AT_HEADER));
}

function reject(status: number, code: OfflineRejectCode, error: string): OfflineEnvelopeResult {
  return { ok: false, status, error, code };
}

/** `null` — an ordinary online request. */
export async function readOfflineEnvelope(
  request: Request,
  params: {
    organizationId: string;
    employeeId: string;
    timeZone: string | null | undefined;
    mode: QrFillMode;
    /** Brakerage commission members are signers too. */
    includeCommission?: boolean;
    now?: Date;
  }
): Promise<OfflineEnvelopeResult | null> {
  const recordedAtRaw = request.headers.get(OFFLINE_RECORDED_AT_HEADER);
  if (!recordedAtRaw) return null;

  const session = await getServerSession(authOptions);
  if (!session) return reject(401, "offline-login", "Войдите в кабинет на этом устройстве — записи без связи отправятся после входа");
  if (getActiveOrgId(session) !== params.organizationId) {
    return reject(403, "offline-other-org", "Запись сделана в другой организации — войдите под её аккаунтом");
  }

  const targetDay = request.headers.get(OFFLINE_DAY_HEADER);
  const time = decideOfflineTime({ recordedAtRaw, targetDay, timeZone: params.timeZone, now: params.now });
  if (!time.ok) return reject(422, `offline-time-${time.code}`, offlineTimeErrorText(time.code));

  const employee = await db.user.findFirst({
    where: { id: params.employeeId, organizationId: params.organizationId, ...(params.includeCommission ? ORG_SIGNER_WHERE : ORG_ROSTER_WHERE) },
    select: { id: true, qrPinHash: true },
  });
  if (!employee) return reject(404, "offline-employee", "Сотрудник больше не работает в организации — запись не принята");

  const rawAuth = request.headers.get(OFFLINE_AUTH_HEADER);
  const auth: OfflineAuthKind = rawAuth === "pin" || rawAuth === "list" ? rawAuth : "self";
  const base = {
    recordedAt: time.recordedAt,
    dateKey: time.dateKey,
    pastDayEdit: Boolean(targetDay?.trim()),
    auth,
    deviceUserId: session.user.id,
  };

  // «Только после входа»: who may write for whom is decided by the session, as online.
  if (params.mode === "auth") return { ok: true, envelope: { ...base, actorMode: "auth" } };

  if (auth === "pin") {
    const fingerprint = request.headers.get(OFFLINE_PIN_FP_HEADER) ?? "";
    if (!employee.qrPinHash || !fingerprint || fingerprint !== qrPinFingerprint(employee.qrPinHash)) {
      return reject(409, "offline-pin-changed", "ПИН сотрудника изменён или отозван — введите действующий ПИН, и запись уйдёт");
    }
    return { ok: true, envelope: { ...base, actorMode: "public" } };
  }

  if (auth === "self") {
    if (employee.id !== session.user.id) return reject(403, "offline-not-self", "Запись подписана другим сотрудником без ПИН — её нельзя принять");
    return { ok: true, envelope: { ...base, actorMode: "public" } };
  }

  // Picked from the list without a PIN: fine only while the organization allows it
  // and the employee still has no PIN (same rule as the online QR page).
  if (params.mode === "pin" || employee.qrPinHash) {
    return reject(409, "offline-pin-required", "Сотруднику выдан ПИН — введите его, и запись уйдёт");
  }
  return { ok: true, envelope: { ...base, actorMode: "public" } };
}

/** Details for the audit log: the manager sees that the record was made without network. */
export function offlineAuditMark(envelope: OfflineEnvelope, now: Date = new Date()) {
  return {
    recordedAt: envelope.recordedAt.toISOString(),
    syncedAt: now.toISOString(),
    auth: envelope.auth,
    deviceUserId: envelope.deviceUserId,
    ...(envelope.pastDayEdit ? { pastDayEdit: true } : {}),
  };
}

/**
 * Sticker endpoints (equipment, room, UV lamp): who made the record and when,
 * if it was made without network. `null` — an ordinary online request: the
 * endpoint resolves the actor itself exactly as before.
 */
export async function resolveOfflineObjectActor(
  request: Request,
  params: {
    mode: QrFillMode;
    organizationId: string;
    employeeId: string;
    timeZone: string | null | undefined;
  }
): Promise<{ actor: QrFillActorResult; now: Date; offline: ReturnType<typeof offlineAuditMark> | null } | null> {
  if (!isOfflineRequest(request)) return null;
  const offline = await readOfflineEnvelope(request, params);
  if (!offline) return null;
  if (!offline.ok) {
    return { actor: { ok: false, status: offline.status, error: offline.error, errorCode: offline.code }, now: new Date(), offline: null };
  }
  const actor = await resolveQrFillActor({
    mode: offline.envelope.actorMode,
    organizationId: params.organizationId,
    employeeId: params.employeeId,
    pinVerified: true,
  });
  return { actor, now: offline.envelope.recordedAt, offline: offlineAuditMark(offline.envelope) };
}

/**
 * The device repeats a queued record until it gets an answer, so the same
 * record can arrive twice (the first answer was lost with the connection).
 * The queue item id is the idempotency key: a repeat gets the stored answer
 * instead of a second journal row. Only accepted answers are stored — a
 * refusal must stay retryable after the person fixes its cause.
 */
export async function withOfflineIdempotency(
  request: Request,
  journalCode: string | null,
  run: () => Promise<NextResponse>
): Promise<NextResponse> {
  const rawKey = request.headers.get("idempotency-key") ?? "";
  if (!isOfflineRequest(request) || !rawKey) return run();
  const session = await getServerSession(authOptions);
  const key = session ? journalIdempotencyKey(session.user.id, `offline:${rawKey}`) : null;
  if (!session || !key) return run();

  const store = prismaIdempotencyStore(db);
  const claim = await claimIdempotency(store, { key, organizationId: getActiveOrgId(session), journalCode });
  if (claim.kind === "replay") {
    return NextResponse.json(claim.stored.response as Record<string, unknown>, {
      status: claim.stored.httpStatus,
      headers: { "idempotent-replayed": "true" },
    });
  }
  if (claim.kind === "in_flight") {
    return NextResponse.json({ error: "Запись уже отправляется", code: "offline-in-flight" }, { status: 409 });
  }
  let response: NextResponse;
  try {
    response = await run();
  } catch (error) {
    await store.release(key);
    throw error;
  }
  if (response.ok) {
    const body = await response.clone().json().catch(() => ({}));
    await store.complete(key, { httpStatus: response.status, response: body }).catch(() => null);
  } else {
    await store.release(key);
  }
  return response;
}
