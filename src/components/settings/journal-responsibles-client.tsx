"use client";

import { CommissionDialog } from "@/components/journals/commission-dialog";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronRight,
  Crown,
  Loader2,
  Minus,
  Plus,
  Save,
  Scale,
  Search,
  Sparkles,
  Trash2,
  TrendingDown,
  TrendingUp,
  Wand2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  CATEGORY_LABELS,
  MODE_LABELS,
  getJournalResponsibilityMeta,
  matchPositionsForJournal,
  type JournalCategory,
} from "@/lib/journal-responsible-presets";
import { getSchemaForJournal } from "@/lib/journal-responsible-schemas";
import { isPlaceholderStaffUser } from "@/lib/journal-roster";
import {
  calculateUserWorkloads,
  getJournalMonthlyWeight,
  type SlotUserMap as WorkloadSlotMap,
} from "@/lib/journal-workload";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { confirmAsync } from "@/components/ui/confirm-async";

type Position = {
  id: string;
  name: string;
  categoryKey: string;
  activeUsers: number;
};

type UserItem = {
  id: string;
  name: string;
  jobPositionId: string | null;
  /// Tier-определение для verifier-логики (admin > manager > head_chef > cook).
  role: string;
  isRoot: boolean;
};

/**
 * Tier — числовой ранг должности для умного пресета:
 *   3 = admin (legacy "owner")
 *  -1 = заглушка (имя = почта, «Иванов И.И.»)
 *   2 = manager
 *   1 = head_chef / technologist
 *   0 = cook / waiter / operator
 *
 * Используется чтобы pickSlotUsersForJournal предпочёл админа в качестве
 * проверяющего (verifier), а в качестве "контролёра" (filler с keywords
 * "менеджер/управляющ") — менеджера/заведующую, а не уборщика.
 */
function userTier(u: UserItem): number {
  // ROOT сюда не приходит (страница отдаёт только сотрудников), а аккаунт
  // «имя = почта» — техническая запись мгновенной регистрации, не человек
  // из штата: в пресетах он идёт последним.
  if (isPlaceholderStaffUser(u)) return -1;
  switch (u.role) {
    case "owner":
      return 3;
    case "manager":
      return 2;
    case "head_chef":
    case "technologist":
      return 1;
    default:
      return 0;
  }
}

type SlotUserMap = Record<string, string | null>;

type Journal = {
  code: string;
  name: string;
  description: string | null;
  initialPositionIds: string[];
  initialSlotUsers: SlotUserMap;
  /// Distribution из journal-task-modes.ts. Если "per-employee" —
  /// preset не выбирает filler users, а ставит ВСЕ должности
  /// активных сотрудников в chips и admin'а в verifier.
  distribution: string;
};

function isPerEmployeeJournal(j: Journal): boolean {
  return j.distribution === "per-employee";
}

type Props = {
  positions: Position[];
  users: UserItem[];
  journals: Journal[];
  difficultyOverride: Record<string, number>;
};

type Selection = {
  positions: Map<string, Set<string>>; // code -> positionIds
  slots: Map<string, SlotUserMap>; // code -> { slotId: userId }
};

function toSelection(journals: Journal[]): Selection {
  const positions = new Map<string, Set<string>>();
  const slots = new Map<string, SlotUserMap>();
  for (const j of journals) {
    positions.set(j.code, new Set(j.initialPositionIds));
    slots.set(j.code, { ...j.initialSlotUsers });
  }
  return { positions, slots };
}

function slotMapsEqual(a: SlotUserMap, b: SlotUserMap): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if ((a[k] ?? null) !== (b[k] ?? null)) return false;
  }
  return true;
}

function diff(base: Selection, curr: Selection): Set<string> {
  const changed = new Set<string>();
  for (const [code, set] of curr.positions.entries()) {
    const baseSet = base.positions.get(code) ?? new Set<string>();
    if (set.size !== baseSet.size) {
      changed.add(code);
      continue;
    }
    for (const id of set) {
      if (!baseSet.has(id)) {
        changed.add(code);
        break;
      }
    }
  }
  for (const [code, slotMap] of curr.slots.entries()) {
    if (!slotMapsEqual(base.slots.get(code) ?? {}, slotMap)) {
      changed.add(code);
    }
  }
  return changed;
}

const CATEGORY_ORDER: JournalCategory[] = [
  "health",
  "cleaning",
  "temperature",
  "production",
  "intake",
  "equipment",
  "training",
  "incidents",
  "audit",
  "other",
];

const MODE_TONE: Record<string, string> = {
  "per-employee": "bg-[#eef1ff] text-[#3848c7]",
  shared: "bg-[#ecfdf5] text-[#136b2a]",
  single: "bg-[#fff8eb] text-[#a13a32]",
};

/** Phase C: вспомогательный компонент для рендера одного slot-picker'а
 *  — раньше код был inline, после разделения «Заполняют»/«Проверяет»
 *  оба раздела вызывают этот же UI. */

/**
 * Бракеражи: ответственные = исполнитель + комиссия. Комиссия — отдельным
 * составом из окна «Сторонняя бракеражная комиссия», а не слотами.
 */
function CommissionSlotRow({ code }: { code: string }) {
  const [open, setOpen] = useState(false);
  const [names, setNames] = useState<string[] | null>(null);
  const load = useCallback(() => {
    void fetch(`/api/settings/brakerage-commission/${code}`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { members?: Array<{ employeeName: string }> } | null) => setNames((body?.members ?? []).map((m) => m.employeeName)))
      .catch(() => setNames([]));
  }, [code]);
  useEffect(() => {
    load();
  }, [load]);
  return (
    <div className="mt-3">
      <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#116b2a]">
        <span className="inline-block size-1.5 rounded-full bg-[#16a34a]" />
        Комиссия — подписывает бракераж
      </div>
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[#ececf4] bg-white px-3 py-2 text-[13px]">
        <span className="min-w-0 flex-1 text-[#3c4053]">
          {names === null ? "…" : names.length > 0 ? names.join(", ") : "Не задана — строки закрываются без подписи комиссии"}
        </span>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex h-8 items-center rounded-lg border border-[#dcdfed] px-3 text-[12.5px] font-medium text-[#3848c7] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
        >
          Изменить
        </button>
      </div>
      <CommissionDialog code={code} open={open} onClose={() => setOpen(false)} onSaved={() => load()} />
    </div>
  );
}

export type CandidateGroup = "recommended" | "ok" | "not-recommended";

export type UserCandidate = {
  user: UserItem;
  positionName: string | null;
  monthlyLoad: number;
  group: CandidateGroup;
  reason?: string;
  tier: number; // 0..3
  alreadyInOtherSlot?: boolean;
};

type UserPickerProps = {
  value: string | null;
  groups: {
    recommended: UserCandidate[];
    ok: UserCandidate[];
    notRecommended: UserCandidate[];
  };
  onChange: (userId: string | null) => void;
  placeholder?: string;
  /// Сообщение когда вообще никого нет.
  emptyHint?: string;
};

const TIER_LABELS: Record<number, string> = {
  3: "админ",
  2: "менеджер",
  1: "шеф-повар",
  0: "сотрудник",
};

function UserPicker({
  value,
  groups,
  onChange,
  placeholder = "— не выбран —",
  emptyHint,
}: UserPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  // Click-outside для закрытия popover.
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  const allCandidates = [
    ...groups.recommended,
    ...groups.ok,
    ...groups.notRecommended,
  ];
  const totalCount = allCandidates.length;
  const selected = value
    ? allCandidates.find((c) => c.user.id === value) ?? null
    : null;

  const q = query.trim().toLowerCase();
  const filterFn = (c: UserCandidate) =>
    !q ||
    c.user.name.toLowerCase().includes(q) ||
    (c.positionName ?? "").toLowerCase().includes(q);

  const recommended = groups.recommended.filter(filterFn);
  const ok = groups.ok.filter(filterFn);
  const notRecommended = groups.notRecommended.filter(filterFn);

  function pick(uid: string | null) {
    onChange(uid);
    setOpen(false);
    setQuery("");
  }

  const triggerLabel = selected
    ? `${selected.user.name}${
        selected.positionName ? ` · ${selected.positionName}` : ""
      }`
    : placeholder;

  return (
    <div className="relative" ref={wrapperRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={totalCount === 0}
        className={`flex w-full items-center justify-between gap-2 rounded-xl border bg-white px-3 py-2 text-left text-[13px] transition-colors ${
          totalCount === 0
            ? "cursor-not-allowed border-[#ececf4] text-[#9b9fb3]"
            : selected
              ? "border-[#dcdfed] text-[#0b1024] hover:border-[#5566f6]/50"
              : "border-[#dcdfed] text-[#9b9fb3] hover:border-[#5566f6]/50 hover:bg-[#fafbff]"
        }`}
      >
        <span className="flex min-w-0 items-center gap-2">
          {selected ? (
            <>
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[#eef1ff] text-[11px] font-semibold uppercase text-[#3848c7]">
                {selected.user.name.slice(0, 1).toUpperCase()}
              </span>
              <span className="min-w-0 truncate">
                <span className="font-medium text-[#0b1024]">
                  {selected.user.name}
                </span>
                {selected.positionName ? (
                  <span className="text-[#9b9fb3]">
                    {" · "}
                    {selected.positionName}
                  </span>
                ) : null}
              </span>
            </>
          ) : (
            <span className="truncate">{triggerLabel}</span>
          )}
        </span>
        <ChevronDown
          className={`size-4 shrink-0 transition-transform ${
            open ? "rotate-180 text-[#5566f6]" : "text-[#9b9fb3]"
          }`}
        />
      </button>

      {totalCount === 0 ? (
        <div className="mt-1 text-[11px] text-[#a13a32]">
          {emptyHint ?? "Нет подходящих сотрудников. Заведите/назначьте."}
        </div>
      ) : null}

      {open ? (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-[420px] overflow-hidden rounded-2xl border border-[#dcdfed] bg-white shadow-[0_20px_50px_-20px_rgba(11,16,36,0.35)]">
          <div className="border-b border-[#ececf4] bg-[#fafbff] p-2">
            <div className="relative flex items-center">
              <Search className="absolute left-2.5 size-3.5 text-[#9b9fb3]" />
              <input
                type="text"
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Поиск сотрудника или должности…"
                className="h-8 w-full rounded-lg border border-[#dcdfed] bg-white pl-8 pr-2 text-[12px] text-[#0b1024] placeholder:text-[#9b9fb3] focus:border-[#5566f6] focus:outline-none focus:ring-2 focus:ring-[#5566f6]/15"
              />
            </div>
          </div>

          <div className="max-h-[340px] overflow-y-auto py-1">
            {selected ? (
              <button
                type="button"
                onClick={() => pick(null)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-[#a13a32] transition-colors hover:bg-[#fff4f2]"
              >
                <Minus className="size-3.5" />
                Убрать выбор
              </button>
            ) : null}

            {recommended.length > 0 ? (
              <UserPickerGroup
                title="Рекомендуем"
                tone="recommended"
                items={recommended}
                selectedId={value}
                onPick={pick}
              />
            ) : null}
            {ok.length > 0 ? (
              <UserPickerGroup
                title="Можно"
                tone="ok"
                items={ok}
                selectedId={value}
                onPick={pick}
              />
            ) : null}
            {notRecommended.length > 0 ? (
              <UserPickerGroup
                title="Не рекомендуем"
                tone="not-recommended"
                items={notRecommended}
                selectedId={value}
                onPick={pick}
              />
            ) : null}

            {recommended.length === 0 &&
            ok.length === 0 &&
            notRecommended.length === 0 ? (
              <div className="px-3 py-6 text-center text-[12px] text-[#9b9fb3]">
                Никого не найдено под «{query}».
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function UserPickerGroup({
  title,
  tone,
  items,
  selectedId,
  onPick,
}: {
  title: string;
  tone: CandidateGroup;
  items: UserCandidate[];
  selectedId: string | null;
  onPick: (uid: string) => void;
}) {
  const headerTone =
    tone === "recommended"
      ? "bg-emerald-50/60 text-emerald-700"
      : tone === "ok"
        ? "bg-[#fafbff] text-[#3c4053]"
        : "bg-[#fff8eb]/40 text-[#a16d32]";
  return (
    <div className="py-0.5">
      <div
        className={`flex items-center gap-1.5 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] ${headerTone}`}
      >
        {tone === "recommended" ? (
          <Sparkles className="size-3" />
        ) : tone === "not-recommended" ? (
          <AlertCircle className="size-3" />
        ) : null}
        {title}
        <span className="text-[10px] font-normal opacity-70">
          · {items.length}
        </span>
      </div>
      {items.map((c) => {
        const isSelected = c.user.id === selectedId;
        return (
          <button
            key={c.user.id}
            type="button"
            onClick={() => onPick(c.user.id)}
            className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] transition-colors ${
              isSelected
                ? "bg-[#eef1ff] text-[#3848c7]"
                : "text-[#0b1024] hover:bg-[#fafbff]"
            }`}
          >
            <span
              className={`flex size-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold uppercase ${
                isSelected
                  ? "bg-[#5566f6] text-white"
                  : "bg-[#eef1ff] text-[#3848c7]"
              }`}
            >
              {c.user.name.slice(0, 1).toUpperCase()}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium leading-tight">
                {c.user.name}
                {c.tier >= 3 ? (
                  <Crown
                    className="ml-1 inline size-3 -translate-y-px text-[#a16d32]"
                    aria-label="админ"
                  />
                ) : null}
              </span>
              <span className="block truncate text-[11px] text-[#9b9fb3]">
                {c.positionName ?? "Без должности"}
                {c.tier > 0 ? ` · ${TIER_LABELS[c.tier]}` : ""}
                {c.reason ? ` · ${c.reason}` : ""}
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-1.5">
              {c.alreadyInOtherSlot ? (
                <span
                  title="Этот сотрудник уже назначен в другом слоте этого журнала"
                  className="rounded-full bg-[#eef1ff] px-1.5 py-0.5 text-[10px] font-medium text-[#3848c7]"
                >
                  уже в др. слоте
                </span>
              ) : null}
              {c.monthlyLoad > 0 ? (
                <span
                  title="Текущая месячная нагрузка по всем журналам"
                  className="rounded-full bg-[#fafbff] px-1.5 py-0.5 text-[10px] tabular-nums text-[#6f7282]"
                >
                  {Math.round(c.monthlyLoad)}
                </span>
              ) : null}
              {isSelected ? <Check className="size-3.5 text-[#3848c7]" /> : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}

type SlotPickerProps = {
  journalCode: string;
  slot: import("@/lib/journal-responsible-schemas").ResponsibleSlot;
  slotIdx: number;
  slotMap: SlotUserMap;
  positionsById: Map<string, Position>;
  usersById: Map<string, UserItem>;
  candidateGroupsForSlot: (
    journalCode: string,
    slotId: string,
  ) => {
    recommended: UserCandidate[];
    ok: UserCandidate[];
    notRecommended: UserCandidate[];
  };
  onSetUser: (journalCode: string, slotId: string, userId: string | null) => void;
};

function SlotPicker({
  journalCode,
  slot,
  slotIdx,
  slotMap,
  positionsById,
  usersById,
  candidateGroupsForSlot,
  onSetUser,
}: SlotPickerProps) {
  const userId = slotMap[slot.id] ?? null;
  const groups = candidateGroupsForSlot(journalCode, slot.id);
  const totalCount =
    groups.recommended.length +
    groups.ok.length +
    groups.notRecommended.length;
  // Если выбран userId которого нет ни в одной группе (например, был
  // удалён) — добавляем его как fallback в notRecommended «вне фильтра».
  if (userId && !groups.recommended.find((c) => c.user.id === userId) &&
      !groups.ok.find((c) => c.user.id === userId) &&
      !groups.notRecommended.find((c) => c.user.id === userId)) {
    const u = usersById.get(userId);
    if (u) {
      const pos = u.jobPositionId
        ? positionsById.get(u.jobPositionId)
        : null;
      groups.notRecommended.unshift({
        user: u,
        positionName: pos?.name ?? null,
        monthlyLoad: 0,
        group: "not-recommended",
        reason: "вне фильтра",
        tier: 0,
      });
    }
  }
  return (
    <div className="flex flex-wrap items-start gap-2 rounded-xl border border-[#ececf4] bg-[#fafbff] px-3 py-2.5">
      <div className="flex min-w-[180px] flex-col">
        <div className="flex items-center gap-1.5 text-[12px] font-medium text-[#3c4053]">
          <span className="flex size-5 items-center justify-center rounded-full bg-[#eef1ff] text-[10px] font-semibold text-[#3848c7]">
            {slotIdx + 1}
          </span>
          {slot.label}
          {slot.primary ? (
            <span className="rounded-full bg-[#fff8eb] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[#a13a32]" title="Этот сотрудник попадает в шапку документа">
              главный
            </span>
          ) : null}
        </div>
        {slot.hint ? (
          <div className="mt-0.5 text-[11px] leading-snug text-[#9b9fb3]">
            {slot.hint}
          </div>
        ) : null}
      </div>
      <div className="flex-1 min-w-[240px]">
        <UserPicker
          value={userId}
          groups={groups}
          onChange={(uid) => onSetUser(journalCode, slot.id, uid)}
          placeholder={
            totalCount === 0 ? "Нет подходящих" : "Выбрать сотрудника"
          }
          emptyHint={
            totalCount === 0
              ? "Нет сотрудников. Заведите в /settings/users."
              : undefined
          }
        />
      </div>
    </div>
  );
}

export function JournalResponsiblesClient({
  positions,
  users,
  journals,
  difficultyOverride,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const fixCode = searchParams?.get("fix") ?? null;
  const fixReason = searchParams?.get("reason") ?? null;
  const [fixDismissed, setFixDismissed] = useState(false);
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [base, setBase] = useState<Selection>(() => toSelection(journals));
  const [curr, setCurr] = useState<Selection>(() => toSelection(journals));
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applyingCategory, setApplyingCategory] = useState<JournalCategory | null>(
    null
  );
  const [resyncing, setResyncing] = useState(false);
  const [recreating, setRecreating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<JournalCategory>>(
    () => new Set()
  );

  // Скроллим к карточке журнала + раскрываем категорию + добавляем
  // красную рамку, когда юзер пришёл с ?fix=<code> из notification.
  useEffect(() => {
    if (!fixCode || fixDismissed) return;
    setCollapsed(new Set()); // принудительно раскрываем все категории
    const node = cardRefs.current.get(fixCode);
    if (node) {
      requestAnimationFrame(() => {
        node.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    } else {
      // Карточки ещё нет (рендер не завершён) — повторим через 200ms.
      const t = setTimeout(() => {
        const n = cardRefs.current.get(fixCode);
        if (n) n.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 200);
      return () => clearTimeout(t);
    }
  }, [fixCode, fixDismissed]);

  // Confirm-модалки. Каждая destructive операция держит свой open-state.
  const [applyAllOpen, setApplyAllOpen] = useState(false);
  const [saveAllOpen, setSaveAllOpen] = useState(false);
  const [recreateOpen, setRecreateOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletePreflight, setDeletePreflight] = useState<{
    docCount: number;
    entryCount: number;
  } | null>(null);
  /// Сколько активных документов закроет «Пересоздать документы».
  const [recreatePreflight, setRecreatePreflight] = useState<{
    activeDocCount: number;
    filledEntryCount: number;
  } | null>(null);

  const usersById = useMemo(
    () => new Map(users.map((u) => [u.id, u])),
    [users]
  );

  // Если родительская server-component дёрнула router.refresh() и
  // обновила journals — пересинхронизируем локальный state. Без этого
  // useState остаётся со «старым» снимком на момент монтирования.
  useEffect(() => {
    const next = toSelection(journals);
    setBase(next);
    setCurr((prev) => {
      // Если у юзера есть несохранённые изменения, не сбрасываем — пусть
      // dirty-индикатор остаётся. Перезаписываем только если prev==base
      // (т.е. ничего не меняли локально).
      const prevDirty = diff(toSelection(journals), prev).size > 0;
      if (prevDirty) return prev;
      return next;
    });
  }, [journals]);

  const dirty = diff(base, curr);

  const positionsById = useMemo(
    () => new Map(positions.map((p) => [p.id, p])),
    [positions]
  );

  /**
   * Прогноз нагрузки в реальном времени: пересчёт workload каждый
   * раз когда меняется base или curr. Сравниваем «было/станет» и
   * показываем менеджеру что улучшилось/ухудшилось.
   */
  const userIds = useMemo(() => users.map((u) => u.id), [users]);

  function buildSlotMapForCalc(sel: Selection): Record<string, WorkloadSlotMap> {
    const out: Record<string, WorkloadSlotMap> = {};
    for (const [code, slotMap] of sel.slots) {
      out[code] = { ...slotMap };
    }
    return out;
  }

  const baseWorkloads = useMemo(
    () =>
      calculateUserWorkloads({
        slotUsersByJournal: buildSlotMapForCalc(base),
        difficultyOverride,
        userIds,
      }),
    [base, difficultyOverride, userIds],
  );
  const currWorkloads = useMemo(
    () =>
      calculateUserWorkloads({
        slotUsersByJournal: buildSlotMapForCalc(curr),
        difficultyOverride,
        userIds,
      }),
    [curr, difficultyOverride, userIds],
  );

  /**
   * Diff карта userId → { before, after, delta }. Только пользователи
   * у которых нагрузка изменилась.
   */
  const workloadDiffs = useMemo(() => {
    const diffs: Array<{
      userId: string;
      name: string;
      position: string | null;
      before: number;
      after: number;
      delta: number;
    }> = [];
    for (const u of users) {
      const before = baseWorkloads.get(u.id)?.totalWeight ?? 0;
      const after = currWorkloads.get(u.id)?.totalWeight ?? 0;
      if (Math.abs(after - before) < 0.5) continue;
      const positionName = u.jobPositionId
        ? (positionsById.get(u.jobPositionId)?.name ?? null)
        : null;
      diffs.push({
        userId: u.id,
        name: u.name,
        position: positionName,
        before,
        after,
        delta: after - before,
      });
    }
    diffs.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
    return diffs;
  }, [users, baseWorkloads, currWorkloads, positionsById]);

  /**
   * Imbalance (max-min)/avg внутри каждой должности. Сравниваем
   * before/after — менеджер видит «было 0.62 → станет 0.18» и
   * понимает что сделал хорошо.
   */
  type ImbalanceRow = {
    positionId: string;
    positionName: string;
    userCount: number;
    beforeImb: number;
    afterImb: number;
  };

  function imbalanceFor(
    workloads: Map<string, { totalWeight: number }>,
  ): Map<string, { positionName: string; userCount: number; imb: number }> {
    const byPos = new Map<
      string,
      { name: string; weights: number[] }
    >();
    for (const u of users) {
      if (!u.jobPositionId) continue;
      const pos = positionsById.get(u.jobPositionId);
      if (!pos) continue;
      const bucket = byPos.get(u.jobPositionId) ?? {
        name: pos.name,
        weights: [],
      };
      bucket.weights.push(workloads.get(u.id)?.totalWeight ?? 0);
      byPos.set(u.jobPositionId, bucket);
    }
    const out = new Map<
      string,
      { positionName: string; userCount: number; imb: number }
    >();
    for (const [pid, b] of byPos) {
      const total = b.weights.reduce((a, x) => a + x, 0);
      const avg = b.weights.length ? total / b.weights.length : 0;
      const min = b.weights.length ? Math.min(...b.weights) : 0;
      const max = b.weights.length ? Math.max(...b.weights) : 0;
      const imb = avg > 0 ? (max - min) / avg : 0;
      out.set(pid, { positionName: b.name, userCount: b.weights.length, imb });
    }
    return out;
  }

  const imbalanceDiffs = useMemo<ImbalanceRow[]>(() => {
    const before = imbalanceFor(baseWorkloads);
    const after = imbalanceFor(currWorkloads);
    const rows: ImbalanceRow[] = [];
    const allPos = new Set([...before.keys(), ...after.keys()]);
    for (const pid of allPos) {
      const b = before.get(pid);
      const a = after.get(pid);
      const userCount = a?.userCount ?? b?.userCount ?? 0;
      if (userCount <= 1) continue; // одного — не сравниваем
      const beforeImb = b?.imb ?? 0;
      const afterImb = a?.imb ?? 0;
      if (Math.abs(afterImb - beforeImb) < 0.05) continue; // не значимый
      rows.push({
        positionId: pid,
        positionName: a?.positionName ?? b?.positionName ?? "",
        userCount,
        beforeImb,
        afterImb,
      });
    }
    rows.sort(
      (a, b) =>
        Math.abs(b.afterImb - b.beforeImb) -
        Math.abs(a.afterImb - a.beforeImb),
    );
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseWorkloads, currWorkloads, users, positionsById]);

  /**
   * Категоризация кандидатов на слот для красивого dropdown'а:
   *   • recommended — идеально подходит (matches keywords + position
   *     для filler, или tier ≥ 2 для verifier)
   *   • ok — формально подходит, но не идеально
   *   • not-recommended — выходит за пределы рекомендации (cook
   *     для verifier, или вне chips для filler)
   *
   * Исключаем тех кто уже взят другими слотами этого журнала.
   */
  function candidateGroupsForSlot(
    journalCode: string,
    slotId: string,
  ): {
    recommended: UserCandidate[];
    ok: UserCandidate[];
    notRecommended: UserCandidate[];
  } {
    const schema = getSchemaForJournal(journalCode);
    const slot = schema.slots.find((s) => s.id === slotId);
    const slotMap = curr.slots.get(journalCode) ?? {};
    const usedIds = new Set(
      Object.entries(slotMap)
        .filter(([sid, uid]) => sid !== slotId && uid)
        .map(([, uid]) => uid as string),
    );

    const isVerifier = slot?.kind === "verifier";
    const keywords = slot?.positionKeywords ?? null;
    const positionSet = curr.positions.get(journalCode);

    function matchesKeywords(u: UserItem): boolean {
      if (!keywords || keywords.length === 0) return true;
      if (!u.jobPositionId) return false;
      const pos = positionsById.get(u.jobPositionId);
      if (!pos) return false;
      const lower = pos.name.toLowerCase();
      return keywords.some((kw) => lower.includes(kw));
    }

    function inPositionSet(u: UserItem): boolean {
      if (!positionSet || positionSet.size === 0) return true;
      return Boolean(u.jobPositionId && positionSet.has(u.jobPositionId));
    }

    function makeCandidate(
      u: UserItem,
      group: CandidateGroup,
      reason?: string,
    ): UserCandidate {
      const pos = u.jobPositionId
        ? (positionsById.get(u.jobPositionId) ?? null)
        : null;
      return {
        user: u,
        positionName: pos?.name ?? null,
        monthlyLoad: currWorkloads.get(u.id)?.totalWeight ?? 0,
        group,
        reason,
        tier: userTier(u),
        alreadyInOtherSlot: usedIds.has(u.id),
      };
    }

    const recommended: UserCandidate[] = [];
    const ok: UserCandidate[] = [];
    const notRecommended: UserCandidate[] = [];

    for (const u of users) {

      const t = userTier(u);
      const kw = matchesKeywords(u);
      const pset = inPositionSet(u);

      if (isVerifier) {
        // Verifier: tier >= 2 = идеально (admin/manager).
        // Tier 1 (head_chef) — ok.
        // Tier 0 (cook/waiter) — not-recommended.
        // Keywords match повышает на одну ступень.
        if (t >= 2) {
          recommended.push(
            makeCandidate(
              u,
              "recommended",
              t === 3 ? "админ — самый главный" : "руководитель",
            ),
          );
        } else if (t === 1 || kw) {
          ok.push(
            makeCandidate(
              u,
              "ok",
              kw ? "matches keywords" : "шеф-повар",
            ),
          );
        } else {
          notRecommended.push(
            makeCandidate(u, "not-recommended", "не управленческая роль"),
          );
        }
      } else {
        // Filler: matches keywords + matches positionSet = идеально.
        // Один из двух = ok. Ни то ни другое = not-recommended.
        if (kw && pset) {
          recommended.push(makeCandidate(u, "recommended"));
        } else if (kw || pset) {
          ok.push(
            makeCandidate(
              u,
              "ok",
              kw ? "должность подходит, но не в chips" : "в chips, но другой профиль",
            ),
          );
        } else {
          notRecommended.push(
            makeCandidate(u, "not-recommended", "не из назначенных должностей"),
          );
        }
      }
    }

    // Сортировка внутри групп: по нагрузке возрастанием (меньше
    // загруженный — выше), потом по имени.
    function sortFn(a: UserCandidate, b: UserCandidate) {
      if (Math.abs(a.monthlyLoad - b.monthlyLoad) > 0.5) {
        return a.monthlyLoad - b.monthlyLoad;
      }
      return a.user.name.localeCompare(b.user.name, "ru");
    }
    recommended.sort(sortFn);
    ok.sort(sortFn);
    notRecommended.sort(sortFn);

    // Для verifier — внутри recommended поднимаем admin'ов наверх.
    if (isVerifier) {
      recommended.sort((a, b) => {
        if (a.tier !== b.tier) return b.tier - a.tier;
        return sortFn(a, b);
      });
    }

    return { recommended, ok, notRecommended };
  }

  /**
   * Авто-подбор слотов на стороне клиента с балансировкой по нагрузке.
   *
   * Алгоритм:
   *   1. Pool строится так:
   *      • filler-slot — фильтр по positionIds (chips журнала) + keywords.
   *      • verifier-slot — НЕ ограничиваем positionIds (verifier может
   *        быть и не из тех должностей которые «заполняют»). Применяем
   *        только keywords (с fallback на всех если никто не подходит).
   *   2. Для verifier-slot: поднимаем юзеров с большим tier'ом
   *      (admin > manager > head_chef) выше — компании естественно
   *      хотят чтобы проверял старший по иерархии.
   *   3. Tie-break: меньше накопленной нагрузки → выбираем. Так из 3-х
   *      уборщиц с одинаковыми keywords первая дорогая задача уйдёт
   *      одной, вторая — другой, третья — третьей.
   *
   * @param workloadAcc — накопленный вес по userId из ранее
   *        распределённых журналов в этой же сессии presets.
   *        Не мутируется — результат можно прибавить к нему снаружи.
   */
  function pickSlotUsersForJournal(
    journalCode: string,
    positionIds: Set<string>,
    workloadAcc?: Map<string, number>,
  ): SlotUserMap {
    const schema = getSchemaForJournal(journalCode);
    const positionsByIdLocal = new Map(positions.map((p) => [p.id, p]));
    const result: SlotUserMap = {};
    const usedIds = new Set<string>();

    function matchesKeywords(u: UserItem, keywords: readonly string[]): boolean {
      if (!u.jobPositionId) return false;
      const pos = positionsByIdLocal.get(u.jobPositionId);
      if (!pos) return false;
      const lower = pos.name.toLowerCase();
      return keywords.some((kw) => lower.includes(kw));
    }

    for (const slot of schema.slots) {
      const isVerifier = slot.kind === "verifier";
      const keywords = slot.positionKeywords ?? [];
      const hasKeywords = keywords.length > 0;

      // Шаг 1: pool — кандидаты до фильтрации keyword'ом.
      //   • Verifier — все сотрудники (tier важнее keywords).
      //   • Filler — фильтр по chips (positionIds), если они заданы.
      let pool: UserItem[];
      if (isVerifier) {
        pool = users;
      } else {
        pool = users;
        if (positionIds.size > 0) {
          pool = pool.filter(
            (u) => u.jobPositionId && positionIds.has(u.jobPositionId),
          );
        }
      }

      // Шаг 2: убираем тех кого уже взяли в другие слоты ЭТОГО журнала.
      // Делаем ПЕРЕД keyword-фильтром — иначе если единственный
      // matching-юзер уже filler, то verifier останется null.
      pool = pool.filter((u) => !usedIds.has(u.id));

      // Шаг 3: ranking. Сортировка многокритериальная:
      //   • Для verifier: tier приоритетнее keywords. Админ (tier 3)
      //     попадёт на 1 место даже если keywords (завед/менеджер) его
      //     не упоминают.
      //   • Для filler: keywords приоритетнее tier. Технолог встретится
      //     раньше Заведующей, если тот у нас и тот и тот в pool'е.
      //   • Tie-break — меньшая накопленная нагрузка (балансировка),
      //     потом имя.
      const ranked = [...pool].sort((a, b) => {
        if (isVerifier) {
          const tierDiff = userTier(b) - userTier(a);
          if (tierDiff !== 0) return tierDiff;
          if (hasKeywords) {
            const am = matchesKeywords(a, keywords) ? 0 : 1;
            const bm = matchesKeywords(b, keywords) ? 0 : 1;
            if (am !== bm) return am - bm;
          }
        } else {
          if (hasKeywords) {
            const am = matchesKeywords(a, keywords) ? 0 : 1;
            const bm = matchesKeywords(b, keywords) ? 0 : 1;
            if (am !== bm) return am - bm;
          }
          // Для filler: chips-matched и keyword-matched > просто
          // chips-matched > вне chips.
          const aIn = a.jobPositionId
            ? positionIds.has(a.jobPositionId)
              ? 0
              : 1
            : 1;
          const bIn = b.jobPositionId
            ? positionIds.has(b.jobPositionId)
              ? 0
              : 1
            : 1;
          if (aIn !== bIn) return aIn - bIn;
        }
        const wa = workloadAcc?.get(a.id) ?? 0;
        const wb = workloadAcc?.get(b.id) ?? 0;
        if (wa !== wb) return wa - wb;
        return a.name.localeCompare(b.name, "ru");
      });

      const pick = ranked[0];
      if (pick) {
        result[slot.id] = pick.id;
        usedIds.add(pick.id);
      } else {
        result[slot.id] = null;
      }
    }
    return result;
  }

  // Build journal entries with meta + group by category.
  const enriched = useMemo(() => {
    const q = query.trim().toLowerCase();
    return journals
      .map((j) => {
        const meta = getJournalResponsibilityMeta(j.code);
        return {
          ...j,
          meta,
          category: (meta?.category ?? "other") as JournalCategory,
        };
      })
      .filter(
        (j) =>
          !q ||
          j.name.toLowerCase().includes(q) ||
          j.code.toLowerCase().includes(q) ||
          (j.meta?.who ?? "").toLowerCase().includes(q)
      );
  }, [journals, query]);

  const grouped = useMemo(() => {
    const map = new Map<JournalCategory, typeof enriched>();
    for (const j of enriched) {
      const list = map.get(j.category) ?? [];
      list.push(j);
      map.set(j.category, list);
    }
    return CATEGORY_ORDER.map(
      (cat) => [cat, map.get(cat) ?? []] as const
    ).filter(([, list]) => list.length > 0);
  }, [enriched]);

  function togglePosition(code: string, positionId: string) {
    setCurr((prev) => {
      const positions = new Map(prev.positions);
      const set = new Set(positions.get(code) ?? new Set<string>());
      if (set.has(positionId)) set.delete(positionId);
      else set.add(positionId);
      positions.set(code, set);

      // Если кто-то из текущих slot users не помещается в новые
      // должности — снимаем его. Сервер при сохранении подберёт нового.
      const slots = new Map(prev.slots);
      const slotMap = { ...(slots.get(code) ?? {}) };
      let mutated = false;
      for (const [slotId, userId] of Object.entries(slotMap)) {
        if (!userId) continue;
        const u = usersById.get(userId);
        if (
          set.size > 0 &&
          (!u?.jobPositionId || !set.has(u.jobPositionId))
        ) {
          slotMap[slotId] = null;
          mutated = true;
        }
      }
      if (mutated) slots.set(code, slotMap);
      return { positions, slots };
    });
  }

  function setSlotUser(code: string, slotId: string, userId: string | null) {
    setCurr((prev) => {
      const slots = new Map(prev.slots);
      const slotMap = { ...(slots.get(code) ?? {}) };
      slotMap[slotId] = userId;
      slots.set(code, slotMap);
      return { positions: prev.positions, slots };
    });
  }

  /**
   * Для per-employee журналов (гигиена/медкнижки/инструктажи) preset
   * специальный:
   *   • positionIds = ВСЕ должности с активными сотрудниками — чтобы
   *     задача автоматически создавалась на каждого работника.
   *   • Filler-slot users: оставляем null, потому что filler не
   *     один — это «каждый сотрудник за себя».
   *   • Verifier-slot user: самый старший по tier (admin > manager).
   */
  function buildPerEmployeeAssignment(code: string): {
    positionIds: Set<string>;
    slotUsers: SlotUserMap;
  } {
    const allPositions = new Set(
      positions.filter((p) => p.activeUsers > 0).map((p) => p.id),
    );
    const schema = getSchemaForJournal(code);
    const slotUsers: SlotUserMap = {};
    for (const slot of schema.slots) {
      if (slot.kind === "verifier") {
        const sorted = [...users].sort((a, b) => {
          const td = userTier(b) - userTier(a);
          if (td !== 0) return td;
          return a.name.localeCompare(b.name, "ru");
        });
        slotUsers[slot.id] = sorted[0]?.id ?? null;
      } else {
        slotUsers[slot.id] = null;
      }
    }
    return { positionIds: allPositions, slotUsers };
  }

  function applyJournalPreset(code: string) {
    const journal = journals.find((j) => j.code === code);
    if (journal && isPerEmployeeJournal(journal)) {
      const a = buildPerEmployeeAssignment(code);
      if (a.positionIds.size === 0) {
        toast.error(
          "Нет должностей с активными сотрудниками — preset нечего распределять",
        );
        return;
      }
      setCurr((prev) => {
        const pmap = new Map(prev.positions);
        const smap = new Map(prev.slots);
        pmap.set(code, a.positionIds);
        smap.set(code, a.slotUsers);
        return { positions: pmap, slots: smap };
      });
      const verifierUser = Object.values(a.slotUsers).find((v) => v);
      const verifierName = verifierUser
        ? users.find((u) => u.id === verifierUser)?.name
        : null;
      toast.success(
        `На каждого сотрудника · все должности (${a.positionIds.size})${verifierName ? `, проверяет ${verifierName}` : ""}`,
      );
      return;
    }

    const meta = getJournalResponsibilityMeta(code);
    if (!meta) {
      toast.error("Для этого журнала не описан умный пресет");
      return;
    }
    const matchedIds = matchPositionsForJournal(code, positions);
    if (matchedIds.length === 0) {
      toast.error(
        `Не нашёл должности под ключевые слова: ${meta.keywords.join(", ")}. Заведите подходящую должность или добавьте вручную.`
      );
      return;
    }
    const matchedSet = new Set(matchedIds);
    const slotMap = pickSlotUsersForJournal(code, matchedSet);
    setCurr((prev) => {
      const positions = new Map(prev.positions);
      const slots = new Map(prev.slots);
      positions.set(code, matchedSet);
      slots.set(code, slotMap);
      return { positions, slots };
    });
    const filledSlots = Object.values(slotMap).filter(Boolean).length;
    toast.success(
      filledSlots > 0
        ? `${meta.code} ← ${matchedIds.length} должн., ${filledSlots} ответственн.`
        : `${meta.code} ← ${matchedIds.length} должн. (нет подходящих сотрудников)`
    );
  }

  type Assignment = {
    positionIds: Set<string>;
    slotUsers: SlotUserMap;
  };

  /**
   * Балансировка: идём по журналам в порядке убывания их веса (тяжёлые
   * первыми). Для каждого вызываем pickSlotUsersForJournal с текущим
   * accumulator workload — это гарантирует что одинаково подходящие
   * кандидаты получат разные журналы. После выбора прибавляем вес
   * журнала к accumulator'у выбранных userId по их доле (filler-share
   * 1/N, verifier-share 0.3 — те же коэффициенты что в lib).
   */
  function computeAssignmentsFor(
    codes: readonly string[],
  ): Map<string, Assignment> {
    const result = new Map<string, Assignment>();
    const workloadAcc = new Map<string, number>();
    // Старт: уже назначенные (не в codes — но в curr) тоже учитываем,
    // чтобы preset не игнорировал то что менеджер сам уже расставил.
    for (const [code, slotMap] of curr.slots) {
      if (codes.includes(code)) continue;
      const w = getJournalMonthlyWeight(code, difficultyOverride);
      const fillerSlots = getSchemaForJournal(code).slots.filter(
        (s) => s.kind !== "verifier",
      );
      const verifierSlots = getSchemaForJournal(code).slots.filter(
        (s) => s.kind === "verifier",
      );
      const fillerUsers = fillerSlots
        .map((s) => slotMap[s.id])
        .filter((v): v is string => Boolean(v));
      const verifierUsers = verifierSlots
        .map((s) => slotMap[s.id])
        .filter((v): v is string => Boolean(v));
      if (fillerUsers.length > 0) {
        const share = w / fillerUsers.length;
        for (const uid of fillerUsers) {
          workloadAcc.set(uid, (workloadAcc.get(uid) ?? 0) + share);
        }
      }
      for (const uid of verifierUsers) {
        workloadAcc.set(uid, (workloadAcc.get(uid) ?? 0) + w * 0.3);
      }
    }

    // Сортируем целевые codes по весу — тяжёлые первыми.
    const codesByWeight = [...codes].sort(
      (a, b) =>
        getJournalMonthlyWeight(b, difficultyOverride) -
        getJournalMonthlyWeight(a, difficultyOverride),
    );

    for (const code of codesByWeight) {
      const journal = journals.find((j) => j.code === code);
      // Per-employee — спец-логика: все должности + admin verifier.
      if (journal && isPerEmployeeJournal(journal)) {
        const a = buildPerEmployeeAssignment(code);
        if (a.positionIds.size === 0) continue;
        result.set(code, a);
        const w = getJournalMonthlyWeight(code, difficultyOverride);
        const verifierUsers = Object.values(a.slotUsers).filter(
          (v): v is string => Boolean(v),
        );
        for (const uid of verifierUsers) {
          workloadAcc.set(uid, (workloadAcc.get(uid) ?? 0) + w * 0.3);
        }
        continue;
      }

      const matched = matchPositionsForJournal(code, positions);
      // Раньше при matched.length === 0 мы делали continue — журнал
      // полностью игнорировался. Это плохо: даже если у журнала нет
      // matching-должностей в keywords (например, equipment_calibration
      // ищет "технолог/инженер", а в орге их нет), мы всё равно можем
      // поставить verifier-админа и подобрать filler из общего пула.
      // Сейчас не пропускаем — positionSet остаётся empty, и
      // pickSlotUsersForJournal делает fallback на всех users.
      const positionSet = new Set(matched);
      const slotUsers = pickSlotUsersForJournal(
        code,
        positionSet,
        workloadAcc,
      );
      // Если ВООБЩЕ ничего не подобрали (пустой результат) — журнал
      // не сохраняем чтобы не ломать существующие.
      const hasAnyAssignment = Object.values(slotUsers).some((v) => v);
      if (!hasAnyAssignment && positionSet.size === 0) continue;
      result.set(code, { positionIds: positionSet, slotUsers });

      // Обновляем accumulator после выбора.
      const w = getJournalMonthlyWeight(code, difficultyOverride);
      const schema = getSchemaForJournal(code);
      const fillerUsers = schema.slots
        .filter((s) => s.kind !== "verifier")
        .map((s) => slotUsers[s.id])
        .filter((v): v is string => Boolean(v));
      const verifierUsers = schema.slots
        .filter((s) => s.kind === "verifier")
        .map((s) => slotUsers[s.id])
        .filter((v): v is string => Boolean(v));
      if (fillerUsers.length > 0) {
        const share = w / fillerUsers.length;
        for (const uid of fillerUsers) {
          workloadAcc.set(uid, (workloadAcc.get(uid) ?? 0) + share);
        }
      }
      for (const uid of verifierUsers) {
        workloadAcc.set(uid, (workloadAcc.get(uid) ?? 0) + w * 0.3);
      }
    }
    return result;
  }

  async function persistAssignments(
    assignments: Map<string, Assignment>,
    scope: "active-any" | "all" = "active-any"
  ): Promise<{ ok: number; failed: number }> {
    let ok = 0;
    let failed = 0;
    const successful = new Map<string, Assignment>();
    for (const [code, a] of assignments) {
      try {
        const res = await fetch(
          `/api/settings/journal-responsibles/${code}`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              positionIds: [...a.positionIds],
              slotUsers: a.slotUsers,
              scope,
            }),
          }
        );
        if (res.ok) {
          ok += 1;
          // Сервер мог авто-подобрать недостающие slot users.
          const data = await res.json().catch(() => null);
          const serverSlots = (data?.slotUsers ?? a.slotUsers) as SlotUserMap;
          successful.set(code, {
            positionIds: a.positionIds,
            slotUsers: serverSlots,
          });
        } else {
          failed += 1;
        }
      } catch {
        failed += 1;
      }
    }
    if (successful.size > 0) {
      const updateBoth = (prev: Selection): Selection => {
        const positions = new Map(prev.positions);
        const slots = new Map(prev.slots);
        for (const [code, a] of successful) {
          positions.set(code, new Set(a.positionIds));
          slots.set(code, { ...a.slotUsers });
        }
        return { positions, slots };
      };
      setCurr(updateBoth);
      setBase(updateBoth);
    }
    return { ok, failed };
  }

  function requestApplyAllPresets() {
    if (applying) return;
    if (positions.length === 0) {
      toast.error("Сначала создайте должности и сотрудников");
      return;
    }
    setApplyAllOpen(true);
  }

  async function applyAllPresets() {
    setApplying(true);
    try {
      const allCodes = journals.map((j) => j.code);
      const assignments = computeAssignmentsFor(allCodes);
      if (assignments.size === 0) {
        toast.error(
          "Ни одна должность не подошла под пресеты. Заведите должности " +
            "вроде «Уборщица», «Повар», «Менеджер»."
        );
        return;
      }
      const { ok, failed } = await persistAssignments(assignments);
      if (failed > 0) {
        toast.error(`Готово · применено: ${ok}, не удалось: ${failed}`);
      } else {
        toast.success(`Применено к ${ok} журналам`);
      }
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Ошибка сети");
    } finally {
      setApplying(false);
    }
  }

  async function applyCategoryPresets(category: JournalCategory) {
    if (applyingCategory) return;
    if (positions.length === 0) {
      toast.error("Сначала создайте должности и сотрудников");
      return;
    }
    setApplyingCategory(category);
    try {
      const codesInCategory = journals
        .filter((j) => {
          const meta = getJournalResponsibilityMeta(j.code);
          return (meta?.category ?? "other") === category;
        })
        .map((j) => j.code);
      const assignments = computeAssignmentsFor(codesInCategory);
      if (assignments.size === 0) {
        toast.error(
          `Не нашёл подходящих должностей для категории «${CATEGORY_LABELS[category]}». Заведите должность по теме (например, «Уборщица» для уборки).`
        );
        return;
      }
      const { ok, failed } = await persistAssignments(assignments);
      if (failed > 0) {
        toast.error(
          `«${CATEGORY_LABELS[category]}» · применено: ${ok}, не удалось: ${failed}`
        );
      } else {
        toast.success(
          `«${CATEGORY_LABELS[category]}» · применено к ${ok} журналам`
        );
      }
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Ошибка сети");
    } finally {
      setApplyingCategory(null);
    }
  }

  async function saveWithScope(scope: "active-any" | "all") {
    if (saving || dirty.size === 0) return;
    setSaving(true);
    try {
      const dirtyAssignments = new Map<string, Assignment>();
      for (const code of dirty) {
        dirtyAssignments.set(code, {
          positionIds: curr.positions.get(code) ?? new Set<string>(),
          slotUsers: curr.slots.get(code) ?? {},
        });
      }
      const { ok, failed } = await persistAssignments(dirtyAssignments, scope);
      if (failed > 0) {
        toast.error(
          `Сохранено: ${ok}, не удалось: ${failed}. Попробуйте ещё раз.`
        );
      } else {
        toast.success(
          scope === "all"
            ? `Применено ко всем документам · журналов: ${ok}`
            : `Применено к активным документам · журналов: ${ok}`
        );
        router.refresh();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Ошибка сети");
    } finally {
      setSaving(false);
    }
  }

  // «В активных» — без модалки, безопасное действие.
  async function save() {
    await saveWithScope("active-any");
  }

  // «Во всех» — с модальным confirm, потому что переписывает
  // закрытые/архивные документы и ломает аудит-trail.
  function requestSaveAll() {
    if (saving || dirty.size === 0) return;
    setSaveAllOpen(true);
  }

  async function saveAll() {
    await saveWithScope("all");
  }

  function discard() {
    setCurr({
      positions: new Map(
        [...base.positions].map(([k, v]) => [k, new Set(v)])
      ),
      slots: new Map(
        [...base.slots].map(([k, v]) => [k, { ...v }])
      ),
    });
  }

  async function resyncAll() {
    if (resyncing) return;
    // Раньше кнопка срабатывала сразу по клику, хотя переписывает шапку
    // и печатные ФИО внутри УЖЕ заполненных документов — отменить это
    // нечем. Спрашиваем подтверждение и называем последствия.
    const ok = await confirmAsync({
      title: "Перезаписать ответственных в документах?",
      description:
        "Во все документы, действующие сегодня, будут записаны ответственные из этой таблицы.",
      bullets: [
        {
          label:
            "Заполненные документы тоже будут переписаны: в шапке и в печати поменяются ФИО",
          tone: "warn",
        },
        {
          label: "Сами отметки и записи сотрудников не пострадают",
          tone: "info",
        },
        { label: "Откатить одной кнопкой нельзя", tone: "warn" },
      ],
      variant: "danger",
      confirmLabel: "Да, перезаписать",
    });
    if (!ok) return;
    setResyncing(true);
    try {
      const res = await fetch(
        "/api/settings/journal-responsibles/resync-all",
        { method: "POST" }
      );
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(data?.error ?? "Ошибка resync");
        return;
      }
      toast.success(
        `Перезаписано документов: ${data?.documentsUpdated ?? 0} (${data?.journalsProcessed ?? 0} журналов)`
      );
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Ошибка сети");
    } finally {
      setResyncing(false);
    }
  }

  async function requestDeleteAllDocuments() {
    if (deleting) return;
    // Preflight — заглядываем сколько ИМЕННО удалится, показываем в
    // модалке. Менеджер видит «33 документа, 1290 записей» и думает
    // дважды перед тем как ввести «УДАЛИТЬ».
    setDeletePreflight(null);
    try {
      const res = await fetch(
        "/api/settings/journals/delete-all-documents",
        { method: "GET" },
      );
      if (res.ok) {
        const counts = await res.json();
        setDeletePreflight(counts);
      }
    } catch {
      /* preflight не критичен */
    }
    setDeleteOpen(true);
  }

  async function deleteAllDocuments() {
    setDeleting(true);
    try {
      const res = await fetch(
        "/api/settings/journals/delete-all-documents",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirmation: "УДАЛИТЬ" }),
        }
      );
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(data?.error ?? "Ошибка удаления");
        return;
      }
      toast.success(
        `Удалено документов: ${data?.deletedDocuments ?? 0}` +
          (data?.deletedEntries
            ? `, записей: ${data.deletedEntries}`
            : "")
      );
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Ошибка сети");
    } finally {
      setDeleting(false);
    }
  }

  async function requestRecreateDocuments() {
    if (recreating) return;
    // Preflight: диалог должен назвать, сколько документов закроется и
    // сколько в них заполненных строк — без цифр это кнопка вслепую.
    setRecreatePreflight(null);
    try {
      const res = await fetch(
        "/api/settings/journal-responsibles/recreate-documents"
      );
      if (res.ok) setRecreatePreflight(await res.json());
    } catch {
      /* preflight не критичен */
    }
    setRecreateOpen(true);
  }

  async function recreateDocuments() {
    setRecreating(true);
    try {
      const res = await fetch(
        "/api/settings/journal-responsibles/recreate-documents",
        { method: "POST" }
      );
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(data?.error ?? "Ошибка пересоздания");
        return;
      }
      toast.success(
        `Закрыто: ${data?.closed ?? 0}, создано новых: ${data?.created ?? 0}` +
          (data?.errorsTotal ? `, ошибок: ${data.errorsTotal}` : "")
      );
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Ошибка сети");
    } finally {
      setRecreating(false);
    }
  }

  function toggleCategory(cat: JournalCategory) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }

  return (
    <div className="space-y-5">
      {/* Top bar */}
      <div className="flex flex-wrap items-center gap-3 rounded-3xl border border-[#ececf4] bg-white p-4">
        <button
          type="button"
          onClick={requestApplyAllPresets}
          disabled={applying || positions.length === 0}
          className="inline-flex h-11 items-center gap-2 rounded-2xl bg-gradient-to-br from-[#5566f6] to-[#7a5cff] px-4 text-[14px] font-medium text-white shadow-[0_10px_26px_-12px_rgba(85,102,246,0.6)] transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {applying ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Wand2 className="size-4" />
          )}
          Применить умные пресеты ко всем
        </button>

        <button
          type="button"
          onClick={resyncAll}
          disabled={resyncing || recreating}
          title="Перезаписать ФИО ответственных в шапке всех активных документов на текущие из настроек. Полезно если документы создавались до изменений."
          className="inline-flex h-11 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[13px] font-medium text-[#3c4053] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {resyncing ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Sparkles className="size-4 text-[#5566f6]" />
          )}
          Перезаписать в документах
        </button>

        <button
          type="button"
          onClick={requestRecreateDocuments}
          disabled={recreating || resyncing || deleting}
          title="Закрыть все активные документы и создать свежие со строками по умолчанию и текущими ответственными. Старые записи сохранятся в закрытых документах."
          className="inline-flex h-11 items-center gap-2 rounded-2xl border border-[#ffd2cd] bg-white px-4 text-[13px] font-medium text-[#a13a32] hover:border-[#a13a32]/50 hover:bg-[#fff4f2] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {recreating ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Wand2 className="size-4" />
          )}
          Пересоздать документы
        </button>

        <button
          type="button"
          onClick={requestDeleteAllDocuments}
          disabled={deleting || recreating || resyncing}
          title="Опасно: удалит ВСЕ документы журналов вместе с заполненными записями. Используется только для полного сброса."
          className="inline-flex h-11 items-center gap-2 rounded-2xl bg-[#a13a32] px-4 text-[13px] font-medium text-white hover:bg-[#8b3128] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {deleting ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Trash2 className="size-4" />
          )}
          Удалить все документы
        </button>

        <div className="relative ml-auto flex items-center">
          <Search className="absolute left-3 size-4 text-[#9b9fb3]" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск по журналу или роли…"
            className="h-11 w-[280px] rounded-2xl border border-[#dcdfed] bg-[#fafbff] pl-9 pr-3 text-[14px] text-[#0b1024] placeholder:text-[#9b9fb3] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
          />
        </div>

        {dirty.size > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[12px] text-[#a13a32]">
              Несохранённых: {dirty.size}
            </span>
            <button
              type="button"
              onClick={discard}
              disabled={saving}
              className="inline-flex h-9 items-center gap-1 rounded-xl border border-[#dcdfed] bg-white px-3 text-[13px] text-[#3c4053] hover:bg-[#fafbff] disabled:opacity-60"
            >
              Сбросить
            </button>
            {/* «В активных» — обычное безопасное сохранение. Каскад
                идёт только на active-документы и не-завершённые TF-задачи. */}
            <button
              type="button"
              onClick={save}
              disabled={saving}
              title="Применить только к текущим/активным документам и невыполненным TasksFlow-задачам. Закрытые архивные документы не трогаются."
              className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[#5566f6] px-3 text-[13px] font-medium text-white hover:bg-[#4a5bf0] disabled:opacity-60"
            >
              {saving ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Save className="size-3.5" />
              )}
              Сохранить (в активных)
            </button>
            {/* «Во всех» — каскад в архив + закрытые TF-задачи. Опасно,
                с confirm-модалкой. Кнопка outlined чтобы не сливалась с
                первичной. */}
            <button
              type="button"
              onClick={requestSaveAll}
              disabled={saving}
              title="Каскадно применить во ВСЕ документы — включая закрытые и архивные. Также переписывает verifier на уже одобренных/отклонённых TasksFlow-задачах. Опасное действие — потребует подтверждения."
              className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-[#a13a32] bg-white px-3 text-[13px] font-medium text-[#a13a32] hover:bg-[#fff4f2] disabled:opacity-60"
            >
              {saving ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Save className="size-3.5" />
              )}
              Изменить во всех…
            </button>
          </div>
        ) : null}
      </div>

      {positions.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-[#dcdfed] bg-[#fafbff] p-8 text-center text-[14px] text-[#6f7282]">
          В организации нет должностей. Сначала создайте должности и
          сотрудников в{" "}
          <a href="/settings/users" className="text-[#3848c7] hover:underline">
            Сотрудники
          </a>
          .
        </div>
      ) : null}

      {/* Fix-banner: показывается когда юзер пришёл с ?fix=<code> из
          уведомления. Объясняет проблему конкретного журнала и
          предлагает «Умный пресет» одним кликом — назначит подходящих
          сотрудников по семантике должностей. */}
      {fixCode && !fixDismissed
        ? (() => {
            const targetJournal = journals.find((j) => j.code === fixCode);
            if (!targetJournal) return null;
            // Собираем рекомендации из candidateGroupsForSlot. Берём
            // первого recommended кандидата из каждого ключевого slot'а.
            const schema = getSchemaForJournal(fixCode);
            const fillerSlots = schema.slots.filter(
              (s) => s.kind !== "verifier",
            );
            const verifierSlots = schema.slots.filter(
              (s) => s.kind === "verifier",
            );
            const fillerSuggestions = fillerSlots
              .map((s) => {
                const groups = candidateGroupsForSlot(fixCode, s.id);
                const top =
                  groups.recommended[0] ??
                  groups.ok[0] ??
                  groups.notRecommended[0];
                return top
                  ? {
                      slot: s,
                      candidate: top,
                    }
                  : null;
              })
              .filter((v): v is NonNullable<typeof v> => v !== null);
            const verifierSuggestion = (() => {
              for (const s of verifierSlots) {
                const groups = candidateGroupsForSlot(fixCode, s.id);
                const top = groups.recommended[0] ?? groups.ok[0];
                if (top) return { slot: s, candidate: top };
              }
              return null;
            })();
            const hasAnySuggestion =
              fillerSuggestions.length > 0 || verifierSuggestion !== null;
            return (
              <div className="rounded-3xl border-2 border-[#a13a32]/30 bg-gradient-to-br from-[#fff4f2] to-white p-5 shadow-[0_10px_30px_-12px_rgba(161,58,50,0.2)]">
                <div className="flex items-start gap-3">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-[#a13a32] text-white shadow-[0_8px_18px_-8px_rgba(161,58,50,0.5)]">
                    <Sparkles className="size-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[12px] font-semibold uppercase tracking-[0.12em] text-[#a13a32]">
                      Проблема с уведомления
                    </div>
                    <h3 className="mt-1 text-[16px] font-semibold leading-tight tracking-[-0.01em] text-[#0b1024]">
                      {targetJournal.name}
                    </h3>
                    {fixReason ? (
                      <p className="mt-1 text-[13px] leading-snug text-[#3c4053]">
                        Что не так:{" "}
                        <strong className="text-[#a13a32]">{fixReason}</strong>
                      </p>
                    ) : null}

                    {hasAnySuggestion ? (
                      <div className="mt-3 rounded-2xl border border-[#dcdfed] bg-white p-3">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[#3848c7]">
                          Рекомендация системы
                        </div>
                        <ul className="mt-1.5 space-y-1 text-[13px]">
                          {fillerSuggestions.map((sug) => (
                            <li
                              key={sug.slot.id}
                              className="flex items-start gap-1.5"
                            >
                              <span className="mt-1.5 inline-block size-1.5 shrink-0 rounded-full bg-[#5566f6]" />
                              <span className="text-[#3c4053]">
                                <strong>{sug.slot.label}</strong> →{" "}
                                <span className="text-[#0b1024]">
                                  {sug.candidate.user.name}
                                </span>
                                {sug.candidate.positionName ? (
                                  <span className="text-[#9b9fb3]">
                                    {" "}
                                    · {sug.candidate.positionName}
                                  </span>
                                ) : null}
                              </span>
                            </li>
                          ))}
                          {verifierSuggestion ? (
                            <li className="flex items-start gap-1.5">
                              <span className="mt-1.5 inline-block size-1.5 shrink-0 rounded-full bg-[#a16d32]" />
                              <span className="text-[#3c4053]">
                                <strong>Кто проверяет</strong> →{" "}
                                <span className="text-[#0b1024]">
                                  {verifierSuggestion.candidate.user.name}
                                </span>
                                {verifierSuggestion.candidate.positionName ? (
                                  <span className="text-[#9b9fb3]">
                                    {" "}
                                    ·{" "}
                                    {verifierSuggestion.candidate.positionName}
                                  </span>
                                ) : null}
                              </span>
                            </li>
                          ) : null}
                        </ul>
                      </div>
                    ) : (
                      <p className="mt-3 rounded-2xl border border-[#ffd2cd] bg-[#fff4f2] p-3 text-[13px] text-[#a13a32]">
                        Не нашёл подходящих сотрудников. Заведите должность
                        вроде «Заведующая» или «Старший повар» в{" "}
                        <a
                          href="/settings/users"
                          className="underline"
                        >
                          Сотрудниках
                        </a>
                        .
                      </p>
                    )}
                    <div className="mt-3 flex flex-wrap gap-2">
                      {hasAnySuggestion ? (
                        <button
                          type="button"
                          onClick={() => {
                            applyJournalPreset(fixCode);
                            // НЕ закрываем баннер — пусть юзер увидит
                            // что заполнилось, и нажмёт «Сохранить».
                          }}
                          className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[#5566f6] px-3 text-[13px] font-medium text-white shadow-[0_8px_20px_-10px_rgba(85,102,246,0.5)] hover:bg-[#4a5bf0]"
                        >
                          <Wand2 className="size-3.5" />
                          Применить рекомендацию
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => setFixDismissed(true)}
                        className="inline-flex h-9 items-center rounded-xl border border-[#dcdfed] bg-white px-3 text-[13px] font-medium text-[#3c4053] hover:border-[#5566f6]/40 hover:bg-[#fafbff]"
                      >
                        Скрыть подсказку
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })()
        : null}

      {/* Live workload preview — показывается когда есть несохранённые
          изменения. Помогает менеджеру понять «лучше или хуже стало». */}
      {workloadDiffs.length > 0 || imbalanceDiffs.length > 0 ? (
        <div className="sticky top-2 z-10 rounded-3xl border border-[#5566f6]/20 bg-gradient-to-br from-[#f5f6ff] to-white p-4 shadow-[0_10px_24px_-12px_rgba(85,102,246,0.25)]">
          <div className="mb-3 flex items-center gap-2">
            <Scale className="size-4 text-[#5566f6]" />
            <h3 className="text-[13px] font-semibold uppercase tracking-[0.12em] text-[#0b1024]">
              Прогноз нагрузки после сохранения
            </h3>
            <a
              href="/settings/workload-balance"
              className="ml-auto text-[11px] text-[#5566f6] hover:underline"
              target="_blank"
              rel="noopener noreferrer"
              title="Открыть полный дашборд распределения"
            >
              полный дашборд →
            </a>
          </div>

          {imbalanceDiffs.length > 0 ? (
            <div className="mb-3 grid gap-1.5 sm:grid-cols-2">
              {imbalanceDiffs.slice(0, 4).map((row) => {
                const improved = row.afterImb < row.beforeImb;
                const stillBad = row.afterImb >= 0.5;
                const tone = improved
                  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                  : stillBad
                    ? "border-rose-200 bg-rose-50 text-rose-800"
                    : "border-amber-200 bg-amber-50 text-amber-800";
                const Icon = improved ? TrendingDown : TrendingUp;
                return (
                  <div
                    key={row.positionId}
                    className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-[12px] ${tone}`}
                  >
                    <Icon className="size-4 shrink-0" />
                    <div className="min-w-0">
                      <div className="font-semibold">{row.positionName}</div>
                      <div className="text-[11px] opacity-80">
                        перекос:{" "}
                        <span className="tabular-nums">
                          {(row.beforeImb * 100).toFixed(0)}%
                        </span>
                        {" → "}
                        <span className="tabular-nums font-semibold">
                          {(row.afterImb * 100).toFixed(0)}%
                        </span>
                        {improved ? " · стало ровнее" : " · стало неравномернее"}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}

          {workloadDiffs.length > 0 ? (
            <div className="space-y-1">
              <div className="text-[11px] font-medium uppercase tracking-[0.1em] text-[#6f7282]">
                Изменения по сотрудникам
              </div>
              <div className="flex flex-wrap gap-1.5">
                {workloadDiffs.slice(0, 12).map((d) => {
                  const positive = d.delta > 0;
                  return (
                    <span
                      key={d.userId}
                      title={`${d.name} (${d.position ?? "без должности"}): было ${Math.round(d.before)}, станет ${Math.round(d.after)}`}
                      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] tabular-nums ${
                        positive
                          ? "bg-rose-50 text-rose-700"
                          : "bg-emerald-50 text-emerald-700"
                      }`}
                    >
                      {d.name.split(" ")[0] ?? d.name}
                      <span className="font-semibold">
                        {positive ? "+" : ""}
                        {Math.round(d.delta)}
                      </span>
                    </span>
                  );
                })}
                {workloadDiffs.length > 12 ? (
                  <span className="inline-flex items-center rounded-full bg-[#fafbff] px-2.5 py-1 text-[11px] text-[#9b9fb3]">
                    +{workloadDiffs.length - 12} ещё
                  </span>
                ) : null}
              </div>
            </div>
          ) : null}

          {imbalanceDiffs.length === 0 && workloadDiffs.length > 0 ? (
            <div className="mt-2 text-[11px] text-[#6f7282]">
              Изменения внутри одной должности не меняют картину
              перекоса — система просто перераспределяет работу между
              сотрудниками одной роли.
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Grouped journals */}
      <div className="space-y-5">
        {grouped.map(([cat, items]) => {
          const isCollapsed = collapsed.has(cat);
          const isApplyingThis = applyingCategory === cat;
          return (
            <section key={cat} className="space-y-3">
              <div className="flex flex-wrap items-center gap-2 px-1">
                <button
                  type="button"
                  onClick={() => toggleCategory(cat)}
                  className="group flex flex-1 items-center gap-2 rounded-xl text-left"
                >
                  {isCollapsed ? (
                    <ChevronRight className="size-4 text-[#6f7282] transition-transform" />
                  ) : (
                    <ChevronDown className="size-4 text-[#6f7282] transition-transform" />
                  )}
                  <h2 className="text-[14px] font-semibold uppercase tracking-[0.12em] text-[#0b1024]">
                    {CATEGORY_LABELS[cat]}
                  </h2>
                  <span className="text-[12px] text-[#9b9fb3]">
                    · {items.length}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => applyCategoryPresets(cat)}
                  disabled={
                    !!applyingCategory ||
                    applying ||
                    positions.length === 0
                  }
                  className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-[#dcdfed] bg-white px-2.5 text-[12px] font-medium text-[#5566f6] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] disabled:cursor-not-allowed disabled:opacity-50"
                  title={`Применить умные пресеты для категории «${CATEGORY_LABELS[cat]}»`}
                >
                  {isApplyingThis ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Wand2 className="size-3.5" />
                  )}
                  Применить пресет
                </button>
              </div>

              {isCollapsed ? null : (
                <div className="grid gap-2.5">
                  {items.map((j) => {
                    const set = curr.positions.get(j.code) ?? new Set<string>();
                    const slotMap = curr.slots.get(j.code) ?? {};
                    const isDirty = dirty.has(j.code);
                    const meta = j.meta;
                    const schema = getSchemaForJournal(j.code);
                    const isFixTarget =
                      fixCode === j.code && !fixDismissed;
                    return (
                      <div
                        key={j.code}
                        ref={(el) => {
                          if (el) cardRefs.current.set(j.code, el);
                          else cardRefs.current.delete(j.code);
                        }}
                        className={`rounded-2xl border-2 bg-white p-4 transition-all ${
                          isFixTarget
                            ? "border-[#a13a32] bg-[#fff4f2]/40 ring-4 ring-[#a13a32]/15 shadow-[0_10px_30px_-12px_rgba(161,58,50,0.25)]"
                            : isDirty
                              ? "border-[#ffe9b0] bg-[#fff8eb]/40"
                              : "border-[#ececf4]"
                        }`}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <div className="text-[15px] font-semibold leading-tight text-[#0b1024]">
                                {j.name}
                              </div>
                              {meta ? (
                                <span
                                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${MODE_TONE[meta.mode] ?? "bg-[#fafbff] text-[#6f7282]"}`}
                                >
                                  {MODE_LABELS[meta.mode]}
                                </span>
                              ) : null}
                            </div>
                            {meta?.who ? (
                              <p className="mt-1.5 text-[12px] leading-relaxed text-[#3c4053]">
                                {meta.who}
                              </p>
                            ) : j.description ? (
                              <p className="mt-1 line-clamp-2 text-[12px] leading-snug text-[#6f7282]">
                                {j.description}
                              </p>
                            ) : null}
                          </div>
                          {meta ? (
                            <button
                              type="button"
                              onClick={() => applyJournalPreset(j.code)}
                              className="inline-flex h-8 items-center gap-1 rounded-xl border border-[#dcdfed] bg-white px-2.5 text-[12px] text-[#5566f6] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
                              title={`Подставить должности по keywords: ${meta.keywords.join(", ") || "(всем)"}`}
                            >
                              <Sparkles className="size-3.5" />
                              Умный пресет
                            </button>
                          ) : null}
                        </div>

                        <div className="mt-3 flex flex-wrap gap-1.5">
                          {set.size === 0 ? (
                            <span className="rounded-full bg-[#fff4f2] px-2.5 py-1 text-[11px] font-medium text-[#a13a32]">
                              Никто не назначен
                            </span>
                          ) : null}
                          {[...set].map((pid) => {
                            const p = positionsById.get(pid);
                            if (!p) return null;
                            return (
                              <button
                                type="button"
                                key={pid}
                                onClick={() => togglePosition(j.code, pid)}
                                className="inline-flex items-center gap-1 rounded-full bg-[#eef1ff] px-2.5 py-1 text-[12px] font-medium text-[#3848c7] transition-colors hover:bg-[#fff4f2] hover:text-[#a13a32]"
                                title="Снять"
                              >
                                <Check className="size-3" />
                                {p.name}
                                <span className="text-[10px] text-[#9b9fb3]">
                                  ({p.activeUsers})
                                </span>
                              </button>
                            );
                          })}
                        </div>

                        <details className="mt-3">
                          <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-[12px] text-[#6f7282] hover:text-[#5566f6]">
                            <Plus className="size-3.5" />
                            Добавить должность
                          </summary>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {positions
                              .filter((p) => !set.has(p.id))
                              .map((p) => (
                                <button
                                  key={p.id}
                                  type="button"
                                  onClick={() =>
                                    togglePosition(j.code, p.id)
                                  }
                                  className="inline-flex items-center gap-1 rounded-lg border-0 bg-[#5566f6]/[0.04] px-2.5 py-1 text-[12px] text-[#3c4053] hover:bg-[#5566f6]/[0.09] hover:text-[#3848c7]"
                                >
                                  <Plus className="size-3" />
                                  {p.name}
                                  <span className="text-[10px] text-[#9b9fb3]">
                                    ({p.activeUsers})
                                  </span>
                                </button>
                              ))}
                          </div>
                        </details>

                        {/* Slot pickers — по одному на каждый «слот»
                            ответственного из schema этого журнала.
                            Phase C: разделены 2 секции:
                              • «Заполняют» — все filler-слоты (могут быть N)
                              • «Кто проверяет» — verifier-слот (1).
                            Filler'ы заполняют журнал, verifier
                            принимает работу через TasksFlow. */}
                        {(() => {
                          const fillerSlots = schema.slots.filter(
                            (s) => s.kind !== "verifier",
                          );
                          const verifierSlots = schema.slots.filter(
                            (s) => s.kind === "verifier",
                          );
                          return (
                            <>
                              <div className="mt-3">
                                <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#6f7282]">
                                  Заполняют журнал
                                </div>
                                <div className="space-y-2">
                                  {fillerSlots.map((slot, slotIdx) => (
                                    <SlotPicker
                                      key={slot.id}
                                      journalCode={j.code}
                                      slot={slot}
                                      slotIdx={slotIdx}
                                      slotMap={slotMap}
                                      positionsById={positionsById}
                                      usersById={usersById}
                                      candidateGroupsForSlot={
                                        candidateGroupsForSlot
                                      }
                                      onSetUser={setSlotUser}
                                    />
                                  ))}
                                </div>
                              </div>
                              {/* Per-employee — preset раздаёт всем
                                  должностям и админу-проверяющему.
                                  Помечаем явно подсказкой. */}
                              {isPerEmployeeJournal(j) ? (
                                <div className="mt-2 rounded-xl border border-[#5566f6]/15 bg-[#f5f6ff] p-2.5 text-[11px] leading-snug text-[#3848c7]">
                                  Журнал «На каждого сотрудника» —
                                  filler-слоты не нужны. Чек выполняет
                                  сам сотрудник, проверяет старший.
                                  Жми «Умный пресет» — добавит все
                                  должности и поставит админа в
                                  «Кто проверяет».
                                </div>
                              ) : null}
                              {verifierSlots.length > 0 ? (
                                <div className="mt-3">
                                  <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#3848c7]">
                                    <span className="inline-block size-1.5 rounded-full bg-[#5566f6]" />
                                    Кто проверяет
                                  </div>
                                  <div className="space-y-2">
                                    {verifierSlots.map((slot, slotIdx) => (
                                      <SlotPicker
                                        key={slot.id}
                                        journalCode={j.code}
                                        slot={slot}
                                        slotIdx={slotIdx}
                                        slotMap={slotMap}
                                        positionsById={positionsById}
                                        usersById={usersById}
                                        candidateGroupsForSlot={
                                          candidateGroupsForSlot
                                        }
                                        onSetUser={setSlotUser}
                                      />
                                    ))}
                                  </div>
                                </div>
                              ) : null}
                              {j.code === "finished_product" || j.code === "perishable_rejection" ? (
                                <CommissionSlotRow code={j.code} />
                              ) : null}
                            </>
                          );
                        })()}

                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}

        {grouped.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-[#dcdfed] bg-[#fafbff] p-8 text-center text-[14px] text-[#6f7282]">
            Не найдено журналов под «{query}».
          </div>
        ) : null}
      </div>

      <ConfirmDialog
        open={applyAllOpen}
        onClose={() => setApplyAllOpen(false)}
        onConfirm={async () => {
          setApplyAllOpen(false);
          await applyAllPresets();
        }}
        title="Применить умные пресеты ко всем журналам?"
        description={
          <>
            Система пройдётся по всем журналам в порядке убывания нагрузки
            и расставит должности и сотрудников по семантике. Уборка —
            уборщикам, температура — поварам, поверка — технологу или
            заведующей. Админ автоматически попадёт в «Кто проверяет».
          </>
        }
        bullets={[
          {
            label:
              "Существующие назначения будут перезаписаны там, где система нашла подходящих кандидатов.",
            tone: "warn",
          },
          {
            label:
              "Если для журнала нет matching должностей — он не трогается.",
            tone: "info",
          },
          {
            // Число журналов диалог раньше не называл — а каскад заодно
            // переписывает ответственных внутри активных документов.
            label: `Будет перебрано журналов: ${journals.length}; в активных документах ответственные тоже обновятся`,
            tone: "warn",
          },
        ]}
        confirmLabel="Да, применить ко всем"
        variant="default"
        icon={Wand2}
      />

      <ConfirmDialog
        open={saveAllOpen}
        onClose={() => setSaveAllOpen(false)}
        onConfirm={async () => {
          setSaveAllOpen(false);
          await saveAll();
        }}
        title="Изменить ответственных во всех документах?"
        description={
          <>
            Каскад затронет не только активные, но и закрытые/архивные
            документы. Это удобно для ретроспективы, но переписывает
            историю — будь осторожен.
          </>
        }
        bullets={[
          {
            label:
              "Старые подписи в PDF меняются на новые ФИО.",
            tone: "warn",
          },
          {
            label:
              "Verifier меняется и у уже отправленных TasksFlow-задач, включая «На проверке».",
            tone: "warn",
          },
          {
            label:
              "Откатить нельзя — каскад идёт в БД и в TasksFlow одновременно.",
            tone: "warn",
          },
          {
            label:
              "Если хочешь только текущие/активные — закрой и используй кнопку «Сохранить (в активных)».",
            tone: "info",
          },
        ]}
        confirmLabel="Да, переписать все документы"
        variant="danger"
        /* Переписывает историю и живые задачи TasksFlow без отката —
           по правилам проекта такое подтверждают фразой, а не кликом. */
        typeToConfirm="ПЕРЕПИСАТЬ"
      />

      <ConfirmDialog
        open={recreateOpen}
        onClose={() => setRecreateOpen(false)}
        onConfirm={async () => {
          setRecreateOpen(false);
          await recreateDocuments();
        }}
        title="Пересоздать документы?"
        description={
          <>
            Все ТЕКУЩИЕ активные документы будут закрыты, и взамен
            создадутся свежие — с дефолтными строками и текущими
            ответственными. Заполненные ранее записи останутся в
            закрытых документах (можно открыть для отчёта).
          </>
        }
        bullets={[
          ...(recreatePreflight
            ? [
                {
                  label: `Будет закрыто документов: ${recreatePreflight.activeDocCount}, в них уже заполнено строк: ${recreatePreflight.filledEntryCount}`,
                  tone: "warn" as const,
                },
              ]
            : []),
          {
            label:
              "Старые записи не теряются — они уйдут в закрытые документы.",
            tone: "info",
          },
          {
            label:
              "Новые документы возьмут ответственных из текущих настроек.",
            tone: "info",
          },
        ]}
        confirmLabel="Пересоздать"
        variant="warn"
      />

      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={async () => {
          setDeleteOpen(false);
          await deleteAllDocuments();
        }}
        title="Удалить ВСЕ документы журналов?"
        description={
          <>
            {deletePreflight ? (
              <span>
                Сейчас в БД:{" "}
                <strong className="text-[#a13a32]">
                  {deletePreflight.docCount} документ(ов)
                </strong>{" "}
                и{" "}
                <strong className="text-[#a13a32]">
                  {deletePreflight.entryCount} запис(ей)
                </strong>
                . Все они уйдут безвозвратно.
              </span>
            ) : (
              <span>
                Все документы журналов организации будут удалены вместе со
                всеми заполненными записями.
              </span>
            )}
          </>
        }
        bullets={[
          {
            label:
              "Восстановить нельзя — это полный сброс данных журналов.",
            tone: "warn",
          },
          {
            label:
              "Используется только когда нужно начать с чистого листа (тестовая компания, прежний пилот).",
            tone: "info",
          },
        ]}
        confirmLabel="Удалить навсегда"
        variant="danger"
        typeToConfirm="УДАЛИТЬ"
      />
    </div>
  );
}
