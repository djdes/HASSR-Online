"use client";

import { useState } from "react";
import { Building2, Copy, Library, Loader2, LogOut } from "lucide-react";
import { signOut } from "next-auth/react";
import { toast } from "sonner";

import { BrandLogo } from "@/components/brand/logo";
import { ResponsiveMenu, type ResponsiveMenuItem } from "@/components/ui/responsive-menu";

export type MasterShellProps = {
  organizationName: string;
  code: string | null;
  objectsCount: number;
  userName: string;
  userEmail: string;
  /** Обычные организации пользователя — пункты «Вернуться в …». */
  returnTargets: Array<{ id: string; name: string }>;
  children: React.ReactNode;
};

/**
 * Оболочка мастер-кабинета справочников. Живёт отдельно от
 * (dashboard)/layout: у кабинета нет журналов, сотрудников и настроек —
 * только списки меню и сырья для объектов пула.
 */
export function MasterShell({
  organizationName,
  code,
  objectsCount,
  userName,
  userEmail,
  returnTargets,
  children,
}: MasterShellProps) {
  const [switching, setSwitching] = useState(false);
  const initials = (userName || userEmail || "?").trim().slice(0, 1).toUpperCase();

  async function returnTo(target: { id: string; name: string }) {
    setSwitching(true);
    try {
      const response = await fetch("/api/me/active-organization", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId: target.id }),
      });
      const json = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(json?.error ?? "Не удалось переключиться");
      window.location.assign("/dashboard");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось переключиться");
      setSwitching(false);
    }
  }

  const menuItems: ResponsiveMenuItem[] = [
    ...returnTargets.map((target) => ({
      key: `return-${target.id}`,
      label: `Вернуться в «${target.name}»`,
      icon: <Building2 className="size-4 text-[#5566f6]" />,
      onSelect: () => void returnTo(target),
      disabled: switching,
    })),
    {
      key: "logout",
      label: "Выйти",
      icon: <LogOut className="size-4 text-[#6f7282]" />,
      onSelect: () => void signOut({ callbackUrl: "/login" }),
      tone: "danger" as const,
    },
  ];

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 border-b border-[#ececf4] bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-[1200px] items-center justify-between gap-3 px-4 md:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#eef1ff] text-[#5566f6]">
              <Library className="size-5" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[15px] font-semibold text-[#0b1024]" data-testid="master-org-name">
                {organizationName}
              </span>
              <span className="block truncate text-[11px] font-medium uppercase tracking-[0.14em] text-[#6f7282]">
                Мастер-кабинет справочников
              </span>
            </span>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {switching ? <Loader2 className="size-4 animate-spin text-[#5566f6]" aria-label="Переключаем" /> : null}
            <ResponsiveMenu
              title={userName || userEmail}
              contentClassName="w-[280px] rounded-2xl p-1.5"
              items={menuItems}
              trigger={
                <button
                  type="button"
                  aria-label="Профиль"
                  className="flex size-10 items-center justify-center rounded-full bg-[#eef1ff] text-[14px] font-semibold text-[#3848c7] transition-colors duration-150 hover:bg-[#e3e8ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
                >
                  {initials}
                </button>
              }
            />
          </div>
        </div>

        <div className="mx-auto flex w-full max-w-[1200px] flex-wrap items-center gap-2 px-4 pb-3 md:px-8">
          {code ? (
            <span className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-[#f5f6ff] py-1 pl-3 pr-1 text-[13px] text-[#3848c7]">
              <span className="truncate">
                Код справочника{" "}
                <span className="font-mono font-semibold tracking-wider" data-testid="master-code">
                  {code}
                </span>
              </span>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard?.writeText(code).then(
                    () => toast.success("Код скопирован"),
                    () => toast.error("Не удалось скопировать")
                  );
                }}
                className="flex size-7 shrink-0 items-center justify-center rounded-full transition-colors duration-150 hover:bg-white"
                aria-label="Скопировать код справочника"
                title="Скопировать код"
              >
                <Copy className="size-3.5" />
              </button>
            </span>
          ) : null}
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#f5f6ff] px-3 py-1.5 text-[13px] tabular-nums text-[#3848c7]">
            <Building2 className="size-3.5" />
            Подключено объектов: {objectsCount}
          </span>
        </div>
      </header>

      <main className="flex-1 py-6 md:py-8">
        <div className="mx-auto w-full max-w-[1200px] px-4 md:px-8">{children}</div>
      </main>

      <footer className="border-t border-[#ececf4] bg-white">
        <div className="mx-auto flex w-full max-w-[1200px] flex-wrap items-center justify-between gap-3 px-4 py-4 text-[12px] text-[#6f7282] md:px-8">
          <span className="inline-flex items-center gap-2">
            <BrandLogo height={16} title="WeSetup" />
            Мастер-кабинет справочников
          </span>
          <a href="mailto:support@wesetup.ru" className="transition-colors duration-150 hover:text-[#5566f6]">
            support@wesetup.ru
          </a>
        </div>
      </footer>
    </div>
  );
}
