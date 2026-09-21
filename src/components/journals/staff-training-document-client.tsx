"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Archive, ChevronDown, Plus, Trash2 } from "lucide-react";
import { ResponsiveMenu } from "@/components/ui/responsive-menu";
import { Button } from "@/components/ui/button";
import { confirmAsync } from "@/components/ui/confirm-async";
import { JournalDocumentShell } from "@/components/journals/journal-document-shell";
import { JournalDocumentHeader } from "@/components/journals/journal-document-header";
import {
  GRID_CELL_CLASS,
  GRID_HEAD_CELL_CLASS,
} from "@/components/journals/journal-grid";
import { FocusTodayScroller } from "@/components/journals/focus-today-scroller";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { USER_ROLE_LABEL_VALUES, getUserDisplayTitle } from "@/lib/user-roles";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  createStaffTrainingRow,
  normalizeStaffTrainingConfig,
  TRAINING_TYPES,
  TRAINING_TOPICS,
  ATTESTATION_RESULTS,
  type StaffTrainingConfig,
  type StaffTrainingRow,
} from "@/lib/staff-training-document";
import { buildStaffOptionLabel } from "@/lib/journal-staff-binding";
import { useMobileView } from "@/lib/use-mobile-view";
import {
  RecordCardsView,
  type RecordCardItem,
} from "@/components/journals/record-cards-view";

import { toast } from "sonner";
import { useJournalUndo } from "@/lib/journal-undo";
import {
  PositionSelectItems,
  usePositionEmployeeCascade,
} from "@/components/shared/position-select";
import { JournalSettingsModal } from "@/components/journals/v2/journal-settings-modal";
import { localDayKey } from "@/lib/entry-defaults";
type Props = {
  documentId: string;
  title: string;
  organizationName: string;
  dateFrom: string;
  status: string;
  initialConfig: StaffTrainingConfig;
  // Должность из карточки (как в UserLike) — «Должность» обучаемого.
  users: {
    id: string;
    name: string;
    role: string;
    positionTitle?: string | null;
    jobPosition?: { name: string; categoryKey: string } | null;
  }[];
  /** Design v2 toggle. */
  useV2?: boolean;
};

const POSITION_OPTIONS = USER_ROLE_LABEL_VALUES;

function nowDate() {
  return localDayKey();
}

export function StaffTrainingDocumentClient({
  documentId,
  title,
  organizationName,
  dateFrom,
  status,
  initialConfig,
  users,
  useV2 = false,
}: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [, setIsSaving] = useState(false);
  const [config, setConfig] = useState(() =>
    normalizeStaffTrainingConfig(initialConfig)
  );
  const [selectedRows, setSelectedRows] = useState<string[]>([]);
  const { mobileView, switchMobileView } = useMobileView("staff_training");
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTitle, setSettingsTitle] = useState(title);
  const [editingCell, setEditingCell] = useState<{
    rowId: string;
    field: string;
  } | null>(null);
  const [cellEditValue, setCellEditValue] = useState("");
  // Выбор сотрудника в окне правки идёт ПО ID: раньше выбиралось имя, а
  // `employeeId` строки оставался прежним, и сервер пересобирал строку по
  // старому человеку — смена молча откатывалась после перезагрузки.
  const [cellEditUserId, setCellEditUserId] = useState("");

  // Сотрудника в новой строке выбирают сами: «первый в списке» —
  // случайный человек, и инструктаж записывался бы не на того.
  const [draftRow, setDraftRow] = useState<StaffTrainingRow>(() =>
    createStaffTrainingRow({
      date: nowDate(),
      employeeId: null,
      employeeName: "",
      employeePosition: "",
    })
  );
  const draftCascade = usePositionEmployeeCascade({
    users,
    positionTitle: draftRow.employeePosition,
    userId: draftRow.employeeId || "",
    onChange: (next) =>
      setDraftRow((prev) => {
        const user = next.userId ? users.find((u) => u.id === next.userId) : undefined;
        return {
          ...prev,
          employeePosition: next.positionTitle,
          employeeId: user?.id || null,
          employeeName: user?.name || "",
        };
      }),
    autoPick: "none",
  });

  const isClosed = status === "closed";
  // История отмены: только правки этого человека в этой вкладке.
  const undoStack = useJournalUndo({ enabled: status !== "closed" });

  const cardItems: RecordCardItem[] = config.rows.map((row, index) => {
    const trainingLabel =
      TRAINING_TYPES.find((t) => t.value === row.trainingType)?.label ||
      row.trainingType;
    const attestLabel =
      ATTESTATION_RESULTS.find((a) => a.value === row.attestationResult)?.label ||
      row.attestationResult;
    return {
      id: row.id,
      title: `№${index + 1} · ${row.employeeName || "—"}`,
      subtitle: `${row.date || "—"} · ${row.employeePosition || "—"}`,
      leading: !isClosed ? (
        <Checkbox
          checked={selectedRows.includes(row.id)}
          onCheckedChange={(checked) => toggleRow(row.id, checked === true)}
          className="size-5"
        />
      ) : null,
      fields: [
        {
          label: "Дата",
          value: row.date,
          warnIfEmpty: true,
          onClick: !isClosed ? () => openCellEdit(row.id, "date") : undefined,
        },
        {
          label: "Ф.И.О. сотрудника",
          value: row.employeeName,
          warnIfEmpty: true,
          onClick: !isClosed ? () => openCellEdit(row.id, "employeeName") : undefined,
        },
        {
          label: "Должность",
          value: row.employeePosition,
          warnIfEmpty: true,
          onClick: !isClosed ? () => openCellEdit(row.id, "employeePosition") : undefined,
        },
        {
          label: "Тема обучения",
          value: row.topic,
          warnIfEmpty: true,
          onClick: !isClosed ? () => openCellEdit(row.id, "topic") : undefined,
        },
        {
          label: "Вид инструктажа",
          value: trainingLabel,
          warnIfEmpty: true,
          onClick: !isClosed ? () => openCellEdit(row.id, "trainingType") : undefined,
        },
        {
          label: "Причина (внеплановый)",
          value: row.unscheduledReason,
          onClick: !isClosed ? () => openCellEdit(row.id, "unscheduledReason") : undefined,
        },
        {
          label: "Инструктирующий",
          value: row.instructorName,
          warnIfEmpty: true,
          onClick: !isClosed ? () => openCellEdit(row.id, "instructorName") : undefined,
        },
        {
          label: "Результат аттестации",
          value: attestLabel,
          warnIfEmpty: true,
          onClick: !isClosed ? () => openCellEdit(row.id, "attestationResult") : undefined,
        },
      ],
    };
  });

  /* ---------- persistence ---------- */

  /**
   * `silent` — вызов из истории отмены: ошибку пробрасываем наружу,
   * чтобы протухший шаг вылетел из стека, а не показывался тостом
   * поверх «не удалось отменить».
   */
  async function saveConfig(
    nextConfig: StaffTrainingConfig,
    options?: { silent?: boolean }
  ) {
    setIsSaving(true);
    try {
      const response = await fetch(`/api/journal-documents/${documentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: nextConfig }),
      });
      if (!response.ok) throw new Error("Не удалось сохранить журнал");
      startTransition(() => router.refresh());
    } catch (error) {
      if (options?.silent) throw error;
      toast.error("Не удалось сохранить журнал");
    } finally {
      setIsSaving(false);
    }
  }

  /**
   * Правка ячейки/строки. Отмена (Ctrl+Z) — это повторная запись
   * прежнего config'а тем же PATCH, а не правка состояния на клиенте:
   * серверные проверки обязаны сработать и на откате.
   */
  function updateConfigAndSave(next: StaffTrainingConfig) {
    const previous = config;
    setConfig(next);
    // Шаг кладём ТОЛЬКО после успешного PATCH: при ошибке возвращаем
    // прежний config, и отменять было бы нечего.
    void saveConfig(next, { silent: true })
      .then(() => {
        undoStack.push({
          undo: async () => {
            setConfig(previous);
            await saveConfig(previous, { silent: true });
          },
          redo: async () => {
            setConfig(next);
            await saveConfig(next, { silent: true });
          },
        });
      })
      .catch(() => {
        setConfig(previous);
        toast.error("Не удалось сохранить журнал");
      });
  }

  /* ---------- row helpers ---------- */

  function toggleRow(id: string, checked: boolean) {
    setSelectedRows((prev) =>
      checked ? [...new Set([...prev, id])] : prev.filter((x) => x !== id)
    );
  }

  function removeSelectedRows() {
    if (selectedRows.length === 0) return;
    const next = {
      ...config,
      rows: config.rows.filter((row) => !selectedRows.includes(row.id)),
    };
    setSelectedRows([]);
    updateConfigAndSave(next);
  }

  /* ---------- add row ---------- */

  function saveDraftRow() {
    const next = {
      ...config,
      rows: [...config.rows, draftRow],
    };
    updateConfigAndSave(next);
    setDraftRow(
      createStaffTrainingRow({
        date: nowDate(),
        employeeId: null,
        employeeName: "",
        employeePosition: "",
      })
    );
    setAddModalOpen(false);
  }

  /* ---------- cell editing ---------- */

  function openCellEdit(rowId: string, field: string) {
    if (isClosed) return;
    const row = config.rows.find((r) => r.id === rowId);
    if (!row) return;
    setCellEditValue((row as Record<string, unknown>)[field] as string || "");
    setCellEditUserId(field === "employeeName" ? row.employeeId || "" : "");
    setEditingCell({ rowId, field });
  }

  function saveCellEdit() {
    if (!editingCell) return;
    const { rowId, field } = editingCell;
    const picked =
      field === "employeeName"
        ? users.find((user) => user.id === cellEditUserId)
        : undefined;
    const next = {
      ...config,
      rows: config.rows.map((row) =>
        row.id === rowId
          ? field === "employeeName"
            ? {
                ...row,
                // Пара «id + имя» едет вместе, иначе сервер восстановит
                // строку по прежнему сотруднику.
                employeeId: picked?.id || null,
                employeeName: picked?.name || cellEditValue,
                // Должность из справочника, а не лейбл роли — сервер
                // при сохранении выводит её так же.
                employeePosition: picked
                  ? getUserDisplayTitle(picked)
                  : row.employeePosition,
              }
            : { ...row, [field]: cellEditValue }
          : row
      ),
    };
    updateConfigAndSave(next);
    setEditingCell(null);
    setCellEditValue("");
    setCellEditUserId("");
  }

  function getCellEditLabel(): string {
    if (!editingCell) return "";
    switch (editingCell.field) {
      case "date":
        return "Дата инструктажа";
      case "employeeName":
        return "Ф.И.О. инструктируемого";
      case "employeePosition":
        return "Должность инструктируемого";
      case "topic":
        return "Тема инструктажа / обучения";
      case "attestationResult":
        return "Результат аттестации";
      case "trainingType":
        return "Вид инструктажа";
      case "unscheduledReason":
        return "Причина проведения внепланового инструктажа";
      case "instructorName":
        return "Должность инструктирующего";
      default:
        return "Редактирование";
    }
  }

  /* ---------- close journal ---------- */

  async function handleCloseJournal() {
    const ok = await confirmAsync({
      title: `Закончить журнал «${title}»?`,
      description:
        "Журнал уйдёт из рабочего списка в раздел закрытых. Все записи сохранятся — отчёты и PDF по ним останутся.",
      bullets: [
        { label: "Добавлять и править записи после этого нельзя", tone: "warn" },
        { label: "Вернуть журнал в активные можно в любой момент", tone: "info" },
      ],
      confirmLabel: "Закончить журнал",
      variant: "warn",
    });
    if (!ok) return;
    const response = await fetch(`/api/journal-documents/${documentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "closed" }),
    });
    if (!response.ok) {
      toast.error("Не удалось закончить журнал");
      return;
    }
    router.refresh();
  }

  /* ---------- helpers ---------- */

  function emptyCellClass(value: string) {
    return !value ? "bg-red-50" : "";
  }

  const pageCount = Math.max(1, Math.ceil(config.rows.length / 20));

  return (
    <div className="space-y-6 text-black">
      <FocusTodayScroller selector="[data-focus-today]" emptyTitle="Записей пока нет" emptyBody="Нажмите «Добавить» в таблице ниже, чтобы создать запись." />
      <JournalDocumentShell
        title={title}
        documentId={documentId}
        backHref="/journals/staff_training"
        closed={isClosed}
        closedHint="Верните журнал в активные, чтобы добавлять и править записи инструктажей."
        onSettings={!isClosed ? () => setSettingsOpen(true) : undefined}
        menuItems={
          !isClosed
            ? [
                {
                  key: "close-journal",
                  label: "Закончить журнал",
                  icon: <Archive className="size-4" />,
                  onSelect: handleCloseJournal,
                },
              ]
            : []
        }
        undo={
          !isClosed
            ? {
                canUndo: undoStack.canUndo,
                canRedo: undoStack.canRedo,
                onUndo: () => void undoStack.undo(),
                onRedo: () => void undoStack.redo(),
                undoCount: undoStack.undoCount,
              }
            : undefined
        }
        mobileView={mobileView}
        onMobileView={switchMobileView}
        cards={<RecordCardsView items={cardItems} emptyLabel="Нет записей обучения." />}
        paperHeader={
          <JournalDocumentHeader
            orgName={organizationName}
            title="ЖУРНАЛ РЕГИСТРАЦИИ ИНСТРУКТАЖЕЙ (ОБУЧЕНИЯ) СОТРУДНИКОВ"
            pageInfo={`СТР. 1 ИЗ ${pageCount}`}
            startedAt={dateFrom}
            finishedAt={null}
          />
        }
        sheetTitle="ЖУРНАЛ регистрации инструктажей (обучения) сотрудников"
        sheetMinWidth={1600}
        toolbar={
          !isClosed ? (
            <>
              <ResponsiveMenu
              title="Добавить"
              contentClassName="w-[280px] rounded-2xl border-0 p-2 shadow-xl"
              items={[
                {
                  key: "add-employee",
                  label: "Добавить сотрудника",
                  icon: <Plus className="size-4 text-[#6f7282]" />,
                  onSelect: () => setAddModalOpen(true),
                },
              ]}
              trigger={
                <Button type="button" className="bg-[#5566f6] hover:bg-[#4d58f5]">
                  <Plus className="size-4" />
                  Добавить
                  <ChevronDown className="ml-1 size-4" />
                </Button>
              }
            />

              {selectedRows.length > 0 && (
                <>
                  <span className="text-sm text-[#7a7f93]">
                    Выбрано: {selectedRows.length}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={removeSelectedRows}
                  >
                    <Trash2 className="size-4" />
                    Удалить
                  </Button>
                </>
              )}
            </>
          ) : undefined
        }
      >
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr>
              <th className={`w-10 ${GRID_HEAD_CELL_CLASS} px-2 py-1.5 font-semibold leading-tight`} />
              <th className={`${GRID_HEAD_CELL_CLASS} px-2 py-1.5 font-semibold leading-tight`}>Дата</th>
              <th className={`${GRID_HEAD_CELL_CLASS} px-2 py-1.5 font-semibold leading-tight`}>
                Ф.И.О. инструктируемого
              </th>
              <th className={`${GRID_HEAD_CELL_CLASS} px-2 py-1.5 font-semibold leading-tight`}>
                Профессия / должность инструктируемого
              </th>
              <th className={`${GRID_HEAD_CELL_CLASS} px-2 py-1.5 font-semibold leading-tight`}>
                Тема инструктажа (обучения)
              </th>
              <th className={`${GRID_HEAD_CELL_CLASS} px-2 py-1.5 font-semibold leading-tight`}>
                Вид инструктажа (первичный / повторный / внеплановый)
              </th>
              <th className={`${GRID_HEAD_CELL_CLASS} px-2 py-1.5 font-semibold leading-tight`}>
                Причина проведения внепланового инструктажа
              </th>
              <th className={`${GRID_HEAD_CELL_CLASS} px-2 py-1.5 font-semibold leading-tight`}>
                Ф.И.О. / должность инструктирующего
              </th>
              <th className={`${GRID_HEAD_CELL_CLASS} px-2 py-1.5 font-semibold leading-tight`}>
                Результат аттестации после обучения (удовл. / не удовл.)
              </th>
            </tr>
          </thead>
          <tbody>
            {config.rows.map((row) => {
              const trainingLabel =
                TRAINING_TYPES.find((t) => t.value === row.trainingType)
                  ?.label || row.trainingType;
              const attestLabel =
                ATTESTATION_RESULTS.find(
                  (a) => a.value === row.attestationResult
                )?.label || row.attestationResult;

              return (
                <tr key={row.id}>
                  <td className={`${GRID_CELL_CLASS} px-2 py-1 align-top leading-tight`}>
                    {!isClosed && (
                      <Checkbox
                        checked={selectedRows.includes(row.id)}
                        onCheckedChange={(checked) =>
                          toggleRow(row.id, checked === true)
                        }
                      />
                    )}
                  </td>
                  <td
                    className={`${GRID_CELL_CLASS} px-2 py-1 align-top leading-tight whitespace-nowrap ${isClosed ? "" : "cursor-pointer hover:bg-[#f5f6ff]"}`}
                    onClick={() => !isClosed && openCellEdit(row.id, "date")}
                  >
                    {row.date || <span className="text-gray-300">---</span>}
                  </td>
                  <td
                    className={`${GRID_CELL_CLASS} px-2 py-1 align-top leading-tight ${emptyCellClass(row.employeeName)} ${isClosed ? "" : "cursor-pointer hover:bg-[#f5f6ff]"}`}
                    onClick={() => !isClosed && openCellEdit(row.id, "employeeName")}
                  >
                    {row.employeeName || <span className="text-gray-300">---</span>}
                  </td>
                  <td
                    className={`${GRID_CELL_CLASS} px-2 py-1 align-top leading-tight ${emptyCellClass(row.employeePosition)} ${isClosed ? "" : "cursor-pointer hover:bg-[#f5f6ff]"}`}
                    onClick={() => !isClosed && openCellEdit(row.id, "employeePosition")}
                  >
                    {row.employeePosition || <span className="text-gray-300">---</span>}
                  </td>
                  <td
                    className={`${GRID_CELL_CLASS} px-2 py-1 align-top leading-tight ${emptyCellClass(row.topic)} ${isClosed ? "" : "cursor-pointer hover:bg-[#f5f6ff]"}`}
                    onClick={() => !isClosed && openCellEdit(row.id, "topic")}
                  >
                    {row.topic || <span className="text-gray-300">---</span>}
                  </td>
                  <td
                    className={`${GRID_CELL_CLASS} px-2 py-1 align-top leading-tight cursor-pointer ${emptyCellClass(row.trainingType)}`}
                    onClick={() => openCellEdit(row.id, "trainingType")}
                  >
                    {trainingLabel || <span className="text-gray-300">---</span>}
                  </td>
                  <td
                    className={`${GRID_CELL_CLASS} px-2 py-1 align-top leading-tight cursor-pointer ${emptyCellClass(row.unscheduledReason)}`}
                    onClick={() =>
                      openCellEdit(row.id, "unscheduledReason")
                    }
                  >
                    {row.unscheduledReason || (
                      <span className="text-gray-300">---</span>
                    )}
                  </td>
                  <td
                    className={`${GRID_CELL_CLASS} px-2 py-1 align-top leading-tight cursor-pointer ${emptyCellClass(row.instructorName)}`}
                    onClick={() =>
                      openCellEdit(row.id, "instructorName")
                    }
                  >
                    {row.instructorName || (
                      <span className="text-gray-300">---</span>
                    )}
                  </td>
                  <td
                    className={`${GRID_CELL_CLASS} px-2 py-1 align-top leading-tight cursor-pointer ${emptyCellClass(row.attestationResult)}`}
                    onClick={() =>
                      openCellEdit(row.id, "attestationResult")
                    }
                  >
                    {attestLabel || (
                      <span className="text-gray-300">---</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {config.rows.length === 0 && (
              <tr>
                <td colSpan={9} className={`${GRID_CELL_CLASS} px-2 py-4 text-center leading-tight text-gray-400`}>
                  Нет записей. Нажмите &laquo;Добавить&raquo; чтобы добавить сотрудника.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </JournalDocumentShell>

      {/* ---------- Add Row Dialog ---------- */}
      <Dialog open={addModalOpen} onOpenChange={setAddModalOpen}>
        <DialogContent className="max-h-[92vh] supports-[height:100dvh]:max-h-[92dvh] overflow-y-auto sm:max-w-[620px]">
          <DialogHeader>
            <DialogTitle>Добавление записи</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-3">
            <Label>Дата</Label>
            <Input
              type="date"
              value={draftRow.date}
              onChange={(e) =>
                setDraftRow((prev) => ({ ...prev, date: e.target.value }))
              }
            />

            <Label>Должность инструктируемого</Label>
            <Select
              value={draftRow.employeePosition}
              onValueChange={draftCascade.handlePositionChange}
            >
              <SelectTrigger>
                <SelectValue placeholder="Выберите должность" />
              </SelectTrigger>
              <SelectContent>
                <PositionSelectItems users={users} />
              </SelectContent>
            </Select>

            <Label>Ф.И.О. инструктируемого</Label>
            <Select
              value={draftRow.employeeId || "__empty__"}
              onValueChange={(val) => {
                const user = users.find((u) => u.id === val);
                setDraftRow((prev) => ({
                  ...prev,
                  employeeId: user?.id || null,
                  employeeName: user?.name || "",
                  employeePosition: user
                    ? getUserDisplayTitle(user)
                    : prev.employeePosition,
                }));
              }}
              open={draftCascade.employeeOpen}
              onOpenChange={draftCascade.setEmployeeOpen}
            >
              <SelectTrigger>
                <SelectValue placeholder="Выберите сотрудника" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__empty__">Выберите сотрудника</SelectItem>
                {(draftRow.employeePosition ? draftCascade.candidates : users).map((user) => (
                  <SelectItem key={user.id} value={user.id}>
                    {buildStaffOptionLabel(user)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Label>Вид инструктажа</Label>
            <Select
              value={draftRow.trainingType}
              onValueChange={(val) =>
                setDraftRow((prev) => ({ ...prev, trainingType: val }))
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Выберите из списка" />
              </SelectTrigger>
              <SelectContent>
                {TRAINING_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Label>Тема обучения</Label>
            <Select
              value={draftRow.topic}
              onValueChange={(val) =>
                setDraftRow((prev) => ({ ...prev, topic: val }))
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Выберите из списка" />
              </SelectTrigger>
              <SelectContent>
                {TRAINING_TOPICS.map((t) => (
                  <SelectItem key={t.value} value={t.label}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Label>Причина проведения внепланового инструктажа</Label>
            <Textarea
              value={draftRow.unscheduledReason}
              onChange={(e) =>
                setDraftRow((prev) => ({
                  ...prev,
                  unscheduledReason: e.target.value,
                }))
              }
              placeholder="Причина"
            />

            <Label>Должность инструктирующего</Label>
            <Select
              value={draftRow.instructorName}
              onValueChange={(val) =>
                setDraftRow((prev) => ({ ...prev, instructorName: val }))
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Выберите должность" />
              </SelectTrigger>
              <SelectContent>
                <PositionSelectItems users={users} />
              </SelectContent>
            </Select>

            <div className="flex justify-end pt-2">
              <Button onClick={saveDraftRow} disabled={!draftRow.employeeId}>
                Добавить
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ---------- Cell Edit Dialog ---------- */}
      <Dialog
        open={editingCell !== null}
        onOpenChange={(open) => {
          if (!open) {
            setEditingCell(null);
            setCellEditValue("");
          }
        }}
      >
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Редактирование ячейки</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <Label>{getCellEditLabel()}</Label>

            {editingCell?.field === "date" && (
              <Input
                type="date"
                value={cellEditValue}
                onChange={(e) => setCellEditValue(e.target.value)}
              />
            )}

            {editingCell?.field === "employeeName" && (
              <>
                <Select
                  value={cellEditUserId || "__custom__"}
                  onValueChange={(value) => {
                    if (value === "__custom__") {
                      setCellEditUserId("");
                      return;
                    }
                    setCellEditUserId(value);
                    setCellEditValue(
                      users.find((user) => user.id === value)?.name || ""
                    );
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="- Выберите сотрудника -" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__custom__">
                      Без привязки (ввести вручную ниже)
                    </SelectItem>
                    {/* Ключ выбора — id, а не ФИО: двух однофамильцев
                        Radix склеивал в один вариант. */}
                    {users.map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {buildStaffOptionLabel(u)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {!cellEditUserId ? (
                  <Input
                    value={cellEditValue}
                    onChange={(e) => setCellEditValue(e.target.value)}
                    placeholder="Ф.И.О. вручную"
                  />
                ) : null}
              </>
            )}

            {editingCell?.field === "employeePosition" && (
              <Select value={cellEditValue || "__empty__"} onValueChange={(value) => setCellEditValue(value === "__empty__" ? "" : value)}>
                <SelectTrigger>
                  <SelectValue placeholder="- Выберите должность -" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__empty__">— не указана —</SelectItem>
                  <PositionSelectItems users={users} />
                </SelectContent>
              </Select>
            )}

            {editingCell?.field === "topic" && (
              <Input
                value={cellEditValue}
                onChange={(e) => setCellEditValue(e.target.value)}
                placeholder="Например: Санитария и гигиена"
              />
            )}

            {editingCell?.field === "attestationResult" && (
              <div className="flex items-center gap-4 text-sm">
                {ATTESTATION_RESULTS.map((opt) => (
                  <label key={opt.value} className="flex items-center gap-2">
                    <input
                      type="radio"
                      checked={cellEditValue === opt.value}
                      onChange={() => setCellEditValue(opt.value)}
                    />
                    {opt.label}
                  </label>
                ))}
              </div>
            )}

            {editingCell?.field === "trainingType" && (
              <Select value={cellEditValue} onValueChange={setCellEditValue}>
                <SelectTrigger>
                  <SelectValue placeholder="Выберите из списка" />
                </SelectTrigger>
                <SelectContent>
                  {TRAINING_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {editingCell?.field === "unscheduledReason" && (
              <Textarea
                value={cellEditValue}
                onChange={(e) => setCellEditValue(e.target.value)}
                placeholder="Причина"
                rows={3}
              />
            )}

            {editingCell?.field === "instructorName" && (
              <Select value={cellEditValue} onValueChange={setCellEditValue}>
                <SelectTrigger>
                  <SelectValue placeholder="Выберите из списка" />
                </SelectTrigger>
                <SelectContent>
                  <PositionSelectItems users={users} />
                </SelectContent>
              </Select>
            )}

            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setEditingCell(null);
                  setCellEditValue("");
                }}
              >
                Отмена
              </Button>
              <Button onClick={saveCellEdit}>Сохранить</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ---------- Settings Dialog ---------- */}
      {useV2 ? (
        <JournalSettingsModal
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          title="Настройки документа"
          description="Параметры журнала обучения и аттестации персонала"
          size="md"
          onSave={async () => {
            try {
              const response = await fetch(`/api/journal-documents/${documentId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ title: settingsTitle }),
              });
              if (!response.ok) {
                throw new Error("Не удалось сохранить настройки");
              }
              setSettingsOpen(false);
              router.refresh();
            } catch {
              toast.error("Не удалось сохранить настройки");
            }
          }}
          onCancel={() => setSettingsOpen(false)}
        >
          <div className="space-y-2">
            <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">Название документа</Label>
            <Input
              value={settingsTitle}
              onChange={(e) => setSettingsTitle(e.target.value)}
              className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px] focus:border-[#5566f6] focus:ring-4 focus:ring-[#5566f6]/15"
            />
          </div>
        </JournalSettingsModal>
      ) : (
        <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
          <DialogContent className="sm:max-w-[480px]">
            <DialogHeader>
              <DialogTitle>Настройки документа</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <Label>Название документа</Label>
              <Input
                value={settingsTitle}
                onChange={(e) => setSettingsTitle(e.target.value)}
              />
              <div className="flex justify-end">
                <Button
                  onClick={async () => {
                    try {
                      const response = await fetch(`/api/journal-documents/${documentId}`, {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ title: settingsTitle }),
                      });
                      if (!response.ok) {
                        throw new Error("Не удалось сохранить настройки");
                      }
                      setSettingsOpen(false);
                      router.refresh();
                    } catch {
                      toast.error("Не удалось сохранить настройки");
                    }
                  }}
                >
                  Сохранить
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
