import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { jsonLdSafeString } from "@/lib/json-ld";
import { cn } from "@/lib/utils";

/**
 * Хлебные крошки публичных страниц: видимая навигация и разметка
 * `BreadcrumbList` из одного источника.
 *
 * Зачем вместе, а не двумя кусками. Google требует, чтобы разметка
 * соответствовала тому, что реально видно на странице, а рекомендация
 * из скилла `site-architecture` — «крошки всегда повторяют структуру
 * URL». Если верстать ссылки в одном месте, а JSON-LD собирать в
 * другом, они расходятся при первой же правке заголовка, и разметка
 * начинает врать. Здесь один массив `items` порождает и то и другое.
 *
 * Почему не переиспользован `@/components/ui/breadcrumbs`: тот компонент
 * клиентский и тянет Radix, `useRouter` и подгрузку документов по
 * fetch — он для кабинета, где крошка это меню перехода между
 * журналами. На публичных страницах нужна статика без JS, иначе мы
 * платим килобайтами бандла за декоративную строку.
 *
 * `tone="dark"` — для тёмного hero (`bg-[#0b1024]`), `tone="light"` —
 * для белого фона.
 *
 * «Главная» добавляется сама, передавать её в `items` не нужно.
 */

export type PublicCrumb = {
  name: string;
  /** Без href — текущая страница, последнее звено. */
  href?: string;
};

const SITE = "https://wesetup.ru";

const HOME: PublicCrumb = { name: "Главная", href: "/" };

function absolute(href: string): string {
  return href.startsWith("http") ? href : `${SITE}${href}`;
}

/**
 * BreadcrumbList по спецификации schema.org: позиции нумеруются с 1,
 * у последнего звена `item` не указывается — это текущая страница.
 */
function breadcrumbJsonLd(items: PublicCrumb[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((crumb, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: crumb.name,
      ...(crumb.href ? { item: absolute(crumb.href) } : {}),
    })),
  };
}

export function PublicBreadcrumbs({
  items,
  tone = "dark",
  className,
  home = HOME,
  ariaLabel = "Хлебные крошки",
}: {
  items: PublicCrumb[];
  tone?: "dark" | "light";
  className?: string;
  home?: PublicCrumb;
  ariaLabel?: string;
}) {
  const trail = [home, ...items];
  if (trail.length < 2) return null;

  // Цвета — токены дизайн-системы: text-muted #6f7282, indigo #5566f6,
  // text-primary #0b1024, text-faint #9b9fb3, border-strong #dcdfed.
  const linkClass =
    tone === "dark"
      ? "text-white/70 transition-colors duration-150 hover:text-white"
      : "text-[#6f7282] transition-colors duration-150 hover:text-[#5566f6]";
  const currentClass = tone === "dark" ? "text-white" : "text-[#0b1024]";
  /** Промежуточное звено без своей страницы — тише ссылки, но читаемо. */
  const mutedClass = tone === "dark" ? "text-white/60" : "text-[#9b9fb3]";
  const sepClass = tone === "dark" ? "text-white/35" : "text-[#dcdfed]";

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLdSafeString(breadcrumbJsonLd(trail)),
        }}
      />
      <nav
        aria-label={ariaLabel}
        className={cn("text-[13px] font-medium print:hidden", className)}
      >
        <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
          {trail.map((crumb, index) => {
            const isLast = index === trail.length - 1;
            return (
              <li key={`${crumb.name}-${index}`} className="flex items-center gap-1.5">
                {index > 0 ? (
                  <ChevronRight aria-hidden className={cn("size-3.5 shrink-0", sepClass)} />
                ) : null}
                {crumb.href && !isLast ? (
                  <Link href={crumb.href} className={linkClass}>
                    {crumb.name}
                  </Link>
                ) : (
                  // aria-current только у последнего звена. Промежуточное
                  // звено тоже бывает без ссылки (раздел «Возможности» не
                  // имеет своей страницы), и помечать его «текущей
                  // страницей» — прямая ложь для скринридера.
                  <span
                    aria-current={isLast ? "page" : undefined}
                    className={isLast ? currentClass : mutedClass}
                  >
                    {crumb.name}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      </nav>
    </>
  );
}
