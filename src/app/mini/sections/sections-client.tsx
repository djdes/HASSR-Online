"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  AlertTriangle,
  BadgeCheck,
  Bell,
  BookOpen,
  Building2,
  CalendarRange,
  ChevronRight,
  ClipboardList,
  Coins,
  CreditCard,
  FileText,
  Gauge,
  GitBranch,
  GraduationCap,
  History,
  LayoutGrid,
  Lightbulb,
  Package,
  Palette,
  Plug,
  ScrollText,
  Search,
  Settings2,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react";

export type MiniSectionItemView = {
  href: string;
  label: string;
  hint: string;
  icon: string;
};

export type MiniSectionGroupView = {
  id: string;
  title: string;
  subtitle: string;
  items: MiniSectionItemView[];
};

/**
 * Соответствие «имя иконки → компонент» живёт здесь, в клиенте.
 * Серверный компонент передаёт только строку: функции через границу
 * RSC не сериализуются. Появился новый раздел — иконку добавляем сюда.
 */
const SECTION_ICONS: Record<string, LucideIcon> = {
  AlertTriangle,
  BadgeCheck,
  Bell,
  BookOpen,
  Building2,
  CalendarRange,
  ClipboardList,
  Coins,
  CreditCard,
  FileText,
  Gauge,
  GitBranch,
  GraduationCap,
  History,
  Lightbulb,
  Package,
  Palette,
  Plug,
  ScrollText,
  Settings2,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
  Users,
  Wrench,
};

function normalize(value: string): string {
  return value.toLocaleLowerCase("ru-RU").trim();
}

export function MiniSectionsClient({
  groups,
  authed,
}: {
  groups: MiniSectionGroupView[];
  authed: boolean;
}) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const needle = normalize(query);
    if (!needle) return groups;
    return groups
      .map((group) => ({
        ...group,
        items: group.items.filter(
          (item) =>
            normalize(item.label).includes(needle) ||
            normalize(item.hint).includes(needle)
        ),
      }))
      .filter((group) => group.items.length > 0);
  }, [groups, query]);

  const total = groups.reduce((sum, group) => sum + group.items.length, 0);

  if (!authed) {
    return (
      <div className="flex flex-1 flex-col gap-4 pb-24">
        <section className="mini-card px-5 py-6 text-center">
          <div
            className="mx-auto flex size-12 items-center justify-center rounded-3xl"
            style={{
              background: "var(--mini-lime-soft)",
              color: "var(--mini-lime)",
            }}
          >
            <LayoutGrid className="size-6" />
          </div>
          <h1
            className="mt-4 text-[20px] font-semibold tracking-[-0.02em]"
            style={{ color: "var(--mini-text)" }}
          >
            Сначала войдите
          </h1>
          <p
            className="mt-2 text-[14px] leading-6"
            style={{ color: "var(--mini-text-muted)" }}
          >
            Разделы зависят от ваших прав, поэтому список появится после
            входа. Откройте экран входа — в Telegram он сработает сам.
          </p>
          <Link
            href="/mini"
            className="mini-press mt-5 inline-flex h-12 w-full items-center justify-center rounded-2xl px-4 text-[14px] font-medium"
            style={{
              background: "var(--mini-lime)",
              color: "var(--mini-primary-contrast)",
            }}
          >
            Войти
          </Link>
        </section>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-4 pb-24">
      <header className="mini-card px-5 py-5">
        <p className="mini-eyebrow">Кабинет</p>
        <h1
          className="mt-1 text-[22px] font-semibold tracking-[-0.02em]"
          style={{ color: "var(--mini-text)" }}
        >
          Все разделы
        </h1>
        <p
          className="mt-2 text-[13px] leading-5"
          style={{ color: "var(--mini-text-muted)" }}
        >
          Те же страницы, что и на сайте, — здесь они открываются прямо в
          приложении. Показаны только разделы, доступные вам.
        </p>
      </header>

      {total > 6 ? (
        <label className="relative block">
          <Search
            className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2"
            style={{ color: "var(--mini-text-faint)" }}
          />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Поиск раздела"
            aria-label="Поиск раздела"
            // 16px — меньше нельзя: iOS зумит страницу на фокусе поля.
            className="h-12 w-full rounded-2xl pl-10 pr-4 text-[16px] outline-none"
            style={{
              background: "var(--mini-surface-1)",
              border: "1px solid var(--mini-divider)",
              color: "var(--mini-text)",
            }}
          />
        </label>
      ) : null}

      {filtered.length === 0 ? (
        <p
          className="px-1 text-[14px]"
          style={{ color: "var(--mini-text-muted)" }}
        >
          Ничего не нашлось. Попробуйте другое слово — например «журнал»,
          «отчёт» или «сотрудник».
        </p>
      ) : null}

      {filtered.map((group) => (
        <section key={group.id} className="space-y-2">
          <div className="px-1">
            <h2
              className="text-[15px] font-semibold"
              style={{ color: "var(--mini-text)" }}
            >
              {group.title}
            </h2>
            {/* Подзаголовок собираем из ТОГО, ЧТО РЕАЛЬНО показано:
                готовая строка «Журналы, проверка, команда» висела и над
                одной-единственной карточкой у повара. Один пункт —
                подзаголовка нет вовсе, он уже написан на карточке. */}
            {group.items.length > 1 ? (
              <p
                className="mt-0.5 text-[12px]"
                style={{ color: "var(--mini-text-faint)" }}
              >
                {group.items.map((item) => item.label).join(" · ")}
              </p>
            ) : null}
          </div>
          {group.items.map((item) => {
            const Icon = SECTION_ICONS[item.icon] ?? LayoutGrid;
            return (
              <Link
                key={item.href}
                href={item.href}
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
                    {item.label}
                  </span>
                  <span
                    className="mt-0.5 block text-[12px]"
                    style={{ color: "var(--mini-text-muted)" }}
                  >
                    {item.hint}
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
      ))}
    </div>
  );
}
