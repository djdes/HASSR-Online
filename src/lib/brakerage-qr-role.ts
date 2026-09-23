import { isCommissionMember, type BrakerageCommissionMember } from "@/lib/brakerage-commission";
import { isManagementRole } from "@/lib/user-roles";

/**
 * Что человек видит на QR бракеража после выбора себя (п. 10 ТЗ):
 *   • член комиссии (утверждённый состав документа или организации) —
 *     список за сегодня, оценивает и подписывает, но наименование и время
 *     не меняет;
 *   • уполномоченный редактировать список блюд (галка в карточке или
 *     руководство — он и так правит всё на сайте) — тот же список, где
 *     наименование и время правятся, строку можно удалить;
 *   • должность «Член бракеражной комиссии» без утверждённого состава —
 *     список только для чтения и подсказка попросить руководителя
 *     (решение владельца 2026-09-23: подписи — только утверждённый состав);
 *   • остальные — форма «добавить блюдо» (одно или несколько сразу).
 */
export type BrakerageQrRole = {
  /** Оценивает и подписывает строки. */
  evaluator: boolean;
  /** Правит наименование и время, удаляет строки. */
  editor: boolean;
  /** Видит список без права оценки и подписи (должность комиссии вне состава). */
  viewer: boolean;
};

export function brakerageQrRole(params: {
  config: { commissionMembers?: readonly BrakerageCommissionMember[] };
  /** Состав организации (`readOrgCommission`) — запасная проверка, если копия документа отстала. */
  orgMembers?: readonly BrakerageCommissionMember[];
  employeeId: string;
  role: string | null | undefined;
  canEditBrakerageDishes: boolean;
  /** Должность категории «Комиссия». */
  commissionPosition?: boolean;
}): BrakerageQrRole {
  const evaluator =
    isCommissionMember(params.config, params.employeeId) ||
    isCommissionMember({ commissionMembers: params.orgMembers ?? [] }, params.employeeId);
  const editor = params.canEditBrakerageDishes || isManagementRole(params.role ?? "");
  return { evaluator, editor, viewer: !evaluator && !editor && params.commissionPosition === true };
}

/** Какой экран открыть: список за сегодня или форму добавления. */
export function brakerageQrDefaultView(role: BrakerageQrRole): "list" | "add" {
  return role.evaluator || role.editor || role.viewer ? "list" : "add";
}

export const BRAKERAGE_BULK_MAX = 30;

/** «Каждое с новой строки»: пустые и повторы убираем, не больше 30. */
export function parseBulkNames(text: string, max = BRAKERAGE_BULK_MAX): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const name = line.replace(/^\s*(?:\d{1,2}[.)]|[-–—•*])\s*/, "").replace(/\s+/g, " ").trim().slice(0, 200);
    if (!name) continue;
    const key = name.toLocaleLowerCase("ru");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
    if (out.length >= max) break;
  }
  return out;
}
