"use client";

import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";

import { splitFirstSentence } from "@/lib/first-sentence";

/**
 * Длинное пояснение одной строкой: видно первое предложение, остальное —
 * по «Подробнее». Ничего не удаляется, просто не занимает экран, пока не
 * нужно (законы, штрафы, оговорки).
 */
export function MoreText({ text, after }: { text: string; after?: ReactNode }) {
  const t = useTranslations("common.moreText");
  const [open, setOpen] = useState(false);
  const { first, rest } = splitFirstSentence(text);
  if (!rest) {
    return (
      <>
        {text}
        {after ? <> {after}</> : null}
      </>
    );
  }
  return (
    <>
      {open ? `${first} ${rest}` : first}
      {open && after ? <> {after}</> : null}{" "}
      <button
        type="button"
        aria-expanded={open}
        data-testid="more-text-toggle"
        onClick={() => setOpen((value) => !value)}
        // Внутри строки текста: без «крупнее на телефоне» (min-height 48px
        // раздвигал строку) — `touch:min-h-0`.
        className="inline p-0 align-baseline font-medium text-[#5566f6] underline-offset-2 hover:underline touch:min-h-0"
      >
        {open ? t("less") : t("more")}
      </button>
    </>
  );
}
