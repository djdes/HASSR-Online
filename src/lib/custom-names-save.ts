import {
  customNamesAuditDetails,
  diffCustomNames,
  parseCustomNames,
  validateCustomNamesInput,
  type CustomNameChange,
  type CustomNames,
} from "@/lib/custom-names";
import { hasFullWorkspaceAccess, type RoleAccessActor } from "@/lib/role-access";

/**
 * Сохранение страницы «Настройки → Названия» (`PUT /api/settings/custom-names`).
 *
 * Логика вынесена из маршрута, чтобы её можно было проверить тестом без
 * базы и сессии: доступ, проверка ввода, запись только в свою
 * организацию и `AuditLog` «было → стало».
 *
 * Тело запроса — ПОЛНЫЙ набор названий, как у «Набора журналов»:
 * страница отправляет все поля разом одной кнопкой, пустое поле значит
 * «стандартное». Частичных правок нет, поэтому две вкладки не затирают
 * друг другу половину правок молча.
 */

export const CUSTOM_NAMES_AUDIT_ACTION = "settings.custom_names.update";

export type SaveCustomNamesDeps = {
  /** Текущий `Organization.customNamesJson` (сырой JSON). */
  loadStored: (organizationId: string) => Promise<unknown>;
  /** Каталог журналов: код → официальное название. */
  listJournals: () => Promise<Array<{ code: string; name: string }>>;
  store: (organizationId: string, names: CustomNames) => Promise<void>;
  audit: (entry: { organizationId: string; details: Record<string, unknown> }) => Promise<void>;
};

export type SaveCustomNamesInput = {
  /** Кто сохраняет — `session.user`; null — не вошёл. */
  actor: RoleAccessActor | null;
  /** Активная организация сессии (`getActiveOrgId`). */
  organizationId: string | null;
  body: unknown;
};

export type SaveCustomNamesResponse = {
  status: number;
  body: Record<string, unknown>;
  changes?: CustomNameChange[];
};

export async function saveCustomNames(
  input: SaveCustomNamesInput,
  deps: SaveCustomNamesDeps
): Promise<SaveCustomNamesResponse> {
  if (!input.actor || !input.organizationId) {
    return { status: 401, body: { error: "Не авторизован" } };
  }
  // Права — как у «Набора журналов» (`/settings/journals`): руководство.
  if (!hasFullWorkspaceAccess(input.actor)) {
    return { status: 403, body: { error: "Это действие доступно руководителю" } };
  }

  const journals = await deps.listJournals();
  const officialNames: Record<string, string> = Object.fromEntries(
    journals.map((journal) => [journal.code, journal.name])
  );

  const validation = validateCustomNamesInput(input.body, officialNames);
  if (!validation.ok) {
    return {
      status: 400,
      body: { error: validation.message, errors: validation.errors },
    };
  }

  const before = parseCustomNames(await deps.loadStored(input.organizationId));
  const changes = diffCustomNames(before, validation.names, officialNames);
  if (changes.length > 0) {
    await deps.store(input.organizationId, validation.names);
    await deps.audit({
      organizationId: input.organizationId,
      details: customNamesAuditDetails(changes),
    });
  }

  return {
    status: 200,
    body: { names: validation.names, changed: changes.length },
    changes,
  };
}
