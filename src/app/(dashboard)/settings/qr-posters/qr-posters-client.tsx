"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, ArrowRight, LayoutGrid, Printer, Refrigerator, Warehouse } from "lucide-react";

import { JournalSelectionBar } from "@/components/journals/journal-selection-bar";
import { PageGuide } from "@/components/ui/page-guide";
import { PageHeader, PageHeaderStat } from "@/components/ui/page-header";
import { isJournalObjectQrCode } from "@/lib/journal-qr-target";
import type { QrPoster, QrPosterItem, QrPrintFormat } from "@/lib/qr-fill-types";
import { composeQrPrintPages, sheetsLabel } from "@/lib/qr-print-layout";
import type { QrPostersView } from "@/lib/qr-posters-view";
import { cn } from "@/lib/utils";

import { QrFormatSwitch } from "./qr-format-switch";
import { QrCompactRow, QrMainCard, QrObjectCard } from "./qr-poster-card";
import { QrPrintSheets, useHydrated } from "./qr-print-sheets";

export type { QrPoster } from "@/lib/qr-fill-types";

const LINK_CLASS = "font-medium text-[#3848c7] underline underline-offset-2";
const OUTLINE_BUTTON_CLASS =
  "inline-flex h-11 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15";
const TEXT_BUTTON_CLASS =
  "inline-flex h-11 shrink-0 items-center rounded-2xl px-3 text-[13.5px] font-medium text-[#3848c7] transition-colors duration-150 hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15";

const GUIDE_BULLETS = [
  "Основные QR работают всегда: повесьте один раз — сотрудник сканирует и пишет в действующий документ. Документа нет — он создастся при первом скане.",
  "Дополнительные QR ведут в один документ и перестают работать после его последнего дня.",
  "Отметьте нужные коды и выберите формат у каждого: A4 — плакат, A5 — два на листе, наклейка — 12 на листе. Всё печатается одним заданием.",
];

function sameFormat(items: QrPosterItem[], formats: Record<string, QrPrintFormat>): QrPrintFormat | null {
  const values = new Set(items.map((item) => formats[item.key]));
  return values.size === 1 ? (Array.from(values)[0] ?? null) : null;
}

function Section({
  title,
  hint,
  actions,
  children,
  testId,
}: {
  title: string;
  hint?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  testId: string;
}) {
  return (
    <section className="space-y-3" data-qr-section={testId}>
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2 className="text-[17px] font-semibold tracking-[-0.01em] text-[#0b1024]">{title}</h2>
          {hint ? <p className="mt-0.5 max-w-[640px] text-[13px] leading-[1.5] text-[#6f7282]">{hint}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-1">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

/** Журнал объектов без объектов: кто и где должен их завести. */
function ObjectsEmpty({ view }: { view: QrPostersView }) {
  const room = view.objectKind === "room";
  const uv = view.journal?.code === "uv_lamp_runtime";
  const href = room ? "/settings/buildings" : "/settings/equipment";
  const what = room ? "помещения" : uv ? "УФ-лампы" : "холодильники";
  return (
    <div className="rounded-3xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-5 py-8 text-center">
      <div className="text-[15px] font-medium text-[#0b1024]">
        {view.documentTitle ? "В документе нет объектов из справочника" : `Пока нет объектов: ${what}`}
      </div>
      <p className="mx-auto mt-1.5 max-w-[460px] text-[13px] leading-[1.55] text-[#6f7282]">
        {view.objectsEmpty ? (
          <>Ответственный за журнал — {view.objectsEmpty.responsible} — должен добавить {what} в «{room ? "Точки и помещения" : "Оборудование"}». Наклейки появятся здесь.</>
        ) : (
          <>Добавьте {what} в «{room ? "Точки и помещения" : "Оборудование"}» — наклейки появятся здесь.</>
        )}
      </p>
      <Link href={href} className={cn(OUTLINE_BUTTON_CLASS, "mt-4")}>
        {room ? <Warehouse className="size-4 text-[#5566f6]" /> : <Refrigerator className="size-4 text-[#5566f6]" />}
        {room ? "Открыть «Точки и помещения»" : "Открыть «Оборудование»"}
      </Link>
    </div>
  );
}

/**
 * Страница QR-кодов: состояние отметок и форматов, группы карточек,
 * полоса «Выбрано: N · M листов» и печатное дерево из выбранного.
 */
export function QrPostersClient({ view }: { view: QrPostersView }) {
  const { items } = view;
  const [selected, setSelected] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(items.map((item) => [item.key, item.defaultSelected && !item.expired]))
  );
  const [formats, setFormats] = useState<Record<string, QrPrintFormat>>(() =>
    Object.fromEntries(items.map((item) => [item.key, item.defaultFormat]))
  );

  const groups = useMemo(
    () => ({
      main: items.filter((item) => item.group === "main"),
      extra: items.filter((item) => item.group === "extra"),
      object: items.filter((item) => item.group === "object"),
    }),
    [items]
  );
  const posters = useMemo(() => new Map<string, QrPoster>(items.map((item) => [item.key, item.poster])), [items]);
  const chosen = items.filter((item) => selected[item.key]);
  const pages = composeQrPrintPages(chosen.map((item) => ({ key: item.key, format: formats[item.key] })));

  const toggle = (key: string, value: boolean) => setSelected((current) => ({ ...current, [key]: value }));
  const setFormat = (key: string, format: QrPrintFormat) => setFormats((current) => ({ ...current, [key]: format }));
  const setGroupSelected = (list: QrPosterItem[], value: boolean) =>
    setSelected((current) => ({ ...current, ...Object.fromEntries(list.filter((item) => !item.expired).map((item) => [item.key, value])) }));
  const setGroupFormat = (list: QrPosterItem[], format: QrPrintFormat) =>
    setFormats((current) => ({ ...current, ...Object.fromEntries(list.map((item) => [item.key, format])) }));

  // autoprint=1: печать после гидратации (портал печати смонтирован) и
  // только если что-то выбрано — иначе Chrome печатал пустые рамки.
  const hydrated = useHydrated();
  const printedRef = useRef(false);
  useEffect(() => {
    if (!view.autoprint || !hydrated || printedRef.current || pages.length === 0) return;
    printedRef.current = true;
    let second = 0;
    const first = window.requestAnimationFrame(() => {
      second = window.requestAnimationFrame(() => window.print());
    });
    return () => {
      window.cancelAnimationFrame(first);
      window.cancelAnimationFrame(second);
    };
  }, [view.autoprint, hydrated, pages.length]);

  const originHost = view.origin.replace(/^https?:\/\//, "");
  const journal = view.journal;
  const title =
    view.screen === "journal" ? "QR-коды журнала" : view.screen === "objects" ? "QR-наклейки" : "QR-коды";
  const description =
    view.screen === "journal"
      ? journal
        ? view.documentTitle
          ? `${journal.name} · наклейки документа «${view.documentTitle}»`
          : journal.name
        : "Журнал не найден"
      : view.screen === "objects"
        ? view.objectKind === "room"
          ? "Наклейки на склады и помещения: сотрудник сканирует и вносит температуру и влажность."
          : "Наклейки на холодильники и оборудование: сотрудник сканирует и вносит показание."
        : "Универсальные коды, QR каждого включённого журнала и наклейки на объекты.";

  const extraTitle = "Дополнительные — на один документ";
  const extraHint = "Ведут только в свой документ и перестают работать после его последнего дня. Не отмечены — отметьте, если нужны.";
  // Общий экран: основные QR журналов делятся на обычные журналы и
  // журналы объектов (холодильники, склады, лампы).
  const overviewJournals = groups.extra.filter((item) => !isJournalObjectQrCode(item.key));
  const overviewObjectJournals = groups.extra.filter((item) => isJournalObjectQrCode(item.key));
  const overviewJournalsSelectable = overviewJournals.filter((item) => !item.expired);
  const overviewJournalsAllSelected =
    overviewJournalsSelectable.length > 0 && overviewJournalsSelectable.every((item) => selected[item.key]);
  const objectsAllSelected = groups.object.length > 0 && groups.object.every((item) => selected[item.key]);
  const extraSelectable = groups.extra.filter((item) => !item.expired);
  const extraAllSelected = extraSelectable.length > 0 && extraSelectable.every((item) => selected[item.key]);

  return (
    <div className="space-y-6 pb-28" data-qr-page={view.screen}>
      <PageHeader
        title={title}
        description={description}
        actions={
          <>
            {journal?.disabled ? <PageHeaderStat tone="warn">Журнал выключен</PageHeaderStat> : null}
            {view.screen !== "overview" ? (
              <Link href="/settings/qr-posters" className={OUTLINE_BUTTON_CLASS}>
                <LayoutGrid className="size-4 text-[#5566f6]" />
                Все QR-коды
              </Link>
            ) : null}
            {view.filtered && view.objectKind ? (
              <Link href={`/settings/qr-posters?kind=${view.objectKind === "room" ? "rooms" : "equipment"}&layout=sheet`} className={OUTLINE_BUTTON_CLASS}>
                {view.objectKind === "room" ? <Warehouse className="size-4 text-[#5566f6]" /> : <Refrigerator className="size-4 text-[#5566f6]" />}
                {view.objectKind === "room" ? "Все помещения" : "Всё оборудование"}
              </Link>
            ) : null}
          </>
        }
      />

      {/* Цель касания гайда — 44px (сам PageGuide общий, правим только здесь). */}
      <div className="space-y-2 [&_button]:min-h-11 [&>div:first-child]:py-0.5" data-qr-guide="">
        <PageGuide
          title="Как это работает"
          storageKey="qr-posters-v2"
          bullets={GUIDE_BULLETS}
          footer={
            <p>
              Кто может записывать по QR — любой из списка, по PIN или только после входа — настраивается в{" "}
              <Link href="/settings/compliance" className={LINK_CLASS}>
                «Строгости журналов»
              </Link>
              .
            </p>
          }
        />
        {originHost !== "wesetup.ru" ? (
          <p className="text-[12px] text-[#9b9fb3]" data-qr-origin="">
            Домен ссылок: {originHost}
          </p>
        ) : null}
      </div>

      {view.missing.length > 0 ? (
        <div role="status" className="flex gap-3 rounded-2xl border border-[#ffd7d3] bg-[#fff4f2] p-4 text-[13px] leading-[1.55] text-[#a13a32]">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <div className="min-w-0">
            <p className="font-medium">Не удалось показать:</p>
            <ul className="mt-1 space-y-0.5">
              {view.missing.map((item) => (
                <li key={item.id}>
                  «{item.label}» — {item.reason}
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      {groups.main.length > 0 ? (
        <Section
          testId="main"
          title={view.screen === "overview" ? "Универсальные — не привязаны к одному журналу" : "Основные — работают всегда"}
          hint={
            view.screen === "overview"
              ? "Каждый — отдельный плакат, отмечены для печати. «Все журналы» — на стену у входа: сотрудник сам выбирает журнал. «Допуск» — для ответственного за смену."
              : "Отмечены для печати. Код бессрочный: повесили один раз — и он работает."
          }
        >
          <div className="grid gap-4 md:grid-cols-2">
            {groups.main.map((item) => (
              <QrMainCard
                key={item.key}
                item={item}
                selected={Boolean(selected[item.key])}
                format={formats[item.key]}
                onToggle={(value) => toggle(item.key, value)}
                onFormat={(format) => setFormat(item.key, format)}
              />
            ))}
          </div>
        </Section>
      ) : null}

      {view.screen === "journal" && journal && !journal.isObject ? (
        <Section
          testId="extra"
          title={extraTitle}
          hint={extraHint}
          actions={
            extraSelectable.length > 1 ? (
              <button type="button" className={TEXT_BUTTON_CLASS} onClick={() => setGroupSelected(extraSelectable, !extraAllSelected)}>
                {extraAllSelected ? "Снять все" : "Отметить все"}
              </button>
            ) : null
          }
        >
          {groups.extra.length > 0 ? (
            <div className="space-y-2">
              {groups.extra.map((item) => (
                <QrCompactRow
                  key={item.key}
                  item={item}
                  selected={Boolean(selected[item.key])}
                  format={formats[item.key]}
                  onToggle={(value) => toggle(item.key, value)}
                  onFormat={(format) => setFormat(item.key, format)}
                />
              ))}
            </div>
          ) : (
            <p className="rounded-2xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-4 py-3 text-[13px] text-[#6f7282]">
              Действующих документов нет — хватит основного QR: при скане он сам найдёт или создаст документ.
            </p>
          )}
        </Section>
      ) : null}

      {view.screen === "overview" ? (
        <>
          <Section
            testId="journals"
            title="Журналы — у каждого свой QR"
            hint={
              <>
                Все включённые журналы. Код ведёт сразу в журнал, без выбора, и работает всегда: нет документа — он создастся при первом скане. Дополнительные коды на отдельный документ — по кнопке «QR-точка контроля» в самом журнале.
              </>
            }
            actions={
              overviewJournalsSelectable.length > 1 ? (
                <button
                  type="button"
                  className={TEXT_BUTTON_CLASS}
                  onClick={() => setGroupSelected(overviewJournalsSelectable, !overviewJournalsAllSelected)}
                >
                  {overviewJournalsAllSelected ? "Снять все" : "Отметить все"}
                </button>
              ) : null
            }
          >
            {overviewJournals.length > 0 ? (
              <div className="space-y-2">
                {overviewJournals.map((item) => (
                  <QrCompactRow
                    key={item.key}
                    item={item}
                    selected={Boolean(selected[item.key])}
                    format={formats[item.key]}
                    onToggle={(value) => toggle(item.key, value)}
                    onFormat={(format) => setFormat(item.key, format)}
                  />
                ))}
              </div>
            ) : (
              <p className="rounded-2xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-4 py-3 text-[13px] text-[#6f7282]">
                Нет включённых журналов.{" "}
                <Link href="/settings/journals" className={LINK_CLASS}>
                  Выбрать журналы
                </Link>
              </p>
            )}
          </Section>
          <Section
            testId="objects"
            title="Объекты — холодильники, склады, лампы"
            hint="Записывают по наклейке на самом объекте. QR журнала показывает статус объектов за сегодня."
          >
            {overviewObjectJournals.length > 0 ? (
              <div className="space-y-2">
                {overviewObjectJournals.map((item) => (
                  <QrCompactRow
                    key={item.key}
                    item={item}
                    selected={Boolean(selected[item.key])}
                    format={formats[item.key]}
                    onToggle={(value) => toggle(item.key, value)}
                    onFormat={(format) => setFormat(item.key, format)}
                  />
                ))}
              </div>
            ) : null}
            <div className="grid gap-2 sm:grid-cols-2">
              {[
                { href: "/settings/qr-posters?kind=equipment&layout=sheet", label: "Наклейки на оборудование", count: view.counts?.equipment ?? 0, icon: Refrigerator },
                { href: "/settings/qr-posters?kind=rooms&layout=sheet", label: "Наклейки на склады и помещения", count: view.counts?.rooms ?? 0, icon: Warehouse },
              ].map((link) => {
                const Icon = link.icon;
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    className="group flex min-h-14 items-center gap-3 rounded-2xl border border-[#ececf4] bg-white px-4 py-2 transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
                  >
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#eef1ff] text-[#5566f6]">
                      <Icon className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1 text-[14px] font-medium text-[#0b1024]">{link.label}</span>
                    <span className="text-[13px] tabular-nums text-[#6f7282]">{link.count}</span>
                    <ArrowRight className="size-4 text-[#9b9fb3] transition-transform duration-150 group-hover:translate-x-0.5" />
                  </Link>
                );
              })}
            </div>
          </Section>
        </>
      ) : null}

      {view.objectKind ? (
        <Section
          testId="object"
          title={view.screen === "objects" ? (view.objectKind === "room" ? "Помещения" : "Оборудование") : "Наклейки на объекты"}
          hint={
            groups.object.length > 0
              ? view.objectKind === "room"
                ? "Клеится в самом помещении: запись идёт по наклейке, так понятно, что именно замеряли."
                : "Клеится на сам объект: запись идёт по наклейке, так понятно, что именно замеряли."
              : undefined
          }
          actions={
            groups.object.length > 0 ? (
              <>
                <button type="button" className={TEXT_BUTTON_CLASS} onClick={() => setGroupSelected(groups.object, !objectsAllSelected)}>
                  {objectsAllSelected ? "Снять все" : "Отметить все"}
                </button>
                <span className="hidden text-[12.5px] text-[#6f7282] sm:inline">Формат для всех</span>
                <QrFormatSwitch
                  label="Формат для всех наклеек"
                  value={sameFormat(groups.object, formats)}
                  onChange={(format) => setGroupFormat(groups.object, format)}
                />
              </>
            ) : null
          }
        >
          {groups.object.length > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {groups.object.map((item) => (
                <QrObjectCard
                  key={item.key}
                  item={item}
                  selected={Boolean(selected[item.key])}
                  format={formats[item.key]}
                  onToggle={(value) => toggle(item.key, value)}
                  onFormat={(format) => setFormat(item.key, format)}
                />
              ))}
            </div>
          ) : view.screen === "objects" && view.filtered ? (
            <div className="rounded-3xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-5 py-8 text-center text-[13px] text-[#6f7282]">
              Выбранные объекты не найдены — возможно, их удалили из справочника.
            </div>
          ) : (
            <ObjectsEmpty view={view} />
          )}
        </Section>
      ) : null}

      <JournalSelectionBar
        placement="bottom"
        keepWhenEmpty
        count={chosen.length}
        label={
          <span data-qr-summary="">
            Выбрано: {chosen.length}
            {pages.length > 0 ? <span className="font-normal text-[#6f7282]"> · {sheetsLabel(pages.length)}</span> : null}
          </span>
        }
        hint={chosen.length === 0 ? "Отметьте коды, которые нужно распечатать" : undefined}
        onClear={() => setGroupSelected(items, false)}
      >
        <button
          type="button"
          onClick={() => window.print()}
          disabled={chosen.length === 0}
          data-qr-print=""
          className="inline-flex h-11 items-center gap-2 rounded-2xl bg-[#5566f6] px-5 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors duration-150 hover:bg-[#4a5bf0] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/25 disabled:cursor-not-allowed disabled:bg-[#c8cbe0] disabled:shadow-none"
        >
          <Printer className="size-4" />
          Распечатать
        </button>
      </JournalSelectionBar>

      <QrPrintSheets pages={pages} posters={posters} />
      <style>{`.qr-box svg { display: block; width: 100%; height: auto; }`}</style>
    </div>
  );
}
