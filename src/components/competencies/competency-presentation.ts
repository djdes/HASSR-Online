import { getUserPositionLabel, normalizeUserRole, isUserRoleValue, type UserLike, type UserRole } from "@/lib/user-roles";

export const COMPETENCY_SKILLS = ["safety", "stability", "speed", "haccp", "hygiene", "equipment"] as const;
export const COMPETENCY_LEVELS = [0, 1, 2, 3] as const;
export function isCompetencySkill(value: string): value is typeof COMPETENCY_SKILLS[number] {
  return (COMPETENCY_SKILLS as readonly string[]).includes(value);
}
export function isCompetencyLevel(value: number): value is typeof COMPETENCY_LEVELS[number] {
  return (COMPETENCY_LEVELS as readonly number[]).includes(value);
}
export function competencyPositionLabel(user: UserLike, roles: Record<UserRole, string>) {
  if (user.jobPosition?.name?.trim() || user.positionTitle?.trim()) return getUserPositionLabel(user);
  const role = normalizeUserRole(user.role);
  return isUserRoleValue(role) ? roles[role] : getUserPositionLabel(user);
}

const LEGACY_ERRORS = {
  "Не авторизован": "unauthorized",
  "Это действие доступно руководителю": "forbidden",
  "Некорректный JSON": "invalidData",
  "Некорректные данные": "invalidData",
  "Сотрудник не найден": "userNotFound",
} as const;
export function competencyErrorKey(error: unknown, status?: number) {
  if (typeof error === "string" && Object.hasOwn(LEGACY_ERRORS, error)) return LEGACY_ERRORS[error as keyof typeof LEGACY_ERRORS];
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 400) return "invalidData";
  if (status === 404) return "userNotFound";
  return "saveFailed";
}

/** Stable API payload; translated labels never become stored skill values. */
export async function saveCompetencyLevel(payload: { userId: string; skill: string; level: number }, fetcher: typeof fetch = fetch): Promise<{ ok: true } | { ok: false; error: ReturnType<typeof competencyErrorKey> }> {
  try {
    const response = await fetcher("/api/competencies", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    });
    if (response.ok) return { ok: true };
    const data = await response.json().catch(() => null) as { error?: unknown } | null;
    return { ok: false, error: competencyErrorKey(data?.error, response.status) };
  } catch {
    return { ok: false, error: "saveFailed" };
  }
}
