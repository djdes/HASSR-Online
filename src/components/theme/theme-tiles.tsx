"use client";

import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Clock } from "lucide-react";
import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";
import { useSiteTheme, type ThemeMode } from "./site-theme";
import {
  THEME_PREVIEW_PALETTES,
  THEME_TILES,
  chooseThemeTile,
  isThemeMode,
  selectedThemeTile,
  themeTileForKey,
  type ThemePreviewPalette,
  type ThemeTile,
} from "./theme-tiles-model";

/**
 * «Тема» — три карточки с мини-превью, как блок Appearance в приложении
 * Claude: «Светлая», «Тёмная», «Как на устройстве». Нажал — тема
 * сменилась сразу, без перехода в настройки.
 *
 * Живёт прямо в меню профиля: на телефоне — в листе снизу (`ThemeTiles`),
 * на компьютере — в выпадающем меню (`ThemeTilesMenu`, пункты Radix, чтобы
 * до карточек доходили стрелки клавиатуры). Состояние и сохранение — те же,
 * что и раньше: `useSiteTheme().setMode` (localStorage + `/api/me/theme`).
 *
 * Сами карточки (`ThemeTileGroup`) от провайдера не зависят — значение и
 * `onChange` приходят снаружи. Так их же показывает профиль мини-приложения
 * (`/mini/me`), где тему ведёт `useMiniTheme()`, а не `useSiteTheme()`.
 *
 * Цвета рамки и подписи — токены темы (`--app-*`), а не хексы: меню
 * порталится в <body>, вне `.app-shell`, и хекс-классы там перекрашиваются
 * тёмной темой хуже (индиго-текст на тёмном становился тусклым).
 */

/**
 * Логотип и цвет организации настраиваются в «Настройки → Организация»,
 * блок «Брендинг» — на странице «Внешний вид» их нет.
 */
export const BRANDING_SETTINGS_HREF = "/settings/organization#branding";

/**
 * Размер карточек:
 *  - `comfortable` — лист профиля на телефоне и страница настроек;
 *  - `compact` — выпадающее меню на компьютере;
 *  - `touch` — мини-приложение: подписи и подсказка крупнее (шкала
 *    QR-страниц), ряд из трёх держится и на узком телефоне.
 */
export type ThemeTileSize = "comfortable" | "compact" | "touch";

/** Откуда карточки берут тему: `useSiteTheme()` на сайте, `useMiniTheme()` в мини-приложении. */
export type ThemeTileSource = {
  mode: ThemeMode;
  autoBySchedule: boolean;
  setMode: (mode: ThemeMode) => void;
  setAutoBySchedule: (on: boolean) => void;
};

/** Подсказка под карточками про смену темы по времени суток. */
export type ThemeTileAutoNote = {
  autoBySchedule: boolean;
  /** Смену выключило нажатие на карточку — предлагаем вернуть. */
  autoTurnedOff: boolean;
  onRestore: () => void;
};

/**
 * Выбор карточки. Если включена смена по времени суток — нажатие её
 * выключает (иначе выбор не имел бы видимого эффекта), и меню говорит
 * об этом: до нажатия — подсказкой, после — строкой «выключена» с
 * возможностью вернуть.
 */
export function useThemeTileChoice(source: ThemeTileSource) {
  const { mode, autoBySchedule, setMode, setAutoBySchedule } = source;
  // Живёт, пока открыто меню: закрыли и открыли снова — строки уже нет.
  const [autoTurnedOff, setAutoTurnedOff] = useState(false);

  function choose(next: ThemeMode) {
    const choice = chooseThemeTile({ autoBySchedule }, next);
    if (choice.turnedOffAuto) {
      setAutoBySchedule(false);
      setAutoTurnedOff(true);
    }
    setMode(choice.mode);
  }

  function restoreAuto() {
    setAutoTurnedOff(false);
    setAutoBySchedule(true);
  }

  const note: ThemeTileAutoNote = {
    autoBySchedule,
    autoTurnedOff,
    onRestore: restoreAuto,
  };

  return {
    selected: selectedThemeTile({ mode, autoBySchedule }),
    autoBySchedule,
    autoTurnedOff,
    choose,
    restoreAuto,
    note,
  };
}

/**
 * Карточки для листа снизу и страниц: обычная группа переключателей.
 * Стрелки выбирают соседнюю карточку, как у родных radio.
 */
export function ThemeTiles({
  size = "comfortable",
  autoNote = true,
  className,
}: {
  size?: ThemeTileSize;
  /** Подсказка про смену по времени суток. На странице настроек её
      заменяет сама галочка «Менять по времени суток» под карточками. */
  autoNote?: boolean;
  className?: string;
}) {
  const choice = useThemeTileChoice(useSiteTheme());
  return (
    <ThemeTileGroup
      value={choice.selected}
      onChange={choice.choose}
      note={autoNote ? choice.note : null}
      size={size}
      className={className}
    />
  );
}

/**
 * Карточки без провайдера: выбранное значение и `onChange` — снаружи.
 * Группа переключателей (`radiogroup`): Tab заходит на выбранную карточку,
 * стрелки выбирают соседнюю, Home / End — крайние.
 */
export function ThemeTileGroup({
  value,
  onChange,
  note = null,
  size = "comfortable",
  className,
  tileClassName,
}: {
  /** Выбранная карточка; `null` — ни одна (тема меняется по времени суток). */
  value: ThemeMode | null;
  onChange: (mode: ThemeMode) => void;
  /** Подсказка про смену по времени суток; `null` — без неё. */
  note?: ThemeTileAutoNote | null;
  size?: ThemeTileSize;
  className?: string;
  /** Дополнительные классы кнопки-карточки (в мини-приложении — отклик нажатия). */
  tileClassName?: string;
}) {
  const buttons = useRef<Partial<Record<ThemeMode, HTMLButtonElement | null>>>({});
  // В группу переключателей Tab заходит один раз — на выбранную карточку.
  const tabStop = value ?? THEME_TILES[0].mode;

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, current: ThemeMode) {
    const next = themeTileForKey(current, event.key);
    if (!next) return;
    event.preventDefault();
    onChange(next);
    buttons.current[next]?.focus();
  }

  return (
    <div className={className} data-testid="theme-tiles">
      <div
        role="radiogroup"
        aria-label="Тема"
        className={cn(
          "grid grid-cols-3",
          size === "compact" ? "gap-2" : "gap-2.5",
          // Правило кабинета для телефонов (globals.css) складывает
          // `.grid-cols-3` внутри `main` в две колонки. Мини-приложение —
          // тоже `.app-shell`, а карточкам нужен ряд из трёх.
          size === "touch" && "no-mobile-shrink"
        )}
      >
        {THEME_TILES.map((tile) => {
          const checked = value === tile.mode;
          return (
            <button
              key={tile.mode}
              ref={(el) => {
                buttons.current[tile.mode] = el;
              }}
              type="button"
              role="radio"
              aria-checked={checked}
              tabIndex={tile.mode === tabStop ? 0 : -1}
              data-state={checked ? "checked" : "unchecked"}
              data-theme-tile={tile.mode}
              data-testid={`theme-tile-${tile.mode}`}
              onClick={() => onChange(tile.mode)}
              onKeyDown={(event) => onKeyDown(event, tile.mode)}
              className={cn(
                "group/tile flex min-w-0 cursor-pointer flex-col gap-2 rounded-2xl text-left outline-none",
                tileClassName
              )}
            >
              <ThemeTileFace tile={tile} checked={checked} size={size} />
            </button>
          );
        })}
      </div>
      {note ? (
        <div aria-live="polite">
          <AutoScheduleNote
            autoBySchedule={note.autoBySchedule}
            autoTurnedOff={note.autoTurnedOff}
            size={size}
            restore={
              <button
                type="button"
                data-testid="theme-auto-restore"
                onClick={note.onRestore}
                className={RESTORE_CLASS}
              >
                Включить снова
              </button>
            }
          />
        </div>
      ) : null}
    </div>
  );
}

/**
 * Карточки внутри выпадающего меню Radix. Пункты — `RadioItem`, поэтому
 * стрелки вверх-вниз доходят до них, как до остальных пунктов меню, а
 * влево-вправо ходят по ряду. Меню после выбора не закрывается: человек
 * видит, как перекрасился кабинет, и может сразу выбрать другую.
 */
export function ThemeTilesMenu({ className }: { className?: string }) {
  const { selected, autoBySchedule, autoTurnedOff, choose, restoreAuto } =
    useThemeTileChoice(useSiteTheme());

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>, current: ThemeMode) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    const next = themeTileForKey(current, event.key);
    const target = event.currentTarget.parentElement?.querySelector<HTMLElement>(
      `[data-theme-tile="${next}"]`
    );
    if (!target) return;
    event.preventDefault();
    target.focus();
  }

  return (
    <div className={className} data-testid="theme-tiles">
      <DropdownMenuPrimitive.RadioGroup
        value={selected ?? ""}
        onValueChange={(value) => {
          if (isThemeMode(value)) choose(value);
        }}
        aria-label="Тема"
        className="grid grid-cols-3 gap-1"
      >
        {THEME_TILES.map((tile) => (
          <DropdownMenuPrimitive.RadioItem
            key={tile.mode}
            value={tile.mode}
            textValue={tile.label}
            data-theme-tile={tile.mode}
            data-testid={`theme-tile-${tile.mode}`}
            onSelect={(event) => event.preventDefault()}
            onKeyDown={(event) => onKeyDown(event, tile.mode)}
            className="group/tile flex min-w-0 cursor-pointer select-none flex-col gap-1.5 rounded-xl p-1 outline-none transition-colors duration-150 data-[highlighted]:bg-[var(--app-tint-indigo)]"
          >
            <ThemeTileFace tile={tile} checked={selected === tile.mode} size="compact" />
          </DropdownMenuPrimitive.RadioItem>
        ))}
      </DropdownMenuPrimitive.RadioGroup>
      <div aria-live="polite" className="px-1">
        <AutoScheduleNote
          autoBySchedule={autoBySchedule}
          autoTurnedOff={autoTurnedOff}
          restore={
            <DropdownMenuPrimitive.Item
              data-testid="theme-auto-restore"
              onSelect={(event) => {
                event.preventDefault();
                restoreAuto();
              }}
              className={cn(
                RESTORE_CLASS,
                "cursor-pointer rounded-md px-1 outline-none data-[highlighted]:bg-[var(--app-tint-indigo)]"
              )}
            >
              Включить снова
            </DropdownMenuPrimitive.Item>
          }
        />
      </div>
    </div>
  );
}

const RESTORE_CLASS =
  "inline-flex font-semibold text-[var(--app-indigo-deep)] underline-offset-2 hover:underline focus-visible:underline focus-visible:outline-none";

function AutoScheduleNote({
  autoBySchedule,
  autoTurnedOff,
  restore,
  size = "comfortable",
}: {
  autoBySchedule: boolean;
  autoTurnedOff: boolean;
  restore: ReactNode;
  size?: ThemeTileSize;
}) {
  if (!autoBySchedule && !autoTurnedOff) return null;
  return (
    <div
      data-testid="theme-auto-note"
      data-state={autoBySchedule ? "on" : "turned-off"}
      className={cn(
        "mt-2 flex items-start gap-2 rounded-xl bg-[var(--app-tint-indigo)] px-2.5 py-2 leading-snug text-[var(--app-text-secondary)]",
        size === "touch" ? "text-[14px]" : "text-[12px]"
      )}
    >
      <Clock className="mt-px size-3.5 shrink-0 text-[var(--app-indigo-deep)]" aria-hidden />
      {autoBySchedule ? (
        <span>
          Сейчас тема меняется по времени суток. Выберите вариант — смена по
          времени выключится.
        </span>
      ) : (
        <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span>Смена по времени суток выключена.</span>
          {restore}
        </span>
      )}
    </div>
  );
}

/**
 * Кегль подписи. В мини-приложении — 15px: крупнее не помещается «устройстве»
 * в карточку на телефоне шириной 360px (ряд из трёх в карточке профиля).
 */
const TILE_LABEL_SIZE: Record<ThemeTileSize, string> = {
  comfortable: "text-[14px]",
  compact: "text-[12px]",
  // Телефон уже 360px: слово переносится внутри, а не вылезает за карточку.
  touch: "text-[15px] break-words",
};

/** Превью и подпись карточки — общие для листа, выпадающего меню и мини-приложения. */
function ThemeTileFace({
  tile,
  checked,
  size,
}: {
  tile: ThemeTile;
  checked: boolean;
  size: ThemeTileSize;
}) {
  return (
    <>
      <span
        className={cn(
          "relative block aspect-[10/7] w-full overflow-hidden border-2 transition-[border-color,box-shadow] duration-150 motion-reduce:transition-none",
          size === "compact" ? "rounded-xl" : "rounded-2xl",
          checked
            ? "border-[var(--app-indigo)] shadow-[0_0_0_3px_rgba(85,102,246,0.18)]"
            : "border-[var(--app-border-strong)] group-hover/tile:border-[#5566f6]/50 group-focus-visible/tile:border-[#5566f6]/70 group-data-[highlighted]/tile:border-[#5566f6]/50",
          "group-focus-visible/tile:ring-4 group-focus-visible/tile:ring-[#5566f6]/20"
        )}
      >
        <ThemeTilePreview mode={tile.mode} />
      </span>
      <span
        className={cn(
          "block text-center leading-tight",
          TILE_LABEL_SIZE[size],
          checked
            ? "font-semibold text-[var(--app-indigo-deep)]"
            : "font-medium text-[var(--app-text-secondary)]"
        )}
      >
        {tile.label}
      </span>
    </>
  );
}

/** «Как на устройстве» — карточка, разрезанная по диагонали: слева
    сверху светлая, справа снизу тёмная. */
const SPLIT_CLIP_PATH = "polygon(100% 0, 100% 100%, 0 100%)";

function ThemeTilePreview({ mode }: { mode: ThemeMode }) {
  if (mode === "system") {
    return (
      <>
        <PreviewScene palette={THEME_PREVIEW_PALETTES.light} />
        <span className="absolute inset-0" style={{ clipPath: SPLIT_CLIP_PATH }}>
          <PreviewScene palette={THEME_PREVIEW_PALETTES.dark} />
        </span>
      </>
    );
  }
  return <PreviewScene palette={THEME_PREVIEW_PALETTES[mode]} />;
}

/**
 * Мини-экран в стиле WeSetup: фон, на нём карточка с индиго-точкой и
 * двумя полосками. Цвета — атрибутами SVG: их не трогает слой тёмной
 * темы, и «Светлая» остаётся светлой в тёмном кабинете.
 */
function PreviewScene({ palette }: { palette: ThemePreviewPalette }) {
  return (
    <svg
      viewBox="0 0 120 84"
      aria-hidden
      focusable="false"
      className="absolute inset-0 block size-full"
    >
      <rect width="120" height="84" fill={palette.page} />
      <rect
        x="14"
        y="15"
        width="92"
        height="54"
        rx="9"
        fill={palette.card}
        stroke={palette.cardBorder}
        strokeWidth="1"
        vectorEffect="non-scaling-stroke"
      />
      <circle cx="30" cy="36" r="5.5" fill={palette.dot} />
      <rect x="42" y="32.5" width="50" height="7" rx="3.5" fill={palette.stripe} />
      <rect x="42" y="46" width="32" height="7" rx="3.5" fill={palette.stripeSoft} />
    </svg>
  );
}
