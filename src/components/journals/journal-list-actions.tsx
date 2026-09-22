"use client";

import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { QrCode } from "lucide-react";

import { FillGuideLauncher } from "@/components/journals/fill-guide-launcher";
import { JOURNAL_LIST_HEADING_CLASS } from "@/components/journals/journal-responsive";
import { LinkPendingSpinner } from "@/components/ui/link-pending";
import { journalQrHref } from "@/lib/journal-qr-target";
import { cn } from "@/lib/utils";

/**
 * Кнопки страницы журнала — одинаковые у ВСЕХ журналов (владелец,
 * 2026-09-22: «во всех журналах кнопку qr сделать над инструкцией и
 * заметнее… а 2 остальные кнопки в 1 ряд в 2 колонки»):
 *
 *   ┌──────────── QR-точка контроля ────────────┐  ← золотая, во всю ширину
 *   ├──── Создать документ ────┬─ Инструкция ───┤  ← два столбца
 *
 * На телефоне блок во всю ширину под заголовком, на компьютере — справа
 * от заголовка шириной 440 px. Одна кнопка во втором ряду (нет прав на
 * создание, вкладка «Закрытые», пустой журнал — там своя большая кнопка в
 * карточке) занимает оба столбца.
 *
 * QR — только руководителю: плакаты и наклейки печатает он. Кнопка есть на
 * каждом журнале и вкладке, даже без документов: у журналов объектов она
 * ведёт на наклейки холодильников / складов / ламп (`journalQrHref`).
 *
 * Покрытие всех списков журналов проверяет
 * `src/lib/journal-list-actions-coverage.test.ts`.
 */

/** Золотая кнопка — единственный не-индиго акцент кабинета (SKILL.md → «Gold accent»). */
export const JOURNAL_QR_POINT_CLASS =
  "qr-point-sheen relative isolate col-span-2 inline-flex h-12 w-full items-center justify-center gap-2 overflow-hidden rounded-2xl bg-[linear-gradient(135deg,#fff3c4_0%,#fcd34d_40%,#f5b301_75%,#dc9d00_100%)] px-4 text-[15px] font-semibold text-[#5b3a00] shadow-[0_12px_30px_-14px_rgba(220,157,0,0.75),inset_0_1px_0_rgba(255,255,255,0.65)] ring-1 ring-[#e8b320]/60 transition-[filter,box-shadow,transform] duration-200 hover:brightness-[1.04] active:scale-[0.99] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#f5b301]/35 motion-reduce:transition-none";

/** «Создать документ» во втором ряду — мягкий индиго (главная кнопка — в пустом состоянии). */
export const JOURNAL_ACTION_CREATE_CLASS =
  "inline-flex h-11 w-full min-w-0 items-center justify-center gap-2 rounded-2xl border-0 bg-[#eef1ff] px-2.5 text-[14px] font-semibold text-[#3848c7] shadow-none transition-colors duration-200 hover:bg-[#e2e7ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 has-[>svg]:px-2.5 disabled:opacity-60 [&_svg]:shrink-0";

/** «Инструкция» — outline. */
export const JOURNAL_ACTION_GUIDE_CLASS =
  "inline-flex h-11 w-full min-w-0 items-center justify-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-2.5 text-[14px] font-semibold text-[#0b1024] transition-colors duration-200 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 [&>svg]:shrink-0 [&>svg]:text-[#5566f6]";

/** Сетка блока: на телефоне во всю ширину, на компьютере 440 px справа от заголовка. */
export const JOURNAL_LIST_ACTIONS_GRID_CLASS = "grid w-full grid-cols-2 gap-2 sm:w-[440px] sm:shrink-0";

/**
 * Строка «заголовок + блок кнопок» в собственных шапках журналов. Блок
 * стоит справа, пока рядом с ним заголовку остаётся хотя бы 18rem, иначе
 * (планшет, узкое окно) уходит под заголовок — длинный заголовок не
 * рвётся посреди слова. Та же раскладка у общей шапки `JournalTopBar`.
 */
export const JOURNAL_LIST_HEADER_ROW_CLASS = "flex flex-wrap items-start justify-between gap-4 sm:items-center";

/** H1 списка журнала в этой строке: всё место рядом с блоком, перенос внутри. */
export const JOURNAL_LIST_TITLE_CLASS = cn(JOURNAL_LIST_HEADING_CLASS, "min-w-0 flex-1 basis-[18rem] sm:max-w-none");

export function JournalQrPointButton({
  templateCode,
  documentId,
  className,
}: {
  /** Код журнала (шаблона), не алиас маршрута. */
  templateCode: string;
  documentId?: string | null;
  className?: string;
}) {
  return (
    <Link
      href={journalQrHref(templateCode, { documentId })}
      aria-label="QR-точка контроля — плакат и наклейки для записи в журнал с телефона"
      title="Плакат или наклейки с QR-кодом: сотрудник сканирует и вносит запись с телефона, без входа в кабинет"
      data-testid="journal-qr-point"
      className={cn(JOURNAL_QR_POINT_CLASS, className)}
    >
      <QrCode className="size-[18px]" strokeWidth={2.25} aria-hidden />
      <span>QR-точка контроля</span>
      <LinkPendingSpinner />
    </Link>
  );
}

type GuideProps = Omit<ComponentProps<typeof FillGuideLauncher>, "code" | "page" | "variant">;

export function JournalListActions({
  templateCode,
  journalName,
  create,
  guideProps,
  canManage,
  className,
}: {
  /** Код журнала (шаблона): QR, «Инструкция». */
  templateCode: string;
  journalName?: string;
  /**
   * Кнопка «Создать документ» (или «Новая запись») — уже со своими
   * правами и вкладкой; стиль — `JOURNAL_ACTION_CREATE_CLASS`. `null` —
   * «Инструкция» займёт оба столбца.
   */
  create?: ReactNode;
  /** Остальные настройки «Инструкции» (первый документ, подпись…). */
  guideProps?: GuideProps;
  /** Руководитель: видит «QR-точку контроля». */
  canManage: boolean;
  className?: string;
}) {
  const hasCreate = create !== null && create !== undefined && create !== false;
  return (
    <div data-journal-list-actions="" className={cn(JOURNAL_LIST_ACTIONS_GRID_CLASS, className)}>
      {canManage ? <JournalQrPointButton templateCode={templateCode} /> : null}
      {hasCreate ? <div className="flex min-w-0 [&>*]:w-full">{create}</div> : null}
      <div className={cn("flex min-w-0 [&>*]:w-full", !hasCreate && "col-span-2")}>
        <FillGuideLauncher
          code={templateCode}
          journalName={journalName}
          page="list"
          variant="button"
          className={JOURNAL_ACTION_GUIDE_CLASS}
          {...guideProps}
        />
      </div>
    </div>
  );
}
