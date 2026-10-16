"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { sectionForPath } from "@/lib/app-nav";
import type { NavModelSection } from "@/lib/app-nav.server";
import { cn } from "@/lib/utils";
import { useAppNav } from "@/components/layout/app-nav-context";
import { NavIcon } from "@/components/layout/nav-icons";

/**
 * Меню кабинета слева (≥1024px): логотип компании и разделы. «Пришла
 * проверка» прижата к низу — в спешке её ищут глазами первой.
 * Подразделы — не здесь, а вкладками над основным окном.
 */
export function AppSidebar({
  logoUrl,
  organizationName,
  homeHref,
}: {
  logoUrl: string | null;
  organizationName: string;
  homeHref: string;
}) {
  const t = useTranslations("navigation.shell");
  const { sections } = useAppNav();
  const pathname = usePathname() || "/";
  const active = sectionForPath(pathname)?.section ?? null;
  const main = sections.filter((section) => section.key !== "inspection");
  const inspection = sections.find((section) => section.key === "inspection");

  return (
    <aside
      data-app-sidebar
      aria-label={t("sidebarAria")}
      className="sticky top-0 z-20 hidden h-screen w-[256px] shrink-0 flex-col border-r border-[#ececf4] bg-white lg:flex print:hidden"
    >
      {/* Высота блока = высоте шапки (72px): линии сходятся в одну. */}
      <Link
        href={homeHref}
        className="flex h-[72px] shrink-0 items-center gap-3 border-b border-[#ececf4] px-5 transition-colors duration-150 hover:bg-[#fafbff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-[#5566f6]/15"
        data-sidebar-logo
      >
        <OrganizationMark logoUrl={logoUrl} name={organizationName} />
      </Link>

      <nav className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-4">
        <div className="space-y-1">
          {main.map((section) => (
            <SidebarItem key={section.key} section={section} active={active === section.key} />
          ))}
        </div>
        {inspection ? (
          <div className="mt-auto border-t border-[#ececf4] pt-3">
            <SidebarItem section={inspection} active={active === "inspection"} accent />
          </div>
        ) : null}
      </nav>
    </aside>
  );
}

function SidebarItem({
  section,
  active,
  accent = false,
}: {
  section: NavModelSection;
  active: boolean;
  accent?: boolean;
}) {
  return (
    <Link
      href={section.rootHref}
      aria-current={active ? "page" : undefined}
      data-nav-section={section.key}
      className={cn(
        "flex min-h-11 items-center gap-3 rounded-2xl px-3 py-2 text-[14.5px] font-medium leading-tight transition-colors duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15",
        active
          ? "bg-[#5566f6]/[0.09] text-[#5566f6]"
          : accent
            ? "bg-[#f5f6ff] text-[#3848c7] hover:bg-[#eef1ff]"
            : "text-[#3c4053] hover:bg-[#f5f6ff] hover:text-[#0b1024]",
      )}
    >
      <NavIcon
        name={section.icon}
        className={cn("size-5 shrink-0", active || accent ? "text-[#5566f6]" : "text-[#6f7282]")}
      />
      <span className="min-w-0">{section.label}</span>
    </Link>
  );
}

/** Логотип организации; нет логотипа — монограмма и название. */
export function OrganizationMark({
  logoUrl,
  name,
  compact = false,
}: {
  logoUrl: string | null;
  name: string;
  compact?: boolean;
}) {
  // Битая ссылка на логотип не должна оставлять пустое место — монограмма.
  const [failed, setFailed] = useState(false);
  if (logoUrl && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={logoUrl}
        alt={name}
        className={cn("w-auto object-contain object-left", compact ? "h-7 max-w-[120px]" : "max-h-10 max-w-[200px]")}
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
      />
    );
  }
  const initials = name
    .replace(/[«»"']/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toLocaleUpperCase("ru-RU") ?? "")
    .join("");
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <span
        aria-hidden
        className={cn(
          "flex shrink-0 items-center justify-center rounded-xl bg-[#eef1ff] font-semibold text-[#3848c7]",
          compact ? "size-8 text-[13px]" : "size-9 text-[14px]",
        )}
      >
        {initials || "W"}
      </span>
      {compact ? null : (
        <span className="truncate text-[15px] font-semibold text-[#0b1024]">{name}</span>
      )}
    </span>
  );
}
