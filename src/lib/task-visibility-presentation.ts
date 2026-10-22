export type TaskVisibilityErrorKey =
  | "errors.forbidden"
  | "errors.invalidBody"
  | "errors.foreignPositions"
  | "errors.unauthorized"
  | "errors.saveFailed"
  | "errors.network";

const DESCRIPTORS = {
  TASK_VISIBILITY_FORBIDDEN: { status: 403, key: "errors.forbidden" },
  TASK_VISIBILITY_INVALID_BODY: { status: 400, key: "errors.invalidBody" },
  TASK_VISIBILITY_FOREIGN_POSITIONS: { status: 400, key: "errors.foreignPositions" },
} as const;

/** API text stays on the wire; only finite own descriptors select managed copy. */
export function taskVisibilitySaveError(data: unknown, status: number): TaskVisibilityErrorKey {
  if (status === 401) return "errors.unauthorized";
  if (!data || typeof data !== "object" || Array.isArray(data)) return "errors.saveFailed";
  const field = Object.getOwnPropertyDescriptor(data, "errorCode");
  if (field) {
    const code: unknown = field.value;
    if (typeof code !== "string" || !Object.hasOwn(DESCRIPTORS, code)) return "errors.saveFailed";
    const descriptor = DESCRIPTORS[code as keyof typeof DESCRIPTORS];
    return descriptor.status === status ? descriptor.key : "errors.saveFailed";
  }
  if ("errorCode" in data) return "errors.saveFailed";
  // There are two legacy400 reasons; an absent code cannot identify either.
  return status === 403 ? "errors.forbidden" : "errors.saveFailed";
}
