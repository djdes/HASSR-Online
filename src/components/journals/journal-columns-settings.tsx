"use client";

import { useLocale, useTranslations } from "next-intl";
import { readLocalizedApiError } from "@/lib/localized-api-error";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Check, Info, Lock, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { TableContextMenu, type TableContextMenuItem } from "@/components/journals/table-context-menu";
import { JournalColumnTemplatesBar } from "@/components/journals/journal-column-templates-bar";
import {
  JOURNAL_COLUMN_LABEL_MAX,
  JOURNAL_CUSTOM_COLUMNS_MAX,
  JOURNAL_FIELD_TYPES,
  JOURNAL_RATING_MAX_DEFAULT,
  JOURNAL_RATING_MAX_MAX,
  JOURNAL_RATING_MAX_MIN,
  JOURNAL_SELECT_OPTIONS_MAX,
  addCustomColumn,
  columnsConfigFromResolved,
  moveColumn,
  newCustomColumnKey,
  removeCustomColumn,
  resolveColumns,
  setColumnMustFill,
  updateCustomColumn,
  type JournalColumnsConfig,
  type JournalFieldType,
  type ResolvedJournalColumn,
} from "@/lib/journal-columns";
import { LONG_PRESS_MS, isLongPressCancelled, type PressPoint } from "@/lib/long-press";
import { cn } from "@/lib/utils";

/**
 * Колонки таблицы журнала: одна секция для «Настроек журнала» обоих
 * бракеражей, меню заголовка таблицы (ПКМ / долгое нажатие) и диалог
 * «Применить ко всем документам журнала».
 *
 * Хранение и правила — `src/lib/journal-columns.ts`. Здесь только UI:
 * скрытие колонки данных не удаляет; скрыть можно любую колонку, кроме
 * последней видимой; порядок — стрелками.
 */

export type ColumnsApplyScope = "new-only" | "active-any" | "all";

/** Новый набор колонок: скрыть/показать одну колонку. */
export function toggleColumnHidden(columns: JournalColumnsConfig, key: string, hidden: boolean): JournalColumnsConfig {
  const set = new Set(columns.hidden);
  if (hidden) set.add(key);
  else set.delete(key);
  return { ...columns, hidden: [...set] };
}

/** Новый набор колонок: переименовать одну колонку ("" — стандартное название). */
export function renameColumn(columns: JournalColumnsConfig, key: string, label: string): JournalColumnsConfig {
  const labels = { ...columns.labels };
  const value = label.replace(/\s+/g, " ").trim().slice(0, JOURNAL_COLUMN_LABEL_MAX);
  if (value) labels[key] = value;
  else delete labels[key];
  return { ...columns, labels };
}

function ColumnRow({
  column,
  display = column,
  onToggle,
  onRename,
  onMustFill,
  onTypeChange,
  onRemove,
  onMove,
  lastVisible,
  disabled,
}: {
  column: ResolvedJournalColumn;
  display?: ResolvedJournalColumn;
  /** Сдвиг в порядке показа; `null` у крайней колонки. */
  onMove?: { up: (() => void) | null; down: (() => void) | null };
  /** Это последняя видимая колонка — скрыть нельзя, таблица не может быть пустой. */
  lastVisible?: boolean;
  onToggle: (hidden: boolean) => void;
  onRename: (label: string) => void;
  /** Отметка «обязательно заполнять». */
  onMustFill?: (mustFill: boolean) => void;
  /** Настройки типа своей колонки. */
  onTypeChange?: (patch: { type?: JournalFieldType; options?: string[]; ratingMax?: number; unit?: string }) => void;
  onRemove?: () => void;
  disabled?: boolean;
}) {
  const t = useTranslations("journalControls");
  const [editing, setEditing] = useState(false);
  const originalDraft = column.label === column.defaultLabel && !column.custom ? "" : column.label;
  const [draft, setDraft] = useState(originalDraft);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const commit = () => {
    setEditing(false);
    const value = draft.trim();
    onRename(value === column.defaultLabel ? "" : value);
  };

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-2xl border px-4 py-3 transition-colors duration-150",
        column.hidden ? "border-[#ececf4] bg-white" : "border-[#ececf4] bg-[#fafbff] hover:bg-[#f5f6ff]"
      )}
    >
      <Checkbox
        checked={!column.hidden}
        disabled={disabled || Boolean(column.unavailable) || (lastVisible === true && !column.hidden)}
        onCheckedChange={(value) => onToggle(value !== true)}
        aria-label={column.hidden ? t("columnSettings.show", { label: display.label }) : t("columnSettings.hide", { label: display.label })}
      />
      <div className="min-w-0 flex-1">
        {editing ? (
          <input
            ref={inputRef}
            value={draft}
            placeholder={display.defaultLabel}
            maxLength={JOURNAL_COLUMN_LABEL_MAX}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commit();
              } else if (event.key === "Escape") {
                event.preventDefault();
                setDraft(originalDraft);
                setEditing(false);
              }
            }}
            className="h-9 w-full rounded-xl border border-[#dcdfed] bg-white px-3 text-[14px] text-[#0b1024] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
            aria-label={t("columnSettings.name")}
          />
        ) : (
          <div className={cn("text-[14px] leading-snug", column.hidden ? "text-[#9b9fb3]" : "text-[#0b1024]")}>
            {display.label}
          </div>
        )}
        {column.unavailable ? (
          <div className="mt-0.5 inline-flex items-center gap-1 text-[12px] text-[#9b9fb3]">
            <Lock className="size-3" />
            {column.unavailable}
          </div>
        ) : lastVisible && !column.hidden ? (
          <div className="mt-0.5 text-[12px] text-[#9b9fb3]">{t("columnSettings.lastVisible")}</div>
        ) : column.custom ? (
          <div className="mt-0.5 text-[12px] text-[#9b9fb3]">
            {t("columnSettings.customType", { type: t(`columnSettings.types.${column.custom.type}`) })}
          </div>
        ) : column.label !== column.defaultLabel && !editing ? (
          <div className="mt-0.5 text-[12px] text-[#9b9fb3]">{t("columnSettings.default", { label: display.defaultLabel })}</div>
        ) : null}
        {!disabled && onMustFill && !column.hidden ? (
          <label className="mt-1.5 flex cursor-pointer items-center gap-2 text-[12.5px] text-[#6f7282]">
            <Checkbox
              checked={column.mustFill}
              onCheckedChange={(value) => onMustFill(value === true)}
              aria-label={t("columnSettings.requiredAria", { label: display.label })}
            />
            {t("columnSettings.required")}</label>
        ) : null}
        {!disabled && column.custom && onTypeChange && !column.hidden ? (
          <CustomColumnEditor column={column} onChange={onTypeChange} />
        ) : null}
      </div>
      {!disabled ? (
        <div className="flex shrink-0 items-center gap-1">
          {onMove ? (
            <div className="flex flex-col">
              <button
                type="button"
                onClick={onMove.up ?? undefined}
                disabled={!onMove.up}
                className="rounded-lg p-1 text-[#6f7282] transition-colors duration-150 hover:bg-white hover:text-[#3848c7] disabled:opacity-30 disabled:hover:bg-transparent"
                title={t("columnSettings.upHint")}
                aria-label={t("columnSettings.left", { label: display.label })}
              >
                <ArrowUp className="size-3.5" />
              </button>
              <button
                type="button"
                onClick={onMove.down ?? undefined}
                disabled={!onMove.down}
                className="rounded-lg p-1 text-[#6f7282] transition-colors duration-150 hover:bg-white hover:text-[#3848c7] disabled:opacity-30 disabled:hover:bg-transparent"
                title={t("columnSettings.downHint")}
                aria-label={t("columnSettings.right", { label: display.label })}
              >
                <ArrowDown className="size-3.5" />
              </button>
            </div>
          ) : null}
          {column.label !== column.defaultLabel && !editing ? (
            <button
              type="button"
              onClick={() => onRename("")}
              className="rounded-xl p-2 text-[#9b9fb3] transition-colors duration-150 hover:bg-white hover:text-[#3848c7]"
              title={t("columnSettings.resetName")}
              aria-label={t("columnSettings.resetName")}
            >
              <RotateCcw className="size-4" />
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => {
              if (editing) commit();
              else { setDraft(originalDraft); setEditing(true); }
            }}
            className="rounded-xl p-2 text-[#6f7282] transition-colors duration-150 hover:bg-white hover:text-[#3848c7]"
            title={editing ? t("columnSettings.done") : t("columnSettings.renameColumn")}
            aria-label={editing ? t("columnSettings.done") : t("columnSettings.renameColumn")}
          >
            {editing ? <Check className="size-4" /> : <Pencil className="size-4" />}
          </button>
          {onRemove ? (
            <button
              type="button"
              onClick={onRemove}
              className="rounded-xl p-2 text-[#a13a32] transition-colors duration-150 hover:bg-[#fff4f2]"
              title={t("columnSettings.deleteColumn")}
              aria-label={t("columnSettings.deleteColumn")}
            >
              <Trash2 className="size-4" />
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Настройки типа своей колонки: тип, значения списка, верхний балл,
 * единица измерения. Значения списка правятся построчно — так же, как
 * списки изделий в журналах.
 */
function CustomColumnEditor({
  column,
  onChange,
}: {
  column: ResolvedJournalColumn;
  onChange: (patch: { type?: JournalFieldType; options?: string[]; ratingMax?: number; unit?: string }) => void;
}) {
  const t = useTranslations("journalControls");
  const custom = column.custom;
  const [optionDraft, setOptionDraft] = useState("");
  if (!custom) return null;
  const options = custom.options ?? [];

  return (
    <div className="mt-2 space-y-2 rounded-xl bg-white p-2.5">
      <label className="flex items-center gap-2 text-[12.5px] text-[#6f7282]">
        {t("columnSettings.fieldType")}<select
          value={custom.type}
          onChange={(event) => onChange({ type: event.target.value as JournalFieldType })}
          className="h-8 flex-1 rounded-lg border border-[#dcdfed] bg-white px-2 text-[13px] text-[#0b1024] focus:border-[#5566f6] focus:outline-none"
        >
          {JOURNAL_FIELD_TYPES.map((type) => (
            <option key={type} value={type}>
              {t(`columnSettings.types.${type}`)}
            </option>
          ))}
        </select>
      </label>

      {custom.type === "number" ? (
        <label className="flex items-center gap-2 text-[12.5px] text-[#6f7282]">
          {t("columnSettings.unit")}<input
            value={custom.unit ?? ""}
            onChange={(event) => onChange({ unit: event.target.value })}
            placeholder={t("columnSettings.unitExample")}
            maxLength={12}
            className="h-8 w-28 rounded-lg border border-[#dcdfed] bg-white px-2 text-[13px] text-[#0b1024] focus:border-[#5566f6] focus:outline-none"
          />
        </label>
      ) : null}

      {custom.type === "rating" ? (
        <label className="flex items-center gap-2 text-[12.5px] text-[#6f7282]">
          {t("columnSettings.maximum")}<input
            type="number"
            min={JOURNAL_RATING_MAX_MIN}
            max={JOURNAL_RATING_MAX_MAX}
            value={custom.ratingMax ?? JOURNAL_RATING_MAX_DEFAULT}
            onChange={(event) => onChange({ ratingMax: Number(event.target.value) || JOURNAL_RATING_MAX_DEFAULT })}
            className="h-8 w-20 rounded-lg border border-[#dcdfed] bg-white px-2 text-[13px] text-[#0b1024] focus:border-[#5566f6] focus:outline-none"
          />
        </label>
      ) : null}

      {custom.type === "select" ? (
        <div className="space-y-1.5">
          <div className="text-[12.5px] text-[#6f7282]">{t("columnSettings.options")}</div>
          {options.map((option, index) => (
            <div key={`${option}-${index}`} className="flex items-center gap-1.5">
              <input
                value={option}
                onChange={(event) => {
                  const next = [...options];
                  next[index] = event.target.value;
                  onChange({ options: next });
                }}
                maxLength={JOURNAL_COLUMN_LABEL_MAX}
                className="h-8 flex-1 rounded-lg border border-[#dcdfed] bg-white px-2 text-[13px] text-[#0b1024] focus:border-[#5566f6] focus:outline-none"
              />
              <button
                type="button"
                onClick={() => onChange({ options: options.filter((_, i) => i !== index) })}
                className="rounded-lg p-1.5 text-[#a13a32] hover:bg-[#fff4f2]"
                aria-label={t("columnSettings.deleteOption", { value: option })}
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
          {options.length < JOURNAL_SELECT_OPTIONS_MAX ? (
            <div className="flex items-center gap-1.5">
              <input
                value={optionDraft}
                onChange={(event) => setOptionDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return;
                  event.preventDefault();
                  const value = optionDraft.trim();
                  if (!value) return;
                  onChange({ options: [...options, value] });
                  setOptionDraft("");
                }}
                placeholder={t("columnSettings.optionPlaceholder")}
                maxLength={JOURNAL_COLUMN_LABEL_MAX}
                className="h-8 flex-1 rounded-lg border border-dashed border-[#dcdfed] bg-white px-2 text-[13px] text-[#0b1024] focus:border-[#5566f6] focus:outline-none"
              />
              <button
                type="button"
                onClick={() => {
                  const value = optionDraft.trim();
                  if (!value) return;
                  onChange({ options: [...options, value] });
                  setOptionDraft("");
                }}
                className="rounded-lg p-1.5 text-[#3848c7] hover:bg-[#f5f6ff]"
                aria-label={t("columnSettings.addOption")}
              >
                <Plus className="size-3.5" />
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Секция «Колонки таблицы» для модалки «Настройки журнала». Работает с
 * черновиком конфига: изменения уходят на сервер кнопкой «Сохранить»
 * модалки. «Применить ко всем» — сразу, через подтверждение.
 */
export function JournalColumnsSettings({
  code,
  config,
  onChange,
  canApplyToAll,
  onApplyToAll,
  presentColumn,
}: {
  code: string;
  config: Record<string, unknown>;
  onChange: (columns: JournalColumnsConfig) => void;
  /** Руководитель может сделать набор общим для журнала. */
  canApplyToAll?: boolean;
  /**
   * Секция живёт внутри модалки Radix: подтверждение поверх неё не получает
   * кликов. Страница закрывает модалку и открывает подтверждение сама
   * (`useColumnHeaderMenu().openApplyToAll`) с черновиком набора.
   */
  onApplyToAll?: (columns: JournalColumnsConfig) => void;
  /** Display metadata must never replace the canonical columns used by mutations. */
  presentColumn?: (column: ResolvedJournalColumn) => ResolvedJournalColumn;
}) {
  const t = useTranslations("journalControls");
  const [applyOpen, setApplyOpen] = useState(false);
  const columns = useMemo(() => resolveColumns(code, config), [code, config]);
  const current = useMemo(() => columnsConfigFromResolved(columns), [columns]);
  const visibleCount = columns.filter((column) => !column.hidden).length;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">{t("columnSettings.title")}</div>
        {canApplyToAll ? (
          <button
            type="button"
            onClick={() => (onApplyToAll ? onApplyToAll(current) : setApplyOpen(true))}
            className="text-[13px] font-medium text-[#3848c7] underline-offset-2 transition-colors duration-150 hover:text-[#5566f6] hover:underline"
          >
            {t("columnSettings.applyAll")}</button>
        ) : null}
      </div>
      <JournalColumnTemplatesBar
        code={code}
        config={config}
        current={current}
        onApply={onChange}
        canManage={canApplyToAll === true}
        presentColumn={presentColumn}
      />
      <p className="flex gap-1.5 text-[12.5px] leading-[1.45] text-[#6f7282]">
        <Info className="mt-0.5 size-3.5 shrink-0 text-[#5566f6]" />
        {t("columnSettings.description")}</p>
      <div className="space-y-2">
        {columns.map((column, index) => (
          <ColumnRow
            key={column.key}
            column={column}
            display={presentColumn?.(column)}
            lastVisible={visibleCount <= 1}
            onMove={{
              up: index > 0 ? () => onChange(moveColumn(current, columns, column.key, -1)) : null,
              down: index < columns.length - 1 ? () => onChange(moveColumn(current, columns, column.key, 1)) : null,
            }}
            onToggle={(hidden) => onChange(toggleColumnHidden(current, column.key, hidden))}
            onRename={(label) =>
              onChange(
                column.custom
                  ? updateCustomColumn(current, column.key, { label: label || column.custom.label })
                  : renameColumn(current, column.key, label)
              )
            }
            onMustFill={(mustFill) => onChange(setColumnMustFill(current, column.key, mustFill))}
            onTypeChange={
              column.custom ? (patch) => onChange(updateCustomColumn(current, column.key, patch)) : undefined
            }
            onRemove={column.custom ? () => onChange(removeCustomColumn(current, column.key)) : undefined}
          />
        ))}
      </div>
      {(current.custom ?? []).length < JOURNAL_CUSTOM_COLUMNS_MAX ? (
        <button
          type="button"
          onClick={() =>
            onChange(
              addCustomColumn(current, {
                key: newCustomColumnKey(),
                label: t("columnSettings.newColumnName", { number: (current.custom ?? []).length + 1 }),
                type: "text",
              })
            )
          }
          className="mt-1 inline-flex h-10 w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-[#dcdfed] text-[13.5px] font-medium text-[#3848c7] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
        >
          <Plus className="size-4" /> {t("columnSettings.addCustom")}</button>
      ) : null}
      <ApplyColumnsToAllDialog code={code} columns={current} open={applyOpen} onClose={() => setApplyOpen(false)} />
    </div>
  );
}

/** «Применить ко всем документам журнала»: объём, подтверждение, запрос, toast. */
export function ApplyColumnsToAllDialog({
  code,
  columns,
  open,
  onClose,
}: {
  code: string;
  columns: JournalColumnsConfig;
  open: boolean;
  onClose: () => void;
}) {
  const t = useTranslations("journalControls");
  const router = useRouter();
  const locale = useLocale();
  const [scope, setScope] = useState<ColumnsApplyScope>("active-any");
  const options: Array<{ value: ColumnsApplyScope; label: string; hint: string }> = [
    { value: "active-any", label: t("columnSettings.scopeActive"), hint: t("columnSettings.scopeActiveHint") },
    { value: "all", label: t("columnSettings.scopeAll"), hint: t("columnSettings.scopeAllHint") },
    { value: "new-only", label: t("columnSettings.scopeNew"), hint: t("columnSettings.scopeNewHint") },
  ];

  return (
    <ConfirmDialog
      open={open}
      onClose={onClose}
      variant="info"
      title={t("columnSettings.confirmTitle")}
      description={t("columnSettings.confirmDescription")}
      bullets={[
        { label: t("columnSettings.confirmShared"), tone: "info" },
        { label: t("columnSettings.confirmReset"), tone: "warn" },
        { label: t("columnSettings.confirmData") },
      ]}
      confirmLabel={t("columnSettings.apply")}
      onConfirm={async () => {
        const response = await fetch(`/api/settings/journal-columns/${code}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ columns, applyTo: scope }),
        });
        const errorResponse = response.clone();
        const data = await response.json().catch(() => null);
        if (!response.ok) {
          toast.error(await readLocalizedApiError(errorResponse, locale, t("columnSettings.failed")));
          return;
        }
        const updated = typeof data?.documentsUpdated === "number" ? data.documentsUpdated : 0;
        toast.success(
          scope === "new-only"
            ? t("columnSettings.savedNew")
            : t("columnSettings.updated", { count: updated })
        );
        onClose();
        router.refresh();
      }}
    >
      <div className="space-y-2">
        {options.map((option) => (
          <label
            key={option.value}
            className={cn(
              "flex cursor-pointer gap-3 rounded-2xl border px-4 py-3 transition-colors duration-150",
              scope === option.value ? "border-[#5566f6] bg-[#f5f6ff]" : "border-[#ececf4] bg-white hover:bg-[#fafbff]"
            )}
          >
            <input
              type="radio"
              name="columns-apply-scope"
              checked={scope === option.value}
              onChange={() => setScope(option.value)}
              className="mt-1 size-4 accent-[#5566f6]"
            />
            <span>
              <span className="block text-[14px] font-medium text-[#0b1024]">{option.label}</span>
              <span className="block text-[12.5px] text-[#6f7282]">{option.hint}</span>
            </span>
          </label>
        ))}
      </div>
    </ConfirmDialog>
  );
}

type HeaderMenuState = { x: number; y: number; column: ResolvedJournalColumn } | null;

/**
 * Меню заголовка колонки: ПКМ на компьютере, долгое нажатие на телефоне.
 * Возвращает обработчики для `<th>` и готовый элемент меню.
 */
export function useColumnHeaderMenu({
  code,
  config,
  enabled,
  canApplyToAll,
  onChange,
  presentColumn,
}: {
  presentColumn?: (column: ResolvedJournalColumn) => ResolvedJournalColumn;
  code: string;
  config: Record<string, unknown>;
  enabled: boolean;
  canApplyToAll?: boolean;
  /** Сохранить новый набор колонок документа (сразу, без модалки). */
  onChange: (columns: JournalColumnsConfig) => void | Promise<void>;
}) {
  const t = useTranslations("journalControls");
  const [menu, setMenu] = useState<HeaderMenuState>(null);
  const [renaming, setRenaming] = useState<ResolvedJournalColumn | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [applyOpen, setApplyOpen] = useState(false);
  // Набор из черновика модалки настроек; нет — сохранённый набор документа.
  const [applyColumns, setApplyColumns] = useState<JournalColumnsConfig | null>(null);
  const press = useRef<{ timer: ReturnType<typeof setTimeout>; start: PressPoint } | null>(null);
  const columns = useMemo(() => resolveColumns(code, config), [code, config]);
  const current = useMemo(() => columnsConfigFromResolved(columns), [columns]);

  const cancelPress = useCallback(() => {
    if (press.current) clearTimeout(press.current.timer);
    press.current = null;
  }, []);
  useEffect(() => cancelPress, [cancelPress]);

  const headerProps = useCallback(
    (key: string) => {
      const column = columns.find((item) => item.key === key);
      if (!enabled || !column) return {};
      return {
        onContextMenu: (event: React.MouseEvent) => {
          event.preventDefault();
          setMenu({ x: event.clientX, y: event.clientY, column });
        },
        onTouchStart: (event: React.TouchEvent) => {
          if (event.touches.length !== 1) return cancelPress();
          const touch = event.touches[0];
          const start = { x: touch.clientX, y: touch.clientY };
          cancelPress();
          press.current = {
            start,
            timer: setTimeout(() => {
              press.current = null;
              setMenu({ x: start.x, y: start.y, column });
            }, LONG_PRESS_MS),
          };
        },
        onTouchMove: (event: React.TouchEvent) => {
          const touch = event.touches[0];
          if (press.current && touch && isLongPressCancelled(press.current.start, { x: touch.clientX, y: touch.clientY })) {
            cancelPress();
          }
        },
        onTouchEnd: cancelPress,
        onTouchCancel: cancelPress,
        title: t("columnSettings.menuHint"),
      };
    },
    [cancelPress, columns, enabled, t]
  );

  const items: TableContextMenuItem[] = menu
    ? [
        {
          key: "rename",
          label: t("columnSettings.rename"),
          onSelect: () => {
            setRenaming(menu.column);
            setRenameDraft(menu.column.label === menu.column.defaultLabel && !menu.column.custom ? "" : menu.column.label);
          },
        },
        ...(columns.filter((column) => !column.hidden).length <= 1
          ? [{ key: "last", label: t("columnSettings.lastVisible"), onSelect: () => undefined }]
          : [
              {
                key: "hide",
                label: t("columnSettings.hideColumn"),
                onSelect: () => void onChange(toggleColumnHidden(current, menu.column.key, true)),
              },
            ]),
        ...(canApplyToAll
          ? [{ key: "apply", label: t("columnSettings.applyAll"), separatorBefore: true, onSelect: () => setApplyOpen(true) }]
          : []),
      ]
    : [];

  const element = (
    <>
      {menu ? (
        <TableContextMenu
          x={menu.x}
          y={menu.y}
          items={items}
          onClose={() => setMenu(null)}
          ariaLabel={t("columnSettings.columnTitle", { label: presentColumn?.(menu.column).label ?? menu.column.label })}
        />
      ) : null}
      <ConfirmDialog
        open={Boolean(renaming)}
        onClose={() => setRenaming(null)}
        variant="info"
        icon={Pencil}
        title={t("columnSettings.name")}
        description={t("columnSettings.renameHint")}
        confirmLabel={t("columnSettings.save")}
        onConfirm={async () => {
          if (!renaming) return;
          const value = renameDraft.trim();
          await onChange(renameColumn(current, renaming.key, value === renaming.defaultLabel ? "" : value));
          setRenaming(null);
        }}
      >
        <input
          value={renameDraft}
          maxLength={JOURNAL_COLUMN_LABEL_MAX}
          onChange={(event) => setRenameDraft(event.target.value)}
          placeholder={renaming ? presentColumn?.(renaming).defaultLabel ?? renaming.defaultLabel : undefined}
          className="h-12 w-full rounded-2xl border border-[#dcdfed] bg-white px-4 text-[15px] text-[#0b1024] placeholder:text-[#9b9fb3] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
          aria-label={t("columnSettings.name")}
          autoFocus
        />
      </ConfirmDialog>
      <ApplyColumnsToAllDialog
        code={code}
        columns={applyColumns ?? current}
        open={applyOpen}
        onClose={() => {
          setApplyOpen(false);
          setApplyColumns(null);
        }}
      />
    </>
  );

  const openApplyToAll = useCallback((draft?: JournalColumnsConfig) => {
    setApplyColumns(draft ?? null);
    setApplyOpen(true);
  }, []);

  return { headerProps, element, columns, openApplyToAll };
}
