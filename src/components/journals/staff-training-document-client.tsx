"use client";

import { useLayoutEffect, useMemo, useRef, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { buildStaffTrainingRoleDisplay, presentStaffTrainingRole, presentStaffTrainingStaffOption, staffTrainingIncomingRevision } from "@/lib/staff-training-presentation";
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
import { getUserDisplayTitle } from "@/lib/user-roles";
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
  trainingTopicDescription,
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
  /** Compact persisted-config and display-directory witness from the server. */
  sourceIdentity?: string;
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

function nowDate() {
  return localDayKey();
}

export function StaffTrainingDocumentClient(props: Props) {
  return <StaffTrainingDocumentEditor key={props.documentId} {...props} />;
}

function StaffTrainingDocumentEditor({
  documentId,
  title,
  organizationName,
  dateFrom,
  status,
  initialConfig,
  sourceIdentity,
  users,
  useV2 = false,
}: Props) {
  const locale = useLocale();
  const st = useTranslations("journalStaffTraining");
  const common = useTranslations("common");
  const controls = useTranslations("journalControls");
  const pdf = useTranslations("personnelMaintenancePdf");
  const feedback = useRef(st);
  useLayoutEffect(() => { feedback.current = st; }, [st]);
  const roleDisplay = useMemo(() => buildStaffTrainingRoleDisplay(users), [users]);
  const displayRole = (raw: string) => presentStaffTrainingRole(raw, roleDisplay, (key) => pdf(key));
  const staffOption = (user: Props["users"][number]) => presentStaffTrainingStaffOption(buildStaffOptionLabel(user), user, roleDisplay, (key) => pdf(key), st("unnamed"));
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [, setIsSaving] = useState(false);
  const [config, setConfig] = useState(() =>
    normalizeStaffTrainingConfig(initialConfig)
  );
  const incomingRevision = staffTrainingIncomingRevision(initialConfig, sourceIdentity, users);
  const [serverRevision, setServerRevision] = useState(incomingRevision);
  const [serverTitle, setServerTitle] = useState(title);
  const [draftTopicKey, setDraftTopicKey] = useState<(typeof TRAINING_TOPICS)[number]["value"] | null>(null);
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
  // Object identity changes during a locale/RSC refresh do not erase drafts.
  // Actual changed server data still wins and removes stale row edit targets.
  if (incomingRevision !== undefined && incomingRevision !== serverRevision) {
    setServerRevision(incomingRevision);
    const incoming = normalizeStaffTrainingConfig(initialConfig);
    setConfig(incoming);
    setSelectedRows((previous) => previous.filter((id) => incoming.rows.some((row) => row.id === id)));
    if (editingCell) {
      const incomingRow = incoming.rows.find((row) => row.id === editingCell.rowId);
      const previousRow = config.rows.find((row) => row.id === editingCell.rowId);
      if (!incomingRow) {
        setEditingCell(null);
        setCellEditValue("");
        setCellEditUserId("");
      } else {
        const field = editingCell.field as keyof StaffTrainingRow;
        if (incomingRow[field] !== previousRow?.[field] ||
            (field === "employeeName" && incomingRow.employeeId !== previousRow?.employeeId)) {
          setCellEditValue((incomingRow as Record<string, unknown>)[field] as string || "");
          setCellEditUserId(field === "employeeName" ? incomingRow.employeeId || "" : "");
        }
      }
    }
  }
  if (title !== serverTitle) {
    setServerTitle(title);
    setSettingsTitle(title);
  }
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
      TRAINING_TYPES.find((t) => t.value === row.trainingType) ? pdf(row.trainingType as (typeof TRAINING_TYPES)[number]["value"]) : row.trainingType;
    const attestLabel =
      ATTESTATION_RESULTS.find((a) => a.value === row.attestationResult) ? pdf(row.attestationResult as (typeof ATTESTATION_RESULTS)[number]["value"]) : row.attestationResult;
    return {
      id: row.id,
      title: `№${index + 1} · ${row.employeeName || "—"}`,
      subtitle: `${row.date || "—"} · ${row.employeePosition || "—"}`,
      leading: !isClosed ? (
        <Checkbox
          aria-label={st("selectRecord", { number: `${config.rows.findIndex((item) => item.id === row.id) + 1}` })}
          checked={selectedRows.includes(row.id)}
          onCheckedChange={(checked) => toggleRow(row.id, checked === true)}
          className="size-5"
        />
      ) : null,
      fields: [
        {
          label: pdf("date"),
          value: row.date,
          warnIfEmpty: true,
          onClick: !isClosed ? () => openCellEdit(row.id, "date") : undefined,
        },
        {
          label: st("employeeName"),
          value: row.employeeName,
          warnIfEmpty: true,
          onClick: !isClosed ? () => openCellEdit(row.id, "employeeName") : undefined,
        },
        {
          label: st("position"),
          value: row.employeePosition,
          warnIfEmpty: true,
          onClick: !isClosed ? () => openCellEdit(row.id, "employeePosition") : undefined,
        },
        {
          label: st("learningTopic"),
          value: row.topic,
          warnIfEmpty: true,
          onClick: !isClosed ? () => openCellEdit(row.id, "topic") : undefined,
        },
        {
          label: st("trainingType"),
          value: trainingLabel,
          warnIfEmpty: true,
          onClick: !isClosed ? () => openCellEdit(row.id, "trainingType") : undefined,
        },
        {
          label: st("unscheduledReasonShort"),
          value: row.unscheduledReason,
          onClick: !isClosed ? () => openCellEdit(row.id, "unscheduledReason") : undefined,
        },
        {
          label: st("instructorShort"),
          value: row.instructorName,
          warnIfEmpty: true,
          onClick: !isClosed ? () => openCellEdit(row.id, "instructorName") : undefined,
        },
        {
          label: st("attestationShort"),
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
      if (!response.ok) throw new Error(st("saveFailed"));
      startTransition(() => router.refresh());
    } catch (error) {
      if (options?.silent) throw error;
      toast.error(feedback.current("saveFailed"));
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
        toast.error(feedback.current("saveFailed"));
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
    setDraftTopicKey(null);
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
        return st("date");
      case "employeeName":
        return st("employee");
      case "employeePosition":
        return st("employeePosition");
      case "topic":
        return st("briefingTopic");
      case "attestationResult":
        return st("attestationShort");
      case "trainingType":
        return st("trainingType");
      case "unscheduledReason":
        return pdf("unscheduledReason");
      case "instructorName":
        return st("instructorPosition");
      default:
        return st("editing");
    }
  }

  /* ---------- close journal ---------- */

  async function handleCloseJournal() {
    const ok = await confirmAsync({
      title: controls("closeDocument.confirmTitle", { title }),
      description:
        st("closeDescription"),
      bullets: [
        { label: st("closeWarning"), tone: "warn" },
        { label: st("closeRestore"), tone: "info" },
      ],
      confirmLabel: controls("closeDocument.close"),
      variant: "warn",
      locale,
    });
    if (!ok) return;
    const response = await fetch(`/api/journal-documents/${documentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "closed" }),
    });
    if (!response.ok) {
      toast.error(feedback.current("closeFailed"));
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
      <FocusTodayScroller selector="[data-focus-today]" emptyTitle={st("emptyTitle")} emptyBody={st("emptyBody")} />
      <JournalDocumentShell
        title={title}
        documentId={documentId}
        backHref="/journals/staff_training"
        closed={isClosed}
        closedHint={st("closedHint")}
        onSettings={!isClosed ? () => setSettingsOpen(true) : undefined}
        menuItems={
          !isClosed
            ? [
                {
                  key: "close-journal",
                  label: controls("closeDocument.close"),
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
        cards={<RecordCardsView items={cardItems} emptyLabel={st("emptyCards")} />}
        paperHeader={
          <JournalDocumentHeader
            orgName={organizationName}
            title={st("paperTitle")}
            pageInfo={st("pageInfo", { count: `${pageCount}` })}
            startedAt={dateFrom}
            finishedAt={null}
          />
        }
        sheetTitle={st("sheetTitle")}
        sheetMinWidth={1600}
        toolbar={
          !isClosed ? (
            <>
              <ResponsiveMenu
              title={common("add")}
              contentClassName="w-[280px] rounded-2xl border-0 p-2 shadow-xl"
              items={[
                {
                  key: "add-employee",
                  label: st("addEmployee"),
                  icon: <Plus className="size-4 text-[#6f7282]" />,
                  onSelect: () => setAddModalOpen(true),
                },
              ]}
              trigger={
                <Button type="button" className="bg-[#5566f6] hover:bg-[#4d58f5]">
                  <Plus className="size-4" />
                  {common("add")}
                  <ChevronDown className="ml-1 size-4" />
                </Button>
              }
            />

              {selectedRows.length > 0 && (
                <>
                  <span className="text-sm text-[#7a7f93]">
                    {controls("selection.count", { count: selectedRows.length })}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={removeSelectedRows}
                  >
                    <Trash2 className="size-4" />
                    {common("delete")}
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
              <th className={`${GRID_HEAD_CELL_CLASS} px-2 py-1.5 font-semibold leading-tight`}>{pdf("date")}</th>
              <th className={`${GRID_HEAD_CELL_CLASS} px-2 py-1.5 font-semibold leading-tight`}>
                {st("employee")}
              </th>
              <th className={`${GRID_HEAD_CELL_CLASS} px-2 py-1.5 font-semibold leading-tight`}>
                {pdf("traineePosition")}
              </th>
              <th className={`${GRID_HEAD_CELL_CLASS} px-2 py-1.5 font-semibold leading-tight`}>
                {pdf("trainingTopic")}
              </th>
              <th className={`${GRID_HEAD_CELL_CLASS} px-2 py-1.5 font-semibold leading-tight`}>
                {pdf("trainingType")}
              </th>
              <th className={`${GRID_HEAD_CELL_CLASS} px-2 py-1.5 font-semibold leading-tight`}>
                {pdf("unscheduledReason")}
              </th>
              <th className={`${GRID_HEAD_CELL_CLASS} px-2 py-1.5 font-semibold leading-tight`}>
                {pdf("instructor")}
              </th>
              <th className={`${GRID_HEAD_CELL_CLASS} px-2 py-1.5 font-semibold leading-tight`}>
                {pdf("attestation")}
              </th>
            </tr>
          </thead>
          <tbody>
            {config.rows.map((row) => {
              const trainingLabel =
                TRAINING_TYPES.find((t) => t.value === row.trainingType) ? pdf(row.trainingType as (typeof TRAINING_TYPES)[number]["value"]) : row.trainingType;
              const attestLabel =
                ATTESTATION_RESULTS.find((a) => a.value === row.attestationResult) ? pdf(row.attestationResult as (typeof ATTESTATION_RESULTS)[number]["value"]) : row.attestationResult;

              return (
                <tr key={row.id}>
                  <td className={`${GRID_CELL_CLASS} px-2 py-1 align-top leading-tight`}>
                    {!isClosed && (
                      <Checkbox
                        aria-label={st("selectRecord", { number: `${config.rows.findIndex((item) => item.id === row.id) + 1}` })}
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
                  {st("emptyTable")}
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
            <DialogTitle>{st("addRecord")}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-3">
            <Label>{pdf("date")}</Label>
            <Input
              type="date"
              value={draftRow.date}
              onChange={(e) =>
                setDraftRow((prev) => ({ ...prev, date: e.target.value }))
              }
            />

            <Label>{st("employeePosition")}</Label>
            <Select
              value={draftRow.employeePosition}
              onValueChange={draftCascade.handlePositionChange}
            >
              <SelectTrigger>
                <SelectValue placeholder={controls("positionSelect.choosePosition")} />
              </SelectTrigger>
              <SelectContent>
                <PositionSelectItems users={users} displayLabel={displayRole} />
              </SelectContent>
            </Select>

            <Label>{st("employee")}</Label>
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
                <SelectValue placeholder={controls("positionSelect.chooseEmployee")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__empty__">{controls("positionSelect.chooseEmployee")}</SelectItem>
                {(draftRow.employeePosition ? draftCascade.candidates : users).map((user) => (
                  <SelectItem key={user.id} value={user.id}>
                    {staffOption(user)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Label>{st("trainingType")}</Label>
            <Select
              value={draftRow.trainingType}
              onValueChange={(val) =>
                setDraftRow((prev) => ({ ...prev, trainingType: val }))
              }
            >
              <SelectTrigger>
                <SelectValue placeholder={st("chooseList")} />
              </SelectTrigger>
              <SelectContent>
                {TRAINING_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {pdf(t.value)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Label>{st("learningTopic")}</Label>
            <Select
              value={draftRow.topic}
              onValueChange={(val) => {
                setDraftTopicKey(TRAINING_TOPICS.find((topic) => topic.label === val)?.value ?? null);
                setDraftRow((prev) => ({ ...prev, topic: val }));
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder={st("chooseList")} />
              </SelectTrigger>
              <SelectContent>
                {TRAINING_TOPICS.map((t) => (
                  <SelectItem key={t.value} value={t.label}>
                    {t.value === "haccp" ? st("haccp") : pdf(t.value)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {/* Подсказка «о чём рассказать» — чтобы инструктаж по теме
                (например, «Принципы ХАССП») провели по существу. */}
            {trainingTopicDescription(draftRow.topic) && draftTopicKey && (
              <p className="-mt-1 rounded-2xl bg-[#f5f6ff] px-3.5 py-2.5 text-[13px] leading-[1.55] text-[#3c4053]">
                <span className="font-medium text-[#3848c7]">{st("whatToCover")}</span>
                {st(`topicDescriptions.${draftTopicKey}`)}
              </p>
            )}

            <Label>{pdf("unscheduledReason")}</Label>
            <Textarea
              value={draftRow.unscheduledReason}
              onChange={(e) =>
                setDraftRow((prev) => ({
                  ...prev,
                  unscheduledReason: e.target.value,
                }))
              }
              placeholder={st("reason")}
            />

            <Label>{st("instructorPosition")}</Label>
            <Select
              value={draftRow.instructorName}
              onValueChange={(val) =>
                setDraftRow((prev) => ({ ...prev, instructorName: val }))
              }
            >
              <SelectTrigger>
                <SelectValue placeholder={controls("positionSelect.choosePosition")} />
              </SelectTrigger>
              <SelectContent>
                <PositionSelectItems users={users} displayLabel={displayRole} />
              </SelectContent>
            </Select>

            <div className="flex justify-end pt-2">
              <Button onClick={saveDraftRow} disabled={!draftRow.employeeId}>
                {common("add")}
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
            <DialogTitle>{st("editCell")}</DialogTitle>
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
                    <SelectValue placeholder={st("chooseEmployeeDashed")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__custom__">
                      {st("unlinked")}
                    </SelectItem>
                    {/* Ключ выбора — id, а не ФИО: двух однофамильцев
                        Radix склеивал в один вариант. */}
                    {users.map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {staffOption(u)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {!cellEditUserId ? (
                  <Input
                    value={cellEditValue}
                    onChange={(e) => setCellEditValue(e.target.value)}
                    placeholder={st("manualName")}
                  />
                ) : null}
              </>
            )}

            {editingCell?.field === "employeePosition" && (
              <Select value={cellEditValue || "__empty__"} onValueChange={(value) => setCellEditValue(value === "__empty__" ? "" : value)}>
                <SelectTrigger>
                  <SelectValue placeholder={st("choosePositionDashed")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__empty__">{st("unspecified")}</SelectItem>
                  <PositionSelectItems users={users} displayLabel={displayRole} />
                </SelectContent>
              </Select>
            )}

            {editingCell?.field === "topic" && (
              <Input
                value={cellEditValue}
                onChange={(e) => setCellEditValue(e.target.value)}
                placeholder={st("exampleTopic")}
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
                    {pdf(opt.value)}
                  </label>
                ))}
              </div>
            )}

            {editingCell?.field === "trainingType" && (
              <Select value={cellEditValue} onValueChange={setCellEditValue}>
                <SelectTrigger>
                  <SelectValue placeholder={st("chooseList")} />
                </SelectTrigger>
                <SelectContent>
                  {TRAINING_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {pdf(t.value)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {editingCell?.field === "unscheduledReason" && (
              <Textarea
                value={cellEditValue}
                onChange={(e) => setCellEditValue(e.target.value)}
                placeholder={st("reason")}
                rows={3}
              />
            )}

            {editingCell?.field === "instructorName" && (
              <Select value={cellEditValue} onValueChange={setCellEditValue}>
                <SelectTrigger>
                  <SelectValue placeholder={st("chooseList")} />
                </SelectTrigger>
                <SelectContent>
                  <PositionSelectItems users={users} displayLabel={displayRole} />
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
                {common("cancel")}
              </Button>
              <Button onClick={saveCellEdit}>{common("save")}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ---------- Settings Dialog ---------- */}
      {useV2 ? (
        <JournalSettingsModal
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          title={st("settingsTitle")}
          description={st("settingsDescription")}
          size="md"
          onSave={async () => {
            try {
              const response = await fetch(`/api/journal-documents/${documentId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ title: settingsTitle }),
              });
              if (!response.ok) {
                throw new Error(st("settingsFailed"));
              }
              setSettingsOpen(false);
              router.refresh();
            } catch {
              toast.error(feedback.current("settingsFailed"));
            }
          }}
          onCancel={() => setSettingsOpen(false)}
        >
          <div className="space-y-2">
            <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">{st("documentTitle")}</Label>
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
              <DialogTitle>{st("settingsTitle")}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <Label>{st("documentTitle")}</Label>
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
                        throw new Error(st("settingsFailed"));
                      }
                      setSettingsOpen(false);
                      router.refresh();
                    } catch {
                      toast.error(feedback.current("settingsFailed"));
                    }
                  }}
                >
                  {common("save")}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
