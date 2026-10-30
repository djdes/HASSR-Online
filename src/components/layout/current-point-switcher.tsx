"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Building2, Check, ChevronDown, Loader2, Plus, Settings2, Store } from "lucide-react";
import { ORGANIZATION_VIEW_ID, type BuildingOption } from "@/lib/building-scope";
import { headerPointHidden, type HeaderPoint, type HeaderPointOption } from "@/lib/header-point";
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
import { LocationSwitcherList, useSwitchBuilding } from "@/components/layout/location-switcher";

const FOCUS = "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15";

/**
 * Центр шапки — текущая торговая точка (эскиз руководителя: слева логотип и
 * название компании, в центре «наименование торговой точки / текущего
 * объекта»). Над названием тихая подпись «Точка», чтобы было видно, где
 * компания, а где точка. Что показать, решает `resolveHeaderPoint`:
 *   • точек две и больше и журналы по точкам — переключатель в одно касание;
 *   • одна точка — её название (совпадает с компанией — адрес);
 *   • точек несколько, журналы общие — «Точки · Все: N», без переключения;
 *   • точек нет — руководителю «+ Добавить точку», остальным ничего.
 */
export function CurrentPointSwitcher({
  point,
  buildings,
  manageHref,
}: {
  point: HeaderPoint;
  /** Точки для переключения (`kind: "switch"`). */
  buildings: BuildingOption[];
  /** Активная точка; выбранный пункт берётся из `point.activeId`. */
  activeBuildingId?: string | null;
  manageHref: string | null;
}) {
  const t = useTranslations("navigation.shell.point");
  const narrow = useIsNarrowViewport();
  const [sheetOpen, setSheetOpen] = useState(false);
  const { switchTo, busyId } = useSwitchBuilding();
  // Главная, реквизиты, мастер-кабинет, офис, подписки, оформление и список
  // всех точек — про всю компанию: выбор точки там ничего не меняет.
  const hidden = headerPointHidden(usePathname());

  const titleOf = (option: HeaderPointOption) => {
    const title = option.title;
    return title.text === null ? t(title.source) : title.text;
  };
  const hintOf = (option: HeaderPointOption) =>
    option.address ? `${titleOf(option)}, ${option.address}` : titleOf(option);

  if (point.kind === "none" || hidden) return null;

  if (point.kind === "add") {
    // Сразу мастер «+ Добавить точку» (как в меню раздела), а не список точек.
    return (
      <Link
        href="/settings/buildings/new"
        title={t("addHint")}
        data-current-point="add"
        className={cn(
          "inline-flex h-10 min-w-0 items-center gap-1.5 rounded-2xl border border-dashed border-[#c9cee6] px-3.5 text-[14px] font-medium text-[#3848c7] transition-colors duration-150 hover:border-[#5566f6]/50 hover:bg-[#f5f6ff] max-sm:h-11 max-sm:px-3 max-sm:text-[13.5px]",
          FOCUS,
        )}
      >
        <Plus className="size-4 shrink-0" aria-hidden />
        <span className="truncate">{t("add")}</span>
      </Link>
    );
  }

  if (point.kind === "single" || point.kind === "all") {
    const caption = point.kind === "all" ? t("captionMany") : t("caption");
    const title = point.kind === "all" ? t("all", { count: String(point.count) }) : titleOf(point.point);
    const hint = point.kind === "all" ? point.options.map(titleOf).join(" · ") : hintOf(point.point);
    const office = point.kind === "single" && point.point.office === true;
    return (
      <span className={BASE} data-current-point={point.kind} title={hint}>
        <PointLabel caption={office ? t("captionOffice") : caption} title={title} office={office} />
      </span>
    );
  }

  // Переключатель: несколько точек, журналы ведутся по каждой.
  const options = point.options;
  const active = options.find((option) => option.id === point.activeId) ?? options[0];
  // В списке — те же подписи, что в шапке: точка с названием компании — по адресу.
  // «Вся организация» — не точка из базы: её «точка» собирается из пункта.
  const buildingOf = (option: HeaderPointOption): BuildingOption | null => {
    const building = buildings.find((item) => item.id === option.id);
    if (building) return { ...building, name: titleOf(option) };
    return option.id === ORGANIZATION_VIEW_ID ? { id: option.id, name: titleOf(option), address: null, kind: "office" } : null;
  };
  const listBuildings = options.map(buildingOf).filter((building): building is BuildingOption => building !== null);
  const trigger = cn(
    BASE,
    "transition-colors duration-150 hover:bg-[#f5f6ff] data-[state=open]:bg-[#f5f6ff]",
    FOCUS,
  );
  const body = (
    <>
      <PointLabel
        caption={active.office ? t("captionOffice") : t("caption")}
        title={titleOf(active)}
        office={active.office === true}
      />
      {busyId ? (
        <Loader2 className="size-4 shrink-0 animate-spin text-[#5566f6]" aria-hidden />
      ) : (
        <ChevronDown className="size-4 shrink-0 text-[#6f7282]" aria-hidden />
      )}
    </>
  );

  if (narrow) {
    return (
      <>
        <button
          type="button"
          onClick={() => setSheetOpen(true)}
          className={trigger}
          aria-label={`${t("switch")}: ${titleOf(active)}`}
          title={hintOf(active)}
          data-current-point="switch"
        >
          {body}
        </button>
        <BottomSheet open={sheetOpen} onClose={() => setSheetOpen(false)} title={t("list")}>
          <div
            onClick={(event) => {
              if ((event.target as HTMLElement).closest("button,a")) setSheetOpen(false);
            }}
          >
            <LocationSwitcherList buildings={listBuildings} activeBuildingId={active.id} />
            {manageHref ? (
              <Link
                href={manageHref}
                className="flex min-h-[48px] items-center gap-3 rounded-xl px-3 text-[14px] font-medium text-[#3848c7] transition-colors hover:bg-[#f5f6ff]"
              >
                <Settings2 className="size-5" />
                {t("manage")}
              </Link>
            ) : null}
          </div>
        </BottomSheet>
      </>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={trigger}
          aria-label={`${t("switch")}: ${titleOf(active)}`}
          title={hintOf(active)}
          data-current-point="switch"
        >
          {body}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center" className="w-[300px]">
        {/* Много точек — список ограничен по высоте, справа полоса прокрутки;
            «Управление точками» под ним всегда на виду. */}
        <ScrollList maxHeightClassName="max-h-[min(360px,55vh)]">
        {options.map((option, index) => {
          const isActive = option.id === active.id;
          const building = buildingOf(option);
          const Icon = option.office ? Building2 : Store;
          // Офис — первым, под ним черта: дальше торговые точки.
          const divider = option.office && index < options.length - 1;
          return (
            <Fragment key={option.id}>
            <DropdownMenuItem
              onSelect={() => {
                if (building) void switchTo(building, active.id);
              }}
              className={cn("items-start", isActive && MENU_ITEM_ACTIVE_CLASS)}
              data-point-option={option.id}
              data-active-option={isActive ? "" : undefined}
            >
              <Icon className={cn("mt-0.5 size-4", isActive ? "text-[#3848c7]" : "text-[#9b9fb3]")} />
              <span className="min-w-0 flex-1">
                <span className="block truncate">{titleOf(option)}</span>
                {option.address ? (
                  <span className="block truncate text-[12px] font-normal text-[#9b9fb3]">{option.address}</span>
                ) : null}
              </span>
              {isActive ? <Check className="mt-0.5 size-4 text-[#3848c7]" /> : null}
            </DropdownMenuItem>
            {divider ? <DropdownMenuSeparator /> : null}
            </Fragment>
          );
        })}
        </ScrollList>
        {manageHref ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href={manageHref}>
                <Settings2 className="size-4" />
                {t("manage")}
              </Link>
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const BASE =
  "inline-flex h-11 min-w-0 max-w-[min(40vw,420px)] items-center gap-2 rounded-2xl px-3 text-left max-sm:max-w-[min(52vw,240px)] max-sm:px-2";

/** Иконка точки, тихая подпись «Точка» («Организация» у офиса) и название — две строки. */
function PointLabel({ caption, title, office = false }: { caption: string; title: string; office?: boolean }) {
  const Icon = office ? Building2 : Store;
  return (
    <>
      <Icon className="size-[18px] shrink-0 text-[#5566f6]" aria-hidden />
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
