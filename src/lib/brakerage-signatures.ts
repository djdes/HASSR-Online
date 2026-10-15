import type { Prisma } from "@prisma/client";

import {
  isCommissionMember,
  normalizeRowSignatures,
  signatureSnapshot,
  type BrakerageRowSignature,
} from "@/lib/brakerage-commission";
import { withDocumentConfigLock } from "@/lib/document-config-lock";
import {
  createFinishedProductRow,
  getFinishedProductOrganolepticOptions,
  normalizeFinishedProductDocumentConfig,
  type FinishedProductDocumentRow,
} from "@/lib/finished-product-document";
import {
  createPerishableRejectionRow,
  normalizePerishableOrganoleptic,
  normalizePerishableRejectionConfig,
  type PerishableRejectionRow,
} from "@/lib/perishable-rejection-document";
import { orgTodayKey } from "@/lib/timezone";
import { commissionSignDefaultTime, deriveBrakerageTimes, withLocalTime } from "@/lib/brakerage-times";
import { aggregateBrakerageAssessment, brakerageCommentRequired, parseBrakerageTimeDigits } from "@/lib/brakerage-assessment";

/**
 * Подпись членов бракеражной комиссии под строками (п. 2, 12 ТЗ).
 *
 * Одна транзакция под блокировкой документа: правки оценки в строках +
 * копия подписи в `row.signatures` (ею владеет сервер) + событие в журнале
 * подписей `SignatureEvent` (entryKind "brakerage_row") — доказательство
 * «кто, когда и каким входом подписал». Повторная подпись того же человека
 * заменяет его прежнюю в строке, в журнале подписей остаются обе.
 *
 * Время подписи в журнале (`journalAt`) — время бракеража строки + 1 минута
 * (решение владельца 2026-09-30); настоящий момент нажатия остаётся в
 * `signedAt`, в журнале подписей (`createdAt`) и в журнале действий.
 */

export type BrakerageSignEntry = {
  rowId: string;
  /** Оценка: у готовой продукции — текст из списка, у скоропорта — код. */
  grade?: string;
  releaseAllowed?: "yes" | "no";
  portionWeight?: string;
  note?: string;
  /** Время снятия бракеража «ЧЧ:ММ», исправленное комиссией (дата — строки). */
  rejectionTime?: string;
};

/** Подписанная строка: время подписи в журнале (null — настоящее время, у строки не было бракеража). */
export type BrakerageSignedRow = { rowId: string; journalAt: string | null };

export type BrakerageSignResult =
  | {
      ok: true;
      signed: number;
      /** Настоящий момент подписи (ISO) — для журнала действий. */
      signedAt: string;
      rows: BrakerageSignedRow[];
    }
  | { ok: false; error: string; status: number };

function localDateTime(timeZone: string | null | undefined, at: Date): string {
  const date = orgTodayKey(timeZone ?? undefined, at);
  try {
    const time = new Intl.DateTimeFormat("en-GB", {
      timeZone: timeZone || "Europe/Moscow",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(at);
    return `${date} ${time.replace(/^24/, "00")}`;
  } catch {
    return `${date} ${at.toISOString().slice(11, 16)}`;
  }
}

function withSignature(
  existing: unknown,
  signature: BrakerageRowSignature
): BrakerageRowSignature[] {
  return [...normalizeRowSignatures(existing).filter((item) => item.userId !== signature.userId), signature];
}

export async function signBrakerageRows(params: {
  documentId: string;
  organizationId: string;
  signer: { id: string; name: string };
  method: "qr" | "session" | "passkey" | "kiosk_pin";
  entries: BrakerageSignEntry[];
  timeZone?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<BrakerageSignResult> {
  if (params.entries.length === 0) return { ok: false, error: "Отметьте строки, которые подписываете", status: 400 };
  const result = await withDocumentConfigLock<BrakerageSignResult>(params.documentId, async (doc, tx) => {
    if (doc.organizationId !== params.organizationId) {
      return { result: { ok: false, error: "Документ не найден", status: 404 } };
    }
    if (doc.status !== "active") {
      return { result: { ok: false, error: "Журнал закрыт — подписать нельзя", status: 409 } };
    }
    const now = new Date();
    const nowLocal = localDateTime(params.timeZone, now);
    const byRowId = new Map(params.entries.map((entry) => [entry.rowId, entry]));

    if (doc.templateCode === "finished_product") {
      const config = normalizeFinishedProductDocumentConfig(doc.config);
      const member = config.commissionMembers.find((item) => item.employeeId === params.signer.id);
      if (!isCommissionMember(config, params.signer.id) || !member) {
        return { result: { ok: false, error: "Подписывают только члены комиссии этого журнала", status: 403 } };
      }
      // Validate the entire batch before creating any immutable events.
      const gradeOptions = getFinishedProductOrganolepticOptions(config);
      for (const entry of params.entries) {
        const row = config.rows.find(item => item.id === entry.rowId);
        if (!row) return { result: { ok: false, error: "Строка не найдена — обновите страницу", status: 404 } };
        if (!row.productName.trim()) return { result: { ok: false, error: "Сначала сотрудник, ведущий журнал, должен внести название блюда", status: 400 } };
        const grade = entry.grade?.trim() || row.organoleptic;
        if (!gradeOptions.includes(grade)) return { result: { ok: false, error: "Выберите оценку из списка", status: 400 } };
        if (brakerageCommentRequired(grade) && !entry.note?.trim()) return { result: { ok: false, error: `Добавьте комментарий к оценке блюда «${row.productName}»`, status: 400 } };
        if (entry.rejectionTime !== undefined && !parseBrakerageTimeDigits(entry.rejectionTime)) return { result: { ok: false, error: "Введите время четырьмя цифрами: например, 1430", status: 400 } };
      }
      let signed = 0;
      const rows: FinishedProductDocumentRow[] = [];
      const signedRows: BrakerageSignedRow[] = [];
      for (const row of config.rows) {
        const entry = byRowId.get(row.id);
        if (!entry) {
          rows.push(row);
          continue;
        }
        const grade = entry.grade?.trim() || row.organoleptic;
        const otherSignatures = normalizeRowSignatures(row.signatures).filter(item => item.userId !== params.signer.id && config.commissionMembers.some(member => member.employeeId === item.userId));
        const assessment = aggregateBrakerageAssessment(otherSignatures, grade);
        const assessmentNote = grade === assessment.grade ? entry.note?.trim() : otherSignatures.find(item => item.grade === assessment.grade)?.note?.trim();
        const releaseAllowed = assessment.releaseAllowed;
        // Время бракеража: исправленное комиссией (ЧЧ:ММ на дату строки), иначе
        // записанное, иначе изготовление + смещение журнала (5 мин); разрешение —
        // бракераж + смещение. «Сейчас» — только если нет и времени изготовления.
        const correctedTime = entry.rejectionTime ? parseBrakerageTimeDigits(entry.rejectionTime) : null;
        const correctedRejection = correctedTime ? withLocalTime(row.productionDateTime || nowLocal, correctedTime) : null;
        const times = deriveBrakerageTimes({
          productionDateTime: row.productionDateTime,
          rejectionTime: correctedRejection ?? row.rejectionTime,
          releasePermissionTime: correctedRejection ? "" : row.releasePermissionTime,
          releaseAllowed,
          offsets: config.timeDefaults,
        });
        const next = createFinishedProductRow({
          ...row,
          organoleptic: assessment.grade,
          releaseAllowed,
          ...(entry.portionWeight !== undefined ? { portionWeight: entry.portionWeight } : {}),
          note: assessmentNote || row.note,
          rejectionTime: times.rejectionTime || nowLocal,
          releasePermissionTime: releaseAllowed === "yes" ? times.releasePermissionTime || nowLocal : "",
        });
        // Время подписи в журнале — бракераж + 1 минута. Бракеража у строки не
        // было (сервер ставит «сейчас») — как раньше: настоящее время подписи.
        const journalAt = times.rejectionTime ? commissionSignDefaultTime(next) : "";
        const signature: BrakerageRowSignature = {
          userId: params.signer.id,
          name: params.signer.name,
          role: member.role,
          signedAt: now.toISOString(),
          ...(journalAt ? { journalAt } : {}),
          method: params.method,
          grade,
          note: entry.note?.trim() ?? "",
          snapshot: { productName: next.productName, portionWeight: next.portionWeight },
        };
        rows.push({ ...next, signatures: withSignature(row.signatures, signature) });
        signedRows.push({ rowId: row.id, journalAt: journalAt || null });
        await tx.signatureEvent.create({
          data: {
            organizationId: doc.organizationId,
            userId: params.signer.id,
            method: params.method,
            entryKind: "brakerage_row",
            documentId: doc.id,
            rowId: row.id,
            ip: params.ip ?? null,
            userAgent: params.userAgent ?? null,
            entryRef: {
              role: member.role,
              userName: params.signer.name,
              grade: signature.grade ?? null,
              note: signature.note,
              snapshot: signature.snapshot,
              // Время в журнале; настоящий момент — createdAt события.
              journalAt: journalAt || null,
            } as Prisma.InputJsonValue,
          },
        });
        signed += 1;
      }
      if (signed === 0) return { result: { ok: false, error: "Строки не найдены — обновите страницу", status: 404 } };
      return {
        config: { ...config, rows } as unknown as Prisma.InputJsonValue,
        result: { ok: true, signed, signedAt: now.toISOString(), rows: signedRows },
      };
    }

    if (doc.templateCode === "perishable_rejection") {
      const config = normalizePerishableRejectionConfig(doc.config);
      const member = config.commissionMembers.find((item) => item.employeeId === params.signer.id);
      if (!member) {
        return { result: { ok: false, error: "Подписывают только члены комиссии этого журнала", status: 403 } };
      }
      let signed = 0;
      const rows: PerishableRejectionRow[] = [];
      const signedRows: BrakerageSignedRow[] = [];
      for (const row of config.rows) {
        const entry = byRowId.get(row.id);
        if (!entry) {
          rows.push(row);
          continue;
        }
        const next = createPerishableRejectionRow({
          ...row,
          ...(entry.grade ? { organolepticResult: normalizePerishableOrganoleptic(entry.grade) } : {}),
          ...(entry.note !== undefined ? { note: entry.note } : {}),
        });
        const signature: BrakerageRowSignature = {
          userId: params.signer.id,
          name: params.signer.name,
          role: member.role,
          signedAt: now.toISOString(),
          method: params.method,
          grade: next.organolepticResult,
          snapshot: signatureSnapshot(next as unknown as Record<string, unknown>),
        };
        rows.push({ ...next, signatures: withSignature(row.signatures, signature) });
        // У скоропорта нет времени бракеража — в журнале настоящее время подписи.
        signedRows.push({ rowId: row.id, journalAt: null });
        await tx.signatureEvent.create({
          data: {
            organizationId: doc.organizationId,
            userId: params.signer.id,
            method: params.method,
            entryKind: "brakerage_row",
            documentId: doc.id,
            rowId: row.id,
            ip: params.ip ?? null,
            userAgent: params.userAgent ?? null,
            entryRef: { role: member.role, userName: params.signer.name, grade: signature.grade ?? null, snapshot: signature.snapshot } as Prisma.InputJsonValue,
          },
        });
        signed += 1;
      }
      if (signed === 0) return { result: { ok: false, error: "Строки не найдены — обновите страницу", status: 404 } };
      return {
        config: { ...config, rows } as unknown as Prisma.InputJsonValue,
        result: { ok: true, signed, signedAt: now.toISOString(), rows: signedRows },
      };
    }

    return { result: { ok: false, error: "Подпись комиссии есть только у бракеражных журналов", status: 400 } };
  });
  const outcome: BrakerageSignResult = result ?? { ok: false, error: "Документ не найден", status: 404 };
  if (outcome.ok) {
    // Настоящий момент подписи и время, которое встало в журнал, — рядом.
    console.info("[brakerage-sign] signed", {
      documentId: params.documentId,
      organizationId: params.organizationId,
      signerId: params.signer.id,
      method: params.method,
      signedAt: outcome.signedAt,
      rows: outcome.rows,
    });
  } else {
    console.info("[brakerage-sign] refused", {
      documentId: params.documentId,
      signerId: params.signer.id,
      method: params.method,
      status: outcome.status,
      error: outcome.error,
    });
  }
  return outcome;
}

/** Строки с датой `dayKey` (готовая продукция — по изготовлению, скоропорт — по поступлению). */
export function rowDayKey(code: string, row: Record<string, unknown>): string {
  const raw = code === "finished_product" ? row.productionDateTime : row.arrivalDate;
  return typeof raw === "string" ? raw.slice(0, 10) : "";
}
