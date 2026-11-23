"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Check, ChevronDown, Loader2, Plus, Settings2, Store } from "lucide-react";
import type { BuildingOption } from "@/lib/building-scope";
import { headerPointChoosing, headerPointHidden, type HeaderPoint, type HeaderPointOption } from "@/lib/header-point";
import { hrefAfterPointSwitch } from "@/lib/point-section-sync";
import { cn } from "@/lib/utils";
import { useIsNarrowViewport } from "@/lib/use-narrow-viewport";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MENU_ITEM_ACTIVE_CLASS } from "@/components/ui/menu-styles";
import { ScrollList } from "@/components/ui/scroll-list";
import { BuildingIcon } from "@/components/layout/building-icon";
import { LocationSwitcherList, POINT_SEARCH_MIN, PointSearchField, useSwitchBuilding } from "@/components/layout/location-switcher";
import { PinButton, usePinnedBuildings } from "@/components/layout/pinned-buildings";
import { sortPinnedFirst } from "@/lib/pinned-buildings";
import { journalMatchesQuery, normalizeJournalSearch } from "@/lib/journal-search";

const FOCUS = "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15";
const NEW_POINT_HREF = "/settings/buildings/new";

/**
 * Центр шапки — текущий объект (эскиз руководителя: слева логотип и
 * название компании, в центре «наименование объекта / текущего объекта»).
 * Офис — не объект (владелец, 2026-11-23): в списке только объекты, а когда
 * объект не выбран (офис, вся организация, раздел всей компании) — на кнопке
 * просто «Выберите объект». По нажатию — список объектов; выбирать нечего —
 * «Объектов пока нет» и «Создать объект». Что показать, решает
 * `resolveHeaderPoint`, когда — «Выберите объект» — `headerPointChoosing`:
 *   • объектов два и больше и журналы по объектам — переключатель;
 *   • один объект — его название (в разделах компании — «Выберите объект»);
 *   • объектов несколько, журналы общие — «Объекты · Все: N», без выбора;
 *   • объектов нет — руководителю «Выберите объект», остальным ничего.
 * Смена — без оповещений (2026-11-23): ни тоста, ни «Вернуться на …».
 */
export function CurrentPointSwitcher({
  point,
  buildings,
  manageHref,
  pinnedIds,
  bar = false,
}: {
  /**
   * Полоса во всю ширину под шапкой — на телефоне (2026-11-11): в середине
   * шапки между бургером и значками название объекта сжималось до одной буквы.
   */
  bar?: boolean;
  point: HeaderPoint;
  /** Объекты для переключения (`kind: "switch"`), без офиса. */
  buildings: BuildingOption[];
  /** Активный объект; выбранный пункт берётся из `point.activeId`. */
  activeBuildingId?: string | null;
  manageHref: string | null;
  /** Закреплённые скрепкой объекты — первыми (личное, 2026-11-23). */
  pinnedIds?: string[];
}) {
  const t = useTranslations("navigation.shell.point");
  const router = useRouter();
  const pathname = usePathname();
  const narrow = useIsNarrowViewport();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [query, setQuery] = useState("");
  const canManage = Boolean(manageHref);
  const { switchTo, busyId } = useSwitchBuilding({ canManagePoints: canManage });
  const pins = usePinnedBuildings(pinnedIds ?? []);
  const hidden = headerPointHidden(pathname, point.kind);
  const choosing = headerPointChoosing(pathname, point);

  const titleOf = (option: HeaderPointOption) => {
    const title = option.title;
    return title.text === null ? t(title.source) : title.text;
  };
  const hintOf = (option: HeaderPointOption) =>
    option.address ? `${titleOf(option)}, ${option.address}` : titleOf(option);

  if (point.kind === "none" || hidden) return null;
  const BASE = bar ? BAR_BASE : INLINE_BASE;
  // Полоса живёт в своей строке под шапкой: рамку и отступы даёт обёртка.
  const wrap = (node: React.ReactNode) =>
    bar ? (
      <div className="border-b border-[#ececf4] bg-white px-4 py-2 sm:hidden print:hidden" data-point-bar>
        {node}
      </div>
    ) : (
      node
    );

  // Объекты несколько, журналы общие: выбирать нечего — только подпись.
  if (point.kind === "all") {
    const hint = point.options.map(titleOf).join(" · ");
    return wrap(
      <span className={BASE} data-current-point="all" title={hint}>
        <PointLabel caption={t("captionMany")} title={t("all", { count: String(point.count) })} />
      </span>,
    );
  }

  // Один объект у того, кто объектами не управляет, — просто подпись.
  if (point.kind === "single" && !canManage && !choosing) {
    return wrap(
      <span className={BASE} data-current-point="single" title={hintOf(point.point)}>
        <PointLabel caption={t("caption")} title={titleOf(point.point)} icon={point.point.icon} />
      </span>,
    );
  }

  // Закреплённые — первыми, сразу после нажатия на скрепку.
  const options: HeaderPointOption[] = sortPinnedFirst(
    point.kind === "switch" ? point.options : point.kind === "single" ? [point.point] : [],
    pins.pinned,
  );
  // Скрепка нужна, когда объектов два и больше.
  const canPin = options.length >= 2;
  // Пункт «выбран», только когда объект и правда выбран (не «Выберите объект»).
  const activeId = choosing
    ? null
    : point.kind === "switch"
      ? point.activeId
      : point.kind === "single"
        ? point.point.id
        : null;
  const active = activeId ? (options.find((option) => option.id === activeId) ?? null) : null;
  // В списке — те же подписи, что в шапке: объект с названием компании — по адресу.
  const buildingOf = (option: HeaderPointOption): BuildingOption => {
    const building = buildings.find((item) => item.id === option.id);
    return building
      ? { ...building, name: titleOf(option) }
      : { id: option.id, name: titleOf(option), address: option.address, icon: option.icon ?? null };
  };
  const listBuildings = options.map(buildingOf);

  /**
   * Выбор объекта. Переключатель — смена объекта (без тоста); один объект без
   * деления журналов — переход туда, где он имеет смысл (страница объекта из
   * раздела компании), без запроса смены.
   */
  const choose = (option: HeaderPointOption) => {
    if (point.kind === "switch") {
      void switchTo(buildingOf(option), activeId);
      return;
    }
    const href = hrefAfterPointSwitch({
      pathname,
      target: { id: option.id, office: false },
      canManagePoints: canManage,
    });
    if (href) router.push(href);
  };

  const trigger = cn(BASE, "transition-colors duration-150 hover:bg-[#f5f6ff] data-[state=open]:bg-[#f5f6ff]", FOCUS);
  // Пока объект переключается — в шапке уже выбранный (страница под ним — скелет).
  const shown = (busyId ? options.find((option) => option.id === busyId) : undefined) ?? active;
  const label = shown ? (
    <PointLabel caption={t("caption")} title={titleOf(shown)} icon={shown.icon} />
  ) : (
    <ChooseLabel text={t("choose")} />
  );
  const body = (
    <>
      {label}
      {busyId ? (
        <Loader2 className="size-4 shrink-0 animate-spin text-[#5566f6]" aria-hidden />
      ) : (
        <ChevronDown className="size-4 shrink-0 text-[#6f7282]" aria-hidden />
      )}
    </>
  );
  const ariaLabel = shown ? `${t("switch")}: ${titleOf(shown)}` : t("choose");
  const state = shown ? (point.kind === "switch" ? "switch" : "single") : "choose";

  if (narrow) {
    return wrap(
      <>
        <button
          type="button"
          onClick={() => setSheetOpen(true)}
          className={trigger}
          aria-label={ariaLabel}
          title={shown ? hintOf(shown) : t("choose")}
          data-current-point={state}
          aria-busy={busyId ? true : undefined}
        >
          {body}
        </button>
        <BottomSheet open={sheetOpen} onClose={() => setSheetOpen(false)} title={t("list")}>
          <div
            onClick={(event) => {
              if ((event.target as HTMLElement).closest("button,a")) setSheetOpen(false);
            }}
          >
            {listBuildings.length === 0 ? (
              <p className="px-3 py-4 text-center text-[14px] text-[#6f7282]" data-point-empty>
                {t("empty")}
              </p>
            ) : (
              <LocationSwitcherList
                buildings={listBuildings}
                activeBuildingId={activeId}
                canManagePoints={canManage}
                pinnedIds={canPin ? pins.pinned : undefined}
                onTogglePin={canPin ? (id) => void pins.toggle(id) : undefined}
                onChoose={point.kind === "switch" ? undefined : (id) => {
                  const option = options.find((item) => item.id === id);
                  if (option) choose(option);
                }}
              />
            )}
            {canManage ? (
              <>
                <Link
                  href={NEW_POINT_HREF}
                  className="flex min-h-[48px] items-center gap-3 rounded-xl px-3 text-[14px] font-medium text-[#3848c7] transition-colors hover:bg-[#f5f6ff]"
                  data-point-create
                >
                  <Plus className="size-5" />
                  {t("create")}
                </Link>
                {listBuildings.length > 0 && manageHref ? (
                  <Link
                    href={manageHref}
                    className="flex min-h-[48px] items-center gap-3 rounded-xl px-3 text-[14px] font-medium text-[#3848c7] transition-colors hover:bg-[#f5f6ff]"
                  >
                    <Settings2 className="size-5" />
                    {t("manage")}
                  </Link>
                ) : null}
              </>
            ) : null}
          </div>
        </BottomSheet>
      </>,
    );
  }
  // Полоса — только для телефона; на компьютере её место в середине шапки.
  if (bar) return null;

  const normalizedQuery = normalizeJournalSearch(query);
  const shownOptions = normalizedQuery
    ? options.filter((option) => journalMatchesQuery([titleOf(option), option.address], normalizedQuery))
    : options;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={trigger}
          aria-label={ariaLabel}
          title={shown ? hintOf(shown) : t("choose")}
          data-current-point={state}
          aria-busy={busyId ? true : undefined}
        >
          {body}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center" className="w-[340px] p-2" data-point-menu>
        {/* Быстрый поиск (владелец, 2026-11-11): по названию и адресу. Клавиши
            в поле не уходят меню — иначе оно перехватывает ввод для перехода по пунктам. */}
        {options.length > POINT_SEARCH_MIN ? (
          <PointSearchField
            value={query}
            onChange={setQuery}
            placeholder={t("search")}
            className="mb-1.5"
            onKeyDown={(event) => {
              if (event.key !== "Escape") event.stopPropagation();
            }}
          />
        ) : null}
        {options.length === 0 ? (
          <div className="px-3 py-4 text-center text-[13.5px] text-[#6f7282]" data-point-empty>
            {t("empty")}
          </div>
        ) : (
          // Много объектов — список ограничен по высоте, справа полоса прокрутки;
          // «Создать объект» и «Настроить объекты» под ним всегда на виду.
          <ScrollList maxHeightClassName="max-h-[min(360px,55vh)]">
            {shownOptions.length === 0 ? (
              <div className="px-3 py-4 text-center text-[13.5px] text-[#6f7282]">{t("nothingFound")}</div>
            ) : null}
            {shownOptions.map((option) => {
              const isActive = option.id === activeId;
              return (
                <DropdownMenuItem
                  key={option.id}
                  onSelect={() => choose(option)}
                  className={cn("group items-start gap-2.5 px-2.5 py-2", isActive && MENU_ITEM_ACTIVE_CLASS)}
                  data-point-option={option.id}
                  data-active-option={isActive ? "" : undefined}
                >
                  <BuildingIcon
                    icon={option.icon}
                    className={cn("mt-0.5 size-4", isActive ? "text-[#3848c7]" : "text-[#9b9fb3]")}
                    uploadClassName="size-5"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{titleOf(option)}</span>
                    {option.address ? (
                      <span className="block truncate text-[12px] font-normal text-[#9b9fb3]">{option.address}</span>
                    ) : null}
                  </span>
                  {canPin ? (
                    <PinButton
                      pinned={pins.isPinned(option.id)}
                      onToggle={() => void pins.toggle(option.id)}
                      name={titleOf(option)}
                      className="-my-1"
                    />
                  ) : null}
                  {isActive ? <Check className="mt-0.5 size-4 text-[#3848c7]" /> : null}
                </DropdownMenuItem>
              );
            })}
          </ScrollList>
        )}
        {canManage ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href={NEW_POINT_HREF} data-point-create>
                <Plus className="size-4" />
                {t("create")}
              </Link>
            </DropdownMenuItem>
            {options.length > 0 && manageHref ? (
              <DropdownMenuItem asChild>
                <Link href={manageHref}>
                  <Settings2 className="size-4" />
                  {t("manage")}
                </Link>
              </DropdownMenuItem>
            ) : null}
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const INLINE_BASE =
  "inline-flex h-11 min-w-0 max-w-[min(40vw,420px)] items-center gap-2 rounded-2xl px-3 text-left max-sm:max-w-[min(52vw,240px)] max-sm:px-2";
/** Полоса на телефоне: во всю ширину, название слева, стрелка справа. */
const BAR_BASE =
  "flex h-12 w-full min-w-0 items-center gap-2.5 rounded-2xl border border-[#e3e6f3] bg-[#fafbff] px-3 text-left [&>svg:last-child]:ml-auto";

/** Иконка объекта, тихая подпись «Объект» и название — две строки. */
function PointLabel({
  caption,
  title,
  icon,
}: {
  caption: string;
  title: string;
  /** Значок объекта из настроек; нет — магазин. */
  icon?: string;
}) {
  return (
    <>
      <BuildingIcon icon={icon} className="size-[18px] text-[#5566f6]" uploadClassName="size-6" />
      <span className="flex min-w-0 flex-col leading-tight">
        <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-[#9b9fb3]" data-point-caption>
          {caption}
        </span>
        <span className="truncate text-[15px] font-semibold text-[#0b1024] max-sm:text-[14px]" data-point-title>
          {title}
        </span>
      </span>
    </>
  );
}

/** «Выберите объект» — одной строкой, без подписи «Организация» (владелец, 2026-11-23). */
function ChooseLabel({ text }: { text: string }) {
  return (
    <>
      <Store className="size-[18px] shrink-0 text-[#9b9fb3]" aria-hidden />
      <span className="truncate text-[15px] font-medium text-[#3c4053] max-sm:text-[14px]" data-point-title data-point-choose>
        {text}
      </span>
    </>
  );
}
