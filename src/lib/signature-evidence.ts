import { db } from "@/lib/db";

/**
 * Доказательство подписи для проверки: какой `SignatureEvent` стоит за
 * записью журнала.
 *
 * Разблокировка общего планшета пишет событие «кто, где, когда, каким
 * методом». Сама запись журнала хранит только автора и время. Связываем
 * их по окну: событие того же сотрудника, сделанное не раньше чем за
 * KIOSK_WINDOW_MS до записи и не позже неё — это и есть «вход, под которым
 * запись была внесена». Окно равно потолку киоск-сессии.
 */
export const KIOSK_WINDOW_MS = 12 * 60 * 60 * 1000;

export type SignatureEvidence = {
  id: string;
  userId: string;
  method: string;
  deviceId: string | null;
  createdAt: Date;
  entryKind: string | null;
  entryRef: unknown;
};

export type SignatureEvidenceBundle = {
  events: SignatureEvidence[];
  deviceLabels: Map<string, string>;
};

export async function loadSignatureEvidence(params: {
  organizationId: string;
  userIds: string[];
  from: Date;
  to: Date;
}): Promise<SignatureEvidenceBundle> {
  const userIds = Array.from(new Set(params.userIds.filter(Boolean)));
  if (userIds.length === 0) return { events: [], deviceLabels: new Map() };
  const events = await db.signatureEvent.findMany({
    where: {
      organizationId: params.organizationId,
      userId: { in: userIds },
      createdAt: { gte: new Date(params.from.getTime() - KIOSK_WINDOW_MS), lte: params.to },
    },
    select: { id: true, userId: true, method: true, deviceId: true, createdAt: true, entryKind: true, entryRef: true },
    orderBy: { createdAt: "desc" },
  });
  const deviceIds = Array.from(new Set(events.map((e) => e.deviceId).filter((d): d is string => Boolean(d))));
  const devices = deviceIds.length
    ? await db.kioskDevice.findMany({ where: { id: { in: deviceIds } }, select: { id: true, label: true } })
    : [];
  return { events, deviceLabels: new Map(devices.map((d) => [d.id, d.label])) };
}

/** Событие, под которым внесена запись: того же человека, в окне до записи. */
export function matchSignature(
  events: SignatureEvidence[],
  userId: string,
  at: Date,
  opts?: { entryId?: string | null },
): SignatureEvidence | null {
  // Точная привязка по entryRef важнее временного окна.
  if (opts?.entryId) {
    const exact = events.find((e) => {
      const ref = e.entryRef as { entryId?: string } | null;
      return e.userId === userId && ref?.entryId === opts.entryId;
    });
    if (exact) return exact;
  }
  const t = at.getTime();
  return (
    events.find((e) => e.userId === userId && e.createdAt.getTime() <= t && e.createdAt.getTime() >= t - KIOSK_WINDOW_MS) ??
    null
  );
}

export const SIGNATURE_METHOD_LABEL: Record<string, string> = {
  kiosk_pin: "ПИН на общем планшете",
  passkey: "Face ID / отпечаток своего телефона",
  qr: "ПИН на QR-форме",
  session: "вход в кабинет",
};

/** Человеческая строка для инспектора и PDF. */
export function describeSignature(ev: SignatureEvidence, deviceLabels: Map<string, string>): string {
  const method = SIGNATURE_METHOD_LABEL[ev.method] ?? ev.method;
  const device = ev.deviceId ? deviceLabels.get(ev.deviceId) : null;
  const when = ev.createdAt.toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" });
  return [method, device ? `«${device}»` : null, when].filter(Boolean).join(" · ");
}
