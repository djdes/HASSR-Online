"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  CalendarCheck,
  CheckSquare,
  ClipboardList,
  FileBarChart2,
  LayoutDashboard,
  UserRound,
  Users,
  type LucideIcon,
} from "lucide-react";

import type { MiniQuickAction, MiniRoleGroup, MiniRoleKind } from "@/lib/mini-role";
import { haptic } from "./use-haptic";

const ROLE_LANDING_PATHS = new Set([
  "/dashboard",
  "/control-board",
  "/journals",
  "/mini/today",
  "/home",
]);

const ICONS: Record<MiniQuickAction["icon"], LucideIcon> = {
  ClipboardList,
  CheckSquare,
  Users,
  FileBarChart2,
  LayoutDashboard,
  CalendarCheck,
  UserRound,
};

export function MiniRoleBar({
  roleKind,
  roleGroup,
  quickActions,
}: {
  roleKind: MiniRoleKind;
  roleGroup: MiniRoleGroup;
  quickActions: MiniQuickAction[];
}) {
  const pathname = usePathname();
  const t = useTranslations("miniHome.roleBar");

  const normalized = pathname.replace(/\/+$/, "") || "/";
  if (!ROLE_LANDING_PATHS.has(normalized) || quickActions.length === 0) {
    return null;
  }

  const badgeLabel =
    roleKind === "manager"
      ? t("managerBadge")
      : roleKind === "supervisor"
        ? t("supervisorBadge")
        : roleKind === "readonly"
          ? t("readonlyBadge")
          : t("staffBadge");

  function actionLabel(id: MiniQuickAction["id"]): string {
    switch (id) {
      case "todayJournals":
        return t("actions.todayJournals");
      case "verifications":
        return t("actions.verifications");
      case "staff":
        return t("actions.staff");
      case "reports":
        return t("actions.reports");
      case "controlBoard":
        return t("actions.controlBoard");
      case "myTasks":
        return t("actions.myTasks");
      case "journals":
        return t("actions.journals");
      case "profile":
        return t("actions.profile");
    }
  }

  return (
    <section
      className="mini-role-bar mb-4"
      aria-label={t("landmark")}
      data-mini-role-bar={roleKind}
    >
      <div className="flex items-center justify-between gap-2">
        <span
          className="mini-pill"
          data-tone={roleGroup === "manager" ? "accent" : "ice"}
        >
          {badgeLabel}
        </span>
      </div>
      <nav aria-label={t("landmark")} className="mini-role-grid mt-2.5">
        {quickActions.map((action) => {
          const Icon = ICONS[action.icon];
          const active =
            normalized === action.href ||
            normalized.startsWith(`${action.href}/`);
          return (
            <Link
              key={action.id}
              href={action.href}
              aria-current={active ? "page" : undefined}
              onClick={() => haptic("light")}
              className="mini-role-action mini-press"
            >
              <span
                className="mini-tile"
                style={{ width: 34, height: 34, borderRadius: 10 }}
                aria-hidden
              >
                <Icon className="size-4" />
              </span>
              <span className="min-w-0 truncate">{actionLabel(action.id)}</span>
            </Link>
          );
        })}
      </nav>
    </section>
  );
}
