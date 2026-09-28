import Image from "next/image";
import Link from "next/link";
import { Check, ChevronRight, FileText, Printer } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  JOURNAL_ROW_CLASS,
  JOURNAL_THUMB_BOX_CLASS,
} from "@/components/dashboard/dashboard-journals-layout";

/**
 * Строки списка «Обязательные журналы» на главной (владелец, 2026-09-27):
 * «слева у названий — маленькие прямоугольные скрины журналов с понятным
 * чекбоксом-галочкой, что тут всё ок. В минималистичном виде».
 *
 * Строка — без заливки и рамки: превью бланка, на его углу — отметка
 * состояния, название, тихая стрелка. Разделитель — тонкая линия над
 * строкой (одна система на весь список, у бумажных и отключённых тоже).
 * Из трёх вариантов выбран этот (A); два других — патчами в
 * `.agent/tasks/dashboard-journals-2026-09/`.
 */

/**
 * Превью бланка. Образец из `public/journal-samples` сервер отдаёт
 * уменьшенным (`next/image`: 1–2 КБ вместо ~40 КБ на строку); живой
 * снимок документа (`/api/journal-previews/…`) приватный и с версией в
 * адресе — его грузим как есть.
 */
export type JournalThumbSource = { src: string; optimized: boolean } | null;

export function JournalThumb({
  source,
  dimmed = false,
  children,
}: {
  source: JournalThumbSource;
  /** Отключённый журнал — превью бледное и серое. */
  dimmed?: boolean;
  /** Отметка поверх угла превью. */
  children?: React.ReactNode;
}) {
  return (
    <span data-journal-thumb="" className="relative shrink-0">
      <span className={JOURNAL_THUMB_BOX_CLASS}>
        {source ? (
          <Image
            src={source.src}
            alt=""
            width={80}
            height={60}
            sizes="(min-width: 1024px) 80px, 64px"
            unoptimized={!source.optimized}
            loading="lazy"
            className={cn(
              // Белый бланк в тёмной теме чуть приглушён, чтобы список не слепил.
              "size-full object-cover object-top dark:brightness-90",
              dimmed && "opacity-60 grayscale",
            )}
          />
        ) : (
          <span className="flex size-full items-center justify-center bg-[#fafbff] text-[#c7ccea]">
            <FileText className="size-5" aria-hidden />
          </span>
        )}
      </span>
      {children}
    </span>
  );
}

/**
 * Отметка «заполнено сегодня»: зелёный круг с галочкой; не заполнено —
 * пустой кружок, без красного (журнал не нарушен, его просто ещё не
 * заполнили).
 */
export function JournalStatusMark({
  filled,
  className,
}: {
  filled: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      data-journal-mark={filled ? "filled" : "open"}
      className={cn(
        "flex size-[22px] shrink-0 items-center justify-center rounded-full",
        // Пустой кружок — свой серый: `border-[#c7ccea]` в тёмной теме
        // общим правилом становится бледно-индиговым и пропадает.
        filled
          ? "bg-[#16a34a] text-white"
          : "border-2 border-[#c3c7dc] bg-white dark:border-[#8a8da6]",
        className,
      )}
    >
      {filled ? <Check className="size-3.5" strokeWidth={3} /> : null}
    </span>
  );
}

/** Отметка на углу превью: вырез цвета фона страницы отделяет её от бланка. */
const MARK_ON_THUMB = "absolute -bottom-1.5 -right-1.5 ring-[3px] ring-[var(--app-soft-surface)]";

const ROW_LINK = cn(
  JOURNAL_ROW_CLASS,
  "group outline-none focus-visible:rounded-xl focus-visible:ring-4 focus-visible:ring-[#5566f6]/15",
);

const NAME =
  "line-clamp-2 break-words text-[16px] font-medium leading-snug tracking-[-0.01em] transition-colors duration-150";
/** Наведение на строку-ссылку: название чуть синеет (на телефоне наведения нет). */
const NAME_LINK = cn(NAME, "text-[#0b1024] group-hover:text-[#3848c7] dark:group-hover:text-[#a3adff]");

export function DashboardJournalRow({
  code,
  name,
  officialName,
  filled,
  thumb,
}: {
  code: string;
  name: string;
  officialName?: string;
  filled: boolean;
  thumb: JournalThumbSource;
}) {
  return (
    <Link
      href={`/journals/${code}`}
      data-journal-row={code}
      data-journal-status={filled ? "filled" : "open"}
      className={ROW_LINK}
    >
      <JournalThumb source={thumb}>
        <JournalStatusMark filled={filled} className={MARK_ON_THUMB} />
      </JournalThumb>
      <span className="min-w-0 flex-1">
        <span
          className={NAME_LINK}
          title={officialName ? `Официальное название: ${officialName}` : undefined}
        >
          {name}
        </span>
        <span className="sr-only">{filled ? ", заполнен сегодня" : ", сегодня ещё не заполнен"}</span>
      </span>
      <ChevronRight
        className="size-4 shrink-0 text-[#c7ccea] transition-[transform,color] duration-150 group-hover:translate-x-0.5 group-hover:text-[#5566f6]"
        aria-hidden
      />
    </Link>
  );
}

/**
 * Бумажный журнал: та же строка, превью бланка `paper_<id>`, вместо
 * отметки — принтер (отметить «заполнено» в системе нельзя, подпись
 * ставится ручкой на распечатке).
 */
export function DashboardPaperRow({ id, name }: { id: string; name: string }) {
  return (
    <Link href={`/settings/journals/paper/${id}`} data-paper-row={id} className={ROW_LINK}>
      <JournalThumb source={{ src: `/journal-samples/paper_${id}.webp`, optimized: true }} />
      <span className="min-w-0 flex-1">
        <span className={NAME_LINK}>{name}</span>
        <span className="sr-only">, бумажный — распечатать</span>
      </span>
      <Printer
        className="size-4 shrink-0 text-[#9b9fb3] transition-colors duration-150 group-hover:text-[#5566f6]"
        aria-hidden
      />
    </Link>
  );
}

/**
 * Отключённый журнал (только в результатах поиска): бледное превью и
 * «Включить». Кнопка забирает ширину, поэтому названию — до трёх строк:
 * иначе от «Журнала проведения витаминизации…» оставалось «Журнал
 * проведения…».
 */
export function DashboardDisabledRow({
  code,
  name,
  thumb,
  action,
}: {
  code: string;
  name: string;
  thumb: JournalThumbSource;
  action: React.ReactNode;
}) {
  return (
    <div data-disabled-row={code} className={JOURNAL_ROW_CLASS}>
      <JournalThumb source={thumb} dimmed />
      <span className={cn(NAME, "line-clamp-3 min-w-0 flex-1 text-[#6f7282]")}>{name}</span>
      {action}
    </div>
  );
}

export const ENABLE_BUTTON_CLASS =
  "inline-flex shrink-0 items-center gap-1 rounded-full bg-[#f5f6ff] px-3 py-1.5 text-[13px] font-medium text-[#5566f6] transition-colors hover:bg-[#eef1ff] disabled:opacity-60";
