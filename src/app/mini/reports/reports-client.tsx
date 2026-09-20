"use client";

import Link from "next/link";
import {
  AlertTriangle,
  CalendarRange,
  ChevronRight,
  FileSpreadsheet,
  FileText,
  GitBranch,
  GraduationCap,
  Package,
  TrendingDown,
  type LucideIcon,
} from "lucide-react";

import { ShareButton } from "../_components/share-button";

export type MiniReportLink = {
  href: string;
  label: string;
  hint: string;
  icon: string;
};

/** Имя иконки → компонент. Держим в клиенте: RSC функции не сериализует. */
const REPORT_ICONS: Record<string, LucideIcon> = {
  AlertTriangle,
  CalendarRange,
  FileSpreadsheet,
  FileText,
  GitBranch,
  GraduationCap,
  Package,
  TrendingDown,
};

export function MiniReportsClient({
  links,
  authed,
}: {
  links: MiniReportLink[];
  authed: boolean;
}) {
  return (
    /* Цвета — токенами Mini App, а не сайтовыми хардкодами. */
    <div className="flex flex-1 flex-col gap-4 pb-24">
      <header className="mini-card px-5 py-5">
        <p className="mini-eyebrow">Отчёты</p>
        <h1
          className="mt-1 text-[22px] font-semibold tracking-[-0.02em]"
          style={{ color: "var(--mini-text)" }}
        >
          Экспорт и разделы
        </h1>
        <p
          className="mt-2 text-[13px] leading-5"
          style={{ color: "var(--mini-text-muted)" }}
        >
          Выгрузки и разделы с отчётами. Открываются прямо здесь, в
          приложении — кнопка «назад» вернёт вас на этот экран.
        </p>
        {/* Инспектор просит журнал прямо на кухне — системное меню отдаёт
            его быстрее, чем скачивание и поиск, чем открыть файл. */}
        <div className="mt-3">
          <ShareButton
            title="Журналы СанПиН и ХАССП"
            text="Отчёты по журналам"
            url="/reports"
          />
        </div>
      </header>

      {links.length === 0 ? (
        <p
          className="px-1 text-[14px] leading-5"
          style={{ color: "var(--mini-text-muted)" }}
        >
          {authed
            ? "Отчёты вам не открыты. Если они нужны для работы — попросите руководителя выдать доступ."
            : "Сначала откройте главный экран: вход произойдёт сам, и отчёты появятся."}
        </p>
      ) : null}

      <section className="space-y-2">
        {links.map((link) => {
          const Icon = REPORT_ICONS[link.icon] ?? FileText;
          return (
            <Link
              key={link.href}
              href={link.href}
              className="mini-card mini-press flex w-full items-center gap-3 px-4 py-3 text-left"
            >
              <span
                className="flex size-10 shrink-0 items-center justify-center rounded-2xl"
                style={{
                  background: "var(--mini-lime-soft)",
                  color: "var(--mini-lime)",
                }}
              >
                <Icon className="size-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span
                  className="block truncate text-[15px] font-medium"
                  style={{ color: "var(--mini-text)" }}
                >
                  {link.label}
                </span>
                <span
                  className="mt-0.5 block text-[12px]"
                  style={{ color: "var(--mini-text-muted)" }}
                >
                  {link.hint}
                </span>
              </span>
              <ChevronRight
                className="size-4 shrink-0"
                style={{ color: "var(--mini-text-faint)" }}
              />
            </Link>
          );
        })}
      </section>
    </div>
  );
}
