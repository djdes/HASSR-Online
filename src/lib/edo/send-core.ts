// Отправка в ЭДО — чистая часть: защита от дублей и вид строки истории. Без prisma и node-модулей:
// её читают и сервис (src/lib/edo/send.server.ts), и интерфейс ROOT.
//
// Анти-цель №1 (как в DocsFlow) — второй юридически значимый документ в Saby. Поэтому: GUID
// документа сохраняется ДО записи; живой документ того же источника не дублируется — черновик
// перезаписывается тем же GUID, отправленный — отказ; «мёртвый» (удалён, отклонён, аннулирован,
// ошибка доставки) новой отправке не мешает.

import { isEdoDead, sabyStateCodeToInt, sabyStateKind } from "./saby/status";
import type { EdoKind } from "./registry";

/** Строка истории в объёме, нужном для решения о дубле. */
export interface EdoDupCandidate {
  id: string;
  sabyDocId: string;
  cabinetClientId: string;
  stateCode: number | null;
  deletedAt: Date | string | null;
  error: string | null;
  number: string;
  createdAt: Date | string;
}

/**
 * Что делать с новой отправкой: `create` — новый документ (новый GUID); `reuse` — есть живой
 * документ в текущем кабинете: перечитать его в Saby и решить `decideAfterReread`; `conflict` —
 * живой документ в другом кабинете Saby (его оттуда не прочитать — второй создавать нельзя).
 */
export type EdoDupDecision =
  | { action: "create" }
  | { action: "reuse"; row: EdoDupCandidate }
  | { action: "conflict"; row: EdoDupCandidate; reason: "other_cabinet" };

const time = (v: Date | string) => (typeof v === "string" ? Date.parse(v) : v.getTime());

export function decideDuplicate(rows: EdoDupCandidate[], clientId: string): EdoDupDecision {
  const live = rows.filter((r) => !isEdoDead(r)).sort((a, b) => time(b.createdAt) - time(a.createdAt));
  const row = live[0];
  if (!row) return { action: "create" };
  if (row.cabinetClientId !== clientId) return { action: "conflict", row, reason: "other_cabinet" };
  return { action: "reuse", row };
}

/**
 * После перечитывания живого документа: `rewrite` — записать тем же GUID (черновик ещё не ушёл
 * или запись прежде не прошла — перезапись того же документа, не второй); `create` — прежний
 * документ мёртв (удалён в Saby, отклонён, аннулирован, ошибка доставки) — нужен новый GUID;
 * `conflict` — документ уже отправлен (или код незнакомый) — второй не создаём.
 * `found === null` — в Saby такого документа нет.
 */
export type EdoRereadDecision =
  | { action: "rewrite" }
  | { action: "create"; markDeleted: boolean }
  | { action: "conflict" };

export function decideAfterReread(rowStateCode: number | null, found: { code: string } | null): EdoRereadDecision {
  if (!found) {
    // Не записывался (или ответ потерян, а документа нет) — пишем тот же GUID заново.
    if (rowStateCode === null) return { action: "rewrite" };
    // Был записан, теперь его нет — удалили руками в Saby.
    return { action: "create", markDeleted: true };
  }
  const kind = sabyStateKind(found.code);
  if (kind === "draft") return { action: "rewrite" };
  if (isEdoDead({ stateCode: sabyStateCodeToInt(found.code), deletedAt: null, error: null })) return { action: "create", markDeleted: false };
  return { action: "conflict" };
}

/** Строка истории для экрана (даты строками, без лишнего). */
export interface EdoDocumentView {
  id: string;
  organizationId: string;
  organizationName: string;
  kind: EdoKind;
  sourceId: string | null;
  sabyType: string;
  number: string;
  docDate: string;
  fileName: string;
  recipientName: string;
  recipientInn: string;
  recipientEdo: string | null;
  recipientOperator: string | null;
  stateCode: number | null;
  stateName: string | null;
  signUrl: string | null;
  error: string | null;
  deletedAt: string | null;
  createdAt: string;
  refreshedAt: string | null;
}

/** Ответ проверки получателя для экрана (без лишних полей Saby). */
export interface EdoRecipientCheckView {
  organizationId: string;
  name: string;
  inn: string;
  kpp: string | null;
  isIp: boolean;
  kind: "saby" | "roaming" | "invited" | "none";
  operator: string;
  participantId: string;
  statusText: string;
}
