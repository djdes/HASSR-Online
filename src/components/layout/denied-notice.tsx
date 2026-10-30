"use client";

import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { ShieldAlert } from "lucide-react";
import { isNavHrefDenied, sectionForPath } from "@/lib/app-nav";
import { DENIED_PARAM, parseDeniedPath, stripDeniedParam } from "@/lib/denied-notice";
import { useAppNav } from "@/components/layout/app-nav-context";
import { MenuHint } from "@/components/layout/access-denied";

/**
 * Одноразовое объяснение после редиректа proxy (2026-10-29): «Раздел «…»
 * закрыт для вашей роли — поэтому открылась эта страница». Proxy добавляет
 * `?denied=<откуда>` (`lib/denied-notice.ts`), плашка показывает его и сразу
 * убирает метку из адреса (без перезагрузки): обновление страницы или ссылка
 * из адресной строки объяснение не повторят. Уходим со страницы — плашка
 * исчезает.
 */
export function useDeniedNotice(): { from: string; text: string; dismiss: () => void } | null {
  const t = useTranslations("navigation.shell");
  const { sections, routedAwayHrefs } = useAppNav();
  const pathname = usePathname() || "/";
  // С домашней по роли человека сейчас уведут дальше (метку страница несёт
  // с собой) — объяснит та, где он окажется, а не мелькнёт здесь.
  const passing = isNavHrefDenied(pathname, routedAwayHrefs);
  const param = useSearchParams().get(DENIED_PARAM);
  const raw = passing ? null : param;
  const [seenRaw, setSeenRaw] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ from: string; at: string } | null>(null);
  // Новая метка в адресе — запоминаем, что объяснять (во время рендера, а не
  // в эффекте: метка сразу уходит из адреса, а плашка должна остаться).
  if (raw !== seenRaw) {
    setSeenRaw(raw);
    const from = parseDeniedPath(raw);
    if (from) setNotice({ from, at: pathname });
  }

  useEffect(() => {
    if (!raw) return;
    const search = stripDeniedParam(window.location.search);
    window.history.replaceState(null, "", `${window.location.pathname}${search}${window.location.hash}`);
  }, [raw]);

  if (!notice || notice.at !== pathname) return null;
  const label = deniedSectionLabel(notice.from, sections, t as unknown as (key: string) => string);
  return {
    from: notice.from,
    text: label ? t("access.deniedNotice", { section: label }) : t("access.deniedNoticeGeneric"),
    dismiss: () => setNotice(null),
  };
}

/** Плашка над страницей кабинета (сайт и оболочка Mini App). */
export function DeniedNotice() {
  const t = useTranslations("navigation.shell.access");
  const notice = useDeniedNotice();
  if (!notice) return null;
  return (
    <div
      role="status"
      className="mb-4 flex flex-col gap-3 rounded-2xl border border-[#dcdfed] bg-[#f5f6ff] px-4 py-3 sm:flex-row sm:items-center print:hidden"
      data-denied-notice={notice.from}
    >
      <ShieldAlert className="hidden size-5 shrink-0 text-[#5566f6] sm:block" aria-hidden />
      <div className="min-w-0 flex-1 text-[13.5px] leading-[1.55] text-[#0b1024]">
        <p className="font-medium">{notice.text}</p>
        <p className="mt-0.5 text-[#3c4053]">
          <MenuHint />
        </p>
      </div>
      <button
        type="button"
        onClick={notice.dismiss}
        className="inline-flex h-9 shrink-0 items-center justify-center self-start rounded-xl border border-[#dcdfed] bg-white px-3 text-[13px] font-medium text-[#3848c7] transition-colors duration-150 hover:border-[#5566f6]/40 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 sm:self-center"
        data-denied-notice-dismiss
      >
        {t("dismiss")}
      </button>
    </div>
  );
}

/**
 * Название закрытого раздела: пункт меню, иначе раздел. Свои названия
 * организации — из модели меню, если раздел человеку виден; закрытый —
 * стандартное название.
 */
function deniedSectionLabel(
  from: string,
  sections: ReturnType<typeof useAppNav>["sections"],
  t: (key: string) => string,
): string | null {
  const owner = sectionForPath(from);
  if (!owner) return null;
  const visible = sections.find((section) => section.key === owner.section);
  if (owner.menuItemId) {
    const item = visible?.menu?.flatMap((group) => group.items).find((entry) => entry.id === owner.menuItemId);
    return item?.label ?? t(`menus.${owner.section}.items.${owner.menuItemId}`);
  }
  return visible?.label ?? t(`sections.${owner.section}`);
}
