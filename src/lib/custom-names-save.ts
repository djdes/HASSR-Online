import {
  customNamesAuditDetails,
  diffCustomNames,
  mergeCustomNamesPatch,
  parseCustomNames,
  validateCustomNamesInput,
  type CustomNameChange,
  type CustomNames,
} from "@/lib/custom-names";
import { hasFullWorkspaceAccess, type RoleAccessActor } from "@/lib/role-access";

/**
 * Сохранение своих названий организации: страница «Настройки → Названия»
 * (`PUT /api/settings/custom-names`) и окно «Своё название журнала» на
 * странице журнала (`PATCH` того же адреса).
 *
 * Логика вынесена из маршрута, чтобы её можно было проверить тестом без
 * базы и сессии: доступ, проверка ввода, запись только в свою
 * организацию и `AuditLog` «было → стало».
 *
 * `PUT` — ПОЛНЫЙ набор названий, как у «Набора журналов»: страница
 * отправляет все поля разом одной кнопкой, пустое поле значит
 * «стандартное», поэтому две вкладки не затирают друг другу половину
 * правок молча. `PATCH` — одно-два поля поверх сохранённого набора
 * (`mergeCustomNamesPatch`): окно на странице журнала видит только свой
 * журнал и не должно трогать остальные названия. Дальше путь общий:
 * те же проверки, дифф, запись и аудит.
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
  /**
   * `replace` (по умолчанию) — тело и есть полный набор (`PUT`, страница
   * «Названия»); `merge` — только присланные поля поверх сохранённых
   * (`PATCH`, окно на странице журнала).
   */
  mode?: "replace" | "merge";
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

  const before = parseCustomNames(await deps.loadStored(input.organizationId));
  // Тело не того вида `mergeCustomNamesPatch` не склеивает — тогда его
  // проверяет `validateCustomNamesInput` и отвечает той же ошибкой, что PUT.
  const body =
    input.mode === "merge"
      ? mergeCustomNamesPatch(before, input.body, officialNames) ?? input.body
      : input.body;

  const validation = validateCustomNamesInput(body, officialNames);
  if (!validation.ok) {
    return {
      status: 400,
      body: { error: validation.message, errors: validation.errors },
    };
  }

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
