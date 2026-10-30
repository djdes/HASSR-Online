"use client";

import { createContext, useContext } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowLeft, Compass, House, LockKeyhole, Menu, PanelLeft } from "lucide-react";
import { useAppNav } from "@/components/layout/app-nav-context";
import { cn } from "@/lib/utils";

/**
 * «Нет доступа» и «Такой страницы нет» внутри кабинета (2026-10-29).
 *
 * Владелец: «если попадаем на страницу, которой нет, например, в меню, то
 * показывать ошибку доступа и просьбу выбрать меню слева». Панель рисуется
 * на месте страницы — сайдбар, шапка и нижнее меню приложения остаются, —
 * говорит, что случилось и почему, где выбрать раздел (меню слева на
 * компьютере, ☰ на телефоне, нижнее меню в Mini App) и даёт две кнопки:
 * «На главную» (домашняя человека) и «Назад».
 *
 * Где мы (сайт или Mini App) и куда «На главную», знает `SectionFrame` —
 * он оборачивает каждую страницу кабинета и отдаёт это через контекст.
 */

export type AccessShell = { shell: "site" | "mini"; homeHref: string };

const AccessShellContext = createContext<AccessShell>({ shell: "site", homeHref: "/dashboard" });

export function AccessShellProvider({ value, children }: { value: AccessShell; children: React.ReactNode }) {
  return <AccessShellContext.Provider value={value}>{children}</AccessShellContext.Provider>;
}

export function useAccessShell(): AccessShell {
  return useContext(AccessShellContext);
}

const FOCUS = "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15";

/**
 * Где выбрать раздел — по месту: меню слева (сайдбар от 1024 px), ☰ на
 * телефоне, нижнее меню в Mini App. Без меню (один раздел) — `fallback`.
 */
export function MenuHint({ className, fallback }: { className?: string; fallback?: React.ReactNode }) {
  const t = useTranslations("navigation.shell.access");
  const { shell } = useAccessShell();
  const { showSidebar } = useAppNav();
  if (shell === "mini") {
    return (
      <span className={cn("inline-flex items-start gap-2", className)} data-menu-hint="mini">
        <Menu className="mt-0.5 size-4 shrink-0 text-[#5566f6]" aria-hidden />
        {t("hintMini")}
      </span>
    );
  }
  if (!showSidebar) return fallback ? <span className={className}>{fallback}</span> : null;
  return (
    <>
      <span className={cn("hidden items-start gap-2 lg:inline-flex", className)} data-menu-hint="sidebar">
        <PanelLeft className="mt-0.5 size-4 shrink-0 text-[#5566f6]" aria-hidden />
        {t("hintSidebar")}
      </span>
      <span className={cn("inline-flex items-start gap-2 lg:hidden", className)} data-menu-hint="burger">
        <Menu className="mt-0.5 size-4 shrink-0 text-[#5566f6]" aria-hidden />
        {t("hintBurger")}
      </span>
    </>
  );
}

export function AccessDenied({ kind }: { kind: "forbidden" | "notFound" }) {
  const t = useTranslations("navigation.shell.access");
  const { homeHref } = useAccessShell();
  const router = useRouter();
  const Icon = kind === "forbidden" ? LockKeyhole : Compass;

  function goBack() {
    // Пришли по прямой ссылке — назад некуда: ведём на домашнюю.
    if (window.history.length > 1) router.back();
    else router.push(homeHref);
  }

  return (
    <div
      className="mx-auto max-w-[560px] rounded-3xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-6 py-12 text-center"
      data-access-denied={kind === "forbidden" ? "forbidden" : "not-found"}
    >
      <span className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#5566f6]">
        <Icon className="size-6" aria-hidden />
      </span>
      <h1 className="mt-4 text-[20px] font-semibold tracking-[-0.02em] text-[#0b1024]">
        {kind === "forbidden" ? t("forbiddenTitle") : t("notFoundTitle")}
      </h1>
      <p className="mx-auto mt-2 max-w-[440px] text-[14px] leading-[1.6] text-[#6f7282]">
        {kind === "forbidden" ? t("forbiddenBody") : t("notFoundBody")}
      </p>
      <p className="mx-auto mt-4 flex max-w-[440px] justify-center text-left text-[14px] leading-[1.55] text-[#3c4053]">
        <MenuHint fallback={t("hintNoMenu")} />
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          onClick={goBack}
          className={cn(
            "inline-flex h-11 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]",
            FOCUS,
          )}
          data-access-back
        >
          <ArrowLeft className="size-4 text-[#5566f6]" aria-hidden />
          {t("back")}
        </button>
        <Link
          href={homeHref}
          className={cn(
            "inline-flex h-11 items-center gap-2 rounded-2xl bg-[#5566f6] px-4 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors duration-150 hover:bg-[#4a5bf0]",
            FOCUS,
          )}
          data-access-home
        >
          <House className="size-4" aria-hidden />
          {t("home")}
        </Link>
      </div>
    </div>
  );
}
