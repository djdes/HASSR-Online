import {
  effectivePreset,
  hasCapability,
  isValidPreset,
  type PermissionPreset,
} from "@/lib/permission-presets";

/**
 * Смена набора прав сотрудника (`POST /api/staff/[id]/preset`).
 *
 *   • менять может только администратор (`admin.full`);
 *   • `null` — «по должности (автоматически)», иначе один из пресетов;
 *   • себе нельзя поставить набор без `admin.full` — руководитель
 *     заперся бы снаружи настроек, а вернуть права было бы некому.
 *
 * Чистая функция: маршрут подставляет пользователя сессии и цель из базы.
 */

export type PresetChangeActor = {
  id: string;
  role?: string | null;
  isRoot?: boolean | null;
  permissionPreset?: string | null;
  orgPresetOverrides?: Record<string, string[]> | null;
};

export type PresetChangeTarget = {
  id: string;
  role: string | null;
  isRoot?: boolean | null;
  permissionPreset: string | null;
};

export type PresetChangeDecision =
  | { ok: true; preset: PermissionPreset | null; changed: boolean; effective: PermissionPreset }
  | { ok: false; status: 400 | 403; code: PresetChangeRefusal; error: string };

export type PresetChangeRefusal = "NOT_ADMIN" | "INVALID_PRESET" | "ROOT_TARGET" | "SELF_LOCKOUT";

export function decidePresetChange(input: {
  actor: PresetChangeActor;
  target: PresetChangeTarget;
  preset: string | null;
}): PresetChangeDecision {
  const { actor, target } = input;
  if (!hasCapability(actor, "admin.full")) {
    return { ok: false, status: 403, code: "NOT_ADMIN", error: "Набор прав меняет администратор" };
  }
  if (input.preset !== null && !isValidPreset(input.preset)) {
    return { ok: false, status: 400, code: "INVALID_PRESET", error: "Такого набора прав нет" };
  }
  if (target.isRoot) {
    return { ok: false, status: 400, code: "ROOT_TARGET", error: "У администратора платформы набор прав не меняется" };
  }
  const preset = input.preset as PermissionPreset | null;
  if (target.id === actor.id) {
    const keepsAdmin = hasCapability(
      { permissionPreset: preset, role: target.role, orgPresetOverrides: actor.orgPresetOverrides },
      "admin.full"
    );
    if (!keepsAdmin) {
      return {
        ok: false,
        status: 400,
        code: "SELF_LOCKOUT",
        error: "Нельзя снять с себя «Администратора»: вы потеряете доступ к настройкам. Попросите другого администратора",
      };
    }
  }
  const current = target.permissionPreset && isValidPreset(target.permissionPreset) ? target.permissionPreset : null;
  return {
    ok: true,
    preset,
    changed: current !== preset,
    effective: effectivePreset({ permissionPreset: preset, role: target.role }),
  };
}
