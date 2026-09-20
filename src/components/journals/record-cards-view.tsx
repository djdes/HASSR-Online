"use client";

import { ChevronDown } from "lucide-react";
import { useState } from "react";

/**
 * Generic «Карточки» mode for list-style journals (one record per row,
 * many columns). Renders each row as a collapsible card: the first N
 * fields are the header (shown collapsed), the rest appear on expand.
 *
 * Designed to let callers keep their existing `<table>` untouched — they
 * derive a parallel array of "record cards" by mapping over the same
 * row data. No DOM gymnastics, no CSS hacks.
 */
export type RecordCardField = {
  label: string;
  value: React.ReactNode;
  /** If true, always visible in header (before expand). Max 2 recommended. */
  header?: boolean;
  /** Hide if empty — useful for optional columns. */
  hideIfEmpty?: boolean;
  /** If set, the field renders as a tappable button that invokes this handler.
   *  Used for per-cell editing journals (staff_training etc.) so a card
   *  field matches its table cell's "click to edit" behaviour. */
  onClick?: () => void;
  /** Optional hint under the value explaining what a tap will do,
   *  e.g. "нажмите, чтобы выбрать". */
  hint?: string;
  /** Tint the value red to flag empty required fields (mirrors
   *  `emptyCellClass` red-background used in several journal tables). */
  warnIfEmpty?: boolean;
};

export type RecordCardItem = {
  id: string;
  /** Big, scannable title shown as the card's headline (e.g. a date or a name) */
  title: React.ReactNode;
  /** Subtitle under the title — secondary identification (e.g. position) */
  subtitle?: React.ReactNode;
  /** Badge in the top-right corner — e.g. status chip */
  badge?: React.ReactNode;
  /** All the data fields. Fields with `header: true` show in the collapsed state. */
  fields: RecordCardField[];
  /** Actions row rendered at the bottom of the card when expanded */
  actions?: React.ReactNode;
  /** Optional leading element — e.g. a checkbox for bulk selection */
  leading?: React.ReactNode;
  /** Optional click handler for the whole card body (excluding leading + actions) */
  onClick?: () => void;
};

export function RecordCardsView({
  items,
  emptyLabel = "Нет записей.",
  defaultExpandFirst = false,
}: {
  items: RecordCardItem[];
  emptyLabel?: string;
  defaultExpandFirst?: boolean;
}) {
  const [expanded, setExpanded] = useState<string | null>(
    defaultExpandFirst && items[0] ? items[0].id : null
  );

  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-[#dcdfed] bg-[#fafbff] p-5 text-center text-[13px] text-[#6f7282]">
        {emptyLabel}
      </div>
    );
  }

  return (
    <div className="space-y-2 sm:hidden print:hidden">
      {items.map((item) => {
        const isExpanded = expanded === item.id;
        const headerFields = item.fields.filter((f) => f.header);
        const bodyFields = item.fields.filter(
          (f) => !f.header && !(f.hideIfEmpty && isEmpty(f.value))
        );
        // Раскрытие есть всегда, когда есть что показать. Раньше при заданном
        // `item.onClick` тело не рендерилось вовсе: с телефона нельзя было
        // просто ПОСМОТРЕТЬ запись (органолептика, срок, ответственный) —
        // только открыть форму правки. Теперь тап по карточке раскрывает её,
        // а правка — отдельной кнопкой «изменить».
        const canExpand = bodyFields.length > 0;

        return (
          <div
            key={item.id}
            className="rounded-2xl border border-[#ececf4] bg-white"
          >
            <div className="flex items-center gap-3 px-3 py-3">
              {item.leading ? (
                <span
                  onClick={(event) => event.stopPropagation()}
                  className="shrink-0"
                >
                  {item.leading}
                </span>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  if (canExpand) {
                    setExpanded(isExpanded ? null : item.id);
                  } else {
                    item.onClick?.();
                  }
                }}
                aria-expanded={canExpand ? isExpanded : undefined}
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
              >
                <div className="min-w-0 flex-1">
                  <div className="line-clamp-3 break-words text-[14px] font-medium leading-snug text-[#0b1024]">
                    {item.title}
                  </div>
                  {item.subtitle ? (
                    <div className="line-clamp-2 break-words text-[12px] text-[#6f7282]">
                      {item.subtitle}
                    </div>
                  ) : null}
                  {headerFields.length > 0 ? (
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-[#6f7282]">
                      {headerFields.map((f, i) => (
                        <span key={i}>
                          <span className="font-medium text-[#3c4053]">{f.label}:</span>{" "}
                          {f.value || "—"}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
                {item.badge ? (
                  <span className="shrink-0">{item.badge}</span>
                ) : null}
                {canExpand ? (
                  <ChevronDown
                    className={`size-4 shrink-0 text-[#6f7282] transition-transform ${
                      isExpanded ? "rotate-180" : ""
                    }`}
                  />
                ) : null}
              </button>
              {item.onClick ? (
                <button
                  type="button"
                  onClick={item.onClick}
                  className="shrink-0 rounded-full bg-[#f5f6ff] px-3 py-1.5 text-[12px] font-semibold text-[#5566f6] transition-colors duration-150 hover:bg-[#eef1ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
                >
                  изменить
                </button>
              ) : null}
            </div>
            {isExpanded && canExpand ? (
              <div className="space-y-2 border-t border-[#ececf4] p-3 text-[13px]">
                {bodyFields.map((f, i) => {
                  const empty = isEmpty(f.value);
                  const warn = empty && f.warnIfEmpty;
                  const tappable = Boolean(f.onClick);
                  const cls = `flex flex-col gap-0.5 rounded-xl px-3 py-2 ${
                    warn ? "bg-[#fff2f1]" : "bg-[#fafbff]"
                  } ${
                    tappable
                      ? "cursor-pointer border border-[#e7e9f4] hover:border-[#5566f6]/50 hover:bg-[#f5f6ff] active:bg-[#eef1ff]"
                      : ""
                  }`;
                  const content = (
                    <>
                      <span
                        className={`text-[11px] font-semibold uppercase tracking-[0.12em] ${
                          warn ? "text-[#d2453d]" : "text-[#6f7282]"
                        }`}
                      >
                        {f.label}
                        {tappable ? (
                          <span className="ml-1 text-[10px] font-medium normal-case tracking-normal text-[#5566f6]">
                            · изменить
                          </span>
                        ) : null}
                      </span>
                      <span
                        className={`text-[13px] leading-[1.45] ${
                          warn ? "text-[#d2453d]" : "text-[#0b1024]"
                        }`}
                      >
                        {empty ? (
                          <span className="text-[#9b9fb3]">—</span>
                        ) : (
                          f.value
                        )}
                      </span>
                      {f.hint ? (
                        <span className="text-[11px] text-[#9b9fb3]">{f.hint}</span>
                      ) : null}
                    </>
                  );
                  if (tappable) {
                    return (
                      <button
                        key={i}
                        type="button"
                        className={`${cls} text-left`}
                        onClick={(event) => {
                          event.stopPropagation();
                          f.onClick?.();
                        }}
                      >
                        {content}
                      </button>
                    );
                  }
                  return (
                    <div key={i} className={cls}>
                      {content}
                    </div>
                  );
                })}
                {item.actions ? (
                  <div className="pt-2">{item.actions}</div>
                ) : null}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function isEmpty(value: React.ReactNode): boolean {
  if (value == null || value === false) return true;
  if (typeof value === "string") return value.trim() === "";
  if (typeof value === "number") return false;
  return false;
}
