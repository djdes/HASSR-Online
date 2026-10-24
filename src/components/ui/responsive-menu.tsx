"use client";

import { useTranslations } from "next-intl";
import { cloneElement, isValidElement, useState, type ReactElement, type ReactNode } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  BottomSheet,
  SHEET_GROUP_LABEL_CLASS,
  SHEET_ROW_CLASS,
} from "@/components/ui/bottom-sheet";
import { useIsNarrowViewport } from "@/components/ui/spotlight-tour";
import { cn } from "@/lib/utils";

/**
 * Меню действий: на компьютере — выпадающий список, на телефоне — лист
 * снизу, как в мобильных приложениях.
 *
 * Зачем один компонент на оба случая: выпадающий список у края экрана
 * телефона даёт мелкие пункты в 40% ширины, до которых ещё и тянуться
 * большим пальцем. Лист снизу — привычный жест: крупные строки, свайп
 * вниз закрывает.
 *
 * Пункты описываются данными (а не разметкой), поэтому оба вида
 * гарантированно одинаковые: одна и та же подпись, иконка и обработчик.
 */
export type ResponsiveMenuItem = {
  key: string;
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  title?: string;
  tone?: "default" | "danger";
};

/**
 * Группа пунктов: на компьютере — вложенное подменю, на телефоне —
 * подпись и пункты под ней. Второй уровень листа не заводим: группы
 * короткие, а лишний шаг стоит дороже подписи.
 */
export type ResponsiveMenuGroup = {
  key: string;
  label: string;
  icon?: ReactNode;
  items: ResponsiveMenuItem[];
};

export type ResponsiveMenuEntry = ResponsiveMenuItem | ResponsiveMenuGroup;

function isGroup(entry: ResponsiveMenuEntry): entry is ResponsiveMenuGroup {
  return Array.isArray((entry as ResponsiveMenuGroup).items);
}

export function ResponsiveMenu({
  trigger,
  items,
  title,
  align = "end",
  contentClassName,
}: {
  /** Кнопка-триггер: получает обработчик открытия обоих видов меню. */
  trigger: ReactElement<{ onClick?: (event: React.MouseEvent) => void }>;
  items: ResponsiveMenuEntry[];
  /** Заголовок листа на телефоне. */
  title?: string;
  align?: "start" | "center" | "end";
  contentClassName?: string;
}) {
  const t = useTranslations("sharedUi.responsiveMenu");
  const narrow = useIsNarrowViewport();
  const [sheetOpen, setSheetOpen] = useState(false);
  const visible = items.filter(Boolean);
  if (visible.length === 0) return null;

  if (narrow) {
    const mobileTrigger = isValidElement(trigger)
      ? cloneElement(trigger, {
          onClick: (event: React.MouseEvent) => {
            trigger.props.onClick?.(event);
            setSheetOpen(true);
          },
        })
      : trigger;

    return (
      <>
        {mobileTrigger}
        <BottomSheet
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          title={title ?? t("actions")}
        >
          {visible.map((entry) =>
            isGroup(entry) ? (
              <div key={entry.key}>
                <div className={SHEET_GROUP_LABEL_CLASS}>{entry.label}</div>
                {entry.items.map((item) => (
                  <SheetRow
                    key={item.key}
                    item={item}
                    onDone={() => setSheetOpen(false)}
                  />
                ))}
              </div>
            ) : (
              <SheetRow
                key={entry.key}
                item={entry}
                onDone={() => setSheetOpen(false)}
              />
            )
          )}
        </BottomSheet>
      </>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent
        align={align}
        className={
          contentClassName ??
          "w-[280px] max-w-[calc(100vw-1rem)] rounded-[24px] border-0 p-3 shadow-xl"
        }
      >
        {visible.map((entry) =>
          isGroup(entry) ? (
            <DropdownMenuSub key={entry.key}>
              <DropdownMenuSubTrigger className="h-9 rounded-xl px-3 text-[13.5px]">
                {entry.icon ? (
                  <span className="mr-3 flex size-4 items-center justify-center text-[#6f7282]">
                    {entry.icon}
                  </span>
                ) : null}
                {entry.label}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-[300px] max-w-[calc(100vw-1rem)] rounded-[24px] border-0 p-3 shadow-xl">
                {entry.items.map((item) => (
                  <MenuRow key={item.key} item={item} />
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          ) : (
            <MenuRow key={entry.key} item={entry} />
          )
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Строка выпадающего меню (компьютер). */
function MenuRow({ item }: { item: ResponsiveMenuItem }) {
  return (
    <DropdownMenuItem
      disabled={item.disabled}
      title={item.title}
      className={cn(
        "h-9 rounded-xl px-3 text-[13.5px]",
        item.tone === "danger" &&
          "text-[#a13a32] focus:bg-[#fff4f2] focus:text-[#a13a32] focus-visible:ring-[#a13a32]/15"
      )}
      onSelect={item.onSelect}
    >
      {item.icon ? (
        <span className="mr-3 flex size-4 items-center justify-center text-[#6f7282]">
          {item.icon}
        </span>
      ) : null}
      {item.label}
    </DropdownMenuItem>
  );
}

/** Строка листа снизу (телефон). */
function SheetRow({
  item,
  onDone,
}: {
  item: ResponsiveMenuItem;
  onDone: () => void;
}) {
  return (
    <button
      type="button"
      disabled={item.disabled}
      title={item.title}
      onClick={() => {
        onDone();
        item.onSelect();
      }}
      className={cn(
        SHEET_ROW_CLASS,
        item.disabled && "opacity-40",
        item.tone === "danger" &&
          "text-[#a13a32] hover:bg-[#fff4f2] active:bg-[#ffe9e5] focus-visible:ring-[#a13a32]/15"
      )}
    >
      {item.icon ? (
        <span className="flex size-5 shrink-0 items-center justify-center text-[#6f7282]">
          {item.icon}
        </span>
      ) : null}
      <span className="min-w-0 flex-1">{item.label}</span>
    </button>
  );
}
