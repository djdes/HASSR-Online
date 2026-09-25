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
          <div className="mini-tile mx-auto" style={{ width: 48, height: 48 }}>
            <LayoutGrid className="size-6" />
          </div>
          <h1 className="mini-h1 mt-4" style={{ fontSize: 21 }}>
            Сначала войдите
          </h1>
          <p
            className="mt-2 text-[16px] leading-relaxed"
            style={{ color: "var(--mini-text-muted)" }}
          >
            Разделы зависят от ваших прав, поэтому список появится после
            входа. Откройте экран входа — в Telegram он сработает сам.
          </p>
          <Link href="/mini" className="mini-btn-primary mini-press mt-5 w-full">
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
        <h1 className="mini-h1 mt-1">Все разделы</h1>
        <p
          className="mt-2 text-[15px] leading-relaxed"
          style={{ color: "var(--mini-text-muted)" }}
        >
          Те же страницы, что и на сайте, — здесь они открываются прямо в
          приложении. Показаны только разделы, доступные вам.
        </p>
      </header>

      {total > 6 ? (
        <label className="relative block">
          <Search
            className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2"
            style={{ color: "var(--mini-text-muted)" }}
          />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Поиск раздела"
            aria-label="Поиск раздела"
            // Поле QR-страниц: 56px, шрифт 17px (меньше 16px iOS зумит).
            className="mini-input"
            style={{ paddingLeft: 46 }}
          />
        </label>
      ) : null}

      {filtered.length === 0 ? (
        <p
          className="px-1 text-[16px] leading-relaxed"
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
              className="text-[17px] font-semibold"
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
                className="mt-0.5 text-[14px] leading-snug"
                style={{ color: "var(--mini-text-muted)" }}
              >
                {group.items.map((item) => item.label).join(" · ")}
              </p>
            ) : null}
          </div>
          {group.items.map((item) => {
            const Icon = SECTION_ICONS[item.icon] ?? LayoutGrid;
            return (
              // Пункт — строка списка QR-страниц: плитка, название
              // крупно, пояснение под ним.
              <Link
                key={item.href}
                href={item.href}
                className="mini-item mini-press"
              >
                <span className="mini-tile">
                  <Icon className="size-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{item.label}</span>
                  <span className="mini-item-hint">{item.hint}</span>
                </span>
                <ChevronRight
                  className="size-5 shrink-0"
                  style={{ color: "var(--mini-text-muted)" }}
                  aria-hidden
                />
              </Link>
            );
          })}
        </section>
      ))}
    </div>
  );
}
