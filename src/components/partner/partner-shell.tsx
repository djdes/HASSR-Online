"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Building2,
  ChevronDown,
  Coins,
  Handshake,
  LayoutDashboard,
  LogOut,
  Mail,
  MessagesSquare,
  Palette,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { BrandLogo } from "@/components/brand/logo";
import { IncomingMessagePopup } from "@/components/support/incoming-message-popup";
import { useIncomingMessages } from "@/components/support/use-incoming-messages";
import { cn } from "@/lib/utils";
import { ResponsiveMenu } from "@/components/ui/responsive-menu";
import { signOutAndOpen } from "@/lib/sign-out";

const NAV = [
  { href: "/partner", label: "Обзор", icon: LayoutDashboard, exact: true },
  { href: "/partner/chats", label: "Чаты", icon: MessagesSquare },
  { href: "/partner/invites", label: "Приглашения", icon: Mail },
  { href: "/partner/branding", label: "Брендинг", icon: Palette },
  { href: "/partner/rewards", label: "Вознаграждение", icon: Coins },
  { href: "/partner/team", label: "Команда", icon: Users },
] as const;

export type PartnerShellProps = {
  brandName: string;
  logoUrl: string | null;
  userName: string;
  userEmail: string;
  /** Есть ли у пользователя своя организация (куда ведёт «Моя организация»). */
  hasOwnOrganization: boolean;
  ownOrganizationName: string | null;
  children: React.ReactNode;
};

/**
 * Оболочка партнёрского кабинета: шапка с брендом партнёра,
 * переключатель контекста «Моя организация / Партнёрский кабинет»,
 * горизонтальная навигация по разделам. Кабинет живёт отдельно от
 * (dashboard)/layout — у него другой контекст (партнёр, а не
 * организация) и другие пункты меню.
 */
export function PartnerShell({
  brandName,
  logoUrl,
  userName,
  userEmail,
  hasOwnOrganization,
  ownOrganizationName,
  children,
}: PartnerShellProps) {
  const pathname = usePathname() ?? "/partner";
  const router = useRouter();
  const initials = (userName || userEmail || "?").trim().slice(0, 1).toUpperCase();

  // Клиент написал в чат — звук и всплывашка в любом разделе кабинета,
  // бейдж у пункта «Чаты». На самой странице чатов всплывашку не показываем.
  const incoming = useIncomingMessages({
    enabled: true,
    statusUrl: "/api/partner/chats/status",
    scope: "partner",
    chatVisible: pathname.startsWith("/partner/chats"),
    title: (status) => status.latest?.operatorName ?? "Клиент",
  });

  return (
    <div className="flex min-h-screen flex-col">
      <IncomingMessagePopup
        popup={incoming.popup}
        icon={MessagesSquare}
        onOpen={() => {
          const threadId = incoming.popup?.threadId;
          incoming.dismissPopup();
          router.push(threadId ? `/partner/chats?thread=${encodeURIComponent(threadId)}` : "/partner/chats");
        }}
        onDismiss={incoming.dismissPopup}
      />
      <header className="sticky top-0 z-30 border-b border-[#ececf4] bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-[1400px] items-center justify-between gap-3 px-4 md:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <Link href="/partner" className="flex min-w-0 items-center gap-3" aria-label="Партнёрский кабинет">
              {logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logoUrl} alt={brandName} className="h-8 max-w-[140px] object-contain" />
              ) : (
                <span className="flex size-9 items-center justify-center rounded-xl bg-[#eef1ff] text-[#5566f6]">
                  <Handshake className="size-5" />
                </span>
              )}
              <span className="min-w-0">
                <span className="block truncate text-[15px] font-semibold text-[#0b1024]">{brandName}</span>
                <span className="block text-[11px] font-medium uppercase tracking-[0.14em] text-[#6f7282]">
                  Партнёрский кабинет
                </span>
              </span>
            </Link>
          </div>

          <div className="flex items-center gap-2">
            {/* Переключатель контекста. Кабинет клиента открывается
                отдельной кнопкой из карточки клиента, здесь — только
                «своя организация ↔ партнёрский кабинет». */}
            <ResponsiveMenu
              title="Контекст"
              contentClassName="w-[280px] rounded-2xl p-1.5"
              items={[
                {
                  key: "partner",
                  label: `Партнёрский кабинет · ${brandName}`,
                  icon: <Handshake className="size-4 text-[#5566f6]" />,
                  onSelect: () => router.push("/partner"),
                },
                ...(hasOwnOrganization
                  ? [
                      {
                        key: "own",
                        label: ownOrganizationName ?? "Моя организация",
                        icon: <Building2 className="size-4 text-[#5566f6]" />,
                        onSelect: () => router.push("/dashboard"),
                      },
                    ]
                  : []),
              ]}
              trigger={
                <button
                  type="button"
                  className="inline-flex h-10 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-3 text-[13px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
                >
                  <Handshake className="size-4 text-[#5566f6]" />
                  <span className="hidden sm:inline">Партнёрский кабинет</span>
                  <ChevronDown className="size-4 text-[#9b9fb3]" />
                </button>
              }
            />

            <ResponsiveMenu
              title={userName}
              contentClassName="w-[240px] rounded-2xl p-1.5"
              items={[
                {
                  key: "logout",
                  label: "Выйти",
                  icon: <LogOut className="size-4 text-[#6f7282]" />,
                  // Полный выход, как везде (`lib/sign-out.ts`): одного
                  // `signOut` next-auth мало — оставались другие куки сессии.
                  onSelect: () =>
                    void signOutAndOpen("/login").catch(() =>
                      toast.error("Не удалось выйти. Проверьте связь и попробуйте ещё раз.")
                    ),
                  tone: "danger" as const,
                },
              ]}
              trigger={
                <button
                  type="button"
                  aria-label="Профиль"
                  className="flex size-10 items-center justify-center rounded-full bg-[#eef1ff] text-[14px] font-semibold text-[#3848c7] transition-colors hover:bg-[#e3e8ff]"
                >
                  {initials}
                </button>
              }
            />
          </div>
        </div>

        <nav className="mx-auto w-full max-w-[1400px] px-4 md:px-8" aria-label="Разделы кабинета">
          <ul className="-mb-px flex gap-1 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {NAV.map((item) => {
              const active = "exact" in item && item.exact ? pathname === item.href : pathname.startsWith(item.href);
              return (
                <li key={item.href} className="shrink-0">
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "inline-flex h-11 items-center gap-2 border-b-2 px-3 text-[14px] font-medium transition-colors duration-150",
                      active
                        ? "border-[#5566f6] text-[#5566f6]"
                        : "border-transparent text-[#6f7282] hover:border-[#dcdfed] hover:text-[#0b1024]",
                    )}
                  >
                    <item.icon className="size-4" />
                    {item.label}
                    {item.href === "/partner/chats" && incoming.unread > 0 ? (
                      <span className="rounded-full bg-[#d2453d] px-1.5 py-0.5 text-[11px] font-semibold leading-none tabular-nums text-white">
                        {incoming.unread > 99 ? "99+" : incoming.unread}
                      </span>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </header>

      <main className="flex-1 py-6 md:py-8">
        <div className="mx-auto w-full max-w-[1400px] px-4 md:px-8">{children}</div>
      </main>

      <footer className="border-t border-[#ececf4] bg-white">
        <div className="mx-auto flex w-full max-w-[1400px] flex-wrap items-center justify-between gap-3 px-4 py-4 text-[12px] text-[#6f7282] md:px-8">
          <span className="inline-flex items-center gap-2">
            <BrandLogo height={16} title="WeSetup" />
            Партнёрская программа WeSetup
          </span>
          <span className="flex flex-wrap gap-4">
            <Link href="/partners" className="transition-colors hover:text-[#5566f6]">
              Условия программы
            </Link>
            <a href="mailto:partners@wesetup.ru" className="transition-colors hover:text-[#5566f6]">
              partners@wesetup.ru
            </a>
          </span>
        </div>
      </footer>
    </div>
  );
}
