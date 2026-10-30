"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { ChevronRight, LayoutGrid, Search } from "lucide-react";
import { NavIconChip } from "@/components/layout/nav-icons";

export type MiniSectionItemView = {
  href: string;
  label: string;
  hint: string;
  icon: string;
  /** У раздела своё меню — стрелка ›; «Остальное» (одна страница) — без неё. */
  hasMenu?: boolean;
};

export type MiniSectionGroupView = {
  id: string;
  title: string;
  subtitle: string;
  items: MiniSectionItemView[];
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
  const t = useTranslations("miniSections");
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
            {t("login.title")}
          </h1>
          <p
            className="mt-2 text-[16px] leading-relaxed"
            style={{ color: "var(--mini-text-muted)" }}
          >
            {t("login.description")}
          </p>
          <Link href="/mini" className="mini-btn-primary mini-press mt-5 w-full">
            {t("login.action")}
          </Link>
        </section>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-4 pb-24">
      <header className="mini-card px-5 py-5">
        <p className="mini-eyebrow">{t("home.eyebrow")}</p>
        <h1 className="mini-h1 mt-1">{t("home.title")}</h1>
        <p
          className="mt-2 text-[15px] leading-relaxed"
          style={{ color: "var(--mini-text-muted)" }}
        >
          {t("home.description")}
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
            placeholder={t("search.label")}
            aria-label={t("search.label")}
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
          {t("emptySearch")}
        </p>
      ) : null}

      {filtered.map((group) => (
        <section key={group.id} className="space-y-2">
          {group.title ? (
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
          ) : null}
          {group.items.map((item) => {
            return (
              // Пункт — строка списка QR-страниц: плитка, название
              // крупно, пояснение под ним.
              <Link
                key={item.href}
                href={item.href}
                data-nav-row
                className="mini-item mini-press"
              >
                <NavIconChip name={item.icon} className="size-10 rounded-xl" iconClassName="size-5" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{item.label}</span>
                  {item.hint ? <span className="mini-item-hint">{item.hint}</span> : null}
                </span>
                {item.hasMenu ? (
                  <ChevronRight
                    className="size-5 shrink-0"
                    style={{ color: "var(--mini-text-muted)" }}
                    aria-hidden
                    data-nav-chevron
                  />
                ) : null}
              </Link>
            );
          })}
        </section>
      ))}
    </div>
  );
}
