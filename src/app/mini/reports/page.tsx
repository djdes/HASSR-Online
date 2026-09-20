"use client";

import Link from "next/link";
import { ChevronRight, FileSpreadsheet, FileText } from "lucide-react";
import { buildMiniOpenBridgePath } from "@/lib/journal-obligation-links";

import { ShareButton } from "../_components/share-button";

// Подпись под названием объясняет, что внутри: «CAPA» и «Партии» сами по
// себе человеку у плиты ничего не говорят.
const REPORT_LINKS = [
  {
    label: "Журналы в PDF",
    hint: "для проверяющего, на печать",
    href: "/reports?format=pdf",
    icon: FileText,
  },
  {
    label: "Журналы в Excel",
    hint: "таблица для своих расчётов",
    href: "/reports?format=excel",
    icon: FileSpreadsheet,
  },
  {
    label: "Производственный план",
    hint: "что и сколько готовим",
    href: "/plans",
    icon: FileText,
  },
  {
    label: "Нарушения и их устранение",
    hint: "что нашли и как исправили (CAPA)",
    href: "/capa",
    icon: FileText,
  },
  {
    label: "Потери и списания",
    hint: "испорченные и просроченные продукты",
    href: "/losses",
    icon: FileText,
  },
  {
    label: "Изменения в работе",
    hint: "новое оборудование, рецептура, поставщик",
    href: "/changes",
    icon: FileText,
  },
  {
    label: "Обучение сотрудников",
    hint: "кто что прошёл и когда повторять",
    href: "/competencies",
    icon: FileText,
  },
  {
    label: "Партии продукции",
    hint: "прослеживаемость сырья и блюд",
    href: "/batches",
    icon: FileText,
  },
];

export default function MiniReportsPage() {
  return (
    /* Цвета — токенами Mini App, а не сайтовыми хардкодами. Раньше здесь
       стояли `bg-white` и `text-[#0b1024]`: в тёмной теме страница
       выглядела как белая заплата посреди приложения. */
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
          Здесь собраны выгрузки и разделы с отчётами. Они открываются в полной
          версии сайта — нажмите на нужный пункт. Чтобы вернуться в приложение,
          нажмите «назад» в браузере или откройте бота заново.
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

      <section className="space-y-2">
        {REPORT_LINKS.map((link) => {
          const Icon = link.icon;
          return (
            <Link
              key={link.href}
              href={buildMiniOpenBridgePath(link.href, link.label)}
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
