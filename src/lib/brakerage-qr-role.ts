import { isCommissionMember, type BrakerageCommissionMember } from "@/lib/brakerage-commission";
import { isManagementRole } from "@/lib/user-roles";

/**
 * Что человек видит на QR бракеража после выбора себя (п. 10 ТЗ):
 *   • член комиссии — список за сегодня, оценивает и подписывает, но
 *     наименование и время не меняет;
 *   • уполномоченный редактировать список блюд (галка в карточке или
 *     руководство — он и так правит всё на сайте) — тот же список, где
 *     наименование и время правятся, строку можно удалить;
 *   • остальные — форма «добавить блюдо» (одно или несколько сразу).
 */
export type BrakerageQrRole = {
  /** Оценивает и подписывает строки. */
  evaluator: boolean;
  /** Правит наименование и время, удаляет строки. */
  editor: boolean;
};

export function brakerageQrRole(params: {
  config: { commissionMembers?: readonly BrakerageCommissionMember[] };
  employeeId: string;
  role: string | null | undefined;
  canEditBrakerageDishes: boolean;
}): BrakerageQrRole {
  return {
    evaluator: isCommissionMember(params.config, params.employeeId),
    editor: params.canEditBrakerageDishes || isManagementRole(params.role ?? ""),
  };
}

/** Какой экран открыть: список за сегодня или форму добавления. */
export function brakerageQrDefaultView(role: BrakerageQrRole): "list" | "add" {
  return role.evaluator || role.editor ? "list" : "add";
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
