/**
 * Сводка страницы «Доступ и права» (`/settings/access`): кто какой набор прав
 * получает и какие разделы меню он откроет. Разделы считает та же функция,
 * что строит меню (`visibleNav`), — новой настройки нет. Чистый модуль.
 */

import { NAV_SECTIONS, visibleNav, type NavActor, type NavFacts, type NavSectionKey } from "@/lib/app-nav";
import { decideJournalAcl } from "@/lib/journal-acl";
import {
  ALL_PRESETS,
  defaultPresetFromRole,
  effectivePreset,
  isControlGroupMember,
  isValidPreset,
  type PermissionPreset,
} from "@/lib/permission-presets";
import { actorHasPermission, type PermissionActor } from "@/lib/permissions";
import { hasFullWorkspaceAccess } from "@/lib/role-access";
import { isManagementRole } from "@/lib/user-roles";

export type SectionVisibility = "visible" | "hidden" | "depends";

/** Группа должности: она задаёт роль (руководство — полный доступ к кабинету). */
export type PositionGroup = "management" | "staff";

/** Разделы меню в порядке `NAV_SECTIONS` — с иконками. */
export const ACCESS_SECTIONS: ReadonlyArray<{ key: NavSectionKey; icon: string }> = NAV_SECTIONS.map((section) => ({
  key: section.key,
  icon: section.icon,
}));

/**
 * Где набор обычно стоит: «Администратор» и «Заведующий» — у руководства,
 * остальные — у сотрудников (их и выдают вручную людям из «Сотрудников»).
 */
export function typicalPresetGroup(preset: PermissionPreset): PositionGroup {
  return preset === "admin" || preset === "head_chef" ? "management" : "staff";
}

/** Роль, которую получает человек из группы (как при создании сотрудника). */
function roleOfGroup(group: PositionGroup): string {
  return group === "management" ? "manager" : "cook";
}

/**
 * Личные факты меню у набора «вообще»: наименьшие и наибольшие. Журнал
 * чек-листов руководство и контроль-группа читают всегда, сотрудникам — по
 * личному доступу; право `settings.permissions` бывает только у руководства.
 */
function factRange(preset: PermissionPreset, group: PositionGroup): [NavFacts, NavFacts] {
  const subject = { role: roleOfGroup(group), isRoot: false, permissionPreset: preset };
  const readsAllJournals = isControlGroupMember(subject) || isManagementRole(subject.role);
  return [
    { checklists: readsAllJournals, settingsPermissions: false },
    { checklists: true, settingsPermissions: hasFullWorkspaceAccess(subject) },
  ];
}

/**
 * Какие разделы откроет набор у человека из группы. «depends» — раздел зависит
 * не от набора, а от личного доступа (к журналу чек-листов, права из «Прав
 * доступа»): у одного человека он есть, у другого — нет.
 */
export function presetSections(
  preset: PermissionPreset,
  group: PositionGroup,
  orgPresetOverrides: Record<string, string[]> | null
): Record<NavSectionKey, SectionVisibility> {
  const actor: NavActor = { role: roleOfGroup(group), permissionPreset: preset, orgPresetOverrides };
  const [least, most] = factRange(preset, group);
  const without = new Set(visibleNav(actor, least).map((section) => section.key));
  const withAll = new Set(visibleNav(actor, most).map((section) => section.key));
  return Object.fromEntries(
    ACCESS_SECTIONS.map(({ key }) => [
      key,
      without.has(key) ? "visible" : withAll.has(key) ? "depends" : "hidden",
    ])
  ) as Record<NavSectionKey, SectionVisibility>;
}

export type AccessPerson = {
  id: string;
  role: string;
  isRoot?: boolean;
  permissionPreset: string | null;
  /** Доступ к журналу чек-листов: перешёл ли человек на ACL и его строка. */
  checklistAcl: {
    migrated: boolean;
    row: { templateCode: string; canRead: boolean; canWrite: boolean; canFinalize: boolean } | undefined;
  };
  /** Для права `settings.permissions` (см. `src/lib/permissions.ts`). */
  permissionActor: PermissionActor;
  /** Руководитель точки: общие разделы компании ему закрыты (lib/point-scope.ts). */
  pointScope?: readonly string[] | null;
};

/** Факты меню человека — как `loadNavFacts`, но без сессии и запросов. */
export function personNavFacts(person: AccessPerson): NavFacts {
  const subject = { role: person.role, isRoot: person.isRoot === true, permissionPreset: person.permissionPreset };
  const bypassesAcl = subject.isRoot || isControlGroupMember(subject) || isManagementRole(subject.role);
  const checklists = decideJournalAcl(subject, "read", bypassesAcl ? null : person.checklistAcl);
  const settingsPermissions =
    hasFullWorkspaceAccess(subject) && actorHasPermission(person.permissionActor, "settings.permissions");
  return { checklists, settingsPermissions };
}

/** Разделы, которые человек откроет сейчас (ключи в порядке меню). */
export function personSections(person: AccessPerson, orgPresetOverrides: Record<string, string[]> | null): NavSectionKey[] {
  const actor: NavActor = {
    role: person.role,
    isRoot: person.isRoot === true,
    permissionPreset: person.permissionPreset,
    orgPresetOverrides,
    pointScope: person.pointScope ?? null,
  };
  return visibleNav(actor, personNavFacts(person)).map((section) => section.key);
}

/** Набор человека: действующий и как он получен — по должности (роли) или вручную. */
export function personPreset(person: { role: string; isRoot?: boolean; permissionPreset: string | null }): {
  effective: PermissionPreset;
  byPosition: PermissionPreset;
  manual: boolean;
} {
  const manual = person.isRoot !== true && Boolean(person.permissionPreset && isValidPreset(person.permissionPreset));
  return {
    effective: effectivePreset({ role: person.role, isRoot: person.isRoot, permissionPreset: person.permissionPreset }),
    byPosition: defaultPresetFromRole(person.role),
    manual,
  };
}

export type PresetHolders = {
  /** Должности, чьи люди получают набор автоматически (по роли). */
  positions: string[];
  /** Сколько людей с этим набором сейчас. */
  total: number;
  /** Из них — назначено вручную. */
  manual: number;
};

/** Кто получает каждый набор: по должности (без ручного набора) и вручную. */
export function presetHolders(
  people: ReadonlyArray<{ role: string; isRoot?: boolean; permissionPreset: string | null; positionName: string | null }>
): Record<PermissionPreset, PresetHolders> {
  const result = Object.fromEntries(
    ALL_PRESETS.map((preset) => [preset, { positions: [] as string[], total: 0, manual: 0 }])
  ) as Record<PermissionPreset, PresetHolders>;
  for (const person of people) {
    const { effective, manual } = personPreset(person);
    const entry = result[effective];
    entry.total += 1;
    if (manual) {
      entry.manual += 1;
    } else if (person.positionName && !entry.positions.includes(person.positionName)) {
      entry.positions.push(person.positionName);
    }
  }
  for (const entry of Object.values(result)) entry.positions.sort((a, b) => a.localeCompare(b, "ru"));
  return result;
}
