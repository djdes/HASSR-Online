import { VERIFIER_SLOT_ID } from "@/lib/journal-responsible-schemas";

/**
 * Общий список «Проверяющие и аудиторы» организации.
 *
 *   • внешние — ссылки и QR портала проверяющего (`InspectorToken`): вид,
 *     метка, срок, активность, кто выпустил, открытия и визиты
 *     (`InspectorVisit`). Хэш токена наружу не уходит никогда;
 *   • внутренние — сотрудники с ролями проверки: проверяющий журнала
 *     (слот `_verifier` в «Ответственных»), проверяющий документа
 *     (`JournalDocument.verifierUserId`, активные документы), проверяющий
 *     помещения (`Room.verifierUserIds`), аудитор внутренних аудитов
 *     (`audit_*`, слоты заполнения) и аудитор прослеживаемости
 *     (`traceability_test`).
 *
 * Модуль чистый: маршрут `GET /api/staff/inspectors-auditors` достаёт
 * строки из базы и отдаёт их сюда. Будущая страница «Проверяющие и
 * аудиторы» строится из ответа маршрута.
 */

// ---------------------------------------------------------------- внешние

export type ExternalInspectorKind = "qr" | "link";
export type ExternalInspectorStatus = "active" | "expired" | "revoked";

export type InspectorTokenRow = {
  id: string;
  label: string | null;
  periodFrom: Date;
  periodTo: Date;
  expiresAt: Date;
  lastAccessedAt: Date | null;
  accessCount: number;
  revokedAt: Date | null;
  createdAt: Date;
  createdById: string | null;
  visits: Array<{
    id: string;
    signedAt: Date;
    inspectorName: string | null;
    templatesViewed: unknown;
  }>;
};

export type ExternalInspector = {
  id: string;
  kind: ExternalInspectorKind;
  label: string | null;
  /** Период, который видит проверяющий; у QR — открытый (выбирает сам), null. */
  periodFrom: string | null;
  periodTo: string | null;
  expiresAt: string;
  status: ExternalInspectorStatus;
  active: boolean;
  issuedBy: { id: string; name: string } | null;
  accessCount: number;
  lastAccessedAt: string | null;
  createdAt: string;
  visits: Array<{ id: string; signedAt: string; inspectorName: string | null; journalsViewed: number }>;
};

/** QR портала — «открытый период» до 2099 года (см. src/lib/inspector-qr.ts). */
function isQrToken(row: { periodTo: Date }): boolean {
  return row.periodTo.getUTCFullYear() >= 2099;
}

export function externalInspectorEntry(
  row: InspectorTokenRow,
  issuers: ReadonlyMap<string, string>,
  now: Date
): ExternalInspector {
  const kind: ExternalInspectorKind = isQrToken(row) ? "qr" : "link";
  const status: ExternalInspectorStatus = row.revokedAt ? "revoked" : row.expiresAt <= now ? "expired" : "active";
  const issuerName = row.createdById ? issuers.get(row.createdById) : undefined;
  return {
    id: row.id,
    kind,
    label: row.label,
    periodFrom: kind === "qr" ? null : row.periodFrom.toISOString(),
    periodTo: kind === "qr" ? null : row.periodTo.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    status,
    active: status === "active",
    issuedBy: row.createdById && issuerName ? { id: row.createdById, name: issuerName } : null,
    accessCount: row.accessCount,
    lastAccessedAt: row.lastAccessedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    visits: [...row.visits]
      .sort((a, b) => b.signedAt.getTime() - a.signedAt.getTime())
      .map((visit) => ({
        id: visit.id,
        signedAt: visit.signedAt.toISOString(),
        inspectorName: visit.inspectorName,
        journalsViewed: Array.isArray(visit.templatesViewed) ? visit.templatesViewed.length : 0,
      })),
  };
}

// --------------------------------------------------------------- внутренние

export type InternalRoleKind =
  | "journal_verifier"
  | "document_verifier"
  | "room_verifier"
  | "audit_auditor"
  | "traceability_auditor";

export const INTERNAL_ROLE_LABELS: Record<InternalRoleKind, string> = {
  journal_verifier: "Проверяющий журналов",
  document_verifier: "Проверяющий документов",
  room_verifier: "Проверяющий помещений",
  audit_auditor: "Аудитор внутренних аудитов",
  traceability_auditor: "Аудитор прослеживаемости",
};

const ROLE_ORDER: InternalRoleKind[] = [
  "journal_verifier",
  "document_verifier",
  "room_verifier",
  "audit_auditor",
  "traceability_auditor",
];

export const AUDIT_JOURNAL_CODES: readonly string[] = ["audit_plan", "audit_protocol", "audit_report"];
export const TRACEABILITY_JOURNAL_CODE = "traceability_test";

export type InternalInspector = {
  userId: string;
  name: string;
  position: string;
  roles: Array<{
    kind: InternalRoleKind;
    label: string;
    /** Журналы (code), документы или помещения (id) — за что отвечает. */
    items: Array<{ id: string; name: string }>;
  }>;
};

export type InternalInspectorsInput = {
  /** Живые сотрудники организации (не в архиве). Чужие и удалённые id отбрасываются. */
  users: ReadonlyArray<{ id: string; name: string; position: string }>;
  /** `Organization.journalResponsibleUsersJson`: { [code]: { [slotId]: userId } }. */
  responsibleSlots: unknown;
  /** Активные документы с проверяющим. */
  documents: ReadonlyArray<{ id: string; title: string; templateCode: string; verifierUserId: string | null }>;
  rooms: ReadonlyArray<{ id: string; name: string; verifierUserIds: readonly string[] }>;
  journalNames: ReadonlyMap<string, string>;
  /** Отключённые журналы организации — их роли не показываем. */
  disabledCodes?: ReadonlySet<string>;
};

function asSlotMap(value: unknown): Record<string, Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, Record<string, unknown>> = {};
  for (const [code, slots] of Object.entries(value as Record<string, unknown>)) {
    if (slots && typeof slots === "object" && !Array.isArray(slots)) out[code] = slots as Record<string, unknown>;
  }
  return out;
}

export function buildInternalInspectors(input: InternalInspectorsInput): InternalInspector[] {
  const people = new Map(input.users.map((user) => [user.id, user]));
  const disabled = input.disabledCodes ?? new Set<string>();
  // userId → kind → items (по id, без повторов)
  const byUser = new Map<string, Map<InternalRoleKind, Map<string, string>>>();
  const add = (userId: unknown, kind: InternalRoleKind, id: string, name: string) => {
    if (typeof userId !== "string" || !people.has(userId)) return;
    const kinds = byUser.get(userId) ?? new Map<InternalRoleKind, Map<string, string>>();
    const items = kinds.get(kind) ?? new Map<string, string>();
    items.set(id, name);
    kinds.set(kind, items);
    byUser.set(userId, kinds);
  };
  const journalName = (code: string) => input.journalNames.get(code) ?? code;

  for (const [code, slots] of Object.entries(asSlotMap(input.responsibleSlots))) {
    if (disabled.has(code)) continue;
    add(slots[VERIFIER_SLOT_ID], "journal_verifier", code, journalName(code));
    const fillerKind: InternalRoleKind | null = AUDIT_JOURNAL_CODES.includes(code)
      ? "audit_auditor"
      : code === TRACEABILITY_JOURNAL_CODE
        ? "traceability_auditor"
        : null;
    if (!fillerKind) continue;
    for (const [slotId, userId] of Object.entries(slots)) {
      if (slotId === VERIFIER_SLOT_ID) continue;
      add(userId, fillerKind, code, journalName(code));
    }
  }
  for (const doc of input.documents) {
    if (disabled.has(doc.templateCode)) continue;
    add(doc.verifierUserId, "document_verifier", doc.id, doc.title || journalName(doc.templateCode));
  }
  for (const room of input.rooms) {
    for (const userId of new Set(room.verifierUserIds)) add(userId, "room_verifier", room.id, room.name);
  }

  const result: InternalInspector[] = [];
  for (const [userId, kinds] of byUser) {
    const person = people.get(userId)!;
    result.push({
      userId,
      name: person.name,
      position: person.position,
      roles: ROLE_ORDER.filter((kind) => kinds.has(kind)).map((kind) => ({
        kind,
        label: INTERNAL_ROLE_LABELS[kind],
        items: [...kinds.get(kind)!.entries()]
          .map(([id, name]) => ({ id, name }))
          .sort((a, b) => a.name.localeCompare(b.name, "ru")),
      })),
    });
  }
  return result.sort((a, b) => a.name.localeCompare(b.name, "ru"));
}
