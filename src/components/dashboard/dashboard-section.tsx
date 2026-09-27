import { ChevronDown, type LucideIcon } from "lucide-react";

import { DashboardSectionMemory } from "@/components/dashboard/dashboard-section-memory";
import { DASHBOARD_SECTION_PERSIST_SCRIPT } from "@/lib/dashboard-section-memory";

type Props = {
  /** Уникальный ключ для localStorage. Inline-скрипт страницы читает все
   *  [data-storage-key] и подменяет open (см. lib/dashboard-section-memory). */
  storageKey: string;
  title: string;
  subtitle?: string;
  icon?: LucideIcon;
  badge?: {
    text: string;
    tone?: "default" | "ok" | "warn" | "danger";
  };
  /**
   * Мелкий элемент сразу после бейджа — тихая пилюля-справка.
   * Живёт внутри <summary>, поэтому обязан гасить клик, иначе секция
   * свернётся вместо перехода.
   */
  titleAction?: React.ReactNode;
  /**
   * Настройка секции — стоит слева от стрелки и остаётся в строке
   * заголовка даже на телефоне, где основные действия уезжают вниз.
   * Внутри группы заголовка кнопка переносилась на вторую строку и
   * висела в пустоте под названием.
   */
  titleAside?: React.ReactNode;
  defaultOpen?: boolean;
  /**
   * Действия в шапке секции — встают справа от заголовка, перед
   * стрелкой. Занимают уже существующую пустую строку вместо того,
   * чтобы заводить под себя новую.
   *
   * Клик по ним не должен сворачивать секцию: элемент лежит внутри
   * <summary>, поэтому содержимое обязано само гасить событие.
   */
  actions?: React.ReactNode;
  /**
   * Секция без карточки — прямо на фоне страницы, во всю ширину
   * (владелец, 2026-09-27, «Обязательные журналы»: «без блока-кругляшка…
   * а то прямоугольник в прямоугольнике»). Строка заголовка — название со
   * счётчиком, `titleAside` и стрелка; нажатие сворачивает. Иконка,
   * подпись и `actions` в этом режиме не рисуются — кнопки секции живут в
   * её содержимом, чтобы свёрнутая секция была одной строкой.
   */
  flat?: boolean;
  children: React.ReactNode;
};

/** Цвета бейджа — токены с тёмными парами (globals.css), а не emerald/amber:
 *  те в тёмной теме оставались светлыми пятнами. */
const TONE_CLS: Record<NonNullable<Props["badge"]>["tone"] & string, string> = {
  default: "bg-[#eef1ff] text-[#3848c7]",
  ok: "bg-[#ecfdf5] text-[#116b2a]",
  warn: "bg-[#fff8eb] text-[#b25f00]",
  danger: "bg-[#fff4f2] text-[#a13a32]",
};

/**
 * Раскрывающаяся секция дашборда. Server-component с native
 * `<details>` — работает с любыми children (включая async
 * server-components), лёгкий SSR.
 *
 * Запоминание на устройстве — `<DashboardSectionPersistScript />` на
 * странице (полная загрузка) и `DashboardSectionMemory` внутри секции
 * (переход внутри приложения), см. lib/dashboard-section-memory.ts.
 * Состояние `open` меняется до гидратации намеренно — отсюда
 * `suppressHydrationWarning`.
 */
export function DashboardSection({
  storageKey,
  title,
  subtitle,
  icon: Icon,
  badge,
  titleAction,
  titleAside,
  defaultOpen = false,
  actions,
  flat = false,
  children,
}: Props) {
  // «Обязательные журналы» → head «Обязательные », tail «журналы».
  const lastSpace = title.lastIndexOf(" ");
  const titleHead = lastSpace > 0 ? title.slice(0, lastSpace + 1) : "";
  const titleTail = lastSpace > 0 ? title.slice(lastSpace + 1) : title;

  const badgeEl = badge ? (
    <span
      className={`ml-1.5 inline-flex translate-y-[-1px] items-center rounded-full px-2 py-0.5 align-middle text-[11px] font-semibold tabular-nums ${TONE_CLS[badge.tone ?? "default"]}`}
    >
      {badge.text}
    </span>
  ) : null;

  // Последнее слово и бейдж — одним неразрывным куском: перед
  // inline-элементом браузер переносит строку даже через nbsp, и бейдж
  // оказывался один на новой строке. Так, если всё не влезает,
  // переносится «журналы 3/5».
  const titleWithBadge = badge ? (
    <>
      {titleHead}
      <span className="whitespace-nowrap">
        {titleTail}
        {badgeEl}
      </span>
    </>
  ) : (
    title
  );

  if (flat) {
    return (
      <details
        open={defaultOpen}
        data-storage-key={storageKey}
        data-section-layout="flat"
        suppressHydrationWarning
        className="group/section"
      >
        <summary className="group/summary flex cursor-pointer list-none items-center gap-2 rounded-2xl py-1 outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 [&::-webkit-details-marker]:hidden">
          <h2 className="min-w-0 flex-1 text-[18px] font-semibold leading-tight tracking-[-0.02em] text-[#0b1024] sm:text-[22px]">
            {titleWithBadge}
          </h2>
          {titleAside ? <div className="flex shrink-0 items-center">{titleAside}</div> : null}
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full text-[#9b9fb3] transition-colors group-hover/summary:text-[#5566f6]">
            <ChevronDown
              className="size-5 transition-transform duration-200 group-open/section:rotate-180"
              aria-hidden
            />
          </span>
        </summary>
        <DashboardSectionMemory />
        <div className="pt-3 sm:pt-4">{children}</div>
      </details>
    );
  }

  return (
    <details
      open={defaultOpen}
      data-storage-key={storageKey}
      suppressHydrationWarning
      className="group overflow-hidden rounded-3xl border border-[#ececf4] bg-white shadow-[0_0_0_1px_rgba(240,240,250,0.45)]"
    >
      {/* items-center: иконка 40px и заголовок выравниваются друг по
          другу. При items-start однострочный заголовок прижимался к
          верху и стоял выше центра иконки.

          flex-wrap только на мобиле: действия секции (например две
          кнопки «Закрыть день») не помещаются в строку заголовка на
          390px и раньше выталкивали её за экран — теперь они уезжают
          отдельной строкой под заголовок. */}
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-3 p-4 transition-colors hover:bg-[#fafbff] sm:flex-nowrap sm:p-5">
        {/* Иконка входит В левую группу: снаружи она делала левую
            сторону шире правой на свою ширину плюс отступ.
            flex-1 на мобиле: группа занимает всю строку заголовка и
            больше не сжимается в ноль под напором кнопок справа.
            На sm+ ширина 430px — ориентир, а не жёсткая рамка
            (shrink разрешён): на узком ноутбуке фиксированная ширина
            выдавливала стрелку за край карточки. */}
        <div className="flex min-w-0 flex-1 items-center gap-3 sm:w-[430px] sm:shrink sm:grow-0 sm:basis-auto">
          {Icon ? (
            // max-sm:self-start — на узком экране строка заголовка
            // переносится (бейджи, ссылка-настройка), и по центру иконка
            // оказывалась напротив ВТОРОЙ строки, будто оторвана от
            // названия. Сверху она стоит ровно у заголовка. Для
            // однострочных секций высота строки и так равна иконке —
            // там ничего не меняется.
            <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#3848c7] max-sm:self-start">
              <Icon className="size-5" />
            </span>
          ) : null}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              {/* Бейдж-счётчик живёт ВНУТРИ заголовка, а не рядом: на
                  390px «Обязательные журналы» занимает всю ширину группы,
                  и отдельный flex-элемент падал на следующую строку под
                  название. Как inline-часть текста он переносится вместе
                  с последним словом («…журналы 3/5»), а на десктопе стоит
                  там же, где стоял. */}
              <h3 className="text-[15px] font-semibold leading-tight tracking-[-0.01em] text-[#0b1024] sm:text-[16px]">
                {titleWithBadge}
              </h3>
              {titleAction}
            </div>
            {subtitle ? (
              <p className="mt-0.5 text-[12px] leading-snug text-[#6f7282] sm:text-[13px]">
                {subtitle}
              </p>
            ) : null}
          </div>
        </div>

        {/* Распорка между группами: слева и справа по 430px, всё лишнее
            место уходит сюда — заголовок и действия оказываются на
            одинаковом расстоянии от краёв. */}
        <div className="hidden flex-1 sm:block" />

        {/* Действия и стрелка — соседи, а не вложенная группа: на
            мобиле действия уезжают отдельной строкой (order-3 +
            basis-full), а стрелка обязана остаться в строке заголовка.
            На sm+ симметрия 430/430 сохраняется арифметикой:
            398 (действия) + 12 (gap-3) + 20 (стрелка) = 430.
            Именно min-w, а не w: при фиксированной ширине длинные
            действия вылезали за неё и наезжали на стрелку. */}
        {actions ? (
          <div className="flex items-center justify-end gap-3 max-sm:order-3 max-sm:basis-full sm:min-w-[398px] sm:shrink-0">
            {actions}
          </div>
        ) : null}
        {titleAside ? (
          <div className="flex shrink-0 items-center max-sm:order-2">
            {titleAside}
          </div>
        ) : null}
        <ChevronDown
          className="size-5 shrink-0 text-[#9b9fb3] transition-transform group-open:rotate-180 group-open:text-[#5566f6] max-sm:order-2"
          aria-hidden
        />
      </summary>
      <DashboardSectionMemory />
      <div className="border-t border-[#ececf4] p-4 sm:p-5">{children}</div>
    </details>
  );
}

/**
 * Inline-скрипт запоминания. Размещается ОДИН раз на странице, выше
 * секций. Без зависимости от React — работает до загрузки JS приложения.
 */
export function DashboardSectionPersistScript() {
  return (
    <script
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: DASHBOARD_SECTION_PERSIST_SCRIPT }}
    />
  );
}
