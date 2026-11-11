"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown, Eye, LogOut, Monitor, Moon, Sparkles, Sun } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PersonalLanguageSelect } from "@/components/i18n/personal-language-select";
import { useSiteTheme, type ThemeMode } from "@/components/theme/site-theme";
import { useDesignChoice } from "@/components/theme/theme-tiles";
import { cn } from "@/lib/utils";

/**
 * Меню пользователя в «Новой» теме (владелец, 2026-11-11, как у oxylabs):
 * аватар со стрелкой; в меню — кто вошёл, тариф и организации, тема рядом
 * иконок (устройство · светлая · тёмная · новая), удобство чтения, язык и
 * «Выйти». Только компьютер — на телефоне остаётся лист профиля.
 */
export function NewProfileMenu({
  open,
  onOpenChange,
  userName,
  userEmail,
  initials,
  onReadability,
  onLogout,
  organizations,
  plan,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userName: string;
  userEmail: string;
  initials: string;
  onReadability: () => void;
  onLogout: () => void;
  organizations: ReactNode;
  plan: ReactNode;
}) {
  const t = useTranslations("navigation");
  const tTheme = useTranslations("common.theme");
  const tView = useTranslations("common.viewPrefs");
  const siteTheme = useSiteTheme();
  const design = useDesignChoice(siteTheme.setMode);
  const current: ThemeMode | "new" = design.isNew ? "new" : siteTheme.mode;

  const themeOptions: { value: ThemeMode | "new"; icon: typeof Sun; label: string }[] = [
    { value: "system", icon: Monitor, label: tTheme("mode.system") },
    { value: "light", icon: Sun, label: tTheme("mode.light") },
    { value: "dark", icon: Moon, label: tTheme("mode.dark") },
    { value: "new", icon: Sparkles, label: tTheme("mode.new") },
  ];

  const choose = (value: ThemeMode | "new") => {
    if (value === "new") {
      design.chooseNew();
      return;
    }
    design.leaveNew();
    siteTheme.setMode(value);
  };

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t("header.profile")}
          className="group flex h-10 shrink-0 items-center gap-1.5 rounded-full pr-1.5 transition-colors hover:bg-[#f1f1f4] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#111114]/10"
        >
          <Avatar size="lg">
            <AvatarFallback data-avatar-gradient className="bg-[#111114] text-[13px] font-bold text-white">
              {initials}
            </AvatarFallback>
          </Avatar>
          <ChevronDown
            aria-hidden
            className="size-4 text-[#3c3d48] transition-transform duration-150 group-data-[state=open]:rotate-180"
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-72 rounded-2xl border-[#e7e7ec] p-0 shadow-[0_18px_48px_-16px_rgba(17,17,20,0.28)]"
      >
        <div className="px-4 pt-3.5 pb-3">
          <p className="truncate text-[15px] font-semibold text-[#111114]">{userEmail || userName}</p>
          {userEmail ? <p className="truncate text-[13px] text-[#6a6c7a]">{userName}</p> : null}
        </div>
        <DropdownMenuSeparator className="my-0" />
        <div className="p-1">
          {plan}
          {organizations}
        </div>
        <DropdownMenuSeparator className="my-0" />
        <div className="p-1">
          <DropdownMenuItem onSelect={onReadability} className="gap-2.5 rounded-lg px-3 py-2 text-[14.5px]">
            <Eye className="size-4 stroke-[1.75] text-[#5f6170]" aria-hidden />
            {tView("more")}
          </DropdownMenuItem>
          <div className="flex items-center justify-between gap-2 px-3 py-1.5">
            <span className="text-[14.5px] text-[#111114]">{tTheme("theme")}</span>
            <div role="radiogroup" aria-label={tTheme("theme")} className="flex gap-1">
              {themeOptions.map((option) => {
                const Icon = option.icon;
                const checked = current === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={checked}
                    aria-label={option.label}
                    title={option.label}
                    data-theme-option={option.value}
                    onClick={() => choose(option.value)}
                    className={cn(
                      "flex size-9 items-center justify-center rounded-[10px] border transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#111114]/10",
                      checked
                        ? "border-[#dcdde3] bg-[#ececef] text-[#111114]"
                        : "border-[#e7e7ec] bg-white text-[#5f6170] hover:bg-[#f1f1f4]",
                    )}
                  >
                    <Icon className="size-4 stroke-[1.75]" aria-hidden />
                  </button>
                );
              })}
            </div>
          </div>
          <div className="px-2 py-1.5">
            <PersonalLanguageSelect />
          </div>
        </div>
        <DropdownMenuSeparator className="my-0" />
        <div className="p-1">
          <DropdownMenuItem
            onSelect={onLogout}
            className="gap-2.5 rounded-lg px-3 py-2 text-[14.5px] text-[#d2453d] focus:bg-[#fff4f2] focus:text-[#d2453d]"
          >
            <LogOut className="size-4 stroke-[1.75]" aria-hidden />
            {t("header.logout")}
          </DropdownMenuItem>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
