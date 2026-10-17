import type { ManagerScope } from "@/lib/manager-scope";
import { pluralRu } from "@/lib/plural-ru";

/**
 * Кратко о «Иерархии» участника контроль-группы: кого он видит и задачи
 * каких журналов назначает. Для `GET /api/staff/control-group` и будущей
 * страницы «Группы и комиссии». Чистый модуль.
 */

export type ScopeSummary = {
  /** Строка `ManagerScope` есть. Нет — видит всех (как везде в кабинете). */
  configured: boolean;
  viewMode: ManagerScope["viewMode"];
  viewJobPositions: Array<{ id: string; name: string }>;
  viewUsers: Array<{ id: string; name: string }>;
  /** Пусто — все журналы. */
  assignableJournals: Array<{ code: string; name: string }>;
  /** «Видит всех», «Видит должности: Повар, Кондитер», «Видит 2 сотрудников: …», «Никого не видит». */
  sees: string;
  /** «Назначает задачи по всем журналам» / «Назначает задачи: Гигиена, Бракераж». */
  assigns: string;
};

const LIST_PREVIEW = 3;

function preview(names: string[]): string {
  const head = names.slice(0, LIST_PREVIEW).join(", ");
  return names.length > LIST_PREVIEW ? `${head} и ещё ${names.length - LIST_PREVIEW}` : head;
}

export function describeManagerScope(
  scope: ManagerScope | null,
  lookup: {
    positions: ReadonlyMap<string, string>;
    users: ReadonlyMap<string, string>;
    journals: ReadonlyMap<string, string>;
  }
): ScopeSummary {
  const viewMode = scope?.viewMode ?? "all";
  const viewJobPositions =
    viewMode === "job_positions"
      ? (scope?.viewJobPositionIds ?? [])
          .filter((id) => lookup.positions.has(id))
          .map((id) => ({ id, name: lookup.positions.get(id) as string }))
      : [];
  const viewUsers =
    viewMode === "specific_users"
      ? (scope?.viewUserIds ?? [])
          .filter((id) => lookup.users.has(id))
          .map((id) => ({ id, name: lookup.users.get(id) as string }))
      : [];
  const assignableJournals = (scope?.assignableJournalCodes ?? []).map((code) => ({
    code,
    name: lookup.journals.get(code) ?? code,
  }));

  let sees: string;
  if (!scope) sees = "Видит всех (иерархия не настроена)";
  else if (viewMode === "all") sees = "Видит всех";
  else if (viewMode === "none") sees = "Никого не видит";
  else if (viewMode === "job_positions") {
    sees =
      viewJobPositions.length === 0
        ? "Никого не видит: должности не выбраны"
        : `Видит должности: ${preview(viewJobPositions.map((item) => item.name))}`;
  } else {
    sees =
      viewUsers.length === 0
        ? "Никого не видит: сотрудники не выбраны"
        : `Видит ${viewUsers.length} ${pluralRu(viewUsers.length, "сотрудника", "сотрудников", "сотрудников")}: ${preview(viewUsers.map((item) => item.name))}`;
  }

  const assigns =
    assignableJournals.length === 0
      ? "Назначает задачи по всем журналам"
      : `Назначает задачи: ${preview(assignableJournals.map((item) => item.name))}`;

  return { configured: Boolean(scope), viewMode, viewJobPositions, viewUsers, assignableJournals, sees, assigns };
}
