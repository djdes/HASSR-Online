"use client";

import { useTranslations } from "next-intl";

import { MAIN_CONTENT_ID } from "@/lib/view-prefs";

/**
 * «Перейти к содержимому» — первая остановка Tab на странице кабинета: с
 * клавиатуры и экранного диктора не нужно проходить шапку и меню, чтобы
 * добраться до журнала. Видна только в фокусе (`.skip-to-content`,
 * view-prefs.css). Фокус уходит в `<main id="main-content" tabIndex={-1}>`.
 */
export function SkipToContent() {
  const t = useTranslations("common.viewPrefs");
  return (
    <a
      href={`#${MAIN_CONTENT_ID}`}
      className="skip-to-content"
      data-testid="skip-to-content"
      onClick={(event) => {
        const main = document.getElementById(MAIN_CONTENT_ID);
        if (!main) return;
        // Без `#main-content` в адресе: фокус и прокрутка — сами.
        event.preventDefault();
        main.focus();
        main.scrollIntoView({ block: "start" });
      }}
    >
      {t("skipToContent")}
    </a>
  );
}
