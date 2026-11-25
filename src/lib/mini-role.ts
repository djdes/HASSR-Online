/**
 * Pure client/server-safe role resolver for the Telegram Mini App shell.
 *
 * Keeps role grouping, home route, and quick actions aligned with
 * `miniHomeHref`, `permission-presets`, `role-access`, and `permissions`.
 */

import { miniHomeHref, type MiniNavActor } from "@/app/mini/_lib/nav-items";
import { hasCapability } from "@/lib/permission-presets";
import { isManagerLikePermissions } from "@/lib/permissions";
import { hasFullWorkspaceAccess } from "@/lib/role-access";

export type MiniRoleKind = "manager" | "supervisor" | "staff" | "readonly";

export type MiniRoleGroup = "manager" | "staff";

export type MiniQuickActionIcon =
  | "ClipboardList"
  | "CheckSquare"
  | "Users"
  | "FileBarChart2"
  | "LayoutDashboard"
  | "CalendarCheck"
  | "UserRound";

export type MiniQuickActionId =
  | "todayJournals"
  | "verifications"
  | "staff"
  | "reports"
  | "controlBoard"
  | "myTasks"
  | "journals"
  | "profile";

export type MiniQuickAction = {
  id: MiniQuickActionId;
  href: string;
  labelKey: MiniQuickActionId;
  icon: MiniQuickActionIcon;
};

export type ResolvedMiniRole = {
  kind: MiniRoleKind;
  group: MiniRoleGroup;
  homeHref: string;
  quickActions: MiniQuickAction[];
};

const ACTION_TODAY_JOURNALS: MiniQuickAction = {
  id: "todayJournals",
  href: "/journals",
  labelKey: "todayJournals",
  icon: "ClipboardList",
};

const ACTION_VERIFICATIONS: MiniQuickAction = {
  id: "verifications",
  href: "/verifications",
  labelKey: "verifications",
  icon: "CheckSquare",
};

const ACTION_MANAGER_STAFF: MiniQuickAction = {
  id: "staff",
  href: "/settings/users",
  labelKey: "staff",
  icon: "Users",
};

const ACTION_SUPERVISOR_STAFF: MiniQuickAction = {
  id: "staff",
  href: "/team",
  labelKey: "staff",
  icon: "Users",
};

const ACTION_REPORTS: MiniQuickAction = {
  id: "reports",
  href: "/reports",
  labelKey: "reports",
  icon: "FileBarChart2",
};

const ACTION_CONTROL_BOARD: MiniQuickAction = {
  id: "controlBoard",
  href: "/control-board",
  labelKey: "controlBoard",
  icon: "LayoutDashboard",
};

const ACTION_MY_TASKS: MiniQuickAction = {
  id: "myTasks",
  href: "/mini/today",
  labelKey: "myTasks",
  icon: "CalendarCheck",
};

const ACTION_JOURNALS: MiniQuickAction = {
  id: "journals",
  href: "/journals",
  labelKey: "journals",
  icon: "ClipboardList",
};

const ACTION_PROFILE: MiniQuickAction = {
  id: "profile",
  href: "/mini/me",
  labelKey: "profile",
  icon: "UserRound",
};

export function resolveMiniRole(
  actor: MiniNavActor | null,
  permissions?: ReadonlySet<string> | readonly string[] | null
): ResolvedMiniRole {
  if (!actor) {
    return {
      kind: "readonly",
      group: "staff",
      homeHref: "/mini/today",
      quickActions: [ACTION_MY_TASKS, ACTION_PROFILE],
    };
  }

  const permSet = permissions ? new Set<string>(permissions) : null;
  const homeHref = miniHomeHref(actor);
  const isRoot = actor.isRoot === true;

  const presetCanViewJournals = hasCapability(actor, "journals.view");
  const canViewJournals = permSet
    ? isRoot || (presetCanViewJournals && permSet.has("journals.view"))
    : presetCanViewJournals;

  const isManagerLike =
    isRoot ||
    hasCapability(actor, "admin.full") ||
    (permSet
      ? isManagerLikePermissions(permSet, actor.role)
      : hasFullWorkspaceAccess(actor) ||
        hasCapability(actor, "staff.manage") ||
        hasCapability(actor, "reports.view"));

  if (canViewJournals && isManagerLike) {
    const quickActions: MiniQuickAction[] = [ACTION_TODAY_JOURNALS];
    if (!permSet || isRoot || hasCapability(actor, "tasks.verify")) {
      quickActions.push(ACTION_VERIFICATIONS);
    }
    if (
      !permSet ||
      isRoot ||
      permSet.has("staff.view") ||
      permSet.has("staff.manage")
    ) {
      quickActions.push(ACTION_MANAGER_STAFF);
    }
    if (!permSet || isRoot || permSet.has("reports.view")) {
      quickActions.push(ACTION_REPORTS);
    }
    return {
      kind: "manager",
      group: "manager",
      homeHref,
      quickActions,
    };
  }

  if (hasCapability(actor, "tasks.verify")) {
    const quickActions: MiniQuickAction[] = [
      ACTION_CONTROL_BOARD,
      ACTION_VERIFICATIONS,
    ];
    if (!permSet || permSet.has("staff.view") || permSet.has("staff.manage")) {
      quickActions.push(ACTION_SUPERVISOR_STAFF);
    }
    return {
      kind: "supervisor",
      group: "manager",
      homeHref,
      quickActions,
    };
  }

  const canFill = permSet
    ? isRoot || permSet.has("journals.fill")
    : hasCapability(actor, "mini.tasks") || canViewJournals;

  if (canFill) {
    const quickActions: MiniQuickAction[] = [ACTION_MY_TASKS];
    if (canViewJournals) {
      quickActions.push(ACTION_JOURNALS);
    }
    quickActions.push(ACTION_PROFILE);
    return {
      kind: "staff",
      group: "staff",
      homeHref,
      quickActions,
    };
  }

  return {
    kind: "readonly",
    group: "staff",
    homeHref,
    quickActions: [
      canViewJournals ? ACTION_JOURNALS : ACTION_MY_TASKS,
      ACTION_PROFILE,
    ],
  };
}
