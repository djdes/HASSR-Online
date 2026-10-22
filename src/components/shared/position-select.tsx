"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import { Crown, Users } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MENU_ITEM_MUTED_CLASS } from "@/components/ui/menu-styles";
import { cn } from "@/lib/utils";
import { useTranslations } from "next-intl";
import { FloatingLabelField } from "@/components/journals/journal-dialog-field";
import {
  JOURNAL_DIALOG_FIELD_TRIGGER_CLASS,
  JOURNAL_DIALOG_HINT_CLASS,
} from "@/components/journals/journal-responsive";
import {
  getPositionLabelsGrouped,
  getUserPositionLabel,
  getUsersForRoleLabel,
  type UserLike,
} from "@/lib/user-roles";

type PositionSelectProps = {
  /// Whole users collection available for this journal / screen. The
  /// component reads `jobPosition` + `positionTitle` + `role` from each and
  /// groups the distinct labels into management / staff sections.
  users: UserLike[];
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  triggerClassName?: string;
};

/**
 * Uniform dropdown that every journal should use for a "должность" picker.
 * Labels come from the live DB positions (seeded from admin's
 * /settings/users) and are split into Руководство / Сотрудники groups with
 * icon headers so the two-column hierarchy from the staff screen is
 * mirrored in every journal that lets the owner pick a role.
 */
export function PositionSelect({
  users,
  value,
  onValueChange,
  placeholder,
  disabled,
  triggerClassName,
}: PositionSelectProps) {
  const t = useTranslations("journalControls.positionSelect");
  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger className={triggerClassName}>
        <SelectValue placeholder={placeholder ?? t("chooseValue")} />
      </SelectTrigger>
      <SelectContent>
        <PositionSelectItems users={users} />
      </SelectContent>
    </Select>
  );
}

export type PositionGroups = { management: string[]; staff: string[] };

/**
 * Just the grouped <SelectItem>s — drop inside an existing <SelectContent>
 * when the enclosing <Select> is already wired up with custom styling /
 * state. Use this in journal clients where the dropdown is embedded in a
 * larger form layout and we don't want to replace the outer <Select>.
 *
 * `groups` — готовый словарь должностей для журналов со своим набором
 * (бактерицидные лампы), чтобы заголовки групп выглядели одинаково везде,
 * а сохраняемые значения не менялись.
 */
export function PositionSelectItems({
  users,
  groups,
  labelClassName,
  displayLabel,
}: {
  users: UserLike[];
  groups?: PositionGroups;
  labelClassName?: string;
  displayLabel?: (rawLabel: string) => string;
}) {
  const t = useTranslations("journalControls.positionSelect");
  const computed = useMemo(() => getPositionLabelsGrouped(users), [users]);
  const resolved = groups ?? computed;
  return (
    <>
      {resolved.management.length > 0 ? (
        <SelectGroup>
          <SelectLabel className={labelClassName}>
            <Crown className="text-[#5566f6]" />
            {t("management")}
            <GroupCount count={resolved.management.length} />
          </SelectLabel>
          {resolved.management.map((label) => (
            <SelectItem key={`m:${label}`} value={label}>
              {displayLabel ? displayLabel(label) : label}
            </SelectItem>
          ))}
        </SelectGroup>
      ) : null}
      {resolved.staff.length > 0 ? (
        <SelectGroup>
          <SelectLabel className={labelClassName}>
            <Users className="text-[#5566f6]" />
            {t("staff")}
            <GroupCount count={resolved.staff.length} />
          </SelectLabel>
          {resolved.staff.map((label) => (
            <SelectItem key={`s:${label}`} value={label}>
              {displayLabel ? displayLabel(label) : label}
            </SelectItem>
          ))}
        </SelectGroup>
      ) : null}
    </>
  );
}

function GroupCount({ count }: { count: number }) {
  return (
    <span className="font-normal normal-case tracking-normal opacity-70">
      · {count}
    </span>
  );
}

/** Единые тексты плейсхолдеров каскада — «селект сам говорит, что выбираем». */
export const POSITION_PLACEHOLDER = "Выберите должность";
export const EMPLOYEE_PLACEHOLDER = "Выберите сотрудника";

/** Значение-сентинел для пункта «ничего не выбрано» (Radix не даёт `""`). */
export const EMPTY_SELECT_VALUE = "__empty__";

/**
 * Анимация появления второго (каскадного) селекта. Держим в одном месте,
 * чтобы «Должность → Сотрудник» выглядел одинаково во всех журналах.
 * Длительность 200ms — верхняя граница дизайн-системы.
 */
export const CASCADE_REVEAL_CLASS =
  "animate-in fade-in-0 slide-in-from-top-1 duration-200";

/**
 * Задержка автооткрытия списка сотрудников после выбора должности.
 * Radix Select при выборе пункта закрывается сразу, но возвращает фокус на
 * триггер должности в `setTimeout(0)` из cleanup FocusScope; открытие
 * второго селекта раньше этого → список открывается и тут же теряет
 * фокус. Плюс `CASCADE_REVEAL_CLASS` длится 200 мс — открываемся после.
 */
const AUTO_OPEN_DELAY_MS = 220;

export type CascadeAutoPick = "single" | "first" | "none";

/**
 * Логика каскада «Должность → Сотрудник», общая для `PositionEmployeePicker`
 * и ручных пар селектов в журналах (раскладка и словарь должностей там
 * свои, поэтому компонент им не подходит — а поведение должно совпадать):
 *
 * - при смене должности сотрудник остаётся, только если он в этой должности;
 * - `autoPick`: `"single"` — подставить, если кандидат ровно один (как в
 *   диалогах создания), `"first"` — первого (как в панелях настроек, где
 *   ждут заполненное поле по умолчанию), `"none"` — ничего;
 * - если после выбора должности кандидатов ≥ 2 и сотрудник не выбран —
 *   список сотрудников открывается сам (только по действию пользователя,
 *   никогда при гидрации формы).
 */
export function usePositionEmployeeCascade<T extends UserLike & { id: string }>({
  users,
  positionTitle,
  userId,
  onChange,
  resolveCandidates,
  autoPick = "single",
  disabled,
}: {
  users: T[];
  positionTitle: string;
  userId: string;
  onChange: (next: { positionTitle: string; userId: string }) => void;
  /** Кандидаты для должности; по умолчанию `getUsersForRoleLabel` с `keepUserId`. */
  resolveCandidates?: (positionTitle: string) => T[];
  autoPick?: CascadeAutoPick;
  disabled?: boolean;
}) {
  const candidates = useMemo(() => {
    if (!positionTitle) return [] as T[];
    if (resolveCandidates) return resolveCandidates(positionTitle);
    return getUsersForRoleLabel(users, positionTitle, { keepUserId: userId });
  }, [positionTitle, resolveCandidates, userId, users]);

  const [employeeOpen, setEmployeeOpenState] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelAutoOpen = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);
  useEffect(() => cancelAutoOpen, [cancelAutoOpen]);

  const setEmployeeOpen = useCallback(
    (next: boolean) => {
      cancelAutoOpen();
      setEmployeeOpenState(next);
    },
    [cancelAutoOpen]
  );

  const handlePositionChange = useCallback(
    (raw: string) => {
      const nextTitle = raw === EMPTY_SELECT_VALUE ? "" : raw;
      const nextCandidates = nextTitle
        ? resolveCandidates
          ? resolveCandidates(nextTitle)
          : getUsersForRoleLabel(users, nextTitle)
        : [];
      const stillValid =
        !!userId &&
        !!nextTitle &&
        (resolveCandidates
          ? nextCandidates.some((u) => u.id === userId)
          : users.some(
              (u) => u.id === userId && getUserPositionLabel(u) === nextTitle
            ));
      let nextUserId = stillValid ? userId : "";
      let autoPicked = false;
      if (!nextUserId && nextTitle) {
        if (autoPick === "first") {
          nextUserId = nextCandidates[0]?.id || "";
          autoPicked = !!nextUserId;
        } else if (autoPick === "single" && nextCandidates.length === 1) {
          nextUserId = nextCandidates[0].id;
        }
      }
      onChange({ positionTitle: nextTitle, userId: nextUserId });

      cancelAutoOpen();
      setEmployeeOpenState(false);
      // Открываем список, когда есть из кого выбирать (2+), а сотрудника
      // человек сам ещё не выбирал: поле пустое или подставлен первый
      // кандидат (`autoPick="first"`) — тогда список показывает выбор, а
      // первый уже отмечен. Если прежний сотрудник остался валидным —
      // ничего не открываем.
      if (!nextTitle || disabled) return;
      if (nextUserId && !autoPicked) return;
      if (nextCandidates.length < 2) return;
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        setEmployeeOpenState(true);
      }, AUTO_OPEN_DELAY_MS);
    },
    [autoPick, cancelAutoOpen, disabled, onChange, resolveCandidates, userId, users]
  );

  const handleEmployeeChange = useCallback(
    (raw: string) => {
      onChange({
        positionTitle,
        userId: raw === EMPTY_SELECT_VALUE ? "" : raw,
      });
    },
    [onChange, positionTitle]
  );

  /**
   * Автовыбор единственного кандидата, в том числе при гидрации (должность
   * пришла с сервера без сотрудника) — второй селект с одним вариантом был
   * лишним кликом. Только для `"single"`: в `"first"` подстановка идёт в
   * `handlePositionChange`, иначе эффект не давал бы очистить сотрудника
   * («не выбран» тут же заменялся бы первым). Списки не открываем: это не
   * действие пользователя.
   */
  useEffect(() => {
    if (disabled || autoPick !== "single") return;
    if (!positionTitle || userId) return;
    if (candidates.length !== 1) return;
    onChange({ positionTitle, userId: candidates[0].id });
  }, [autoPick, candidates, disabled, onChange, positionTitle, userId]);

  return {
    candidates,
    employeeOpen,
    setEmployeeOpen,
    handlePositionChange,
    handleEmployeeChange,
  };
}

/**
 * Подсказка «в должности никого нет» со ссылкой на страницу сотрудников:
 * тупик «выберите сотрудника, а их нет» без выхода — самая частая
 * жалоба новых менеджеров.
 */
/**
 * Каскад Должность → Сотрудник.
 *
 * Сначала виден ТОЛЬКО селект должности с говорящим плейсхолдером
 * «Выберите должность». Как только должность выбрана — НИЖЕ мягко
 * появляется «Выберите сотрудника», отфильтрованный по этой должности.
 * Пока должность не выбрана, список сотрудников не показываем вообще
 * (иначе пользователь выбирает вслепую из всех). Если кандидатов два и
 * больше — список сотрудников открывается сам (`usePositionEmployeeCascade`).
 */
export function PositionEmployeePicker<T extends UserLike & { id: string }>({
  users,
  positionUsers,
  positionGroups,
  value,
  onChange,
  disabled,
  positionLabel,
  employeeLabel,
  emptyPositionPlaceholder,
  emptyEmployeePlaceholder,
  emptyEmployeeHint,
  triggerClassName,
  labelClassName,
  variant = "stacked",
  autoPick = "single",
}: {
  users: T[];
  /**
   * Источник СПИСКА ДОЛЖНОСТЕЙ, когда он шире списка кандидатов.
   *
   * Нужен там, где `users` уже отфильтрован (например «Добавить
   * сотрудника» в журнале показывает только тех, кого ещё нет в
   * документе): без этого должность, у которой все сотрудники уже
   * добавлены, просто исчезала из селекта — и владелец решал, что
   * должность пропала. Теперь должности показываем все, а «кандидатов
   * не осталось» объясняет `emptyEmployeeHint`.
   */
  positionUsers?: UserLike[];
  /** Готовый словарь должностей (см. `PositionSelectItems.groups`). */
  positionGroups?: PositionGroups;
  value: { positionTitle: string; userId: string };
  onChange: (next: { positionTitle: string; userId: string }) => void;
  disabled?: boolean;
  positionLabel?: string;
  employeeLabel?: string;
  emptyPositionPlaceholder?: string;
  emptyEmployeePlaceholder?: string;
  emptyEmployeeHint?: ReactNode;
  triggerClassName?: string;
  labelClassName?: string;
  /**
   * `floating` — эталонный вид диалогов журналов: подпись внутри рамки
   * поля, селект на всю ширину. `stacked` — старый «Label над селектом»,
   * оставлен для экранов вне диалогов (настройки, распределение).
   */
  variant?: "stacked" | "floating";
  autoPick?: CascadeAutoPick;
}) {
  const t = useTranslations("journalControls.positionSelect");
  const resolvedPositionLabel = positionLabel ?? t("positionLabel");
  const resolvedEmployeeLabel = employeeLabel ?? t("employeeLabel");
  const resolvedPositionPlaceholder = emptyPositionPlaceholder ?? t("choosePosition");
  const resolvedEmployeePlaceholder = emptyEmployeePlaceholder ?? t("chooseEmployee");
  const resolvedEmployeeHint = emptyEmployeeHint ?? t.rich("emptyEmployeeHint", {
    add: (chunks) => <Link href="/settings/users" className="font-medium text-[#5566f6] underline underline-offset-2 transition-colors duration-150 hover:text-[#4a5bf0]">{chunks}</Link>,
  });
  const cascade = usePositionEmployeeCascade({
    users,
    positionTitle: value.positionTitle,
    userId: value.userId,
    onChange,
    autoPick,
    disabled,
  });
  const availableEmployees = cascade.candidates;

  const positionValue = value.positionTitle || EMPTY_SELECT_VALUE;
  const userValue = value.userId || EMPTY_SELECT_VALUE;
  const floating = variant === "floating";
  const resolvedTriggerClassName = floating
    ? JOURNAL_DIALOG_FIELD_TRIGGER_CLASS
    : triggerClassName;

  const positionSelect = (
    <Select
      value={positionValue}
      onValueChange={cascade.handlePositionChange}
      disabled={disabled}
    >
      <SelectTrigger className={resolvedTriggerClassName}>
        <SelectValue placeholder={resolvedPositionPlaceholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={EMPTY_SELECT_VALUE} className={MENU_ITEM_MUTED_CLASS}>
          {resolvedPositionPlaceholder}
        </SelectItem>
        <SelectSeparator />
        <PositionSelectItems
          users={positionUsers ?? users}
          groups={positionGroups}
        />
      </SelectContent>
    </Select>
  );

  const employeeSelect = (
    <Select
      value={userValue}
      onValueChange={cascade.handleEmployeeChange}
      open={cascade.employeeOpen}
      onOpenChange={cascade.setEmployeeOpen}
      disabled={disabled || availableEmployees.length === 0}
    >
      <SelectTrigger className={resolvedTriggerClassName}>
        <SelectValue placeholder={resolvedEmployeePlaceholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={EMPTY_SELECT_VALUE} className={MENU_ITEM_MUTED_CLASS}>
          {resolvedEmployeePlaceholder}
        </SelectItem>
        {availableEmployees.map((u) => (
          <SelectItem key={u.id} value={u.id}>
            {u.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  if (floating) {
    return (
      <>
        <FloatingLabelField label={resolvedPositionLabel}>{positionSelect}</FloatingLabelField>

        {value.positionTitle ? (
          <FloatingLabelField
            label={resolvedEmployeeLabel}
            className={CASCADE_REVEAL_CLASS}
            hint={availableEmployees.length === 0 ? resolvedEmployeeHint : undefined}
          >
            {employeeSelect}
          </FloatingLabelField>
        ) : null}
      </>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className={cn("text-[13px] font-medium text-[#6f7282]", labelClassName)}>
          {resolvedPositionLabel}
        </div>
        {positionSelect}
      </div>

      {value.positionTitle ? (
        <div className={cn("space-y-2", CASCADE_REVEAL_CLASS)}>
          <div className={cn("text-[13px] font-medium text-[#6f7282]", labelClassName)}>
            {resolvedEmployeeLabel}
          </div>
          {employeeSelect}
          {availableEmployees.length === 0 ? (
            <div className={JOURNAL_DIALOG_HINT_CLASS}>{emptyEmployeeHint}</div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Native `<optgroup>` + `<option>` variant for journals that still use a
 * plain HTML `<select>` (glass-list, perishable-rejection, product-writeoff
 * and friends). Drop-in for `{ROLE_OPTIONS.map(...)}` inside `<select>`.
 */
export function PositionNativeOptions({ users }: { users: UserLike[] }) {
  const groups = useMemo(() => getPositionLabelsGrouped(users), [users]);
  return (
    <>
      {groups.management.length > 0 ? (
        <optgroup label="Руководство">
          {groups.management.map((label) => (
            <option key={`m:${label}`} value={label}>
              {label}
            </option>
          ))}
        </optgroup>
      ) : null}
      {groups.staff.length > 0 ? (
        <optgroup label="Сотрудники">
          {groups.staff.map((label) => (
            <option key={`s:${label}`} value={label}>
              {label}
            </option>
          ))}
        </optgroup>
      ) : null}
    </>
  );
}
