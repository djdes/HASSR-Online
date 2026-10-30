"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";
import { PageHeader, PageHeaderStat } from "@/components/ui/page-header";
import { ContactSupportButton } from "@/components/support/contact-support-button";
import { useCustomNames } from "@/components/shared/custom-names-provider";
import { customSectionName } from "@/lib/custom-names";
import { useRouter } from "next/navigation";
import {
  MapPin,
  Users,
  Archive,
  ArrowUpDown,
  BookOpen,
  Check,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  KeyRound,
  Mail,
  Pencil,
  Phone,
  Plus,
  Printer,
  QrCode,
  RefreshCcw,
  Send,
  Trash2,
  Unlink,
  UserPlus,
  Users as UsersIcon,
  X,
  Search,
} from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { ApiError, useBillingError } from "@/lib/billing-limit-toast";
import { cn } from "@/lib/utils";
import {
  clampOffset,
  monthDates,
  monthOf,
  shiftMonth,
} from "@/lib/staff-schedule-month";
import { Button } from "@/components/ui/button";
import { confirmAsync } from "@/components/ui/confirm-async";
import { StaffPairDialog } from "@/components/staff/staff-pair-dialog";
import { StaffQrInviteDialog } from "@/components/staff/staff-qr-invite-dialog";
import { StaffImportExport } from "@/components/staff/staff-import-export";
import { StaffBulkAddDialog } from "@/components/staff/staff-bulk-add-dialog";
import {
  StaffAddFlowDialog,
  StaffAddPeriodDialog,
  StaffArchiveDialog,
  StaffDeleteBlockedDialog,
  StaffEditEmployeeDialog,
  StaffEditPositionDialog,
  StaffIikoDialog,
  StaffInstructionDialog,
} from "@/components/staff/staff-dialogs";
import {
  StaffTelegramInviteDialog,
  StaffUnlinkTelegramDialog,
} from "@/components/staff/staff-telegram-dialogs";
import { WeekdayChips } from "@/components/staff/weekday-chips";
import { SubstituteBadge } from "@/components/staff/substitute-badge";
import { useSubstituteBadgeText } from "@/components/staff/point-assignment";
import {
  dayOffOverrideKey,
  isStaffDayOff,
  weekdayIndex,
  type StaffDayOffKind,
  type WorkOffBulkItem,
} from "@/lib/staff-days-off";
import type {
  PositionCategory,
  StaffEmployee,
  StaffPageProps,
  StaffPosition,
  StaffTelegramInvitePayload,
} from "@/components/staff/staff-types";
import { StaffAccessDialog } from "@/components/staff/staff-access-dialog";
import { printPage } from "@/lib/native-bridge";
import { staffApiErrorKey } from "@/components/staff/staff-api-error";
import { occupiesSeat, positionStaffing } from "@/lib/staffing";
import { formatPhone } from "@/lib/phone";
import { PlaceFilterResults } from "@/components/layout/place-filter-scope";

type TabKey = "work-off" | "vacations" | "sick-leaves" | "dismissals";

/** Ключ sessionStorage для «какая должность раскрыта в рубрике». */
const OPEN_POSITIONS_STORAGE_KEY = "staff.openPositions";

function formatDayCell(iso: string, locale: string) {
  const d = new Date(iso + "T00:00:00Z");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dayNum = d.getUTCDay();
  return {
    top: `${dd}.${mm}`,
    bottom: `${new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }).format(d)}.`,
    isWeekend: dayNum === 0 || dayNum === 6,
  };
}


/** Сколько записей журналов ссылается на сотрудника (ответ 409 API). */
async function readBlockedReferences(res: Response) {
  try {
    const data = (await res.clone().json()) as { references?: unknown };
    return typeof data.references === "number" ? data.references : 0;
  } catch {
    return 0;
  }
}

function formatRange(fromIso: string, toIso: string, locale: string) {
  return `${formatDate(fromIso, locale)} — ${formatDate(toIso, locale)}`;
}

function formatDate(iso: string, locale: string) {
  return new Intl.DateTimeFormat(locale, { dateStyle: "short", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));
}

function formatLongDate(iso: string, locale: string) {
  return new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));
}

function formatMonth(month: { year: number; month: number }, locale: string) {
  return new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(month.year, month.month, 1)));
}

type SortField = "name" | "position" | "date";
type SortOrder = "asc" | "desc";

/**
 * Сортировка таблицы графика выходных. `null` — исходный порядок, тот,
 * в котором сотрудники пришли с сервера. ПОЧЕМУ трёхтактно: тумблер
 * «по алфавиту» умел только вкл/выкл и ничего не говорил про должность;
 * клик по заголовку даёт по возрастанию → по убыванию → сброс.
 */
type StaffSortField = "name" | "position";
type StaffSort = { field: StaffSortField; order: SortOrder } | null;

export function StaffPageClient(props: StaffPageProps) {
  const { toastCaughtError } = useBillingError();
  const t = useTranslations("staffManagement.page");
  const tApi = useTranslations("staffManagement.dialogs.api");
  const locale = useLocale();
  const router = useRouter();
  const tabTitles: Record<TabKey, string> = {
    "work-off": t("tabWorkOff"),
    vacations: t("tabVacations"),
    "sick-leaves": t("tabSickLeaves"),
    dismissals: t("tabDismissals"),
  };
  // Своё название раздела «Сотрудники» у организации, если его задали.
  const staffTitle = customSectionName(useCustomNames(), "staff") ?? t("title");
  const [isPending, startTransition] = useTransition();
  const [bulkAddOpen, setBulkAddOpen] = useState(false);

  // Accordion: all open by default.
  const [categoryOpen, setCategoryOpen] = useState<
    Record<PositionCategory, boolean>
  >({ management: true, staff: true, commission: true });
  // В каждой рубрике раскрыта РОВНО ОДНА должность: со всеми открытыми
  // список сотрудников уезжал на два экрана вниз и «Добавить» терялся.
  // По умолчанию — первая должность рубрики.
  const [openPosition, setOpenPosition] = useState<
    Record<PositionCategory, string | null>
  >(() => ({
    management:
      props.positions.find((p) => p.categoryKey === "management")?.id ?? null,
    staff: props.positions.find((p) => p.categoryKey === "staff")?.id ?? null,
    commission: props.positions.find((p) => p.categoryKey === "commission")?.id ?? null,
  }));
  // Ручной выбор переживает router.refresh() — иначе после добавления
  // сотрудника аккордеон схлопывался обратно на первую должность.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(OPEN_POSITIONS_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, string | null>;
      setOpenPosition((prev) => ({
        management: parsed.management ?? prev.management,
        staff: parsed.staff ?? prev.staff,
        commission: parsed.commission ?? prev.commission,
      }));
    } catch {
      /* приватный режим / повреждённое значение — просто игнорируем */
    }
  }, []);

  // Быстрый поиск по ФИО: находит человека без раскрытия должностей.
  const [staffQuery, setStaffQuery] = useState("");
  const staffMatches = useMemo(() => {
    const q = staffQuery.trim().toLowerCase();
    if (!q) return [];
    const posNameById = new Map(props.positions.map((p) => [p.id, p.name]));
    return [...props.employees]
      .filter((e) => e.name.toLowerCase().includes(q) || (e.positionTitle ?? "").toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name, "ru"))
      .map((e) => ({ employee: e, position: (e.jobPositionId ? posNameById.get(e.jobPositionId) : null) ?? e.positionTitle ?? "" }));
  }, [staffQuery, props.employees, props.positions]);

  // Подсветка строки только что добавленного сотрудника.
  const [highlightPositionId, setHighlightPositionId] = useState<string | null>(
    null
  );
  useEffect(() => {
    if (!highlightPositionId) return;
    const timer = setTimeout(() => setHighlightPositionId(null), 1500);
    return () => clearTimeout(timer);
  }, [highlightPositionId]);

  const toggleCategory = (k: PositionCategory) =>
    setCategoryOpen((prev) => ({ ...prev, [k]: !prev[k] }));
  const togglePosition = (category: PositionCategory, id: string) =>
    setOpenPosition((prev) => {
      const next = { ...prev, [category]: prev[category] === id ? null : id };
      try {
        sessionStorage.setItem(
          OPEN_POSITIONS_STORAGE_KEY,
          JSON.stringify(next)
        );
      } catch {
        /* sessionStorage недоступен — состояние живёт только в памяти */
      }
      return next;
    });
  /** Раскрыть конкретную должность (после добавления сотрудника). */
  const revealPosition = (category: PositionCategory, id: string) => {
    setOpenPosition((prev) => {
      const next = { ...prev, [category]: id };
      try {
        sessionStorage.setItem(
          OPEN_POSITIONS_STORAGE_KEY,
          JSON.stringify(next)
        );
      } catch {
        /* см. выше */
      }
      return next;
    });
    setHighlightPositionId(id);
  };

  // Selection for bulk actions.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const anySelected = selected.size > 0;
  const toggleSelected = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const clearSelection = () => setSelected(new Set());

  // `?add=<место>` со страницы офиса или точки: сразу окно добавления в это
  // место, а параметр убираем — обновление страницы не откроет окно снова.
  const initialAddHandled = useRef(false);
  useEffect(() => {
    const target = props.initialAdd;
    if (!target || initialAddHandled.current) return;
    initialAddHandled.current = true;
    const categoryKey: PositionCategory = target.office ? "management" : "staff";
    const position = props.positions.find((p) => p.categoryKey === categoryKey) ?? null;
    setDlg({
      kind: "add-flow",
      initialStep: position ? 2 : 1,
      categoryKey,
      positionId: position?.id ?? null,
      buildingIds: [target.buildingId],
    });
    const url = new URL(window.location.href);
    url.searchParams.delete("add");
    router.replace(`${url.pathname}${url.search}`, { scroll: false });
  }, [props.initialAdd, props.positions, router]);

  // Modal state.
  const [dlg, setDlg] = useState<
    | {
        kind: "add-flow";
        initialStep: 1 | 2;
        categoryKey: PositionCategory;
        positionId: string | null;
        /** Место работы нового сотрудника (офис или точка), если задано заранее. */
        buildingIds?: string[];
      }
    | { kind: "edit-position"; position: StaffPosition }
    | { kind: "edit-employee"; employee: StaffEmployee; pending: boolean }
    | { kind: "access"; employee: StaffEmployee }
    | {
        kind: "tg-invite";
        employee: StaffEmployee;
        mode: "invite" | "rebind";
        pending: boolean;
        error: string | null;
        invite: StaffTelegramInvitePayload | null;
      }
    | { kind: "tg-unlink"; employee: StaffEmployee; pending: boolean }
    | { kind: "archive"; employee: StaffEmployee }
    | { kind: "delete-blocked"; employee: StaffEmployee; references: number }
    | { kind: "iiko" }
    | { kind: "instruction" }
    | { kind: "qr-invite" }
    | {
        kind: "add-period";
        periodKind: "vacation" | "sick_leave" | "dismissal";
      }
    | null
  >(null);

  // Tab state.
  const [tab, setTab] = useState<TabKey>("work-off");
  const [staffSort, setStaffSort] = useState<StaffSort>(null);
  /** Клик по заголовку: ↑ → ↓ → исходный порядок. */
  const cycleStaffSort = (field: StaffSortField) => {
    setStaffSort((current) => {
      if (!current || current.field !== field) return { field, order: "asc" };
      if (current.order === "asc") return { field, order: "desc" };
      return null;
    });
  };

  // Helper data shapes.
  const positionsByCategory = useMemo(() => {
    const groups: Record<PositionCategory, StaffPosition[]> = {
      management: [],
      staff: [],
      commission: [],
    };
    for (const p of props.positions) (groups[p.categoryKey] ?? groups.staff).push(p);
    return groups;
  }, [props.positions]);

  const employeesByPosition = useMemo(() => {
    const map = new Map<string | null, StaffEmployee[]>();
    const sortedEmployees = [...props.employees].sort((a, b) =>
      a.name.localeCompare(b.name, "ru")
    );
    for (const e of sortedEmployees) {
      const key = e.jobPositionId;
      const arr = map.get(key) ?? [];
      arr.push(e);
      map.set(key, arr);
    }
    return map;
  }, [props.employees]);

  const employeesDisplay = useMemo(() => {
    const copy = [...props.employees];
    if (!staffSort) return copy;
    // Должность в таблице — это имя из справочника, а не сырое
    // `positionTitle`: сортировать надо ровно по тому, что видно.
    const posNameById = new Map(props.positions.map((p) => [p.id, p.name]));
    const positionOf = (e: StaffEmployee) =>
      (e.jobPositionId
        ? posNameById.get(e.jobPositionId) ?? e.positionTitle ?? ""
        : e.positionTitle) || "";
    const sign = staffSort.order === "asc" ? 1 : -1;
    copy.sort((a, b) =>
      staffSort.field === "name"
        ? sign * a.name.localeCompare(b.name, "ru")
        : sign * positionOf(a).localeCompare(positionOf(b), "ru") ||
          a.name.localeCompare(b.name, "ru")
    );
    return copy;
  }, [props.employees, props.positions, staffSort]);

  // Явные исключения из недельного правила: `userId|date` → off/work.
  const workOffOverrides = useMemo(() => {
    const map = new Map<string, StaffDayOffKind>();
    for (const w of props.workOffDays) {
      map.set(dayOffOverrideKey(w.userId, w.date), w.kind);
    }
    return map;
  }, [props.workOffDays]);
  // График календарный, а не «20 дней от сегодня»: такой период нельзя
  // ни распечатать, ни повесить на кухне — он начинается сегодняшним
  // числом и обрывается посреди следующего месяца.
  const [monthOffset, setMonthOffset] = useState(0);
  const scheduleMonth = useMemo(
    () => shiftMonth(monthOf(new Date()), monthOffset),
    [monthOffset]
  );
  const workOffDates = useMemo(() => monthDates(scheduleMonth), [scheduleMonth]);

  // Sorting for period/dismissal tables.
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortOrder, setSortOrder] = useState<SortOrder>("asc");
  const cycleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder((o) => (o === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortOrder("asc");
    }
  };

  function sortRows<T extends { userName: string; positionLabel: string; dateFrom?: string; date?: string }>(
    rows: T[]
  ): T[] {
    const sign = sortOrder === "asc" ? 1 : -1;
    const copy = [...rows];
    copy.sort((a, b) => {
      if (sortField === "name") return sign * a.userName.localeCompare(b.userName, "ru");
      if (sortField === "position") return sign * a.positionLabel.localeCompare(b.positionLabel, "ru");
      const da = a.dateFrom ?? a.date ?? "";
      const dbb = b.dateFrom ?? b.date ?? "";
      return sign * da.localeCompare(dbb);
    });
    return copy;
  }

  // Action handlers.
  function localizeStaffApiError(message: string | undefined, status: number) {
    const key = staffApiErrorKey(message);
    switch (key) {
      case "managerOnly": return tApi("managerOnly");
      case "employeeNotFound": return tApi("employeeNotFound");
      case "positionNotFound": return tApi("positionNotFound");
      case "recordNotFound": return tApi("recordNotFound");
      case "endBeforeStart": return tApi("endBeforeStart");
      case "invalidDate": return tApi("invalidDate");
      case "rootCannotArchive": return tApi("rootCannotArchive");
      case "cannotArchiveSelf": return tApi("cannotArchiveSelf");
      case null: break;
    }
    return tApi("requestFailed", { status });
  }

  async function callJson(url: string, init?: RequestInit) {
    const res = await fetch(url, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      // С телом ответа: лимит тарифа (402) показываем с кнопкой «Оплатить».
      throw new ApiError(localizeStaffApiError(data?.error, res.status), data);
    }
    return res.json().catch(() => ({}));
  }

  /** Одна «покраска» графика — один запрос и один refresh. */
  async function handleWorkOffPaint(items: WorkOffBulkItem[]) {
    try {
      await callJson("/api/staff/schedules/work-off/bulk", {
        method: "POST",
        body: JSON.stringify({ items }),
      });
      toast.success(t("daysMarked", { count: items.length }));
      startTransition(() => router.refresh());
    } catch (error) {
      toast.error((error as Error).message);
      startTransition(() => router.refresh());
    }
  }

  async function handleWeeklyDaysOffChange(
    userId: string,
    weeklyDaysOff: number[]
  ) {
    try {
      await callJson(`/api/staff/${userId}`, {
        method: "PATCH",
        body: JSON.stringify({ weeklyDaysOff }),
      });
      startTransition(() => router.refresh());
    } catch (error) {
      toast.error((error as Error).message);
      startTransition(() => router.refresh());
    }
  }

  async function handleArchive(id: string) {
    try {
      await callJson(`/api/staff/${id}/archive`, { method: "POST" });
      toast.success(t("archivedOne"));
      setDlg(null);
      clearSelection();
      startTransition(() => router.refresh());
    } catch (error) {
      toast.error((error as Error).message);
    }
  }

  async function handleBulkArchive() {
    if (!anySelected) return;
    const ids = Array.from(selected);
    // Массовое действие без подтверждения: одиночный архив диалог
    // показывал, а «в архив» по галочкам срабатывал сразу.
    const confirmed = await confirmAsync({
      title: t("archiveCount", { count: ids.length }),
      description:
        t("archiveDescription"),
      bullets: [
        { label: t("archiveRecordsPreserved"), tone: "info" },
        { label: t("archiveCanRestore"), tone: "info" },
      ],
      variant: "danger",
      confirmLabel: t("archiveAction"),
    });
    if (!confirmed) return;
    let ok = 0;
    for (const id of ids) {
      try {
        await callJson(`/api/staff/${id}/archive`, { method: "POST" });
        ok++;
      } catch {
        /* ignore single failures, continue */
      }
    }
    toast.success(t("archivedSummary", { archived: ok, total: ids.length }));
    clearSelection();
    startTransition(() => router.refresh());
  }

  async function tryBulkDelete() {
    if (!anySelected) return;
    const ids = Array.from(selected);
    // Удаление необратимо, а подтверждения у массового действия не было.
    const confirmed = await confirmAsync({
      title: t("deleteCount", { count: ids.length }),
      description: t("deleteDescription"),
      bullets: [
        { label: t("deleteAccountWarning"), tone: "warn" },
        {
          label: t("deleteJournalWarning"),
          tone: "info",
        },
      ],
      variant: "danger",
      confirmLabel: t("deleteAction"),
      typeToConfirm: t("deleteTypeToConfirm"),
    });
    if (!confirmed) return;
    let deleted = 0;
    let blockedEmployee: StaffEmployee | null = null;
    let blockedReferences = 0;
    for (const id of ids) {
      try {
        const res = await fetch(`/api/staff/${id}`, { method: "DELETE" });
        if (res.ok) {
          deleted++;
        } else if (res.status === 409) {
          // Show the "delete blocked" dialog for the first journal-linked
          // employee and stop iterating — keeps the UX identical to the
          // reference design, where deletion pauses on the first conflict.
          if (!blockedEmployee) {
            blockedEmployee =
              props.employees.find((e) => e.id === id) ?? null;
            // Сервер присылает, сколько записей ссылается на сотрудника,
            // — показываем это число в диалоге, а не только сам запрет.
            blockedReferences = await readBlockedReferences(res);
          }
        }
      } catch {
        /* swallow, continue */
      }
    }
    if (deleted > 0) toast.success(t("deletedSummary", { count: deleted }));
    if (blockedEmployee) {
      setDlg({
        kind: "delete-blocked",
        employee: blockedEmployee,
        references: blockedReferences,
      });
    }
    clearSelection();
    startTransition(() => router.refresh());
  }

  async function handlePeriodAdd(payload: {
    kind: "vacation" | "sick_leave" | "dismissal";
    userId: string;
    dateFrom: string;
    dateTo?: string;
  }) {
    try {
      if (payload.kind === "dismissal") {
        await callJson("/api/staff/schedules/dismissals", {
          method: "POST",
          body: JSON.stringify({ userId: payload.userId, date: payload.dateFrom }),
        });
      } else {
        await callJson("/api/staff/schedules/periods", {
          method: "POST",
          body: JSON.stringify({
            kind: payload.kind,
            userId: payload.userId,
            dateFrom: payload.dateFrom,
            dateTo: payload.dateTo,
          }),
        });
      }
      toast.success(t("recordAdded"));
      setDlg(null);
      startTransition(() => router.refresh());
    } catch (error) {
      toast.error((error as Error).message);
    }
  }

  async function deletePeriodRow(id: string, kind: "vacation" | "sick_leave" | "dismissal") {
    try {
      const url =
        kind === "dismissal"
          ? `/api/staff/schedules/dismissals/${id}`
          : `/api/staff/schedules/periods/${id}?kind=${kind}`;
      await callJson(url, { method: "DELETE" });
      startTransition(() => router.refresh());
    } catch (error) {
      toastCaughtError(error, t("recordDeleteFailed"));
    }
  }

  async function openEditEmployee(employee: StaffEmployee) {
    setDlg({ kind: "edit-employee", employee, pending: false });
  }

  async function saveEmployeeEdit(
    id: string,
    patch: {
      name?: string;
      phone?: string | null;
      weeklyDaysOff?: number[];
      buildingIds?: string[];
      primaryBuildingId?: string | null;
    }
  ) {
    setDlg((current) =>
      current?.kind === "edit-employee" && current.employee.id === id
        ? { ...current, pending: true }
        : current
    );
    try {
      const res = await fetch(`/api/users/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        toast.error(t("saveFailed"));
        setDlg((current) =>
          current?.kind === "edit-employee" && current.employee.id === id
            ? { ...current, pending: false }
            : current
        );
        return;
      }
      toast.success(t("saved"));
      setDlg(null);
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("saveFailed")
      );
      setDlg((current) =>
        current?.kind === "edit-employee" && current.employee.id === id
          ? { ...current, pending: false }
          : current
      );
    }
  }

  // Привязка входа без Telegram живёт отдельным состоянием: общий `dlg`
  // и так несёт десяток вариантов, и вплетать туда одиннадцатый ради
  // одной кнопки — лишний риск задеть существующие ветки.
  const [pairEmployee, setPairEmployee] = useState<StaffEmployee | null>(null);

  async function openTelegramInvite(employee: StaffEmployee, mode: "invite" | "rebind") {
    setDlg({
      kind: "tg-invite",
      employee,
      mode,
      pending: true,
      error: null,
      invite: null,
    });

    try {
      const data = (await callJson(`/api/staff/${employee.id}/invite-tg`, {
        method: "POST",
        body: JSON.stringify({ mode }),
      })) as StaffTelegramInvitePayload;

      setDlg((current) =>
        current?.kind === "tg-invite" &&
        current.employee.id === employee.id &&
        current.mode === mode
          ? { ...current, pending: false, error: null, invite: data }
          : current
      );
    } catch (error) {
      setDlg((current) =>
        current?.kind === "tg-invite" &&
        current.employee.id === employee.id &&
        current.mode === mode
          ? {
              ...current,
              pending: false,
              error: (error as Error).message,
              invite: null,
            }
          : current
      );
    }
  }

  async function handleTelegramUnlink(employee: StaffEmployee) {
    setDlg({ kind: "tg-unlink", employee, pending: true });
    try {
      await callJson(`/api/staff/${employee.id}/unlink-tg`, { method: "POST" });
      toast.success(t("telegramUnlinked"));
      setDlg(null);
      startTransition(() => router.refresh());
    } catch (error) {
      toast.error((error as Error).message);
      setDlg({ kind: "tg-unlink", employee, pending: false });
    }
  }

  const firstSelected = anySelected
    ? props.employees.find((e) => selected.has(e.id)) ?? null
    : null;

  const totalEmployees = props.employees.length;
  const totalPositions = props.positions.length;
  const activeVacations = props.vacations.filter((v) => {
    const today = new Date().toISOString().slice(0, 10);
    return v.dateFrom <= today && today <= v.dateTo;
  }).length;
  const activeSickLeaves = props.sickLeaves.filter((s) => {
    const today = new Date().toISOString().slice(0, 10);
    return s.dateFrom <= today && today <= s.dateTo;
  }).length;
  // Точки: сотрудники без точки получают задачи со всех точек — об этом
  // стоит сказать сразу, а не ждать вопросов «почему мне пришло втрое».
  const staffWithoutBuilding = props.perLocationJournals
    ? props.employees.filter(
        (e) => e.isActive && !e.isRoot && (e.buildingIds ?? []).length === 0
      ).length
    : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title={staffTitle}
        description={t("description")}
        actions={
          <>
            <PageHeaderStat>{t("employeesStat", { count: totalEmployees })}</PageHeaderStat>
            <PageHeaderStat>{t("positionsStat", { count: totalPositions })}</PageHeaderStat>
            {activeVacations > 0 ? (
              <PageHeaderStat tone="warn">
                {t("vacationsStat", { count: activeVacations })}
              </PageHeaderStat>
            ) : null}
            {activeSickLeaves > 0 ? (
              <PageHeaderStat tone="warn">
                {t("sickLeaveStat", { count: activeSickLeaves })}
              </PageHeaderStat>
            ) : null}
            <StaffImportExport />
            <button
              type="button"
              onClick={() => setBulkAddOpen(true)}
              className="inline-flex h-10 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
            >
              <Users className="size-4 text-[#5566f6]" />
              {t("bulkAdd")}
            </button>
            <button
              type="button"
              onClick={() => setDlg({ kind: "qr-invite" })}
              className="inline-flex h-10 items-center gap-2 rounded-2xl bg-[#5566f6] px-4 text-[14px] font-medium text-white shadow-[0_12px_36px_-16px_rgba(85,102,246,0.65)] transition-colors hover:bg-[#4a5bf0]"
            >
              <QrCode className="size-4" />
              {t("inviteQr")}
            </button>
            <button
              type="button"
              onClick={() => setDlg({ kind: "instruction" })}
              className="inline-flex h-10 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
            >
              <BookOpen className="size-4" />
              {t("instruction")}
            </button>
          </>
        }
      />
      {props.placeFilter ?? null}

      {props.seatsBanner ? (
        <div
          data-testid="staff-seats-banner"
          className="flex flex-col gap-3 rounded-2xl border border-[#f5d9a8] bg-[#fffaf0] px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
        >
          <span className="text-[13.5px] leading-[1.5] text-[#7a4a00]">{props.seatsBanner.text}</span>
          {props.seatsBanner.action?.kind === "pay" ? (
            <a
              href={props.seatsBanner.action.href}
              className="inline-flex h-10 shrink-0 items-center justify-center rounded-2xl bg-[#5566f6] px-4 text-[14px] font-medium text-white transition-colors hover:bg-[#4a5bf0]"
            >
              {props.seatsBanner.action.label}
            </a>
          ) : props.seatsBanner.action?.kind === "contact" ? (
            <ContactSupportButton
              subject={props.seatsBanner.action.subject}
              className="inline-flex h-10 shrink-0 items-center justify-center rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors hover:bg-[#f5f6ff]"
            >
              {props.seatsBanner.action.label}
            </ContactSupportButton>
          ) : null}
        </div>
      ) : null}

      {staffWithoutBuilding > 0 ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border border-[#ffe1b5] bg-[#fff8ec] px-4 py-2.5 text-[13px] leading-snug text-[#8a5a12]">
          <MapPin className="size-4 shrink-0" />
          <span>
            {t("staffWithoutBuilding", { count: staffWithoutBuilding })}
          </span>
        </div>
      ) : null}

      {/* Bulk-action toolbar. На телефоне шапка кабинета 56px — прилипаем
          ровно под неё (`touch:top-14`), иначе в щель просвечивал список. */}
      {anySelected ? (
        <div className="sticky top-[60px] z-20 flex flex-wrap items-center gap-2 rounded-2xl border border-[#ececf4] bg-white px-4 py-2.5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] touch:top-14">
          <button
            type="button"
            onClick={clearSelection}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-[13px] font-medium text-[#6f7282] hover:bg-[#f5f6ff] hover:text-[#0b1024]"
          >
            <X className="size-4" />
            {t("selectedCount", { count: selected.size })}
          </button>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {selected.size === 1 && firstSelected ? (
              <>
              <button
                type="button"
                onClick={() =>
                  firstSelected.jobPositionId
                    ? setDlg({
                        kind: "edit-position",
                        position:
                          props.positions.find(
                            (p) => p.id === firstSelected.jobPositionId
                          )!,
                      })
                    : toast.error(t("positionMissing"))
                }
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#dcdfed] bg-white px-3 text-[13px] font-medium text-[#0b1024] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
              >
                <Pencil className="size-4" />
                {t("edit")}
              </button>
              {firstSelected.telegramLinked && props.telegramBotUrl ? (
                <Link
                  href={props.telegramBotUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#dcdfed] bg-white px-3 text-[13px] font-medium text-[#0b1024] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
                >
                  <ExternalLink className="size-4" />
                  {t("openTelegram")}
                </Link>
              ) : (
                <button
                  type="button"
                  onClick={() => void openTelegramInvite(firstSelected, "invite")}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#dbe1ff] bg-[#eef1ff] px-3 text-[13px] font-medium text-[#4054d8] hover:bg-[#e5e9ff]"
                >
                  <Send className="size-4" />
                  {t("inviteTelegram")}
                </button>
              )}
              {/* Вход по телефону — для тех, у кого Telegram нет или кто
                  работает через браузер и установленное приложение. */}
              <button
                type="button"
                onClick={() => setPairEmployee(firstSelected)}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#dcdfed] bg-white px-3 text-[13px] font-medium text-[#0b1024] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
              >
                <KeyRound className="size-4 text-[#5566f6]" />
                {t("pairSignIn")}
              </button>
              {firstSelected.telegramLinked ? (
                <>
                  <button
                    type="button"
                    onClick={() => void openTelegramInvite(firstSelected, "rebind")}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#dcdfed] bg-white px-3 text-[13px] font-medium text-[#6f7282] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] hover:text-[#0b1024]"
                  >
                  {t("rebindTelegram")}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setDlg({
                        kind: "tg-unlink",
                        employee: firstSelected,
                        pending: false,
                      })
                    }
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#ffd2cd] bg-[#fff4f2] px-3 text-[13px] font-medium text-[#d2453d] hover:bg-[#ffecea]"
                  >
                    <Unlink className="size-4" />
                    {t("unlinkTelegram")}
                  </button>
                </>
              ) : null}
              </>
            ) : null}
            <button
              type="button"
              onClick={handleBulkArchive}
              disabled={isPending}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#dcdfed] bg-white px-3 text-[13px] font-medium text-[#0b1024] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] disabled:opacity-60"
            >
              <Archive className="size-4" />
              {t("archive")}
            </button>
            <button
              type="button"
              onClick={tryBulkDelete}
              disabled={isPending}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#ffd2cd] bg-[#fff4f2] px-3 text-[13px] font-medium text-[#d2453d] hover:bg-[#ffecea] disabled:opacity-60"
            >
              <Trash2 className="size-4" />
              {t("delete")}
            </button>
          </div>
        </div>
      ) : null}

      {/* Быстрый поиск по ФИО — результаты сразу, без раскрытия должностей. */}
      <div className="rounded-2xl border border-[#ececf4] bg-white p-3 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-[#9b9fb3]" />
          <input
            type="search"
            value={staffQuery}
            onChange={(event) => setStaffQuery(event.target.value)}
            placeholder={t("searchPlaceholder")}
            aria-label={t("searchLabel")}
            className="h-12 w-full rounded-2xl border border-[#dcdfed] bg-white pl-11 pr-4 text-[15px] text-[#0b1024] placeholder:text-[#9b9fb3] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
          />
        </div>
        {staffQuery.trim() ? (
          <div className="mt-3" data-testid="staff-search-results">
            {staffMatches.length === 0 ? (
              <p className="px-1 py-2 text-[13px] text-[#9b9fb3]">{t("searchNoResults", { query: staffQuery.trim() })}</p>
            ) : (
              <ul className="divide-y divide-[#ececf4] rounded-2xl border border-[#ececf4]">
                {staffMatches.map(({ employee, position }) => (
                  <li key={employee.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <span className="min-w-0">
                      <span className="block truncate text-[14px] font-medium text-[#0b1024]">{employee.name}</span>
                      {position ? <span className="block text-[12px] text-[#6f7282]">{position}</span> : null}
                    </span>
                    <button
                      type="button"
                      onClick={() => void openEditEmployee(employee)}
                      className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl border border-[#dcdfed] bg-white px-3 text-[13px] font-medium text-[#3848c7] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
                    >
                      <Pencil className="size-3.5" />
                      {t("change")}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
      </div>

      {/* Список по должностям, вкладки и таблица — область фильтра «Где
          работает»: пока данные места не пришли, вместо неё скелет. */}
      <PlaceFilterResults className="space-y-6" rows={6}>
      {/* Positions by category. Синюю шапку с названием организации
          убрали: название и так есть в hero и в крошках, а лишний
          аккордеон только отодвигал список вниз. */}
      <div className="overflow-hidden rounded-2xl border border-[#ececf4] bg-white shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
        {/* `touch:grid-cols-1!` — на телефоне колонка `minmax(0, 1fr)`:
            общее правило globals.css ставит `1fr !important`, такая колонка
            не ужимается уже самой широкой строки, и на 360px сетка вылезала
            за карточку — «+ Должность» обрезалась. Слоёный !important
            утилиты сильнее неслоёного, поэтому здесь восклицательный знак. */}
        <div
          className={`grid gap-6 bg-[#f4f5fb] p-5 md:grid-cols-2 md:gap-8 md:p-6 touch:grid-cols-1! ${
            positionsByCategory.commission.length > 0 ? "xl:grid-cols-3" : ""
          }`}
        >
          {/* «Комиссия» — сторонние члены бракеражной комиссии: колонка
              появляется, когда в ней есть должность (заводится из окна
              «Сторонняя бракеражная комиссия» журнала бракеража). */}
          {((positionsByCategory.commission.length > 0
            ? ["management", "staff", "commission"]
            : ["management", "staff"]) as PositionCategory[]).map((cat) => (
            <CategoryColumn
                key={cat}
                title={t(`category.${cat}`)}
                categoryKey={cat}
                open={categoryOpen[cat]}
                onToggle={() => toggleCategory(cat)}
                positions={positionsByCategory[cat]}
                openPositionId={openPosition[cat]}
                highlightPositionId={highlightPositionId}
                togglePosition={(id) => togglePosition(cat, id)}
                employeesByPosition={employeesByPosition}
                selected={selected}
                toggleSelected={toggleSelected}
                telegramBotUrl={props.telegramBotUrl}
                onInviteTelegram={(employee) => void openTelegramInvite(employee, "invite")}
                onRebindTelegram={(employee) => void openTelegramInvite(employee, "rebind")}
                onUnlinkTelegram={(employee) =>
                  setDlg({ kind: "tg-unlink", employee, pending: false })
                }
                onEditEmployee={(employee) => void openEditEmployee(employee)}
                onAddPosition={() =>
                  setDlg({
                    kind: "add-flow",
                    initialStep: 1,
                    categoryKey: cat,
                    positionId: null,
                  })
                }
                onAddEmployee={(position) =>
                  // Должность уже есть — открываем сразу шаг 2.
                  setDlg({
                    kind: "add-flow",
                    initialStep: 2,
                    categoryKey: position.categoryKey,
                    positionId: position.id,
                  })
                }
                onEditPosition={(position) => setDlg({ kind: "edit-position", position })}
              />
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div
        data-print-hide
        className="overflow-x-auto pb-0 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
      <div className="flex min-w-max items-center gap-6 border-b border-[#ececf4]">
        {[
          { key: "work-off" as TabKey, label: tabTitles["work-off"] },
          { key: "vacations" as TabKey, label: tabTitles.vacations },
          { key: "sick-leaves" as TabKey, label: tabTitles["sick-leaves"] },
          { key: "dismissals" as TabKey, label: tabTitles.dismissals },
        ].map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={cn(
                "relative -mb-px pb-3 pt-1 text-[14px] font-medium transition-colors",
                active
                  ? "text-[#0b1024]"
                  : "text-[#9b9fb3] hover:text-[#6f7282]"
              )}
            >
              {t.label}
              {active ? (
                <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-[#5566f6]" />
              ) : null}
            </button>
          );
        })}
      </div>
      </div>

      {/* Tab content. `data-print-landscape` переводит лист в альбомную
          ориентацию — см. @page в globals.css. */}
      <section className="space-y-4" data-print-landscape>
        {/* Шапка листа: на экране её нет, на бумаге по ней понятно,
            чей это график и за какой период. */}
        <div className="hidden print:block">
          <div className="text-[11px] uppercase tracking-[0.14em] text-black">
            {props.organization.name}
          </div>
          <div className="mt-1 text-[16px] font-semibold text-black">
            {tabTitles[tab]}
            {tab === "work-off" ? ` — ${formatMonth(scheduleMonth, locale)}` : null}
          </div>
          {tab === "work-off" && workOffDates.length > 0 ? (
            <div className="mt-0.5 text-[10px] text-black">
              {t("period", { from: formatLongDate(workOffDates[0], locale), to: formatLongDate(workOffDates[workOffDates.length - 1], locale) })}
            </div>
          ) : null}
        </div>

        <h2 className="text-center text-[18px] font-semibold text-[#0b1024] print:hidden">
          {tabTitles[tab]}
        </h2>

        <div
          data-print-hide
          className="flex flex-wrap items-center justify-between gap-2"
        >
          {tab === "work-off" ? (
            <div className="flex items-center gap-1 rounded-2xl border border-[#dcdfed] bg-white p-1">
              <button
                type="button"
                aria-label={t("previousMonth")}
                onClick={() => setMonthOffset((o) => clampOffset(o - 1))}
                className="rounded-xl px-2.5 py-1.5 text-[#6f7282] transition-colors hover:bg-[#f5f6ff] hover:text-[#3848c7]"
              >
                <ChevronDown className="size-4 rotate-90" />
              </button>
              <span className="min-w-[132px] text-center text-[13.5px] font-medium tabular-nums text-[#0b1024]">
                {formatMonth(scheduleMonth, locale)}
              </span>
              <button
                type="button"
                aria-label={t("nextMonth")}
                onClick={() => setMonthOffset((o) => clampOffset(o + 1))}
                className="rounded-xl px-2.5 py-1.5 text-[#6f7282] transition-colors hover:bg-[#f5f6ff] hover:text-[#3848c7]"
              >
                <ChevronDown className="size-4 -rotate-90" />
              </button>
              {monthOffset !== 0 ? (
                <button
                  type="button"
                  onClick={() => setMonthOffset(0)}
                  className="ml-1 rounded-xl px-2.5 py-1.5 text-[13px] text-[#3848c7] transition-colors hover:bg-[#f5f6ff]"
                >
                  {t("currentMonth")}
                </button>
              ) : null}
            </div>
          ) : (
            <span />
          )}

          <button
            type="button"
            onClick={() => void printPage()}
            className="inline-flex h-10 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[13.5px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
            title={t("printTitle")}
          >
            <Printer className="size-4 text-[#5566f6]" />
            {t("print")}
          </button>
        </div>

        <div
          data-print-hide
          className="space-y-2 text-[13px] leading-[1.55] text-[#6f7282]"
        >
          {tab === "work-off" ? (
            <p className="rounded-2xl border border-[#ececf4] bg-[#fafbff] px-4 py-3 text-[#3c4053]">
              {t.rich("guideNewMonth", { strong: (chunks) => <b>{chunks}</b> })}
            </p>
          ) : null}
          {/* Один общий абзац про выходные висел на всех четырёх вкладках
              и обещал разное. Теперь на каждой вкладке честно написано,
              что именно происходит. */}
          {tab === "work-off" && (
            <p>{t.rich("guideWorkOff", { strong: (chunks) => <b>{chunks}</b> })}</p>
          )}
          {tab === "vacations" && (
            <p>{t.rich("guideVacation", { strong: (chunks) => <b>{chunks}</b> })}</p>
          )}
          {tab === "sick-leaves" && (
            <p>{t.rich("guideSickLeave", { strong: (chunks) => <b>{chunks}</b> })}</p>
          )}
          {tab === "dismissals" && (
            <p>{t.rich("guideDismissal", { strong: (chunks) => <b>{chunks}</b> })}</p>
          )}
        </div>

        {tab === "work-off" ? (
          <WorkOffGrid
            employees={employeesDisplay}
            positions={props.positions}
            dates={workOffDates}
            overrides={workOffOverrides}
            sort={staffSort}
            onSort={cycleStaffSort}
            onIikoClick={() => setDlg({ kind: "iiko" })}
            onPaint={handleWorkOffPaint}
            onChangeWeekly={handleWeeklyDaysOffChange}
          />
        ) : tab === "dismissals" ? (
          <PeriodsTable
            rows={sortRows(props.dismissals)}
            kind="dismissal"
            onAdd={() => setDlg({ kind: "add-period", periodKind: "dismissal" })}
            onDelete={deletePeriodRow}
            onSort={cycleSort}
            sortField={sortField}
            sortOrder={sortOrder}
          />
        ) : (
          <PeriodsTable
            rows={
              tab === "vacations"
                ? sortRows(props.vacations)
                : sortRows(props.sickLeaves)
            }
            kind={tab === "vacations" ? "vacation" : "sick_leave"}
            onAdd={() =>
              setDlg({
                kind: "add-period",
                periodKind: tab === "vacations" ? "vacation" : "sick_leave",
              })
            }
            onDelete={deletePeriodRow}
            onSort={cycleSort}
            sortField={sortField}
            sortOrder={sortOrder}
          />
        )}
      </section>
      </PlaceFilterResults>

      {/* Modals */}
      {dlg?.kind === "add-flow" ? (
        <StaffAddFlowDialog
          initialStep={dlg.initialStep}
          categoryKey={dlg.categoryKey}
          initialPositionId={dlg.positionId}
          positions={props.positions}
          positionSuggestions={props.positionSuggestions[dlg.categoryKey]}
          hasTasksflowIntegration={props.hasTasksflowIntegration}
          buildings={props.buildings ?? []}
          perLocationJournals={props.perLocationJournals === true}
          defaultBuildingIds={
            dlg.buildingIds ??
            (props.perLocationJournals && props.activeBuildingId
              ? [props.activeBuildingId]
              : [])
          }
          open
          onClose={() => setDlg(null)}
          // Должность создана — список обновляем, но диалог остаётся
          // открытым: он сам уводит менеджера на шаг «сотрудник».
          onPositionCreated={() => startTransition(() => router.refresh())}
          onCreated={(result) => {
            // Раскрываем должность, в которую только что добавили
            // человека, и подсвечиваем её — иначе новая фамилия
            // теряется в свёрнутом аккордеоне.
            if (result?.positionId) {
              revealPosition(dlg.categoryKey, result.positionId);
            }
            startTransition(() => router.refresh());
          }}
        />
      ) : null}
      {dlg?.kind === "edit-position" ? (
        <StaffEditPositionDialog
          position={dlg.position}
          open
          onClose={() => setDlg(null)}
          onUpdated={() => {
            setDlg(null);
            clearSelection();
            startTransition(() => router.refresh());
          }}
        />
      ) : null}
      {/* Своё состояние — рендерим безусловно, рядом с остальными окнами. */}
      <StaffPairDialog
        open={Boolean(pairEmployee)}
        employeeId={pairEmployee?.id ?? null}
        employeeName={pairEmployee?.name ?? null}
        onClose={() => setPairEmployee(null)}
      />
      {dlg?.kind === "qr-invite" ? (
        <StaffQrInviteDialog
          positions={props.positions}
          open
          onClose={() => setDlg(null)}
        />
      ) : null}
      {dlg?.kind === "edit-employee" ? (
        <StaffEditEmployeeDialog
          employee={dlg.employee}
          pending={dlg.pending}
          buildings={props.buildings ?? []}
          perLocationJournals={props.perLocationJournals === true}
          todayKey={props.todayKey}
          onAssignmentChanged={() => {
            setDlg(null);
            startTransition(() => router.refresh());
          }}
          open
          onClose={() => setDlg(null)}
          onSave={(patch) => void saveEmployeeEdit(dlg.employee.id, patch)}
          // Диалоги не стекуем: редактирование закрывается, окно доступа
          // открывается на его месте — два Radix-диалога друг над другом
          // ловят фокус и закрываются одним Esc не в том порядке.
          onOpenAccess={() => setDlg({ kind: "access", employee: dlg.employee })}
        />
      ) : null}
      {dlg?.kind === "access" ? (
        <StaffAccessDialog
          open
          userId={dlg.employee.id}
          onClose={() => setDlg(null)}
          onSaved={() => router.refresh()}
        />
      ) : null}
      {bulkAddOpen ? (
        <StaffBulkAddDialog
          positions={props.positions.map((position) => ({
            id: position.id,
            name: position.name,
            categoryKey: position.categoryKey,
          }))}
          onClose={() => setBulkAddOpen(false)}
          onDone={() => router.refresh()}
        />
      ) : null}
      {dlg?.kind === "tg-invite" ? (
        <StaffTelegramInviteDialog
          employee={dlg.employee}
          mode={dlg.mode}
          botUrl={props.telegramBotUrl}
          pending={dlg.pending}
          error={dlg.error}
          invite={dlg.invite}
          open
          onClose={() => setDlg(null)}
        />
      ) : null}
      {dlg?.kind === "tg-unlink" ? (
        <StaffUnlinkTelegramDialog
          employee={dlg.employee}
          pending={dlg.pending}
          open
          onClose={() => setDlg(null)}
          onConfirm={() => void handleTelegramUnlink(dlg.employee)}
        />
      ) : null}
      {dlg?.kind === "archive" ? (
        <StaffArchiveDialog
          employee={dlg.employee}
          open
          onClose={() => setDlg(null)}
          onConfirm={() => handleArchive(dlg.employee.id)}
        />
      ) : null}
      {dlg?.kind === "delete-blocked" ? (
        <StaffDeleteBlockedDialog
          employee={dlg.employee}
          references={dlg.references}
          open
          onClose={() => setDlg(null)}
        />
      ) : null}
      {dlg?.kind === "iiko" ? (
        <StaffIikoDialog open onClose={() => setDlg(null)} />
      ) : null}
      {dlg?.kind === "instruction" ? (
        <StaffInstructionDialog open onClose={() => setDlg(null)} />
      ) : null}
      {dlg?.kind === "add-period" ? (
        <StaffAddPeriodDialog
          kind={dlg.periodKind}
          positions={props.positions}
          employees={props.employees}
          open
          onClose={() => setDlg(null)}
          onConfirm={handlePeriodAdd}
        />
      ) : null}
    </div>
  );
}

function CategoryColumn(props: {
  title: string;
  categoryKey: PositionCategory;
  open: boolean;
  onToggle: () => void;
  positions: StaffPosition[];
  /** В рубрике раскрыта ровно одна должность (или ни одной). */
  openPositionId: string | null;
  /** Должность, в которую только что добавили сотрудника. */
  highlightPositionId: string | null;
  togglePosition: (id: string) => void;
  employeesByPosition: Map<string | null, StaffEmployee[]>;
  selected: Set<string>;
  toggleSelected: (id: string) => void;
  telegramBotUrl: string | null;
  onInviteTelegram: (employee: StaffEmployee) => void;
  onRebindTelegram: (employee: StaffEmployee) => void;
  onUnlinkTelegram: (employee: StaffEmployee) => void;
  onEditEmployee: (employee: StaffEmployee) => void;
  onAddPosition: () => void;
  onAddEmployee: (position: StaffPosition) => void;
  onEditPosition: (position: StaffPosition) => void;
}) {
  const t = useTranslations("staffManagement.page");
  const substituteBadge = useSubstituteBadgeText();
  const headerAccentClass =
    props.categoryKey === "management"
      ? "bg-[#fff8eb] text-[#b25f00]"
      : props.categoryKey === "commission"
        ? "bg-[#ecfdf5] text-[#116b2a]"
        : "bg-[#eef1ff] text-[#5566f6]";
  const totalEmployees = props.positions.reduce(
    (sum, p) => sum + (props.employeesByPosition.get(p.id)?.length ?? 0),
    0
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={props.onToggle}
          className="inline-flex min-w-0 items-center gap-2 text-[15px] font-semibold text-[#0b1024]"
        >
          <span
            className={`flex size-7 shrink-0 items-center justify-center rounded-lg ${headerAccentClass}`}
            aria-hidden
          >
            <UsersIcon className="size-3.5" />
          </span>
          <span className="min-w-0 truncate">{props.title}</span>
          <span
            className={`inline-flex h-5 items-center rounded-full px-2 text-[11px] font-medium ${headerAccentClass}`}
          >
            {totalEmployees}
          </span>
          <ChevronDown
            className={cn(
              "size-4 text-[#9b9fb3] transition-transform",
              props.open && "rotate-180"
            )}
          />
        </button>
        {/* Не голый «+» на краю: иконку рядом со стрелкой сворачивания
            не замечали, а завести должность — первое, что нужно сделать
            на пустой странице. Кнопка с подписью и заливкой стоит сразу
            за заголовком рубрики, а не у противоположного края. */}
        <button
          type="button"
          onClick={props.onAddPosition}
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-2xl bg-[#eef1ff] px-3 text-[13px] font-semibold text-[#3848c7] transition-colors hover:bg-[#5566f6] hover:text-white"
        >
          <Plus className="size-4" />
          {t("position")}
        </button>
      </div>
      {props.open ? (
        <div className="space-y-2">
          {props.positions.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-[#dcdfed] bg-white px-4 py-8 text-center text-[13px] text-[#9b9fb3]">
              {t("noPositions")}
            </p>
          ) : (
            props.positions.map((p) => {
              const employees = props.employeesByPosition.get(p.id) ?? [];
              const open = props.openPositionId === p.id;
              const highlighted = props.highlightPositionId === p.id;
              return (
                <div
                  key={p.id}
                  className={cn(
                    "group/pos overflow-hidden rounded-2xl border bg-white shadow-[0_1px_2px_0_rgba(11,16,36,0.04),0_4px_10px_-6px_rgba(11,16,36,0.12)] transition-[box-shadow,transform,border-color] hover:-translate-y-0.5 hover:shadow-[0_8px_24px_-12px_rgba(85,102,246,0.22)]",
                    highlighted
                      ? "border-[#5566f6] ring-4 ring-[#5566f6]/15"
                      : "border-[#e2e5ef]"
                  )}
                >
                  <div className="flex items-center gap-2 px-4 py-2.5">
                    <button
                      type="button"
                      onClick={() => props.togglePosition(p.id)}
                      className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 text-left"
                    >
                      <span className="text-[14px] font-medium text-[#0b1024]">
                        {p.name}
                      </span>
                      {p.plannedHeadcount != null ? (
                        <StaffingPill
                          planned={p.plannedHeadcount}
                          occupied={employees.filter(occupiesSeat).length}
                        />
                      ) : (
                        <span className="inline-flex h-4 items-center rounded-full bg-[#f5f6ff] px-1.5 text-[10px] font-medium text-[#9b9fb3]">
                          {employees.length}
                        </span>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => props.onAddEmployee(p)}
                      title={t("addToPosition", { position: p.name })}
                      aria-label={t("addToPosition", { position: p.name })}
                      // На hover/фокусе — быстрый «+» прямо в шапке
                      // должности: не надо раскрывать аккордеон, чтобы
                      // добавить человека. На тач-устройствах hover нет,
                      // поэтому там кнопка видна всегда.
                      className="inline-flex size-7 items-center justify-center rounded-lg text-[#5566f6] transition-opacity hover:bg-[#eef1ff] focus-visible:opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/pos:opacity-100"
                    >
                      <Plus className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => props.onEditPosition(p)}
                      aria-label={t("editPosition")}
                      className="inline-flex size-7 items-center justify-center rounded-lg text-transparent transition-colors group-hover/pos:text-[#9b9fb3] hover:bg-[#f5f6ff] hover:!text-[#5566f6]"
                    >
                      <Pencil className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => props.togglePosition(p.id)}
                      aria-label={t("expandPosition")}
                      className="inline-flex size-7 items-center justify-center rounded-lg text-[#9b9fb3] hover:bg-[#f5f6ff]"
                    >
                      <ChevronDown
                        className={cn(
                          "size-4 transition-transform",
                          open && "rotate-180"
                        )}
                      />
                    </button>
                  </div>
                  {open ? (
                    <div className="border-t border-[#ececf4] bg-[#fafbff]">
                      {employees.length === 0 ? (
                        <p className="px-4 py-3 text-center text-[12px] text-[#9b9fb3]">
                          {t("noEmployees")}
                        </p>
                      ) : (
                        employees.map((e) => (
                          <label
                            key={e.id}
                            className={cn(
                              "flex cursor-pointer items-center justify-between gap-3 px-4 py-2.5 text-[13px] transition-colors",
                              props.selected.has(e.id)
                                ? "bg-[#eef1ff] text-[#0b1024]"
                                : "text-[#0b1024] hover:bg-white"
                            )}
                          >
                            <input
                              type="checkbox"
                              checked={props.selected.has(e.id)}
                              onChange={() => props.toggleSelected(e.id)}
                              className="size-4 cursor-pointer rounded border-[#d0d4e6] text-[#5566f6] focus:ring-[#5566f6]"
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block">
                                {e.name}
                                {e.isSelf ? (
                                  <span className="ml-1.5 text-[11px] text-[#9b9fb3]">
                                    {t("self")}
                                  </span>
                                ) : null}
                                {e.pointAssignment ? (
                                  <SubstituteBadge className="ml-1.5 align-middle" {...substituteBadge(e.pointAssignment)} />
                                ) : null}
                              </span>
                              {/* Контакты — сразу в строке: позвонить или написать
                                  можно, не открывая карточку. */}
                              {e.phone || e.contactEmail ? (
                                <span
                                  className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-[11.5px] text-[#6f7282]"
                                  data-testid="staff-row-contacts"
                                >
                                  {e.phone ? (
                                    <a
                                      href={`tel:${e.phone}`}
                                      onClick={(event) => event.stopPropagation()}
                                      aria-label={`${t("phoneLabel")}: ${e.phone}`}
                                      className="inline-flex items-center gap-1 tabular-nums transition-colors hover:text-[#3848c7]"
                                    >
                                      <Phone className="size-3 shrink-0" />
                                      {formatPhone(e.phone)}
                                    </a>
                                  ) : null}
                                  {e.contactEmail ? (
                                    <a
                                      href={`mailto:${e.contactEmail}`}
                                      onClick={(event) => event.stopPropagation()}
                                      aria-label={`${t("emailLabel")}: ${e.contactEmail}`}
                                      className="inline-flex min-w-0 items-center gap-1 transition-colors hover:text-[#3848c7]"
                                    >
                                      <Mail className="size-3 shrink-0" />
                                      <span className="truncate">{e.contactEmail}</span>
                                    </a>
                                  ) : null}
                                </span>
                              ) : null}
                            </span>
                            <span className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  props.onEditEmployee(e);
                                }}
                                title={t("edit")}
                                aria-label={t("editEmployee")}
                                className="inline-flex h-7 items-center gap-1 rounded-lg border border-[#dcdfed] bg-white px-2 text-[11px] font-medium text-[#6f7282] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] hover:text-[#0b1024]"
                              >
                                <Pencil className="size-3.5" />
                                <span className="hidden sm:inline">{t("change")}</span>
                              </button>
                              {e.telegramLinked && props.telegramBotUrl ? (
                                <Link
                                  href={props.telegramBotUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  onClick={(event) => event.stopPropagation()}
                                  title={t("openTelegram")}
                                  aria-label={t("openTelegram")}
                                  className="inline-flex h-7 items-center gap-1 rounded-lg border border-[#dcdfed] bg-white px-2 text-[11px] font-medium text-[#0b1024] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
                                >
                                  <ExternalLink className="size-3.5" />
                                  <span className="hidden sm:inline">{t("openTelegram")}</span>
                                </Link>
                              ) : (
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    props.onInviteTelegram(e);
                                  }}
                                  title={t("inviteTelegram")}
                                  aria-label={t("inviteTelegram")}
                                  className="inline-flex h-7 items-center gap-1 rounded-lg border border-[#dbe1ff] bg-[#eef1ff] px-2 text-[11px] font-medium text-[#4054d8] hover:bg-[#e5e9ff]"
                                >
                                  <Send className="size-3.5" />
                                  <span className="hidden sm:inline">{t("inviteTelegram")}</span>
                                </button>
                              )}
                              {e.telegramLinked ? (
                                <>
                                  <button
                                  type="button"
                                  onClick={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    props.onRebindTelegram(e);
                                  }}
                                  title={t("rebindTelegram")}
                                  aria-label={t("rebindTelegram")}
                                  className="inline-flex h-7 items-center gap-1 rounded-lg border border-[#dcdfed] bg-white px-2 text-[11px] font-medium text-[#6f7282] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] hover:text-[#0b1024]"
                                >
                                  <RefreshCcw className="size-3.5" />
                                  <span className="hidden sm:inline">{t("rebindTelegram")}</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={(event) => {
                                      event.preventDefault();
                                      event.stopPropagation();
                                      props.onUnlinkTelegram(e);
                                    }}
                                    title={t("unlinkTelegram")}
                                    aria-label={t("unlinkTelegram")}
                                    className="inline-flex h-7 items-center gap-1 rounded-lg border border-[#ffd2cd] bg-[#fff4f2] px-2 text-[11px] font-medium text-[#d2453d] hover:bg-[#ffecea]"
                                  >
                                    <Unlink className="size-3.5" />
                                    <span className="hidden sm:inline">{t("unlinkTelegram")}</span>
                                  </button>
                                </>
                              ) : null}
                            </span>
                          </label>
                        ))
                      )}
                      <button
                        type="button"
                        onClick={() => props.onAddEmployee(p)}
                        className="flex w-full items-center justify-center gap-1.5 border-t border-[#ececf4] bg-white px-4 py-2.5 text-[13px] font-medium text-[#5566f6] transition-colors hover:bg-[#eef1ff]"
                      >
                        <Plus className="size-3.5" />
                        {t("addEmployee")}
                      </button>
                    </div>
                  ) : null}
                </div>
              );
            })
          )}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Пилюля «занято N из M» у должности со штатной численностью: зелёная —
 * штат укомплектован, янтарная — есть вакансии, розовая — сверх штата.
 * Расчёт — тот же, что у `GET /api/positions` (`src/lib/staffing.ts`).
 */
function StaffingPill(props: { planned: number; occupied: number }) {
  const t = useTranslations("staffManagement.page");
  const staffing = positionStaffing(props.planned, props.occupied);
  const tone =
    staffing.overstaffed > 0
      ? "bg-[#fff4f2] text-[#a13a32]"
      : staffing.vacancies > 0
        ? "bg-[#fff8eb] text-[#b25f00]"
        : "bg-[#ecfdf5] text-[#116b2a]";
  const hint =
    staffing.overstaffed > 0
      ? t("staffingOver", { count: staffing.overstaffed })
      : staffing.vacancies > 0
        ? t("staffingVacancies", { count: staffing.vacancies })
        : t("staffingFull");
  return (
    <span
      title={hint}
      data-testid="staffing-pill"
      className={cn(
        "inline-flex h-5 items-center rounded-full px-2 text-[11px] font-medium tabular-nums",
        tone
      )}
    >
      {t("staffingPill", { occupied: String(staffing.occupied), planned: String(props.planned) })}
      <span className="sr-only">. {hint}</span>
    </span>
  );
}

/** Черновик покраски графика поверх серверного снимка. */
type PaintDraft = {
  source: Map<string, StaffDayOffKind>;
  cells: Map<string, boolean>;
  weekly: Map<string, number[]>;
};

// Общие пустые коллекции для «протухшего» черновика — новые объекты
// на каждый рендер ломали бы мемоизацию и сравнение по идентичности.
const EMPTY_CELLS: Map<string, boolean> = new Map();
const EMPTY_WEEKLY: Map<string, number[]> = new Map();

/** `aria-sort` для `<th>` графика выходных. */
function ariaSortOf(
  sort: StaffSort,
  field: StaffSortField
): "ascending" | "descending" | "none" {
  if (!sort || sort.field !== field) return "none";
  return sort.order === "asc" ? "ascending" : "descending";
}

/**
 * Заголовок-кнопка сортируемой колонки. Стрелка появляется только у
 * активной колонки — иначе шапка превращается в частокол иконок.
 */
function StaffSortHead(props: {
  label: string;
  field: StaffSortField;
  sort: StaffSort;
  onClick: (field: StaffSortField) => void;
}) {
  const t = useTranslations("staffManagement.page");
  const active = props.sort?.field === props.field;
  const ascending = active && props.sort?.order === "asc";
  const Arrow = ascending ? ChevronUp : ChevronDown;
  return (
    <button
      type="button"
      onClick={() => props.onClick(props.field)}
      title={
        active && !ascending
          ? t("sortReset")
          : t("sortBy", { label: props.label })
      }
      className={cn(
        "-mx-1 inline-flex items-center gap-1 rounded-lg px-1 py-0.5 text-left font-medium transition-colors",
        "hover:bg-white hover:text-[#0b1024] focus:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15",
        active ? "text-[#3848c7]" : "text-[#6f7282]"
      )}
    >
      {props.label}
      {active ? <Arrow className="size-3.5 text-[#5566f6]" /> : null}
    </button>
  );
}

/**
 * Сетка «сотрудник × день». Две вещи, ради которых её переписали:
 *
 * 1. Колонка «Выходные» — недельное правило (Пн…Вс). Раньше управляющей
 *    приходилось прокликивать Сб/Вс каждому человеку на месяц вперёд.
 * 2. «Зажал и красишь» — pointer-события вместо чекбоксов: один POST на
 *    всю покраску вместо запроса и router.refresh() на каждую ячейку.
 */
/**
 * Сенсорный экран (`pointer: coarse`): ни «зажать и провести курсором»,
 * ни Shift там нет — подсказка должна говорить про нажатия.
 */
const COARSE_POINTER_QUERY = "(pointer: coarse)";

function subscribeCoarsePointer(onChange: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const query = window.matchMedia(COARSE_POINTER_QUERY);
  query.addEventListener?.("change", onChange);
  return () => query.removeEventListener?.("change", onChange);
}

function useCoarsePointer(): boolean {
  return useSyncExternalStore(
    subscribeCoarsePointer,
    () =>
      typeof window !== "undefined" && !!window.matchMedia
        ? window.matchMedia(COARSE_POINTER_QUERY).matches
        : false,
    () => false
  );
}

function WorkOffGrid(props: {
  employees: StaffEmployee[];
  positions: StaffPosition[];
  dates: string[];
  /** Явные исключения из правила: `userId|YYYY-MM-DD` → "off" | "work". */
  overrides: Map<string, StaffDayOffKind>;
  sort: StaffSort;
  onSort: (field: StaffSortField) => void;
  onIikoClick: () => void;
  onPaint: (items: WorkOffBulkItem[]) => Promise<void>;
  onChangeWeekly: (userId: string, weeklyDaysOff: number[]) => Promise<void>;
}) {
  const t = useTranslations("staffManagement.page");
  const locale = useLocale();
  const weekdayKeys = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
  const weeklyDaysOffText = (days: number[]) => days.length > 0
    ? days.map((day) => t(`weekday.${weekdayKeys[day]}`)).join(", ")
    : t("notSet");
  const posNameById = new Map<string, string>(
    props.positions.map((p) => [p.id, p.name])
  );

  const coarsePointer = useCoarsePointer();
  const gridRef = useRef<HTMLDivElement | null>(null);
  // Значение текущей покраски (true = «отмечаем выходным»). Держим в
  // ref, а не в state: pointermove не должен ждать перерисовку.
  const paintValueRef = useRef<boolean | null>(null);
  const anchorRef = useRef<{ userId: string; date: string } | null>(null);
  const [painting, setPainting] = useState(false);
  // Оптимистичный слой поверх серверных данных: пока не приехал
  // router.refresh(), рисуем то, что менеджер только что накликал.
  // `source` — снимок серверных данных, на котором черновик построен:
  // приехали новые — черновик протух и обнуляется прямо в рендере
  // (без useEffect + setState, чтобы не гонять лишний цикл рендера).
  const [draftState, setDraftState] = useState<PaintDraft>(() => ({
    source: props.overrides,
    cells: new Map<string, boolean>(),
    weekly: new Map<string, number[]>(),
  }));
  const draft: PaintDraft =
    draftState.source === props.overrides
      ? draftState
      : { source: props.overrides, cells: EMPTY_CELLS, weekly: EMPTY_WEEKLY };

  function updateDraft(mutate: (base: PaintDraft) => PaintDraft) {
    setDraftState((prev) =>
      mutate(
        prev.source === props.overrides
          ? prev
          : { source: props.overrides, cells: new Map(), weekly: new Map() }
      )
    );
  }

  function weeklyOf(employee: StaffEmployee): number[] {
    return draft.weekly.get(employee.id) ?? employee.weeklyDaysOff ?? [];
  }

  function isChecked(employee: StaffEmployee, iso: string): boolean {
    const key = dayOffOverrideKey(employee.id, iso);
    const local = draft.cells.get(key);
    if (local !== undefined) return local;
    return isStaffDayOff(
      { weeklyDaysOff: weeklyOf(employee) },
      iso,
      props.overrides.get(key) ?? null
    );
  }

  /** Отметка стоит по правилу, а не руками — рисуем полупрозрачной. */
  function isByRule(employee: StaffEmployee, iso: string): boolean {
    const key = dayOffOverrideKey(employee.id, iso);
    if (draft.cells.has(key) || props.overrides.has(key)) return false;
    return weeklyOf(employee).includes(weekdayIndex(iso));
  }

  function applyPaint(userId: string, iso: string, value: boolean) {
    const key = dayOffOverrideKey(userId, iso);
    updateDraft((base) => {
      if (base.cells.get(key) === value) return base;
      const cells = new Map(base.cells);
      cells.set(key, value);
      return { ...base, cells };
    });
  }

  /** Shift-клик: прямоугольник от прошлой ячейки до текущей. */
  function applyRect(
    from: { userId: string; date: string },
    to: { userId: string; date: string },
    value: boolean
  ) {
    const rowIds = props.employees.map((e) => e.id);
    const r1 = rowIds.indexOf(from.userId);
    const r2 = rowIds.indexOf(to.userId);
    const c1 = props.dates.indexOf(from.date);
    const c2 = props.dates.indexOf(to.date);
    if (r1 < 0 || r2 < 0 || c1 < 0 || c2 < 0) return;
    for (let r = Math.min(r1, r2); r <= Math.max(r1, r2); r++) {
      for (let c = Math.min(c1, c2); c <= Math.max(c1, c2); c++) {
        applyPaint(rowIds[r], props.dates[c], value);
      }
    }
  }

  function cellFromPoint(x: number, y: number) {
    const el = document.elementFromPoint(x, y);
    const cell =
      el instanceof HTMLElement
        ? el.closest<HTMLElement>("[data-workoff-cell]")
        : null;
    if (!cell?.dataset.userId || !cell.dataset.date) return null;
    return { userId: cell.dataset.userId, date: cell.dataset.date };
  }

  async function flushPaint() {
    if (paintValueRef.current === null) return;
    paintValueRef.current = null;
    setPainting(false);
    const items: WorkOffBulkItem[] = [];
    draft.cells.forEach((enabled, key) => {
      const [userId, date] = key.split("|");
      items.push({ userId, date, enabled });
    });
    if (items.length === 0) return;
    await props.onPaint(items);
  }

  return (
    <div className="space-y-4">
      <Button
        type="button"
        data-print-hide
        onClick={props.onIikoClick}
        className="h-10 gap-2 rounded-xl bg-[#5566f6] px-4 text-[14px] font-medium text-white shadow-[0_8px_20px_-12px_rgba(85,102,246,0.6)] hover:bg-[#4a5bf0]"
      >
        <UserPlus className="size-4" />
        {t("iikoFill")}
      </Button>

      <div
        ref={gridRef}
        onPointerMove={(event) => {
          if (paintValueRef.current === null) return;
          const cell = cellFromPoint(event.clientX, event.clientY);
          if (!cell) return;
          applyPaint(cell.userId, cell.date, paintValueRef.current);
          anchorRef.current = cell;
        }}
        onPointerUp={() => void flushPaint()}
        onPointerCancel={() => void flushPaint()}
        onLostPointerCapture={() => void flushPaint()}
        className={cn(
          "overflow-x-auto -mx-4 px-4 xl:mx-0 xl:px-0 min-[1720px]:overflow-visible rounded-2xl border border-[#ececf4] bg-white shadow-[0_0_0_1px_rgba(240,240,250,0.45)]",
          painting && "cursor-crosshair select-none [touch-action:none]"
        )}
      >
        {props.employees.length === 0 ? (
          <p className="px-6 py-10 text-center text-[13px] text-[#9b9fb3]">
            {t("noEmployeesForSchedule")}
          </p>
        ) : (
          <table
            data-print-schedule
            className="w-full min-w-[1100px] border-collapse text-[12px]"
          >
            <thead>
              <tr className="bg-[#f5f6ff] text-[#6f7282]">
                <th
                  className="sticky left-0 z-10 bg-[#f5f6ff] px-3 py-2 text-left font-medium"
                  aria-sort={ariaSortOf(props.sort, "name")}
                >
                  <StaffSortHead
                    label={t("employeeName")}
                    field="name"
                    sort={props.sort}
                    onClick={props.onSort}
                  />
                </th>
                <th
                  className="px-3 py-2 text-left font-medium"
                  aria-sort={ariaSortOf(props.sort, "position")}
                >
                  <StaffSortHead
                    label={t("positionLabel")}
                    field="position"
                    sort={props.sort}
                    onClick={props.onSort}
                  />
                </th>
                <th className="px-3 py-2 text-left font-medium">{t("daysOff")}</th>
                {props.dates.map((iso) => {
                  const { top, bottom, isWeekend } = formatDayCell(iso, locale);
                  return (
                    <th
                      key={iso}
                      className={cn(
                        "min-w-[44px] px-1 py-2 text-center font-normal leading-tight",
                        isWeekend && "bg-[#fff5d9]/70 text-[#b25f00]"
                      )}
                    >
                      <div className="text-[11px]">{top}</div>
                      <div
                        className={cn(
                          "text-[10px]",
                          isWeekend ? "font-medium text-[#b25f00]" : "text-[#9b9fb3]"
                        )}
                      >
                        {bottom}
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {props.employees.map((e) => {
                const positionName = e.jobPositionId
                  ? posNameById.get(e.jobPositionId) ?? e.positionTitle ?? "—"
                  : e.positionTitle || "—";
                return (
                  <tr key={e.id} className="border-t border-[#ececf4]">
                    <td className="sticky left-0 z-10 bg-white px-3 py-2 text-[#0b1024]">
                      {e.name}
                    </td>
                    <td className="px-3 py-2 text-[#6f7282]">{positionName}</td>
                    <td className="px-2 py-2">
                      <WeekdayChips
                        size="sm"
                        value={weeklyOf(e)}
                        ariaLabel={t("employeeDaysOff", { name: e.name })}
                        onChange={(next) => {
                          updateDraft((base) => ({
                            ...base,
                            weekly: new Map(base.weekly).set(e.id, next),
                          }));
                          void props.onChangeWeekly(e.id, next);
                        }}
                      />
                    </td>
                    {props.dates.map((iso) => {
                      const checked = isChecked(e, iso);
                      const byRule = isByRule(e, iso);
                      const { isWeekend } = formatDayCell(iso, locale);
                      return (
                        <td
                          key={iso}
                          className={cn(
                            "border-l border-[#f0f1f8] p-0 text-center",
                            isWeekend && "bg-[#fff5d9]/40"
                          )}
                        >
                          <button
                            type="button"
                            data-workoff-cell=""
                            data-user-id={e.id}
                            data-date={iso}
                            aria-pressed={checked}
                            aria-label={`${e.name}, ${iso}`}
                            title={
                              byRule
                                ? t("ruleDayOff", { days: weeklyDaysOffText(weeklyOf(e)) })
                                : checked
                                  ? t("dayOff")
                                  : t("workingDay")
                            }
                            onPointerDown={(event) => {
                              // preventDefault, иначе браузер начнёт
                              // выделять текст таблицы вместо покраски.
                              event.preventDefault();
                              const value = !checked;
                              if (event.shiftKey && anchorRef.current) {
                                applyRect(
                                  anchorRef.current,
                                  { userId: e.id, date: iso },
                                  value
                                );
                              } else {
                                applyPaint(e.id, iso, value);
                              }
                              paintValueRef.current = value;
                              anchorRef.current = { userId: e.id, date: iso };
                              setPainting(true);
                              gridRef.current?.setPointerCapture(event.pointerId);
                            }}
                            onKeyDown={(event) => {
                              // Клавиатура: pointer-события до неё не
                              // доходят, поэтому один день отправляем
                              // тем же bulk-эндпоинтом с одним элементом.
                              if (event.key !== "Enter" && event.key !== " ") {
                                return;
                              }
                              event.preventDefault();
                              const value = !checked;
                              applyPaint(e.id, iso, value);
                              void props.onPaint([
                                { userId: e.id, date: iso, enabled: value },
                              ]);
                            }}
                            className="flex h-8 w-full items-center justify-center focus:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
                          >
                            <span
                              className={cn(
                                "inline-flex size-4 items-center justify-center rounded border transition-colors print:hidden",
                                checked
                                  ? "border-[#5566f6] bg-[#5566f6] text-white"
                                  : "border-[#d0d4e6] bg-white text-transparent",
                                byRule && "opacity-50"
                              )}
                            >
                              <Check className="size-3" strokeWidth={3} />
                            </span>
                            {/* На бумаге отметка — буква: заливку браузер
                                при печати гасит, и синий квадрат с белой
                                галочкой вышел бы пустой клеткой. */}
                            <span aria-hidden className="hidden print:inline">
                              {checked ? t("checkedDay") : ""}
                            </span>
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div data-print-hide className="space-y-1 text-[12px] text-[#9b9fb3]">
        <div className="flex items-center gap-2">
          <span className="inline-block size-3 rounded-sm bg-[#fff5d9]/80 ring-1 ring-[#ffe2a0]" />
          {t("weekendLegend")}
        </div>
        <div>
          {coarsePointer ? (
            <>
              {t("tapInstructions")}
            </>
          ) : (
            <>
              {t("mouseInstructions")}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function SortHead({
  label,
  active,
  order,
  onClick,
}: {
  label: string;
  active: boolean;
  order: SortOrder;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 text-[13px] font-medium text-[#6f7282] hover:text-[#0b1024]"
    >
      {label}
      <ArrowUpDown
        className={cn(
          "size-3.5",
          active ? "text-[#5566f6]" : "text-[#c7ccea]"
        )}
      />
      {active ? (
        <span className="text-[10px] text-[#5566f6]">
          {order === "asc" ? "↑" : "↓"}
        </span>
      ) : null}
    </button>
  );
}

function PeriodsTable(props: {
  rows: Array<{
    id: string;
    userId: string;
    userName: string;
    positionLabel: string;
    positionRoleCode?: string | null;
    dateFrom?: string;
    dateTo?: string;
    date?: string;
  }>;
  kind: "vacation" | "sick_leave" | "dismissal";
  onAdd: () => void;
  onDelete: (id: string, kind: "vacation" | "sick_leave" | "dismissal") => void;
  onSort: (field: SortField) => void;
  sortField: SortField;
  sortOrder: SortOrder;
}) {
  const t = useTranslations("staffManagement.page");
  const tRole = useTranslations("staffManagement.roleLabels");
  const positionLabelForDisplay = (label: string, roleCode?: string | null) => {
    if (!roleCode) return label;
    const role = roleCode;
    const knownRoles = ["manager", "head_chef", "cook", "waiter", "owner", "technologist", "operator"] as const;
    return knownRoles.includes(role as (typeof knownRoles)[number])
      ? tRole(role as (typeof knownRoles)[number])
      : t("positionLabel");
  };
  const locale = useLocale();
  const dateLabel =
  props.kind === "vacation"
      ? t("vacationDates")
      : props.kind === "sick_leave"
        ? t("sickLeaveDates")
        : t("dismissalDate");
  return (
    <div className="space-y-4">
      <Button
        type="button"
        onClick={props.onAdd}
        className="h-10 gap-2 rounded-xl bg-[#5566f6] px-4 text-[14px] font-medium text-white shadow-[0_8px_20px_-12px_rgba(85,102,246,0.6)] hover:bg-[#4a5bf0]"
      >
        <Plus className="size-4" />
        {t("add")}
      </Button>

      <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0 sm:overflow-visible">
        <div className="min-w-[540px] overflow-hidden rounded-2xl border border-[#ececf4] bg-white shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
          <table data-print-periods className="w-full text-[13px]">
          <thead>
            <tr className="bg-[#f5f6ff]">
              <th className="w-[44px] px-3 py-2" />
              <th className="w-[60px] px-3 py-2 text-left text-[12px] font-medium uppercase tracking-wider text-[#9b9fb3]">
                {t("rowNumber")}
              </th>
              <th className="px-3 py-2 text-left">
                <SortHead
                  label={t("employeeName")}
                  active={props.sortField === "name"}
                  order={props.sortOrder}
                  onClick={() => props.onSort("name")}
                />
              </th>
              <th className="px-3 py-2 text-left">
                <SortHead
                  label={t("positionLabel")}
                  active={props.sortField === "position"}
                  order={props.sortOrder}
                  onClick={() => props.onSort("position")}
                />
              </th>
              <th className="px-3 py-2 text-left">
                <SortHead
                  label={dateLabel}
                  active={props.sortField === "date"}
                  order={props.sortOrder}
                  onClick={() => props.onSort("date")}
                />
              </th>
              <th className="w-[60px] px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {props.rows.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-6 py-10 text-center text-[13px] text-[#9b9fb3]"
                >
                  {t("noRecords")}
                </td>
              </tr>
            ) : (
              props.rows.map((r, idx) => (
                <tr key={r.id} className="border-t border-[#ececf4]">
                  <td className="px-3 py-2" />
                  <td className="px-3 py-2 text-[#6f7282]">{idx + 1}</td>
                  <td className="px-3 py-2 text-[#0b1024]">{r.userName}</td>
                  <td className="px-3 py-2 text-[#6f7282]">{positionLabelForDisplay(r.positionLabel, r.positionRoleCode)}</td>
                  <td className="px-3 py-2 text-[#0b1024]">
                    {props.kind === "dismissal"
                      ? formatDate(r.date!, locale)
                      : formatRange(r.dateFrom!, r.dateTo!, locale)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => props.onDelete(r.id, props.kind)}
                      aria-label={t("deleteRecord")}
                      className="inline-flex size-8 items-center justify-center rounded-lg text-[#c7ccea] hover:bg-[#fff4f2] hover:text-[#d2453d]"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
}
