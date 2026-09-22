"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { buildStaffOptionLabel } from "@/lib/journal-staff-binding";
import { getDistinctRoleLabels, getUsersForRoleLabel } from "@/lib/user-roles";
import {
  AUDIT_PLAN_DOCUMENT_TITLE,
  createAuditPlanRow,
  createAuditPlanSection,
  getAuditPlanPrintDateLabel,
  normalizeAuditPlanConfig,
  type AuditPlanConfig,
  type AuditPlanRow,
  type AuditPlanSection,
} from "@/lib/audit-plan-document";
import { JournalSettingsModal } from "@/components/journals/v2/journal-settings-modal";
import { FocusTodayScroller } from "@/components/journals/focus-today-scroller";
import { JournalSelectionBar } from "@/components/journals/journal-selection-bar";
import { SelectionEditButton } from "@/components/journals/selection-edit-button";
import { useSequentialEdit } from "@/components/journals/use-sequential-edit";
import { useMobileView } from "@/lib/use-mobile-view";
import {
  RecordCardsView,
  type RecordCardItem,
} from "@/components/journals/record-cards-view";
import { JournalDocumentShell } from "@/components/journals/journal-document-shell";
import { JournalDocumentHeader } from "@/components/journals/journal-document-header";
import { JournalAddRow } from "@/components/journals/journal-add-row";
import { GRID_CELL_CLASS, GRID_HEAD_CELL_CLASS } from "@/components/journals/journal-grid";

import { toast } from "sonner";
import {
  PositionSelectItems,
  usePositionEmployeeCascade,
} from "@/components/shared/position-select";
import { localDayKey } from "@/lib/entry-defaults";
import { resolveApprover } from "@/lib/approver-display";
type UserItem = { id: string; name: string; role: string };

type Props = {
  documentId: string;
  title: string;
  organizationName: string;
  status: string;
  users: UserItem[];
  config: unknown;
  /** Design v2 toggle. */
  useV2?: boolean;
};

type SettingsState = {
  title: string;
  documentDate: string;
  year: string;
  approveRole: string;
  approveEmployeeId: string;
  approveEmployee: string;
};

function roleOptionsFromUsers(users: UserItem[]) {
  return getDistinctRoleLabels(users);
}

function usersForRole(users: UserItem[], roleLabel: string) {
  return getUsersForRoleLabel(users, roleLabel);
}

function toIsoDate(value: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return localDayKey();
  return date.toISOString().slice(0, 10);
}

function DocumentSettingsDialog(props: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  users: UserItem[];
  initial: SettingsState;
  onSubmit: (value: SettingsState) => Promise<void>;
  useV2?: boolean;
}) {
  const [state, setState] = useState<SettingsState>(props.initial);
  const [submitting, setSubmitting] = useState(false);
  const roles = useMemo(() => roleOptionsFromUsers(props.users), [props.users]);

  const approveCascade = usePositionEmployeeCascade({
    users: props.users,
    positionTitle: state.approveRole,
    userId: state.approveEmployeeId,
    onChange: (next) =>
      setState((current) => {
        const user = props.users.find((item) => item.id === next.userId);
        return {
          ...current,
          approveRole: next.positionTitle,
          approveEmployeeId: next.userId,
          approveEmployee: user
            ? user.name
            : next.positionTitle !== current.approveRole
              ? current.approveEmployee
              : "",
        };
      }),
    resolveCandidates: (roleLabel) => usersForRole(props.users, roleLabel),
    autoPick: "first",
  });

  async function handleSave() {
    setSubmitting(true);
    try {
      await props.onSubmit(state);
      props.onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  }

  if (props.useV2) {
    return (
      <JournalSettingsModal
        open={props.open}
        onOpenChange={(v) => {
          if (v) setState(props.initial);
          props.onOpenChange(v);
        }}
        title="Настройки документа"
        description="Название документа, дата, год и должность утверждающего."
        size="md"
        isSaving={submitting}
        onSave={handleSave}
        onCancel={() => props.onOpenChange(false)}
      >
        <div className="space-y-2">
          <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
            Название документа
          </Label>
          <Input
            value={state.title}
            onChange={(e) => setState({ ...state, title: e.target.value })}
            className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px] focus:border-[#5566f6] focus:ring-4 focus:ring-[#5566f6]/15"
          />
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
              Дата документа
            </Label>
            <Input
              type="date"
              value={state.documentDate}
              onChange={(e) => setState({ ...state, documentDate: toIsoDate(e.target.value) })}
              className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px]"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
              Год
            </Label>
            <Select value={state.year} onValueChange={(value) => setState({ ...state, year: value })}>
              <SelectTrigger className="h-10 rounded-xl border-[#dcdfed] bg-white text-[13.5px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: 10 }).map((_, idx) => {
                  const year = String(new Date().getFullYear() - 3 + idx);
                  return (
                    <SelectItem key={year} value={year}>
                      {year}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="space-y-2">
          <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
            Должность «Утверждаю»
          </Label>
          <Select
            value={state.approveRole}
            onValueChange={approveCascade.handlePositionChange}
          >
            <SelectTrigger className="h-10 rounded-xl border-[#dcdfed] bg-white text-[13.5px]">
              <SelectValue placeholder="— Выберите —" />
            </SelectTrigger>
            <SelectContent>
              <PositionSelectItems users={props.users} />
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
            Сотрудник
          </Label>
          <Select
            value={state.approveEmployeeId || "__empty__"}
            onValueChange={approveCascade.handleEmployeeChange}
            open={approveCascade.employeeOpen}
            onOpenChange={approveCascade.setEmployeeOpen}
          >
            <SelectTrigger className="h-10 rounded-xl border-[#dcdfed] bg-white text-[13.5px]">
              <SelectValue placeholder="— Выберите —" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__empty__">— не выбран —</SelectItem>
              {approveCascade.candidates.map((user) => (
                <SelectItem key={user.id} value={user.id}>
                  {buildStaffOptionLabel(user)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </JournalSettingsModal>
    );
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={(v) => {
        if (v) setState(props.initial);
        props.onOpenChange(v);
      }}
    >
      <DialogContent showCloseButton={false} className="w-[calc(100vw-2rem)] max-w-[calc(100vw-1rem)] rounded-[28px] border-0 p-0 sm:max-w-[760px]">
        <DialogHeader className="border-b px-8 py-6">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-[22px] font-semibold tracking-[-0.03em] text-black">
              Настройки документа
            </DialogTitle>
            <button type="button" className="rounded-xl p-2" onClick={() => props.onOpenChange(false)}>
              <X className="size-8" />
            </button>
          </div>
        </DialogHeader>
        <div className="space-y-4 px-8 py-6">
          <div className="space-y-2">
            <Label className="text-[14px] text-[#73738a]">Название документа</Label>
            <Input
              value={state.title}
              onChange={(e) => setState({ ...state, title: e.target.value })}
              className="h-9 rounded-xl border-[#d8dae6] px-3.5 text-[13.5px]"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-[14px] text-[#73738a]">Дата документа</Label>
            <Input
              type="date"
              value={state.documentDate}
              onChange={(e) => setState({ ...state, documentDate: toIsoDate(e.target.value) })}
              className="h-9 rounded-xl border-[#d8dae6] px-3.5 text-[13.5px]"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-[14px] text-[#73738a]">Год</Label>
            <Select value={state.year} onValueChange={(value) => setState({ ...state, year: value })}>
              <SelectTrigger className="h-10 rounded-xl border-[#d8dae6] bg-[#f1f2f8] px-3.5 text-[13.5px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: 10 }).map((_, idx) => {
                  const year = String(new Date().getFullYear() - 3 + idx);
                  return (
                    <SelectItem key={year} value={year}>
                      {year}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label className="text-[14px] text-[#73738a]">Должность &quot;Утверждаю&quot;</Label>
            <Select
              value={state.approveRole}
              onValueChange={approveCascade.handlePositionChange}
            >
              <SelectTrigger className="h-10 rounded-xl border-[#d8dae6] bg-[#f1f2f8] px-3.5 text-[13.5px]">
                <SelectValue placeholder="Выберите должность" />
              </SelectTrigger>
              <SelectContent>
                <PositionSelectItems users={props.users} />
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label className="text-[14px] text-[#73738a]">Сотрудник</Label>
            <Select
              value={state.approveEmployeeId || "__empty__"}
              onValueChange={approveCascade.handleEmployeeChange}
              open={approveCascade.employeeOpen}
              onOpenChange={approveCascade.setEmployeeOpen}
            >
              <SelectTrigger className="h-10 rounded-xl border-[#d8dae6] bg-[#f1f2f8] px-3.5 text-[13.5px]">
                <SelectValue placeholder="Выберите сотрудника" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__empty__">Выберите сотрудника</SelectItem>
                {approveCascade.candidates.map((user) => (
                  <SelectItem key={user.id} value={user.id}>
                    {buildStaffOptionLabel(user)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex justify-end pt-2">
            <Button
              type="button"
              disabled={submitting}
              onClick={handleSave}
              className="h-9 rounded-xl bg-[#5563ff] px-3.5 text-[13.5px] text-white hover:bg-[#4554ff]"
            >
              {submitting ? "Сохранение..." : "Сохранить"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ManageSectionsDialog(props: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  sections: AuditPlanSection[];
  onRename: (id: string, title: string) => Promise<void>;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [value, setValue] = useState("");

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open) {
          setEditingId(null);
          setValue("");
        }
        props.onOpenChange(open);
      }}
    >
      <DialogContent showCloseButton={false} className="w-[calc(100vw-2rem)] max-w-[calc(100vw-1rem)] rounded-[28px] border-0 p-0 sm:max-w-[620px]">
        <DialogHeader className="border-b px-8 py-6">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-[22px] font-semibold tracking-[-0.03em] text-black">
              Список &quot;Разделы&quot;
            </DialogTitle>
            <button type="button" className="rounded-xl p-2" onClick={() => props.onOpenChange(false)}>
              <X className="size-7" />
            </button>
          </div>
        </DialogHeader>
        <div className="space-y-3 px-8 py-6">
          {props.sections.map((section) => (
            <div key={section.id} className="flex items-center gap-4 rounded-2xl bg-[#f5f6fb] px-4 py-4">
              <Checkbox checked={false} />
              {editingId === section.id ? (
                <Input
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  className="h-12 flex-1 rounded-2xl border-[#d8dae6] px-4 text-[18px]"
                />
              ) : (
                <div className="flex-1 text-[15px] text-black">{section.title}</div>
              )}
              {editingId === section.id ? (
                <Button
                  type="button"
                  className="h-10 rounded-2xl bg-[#5563ff] px-4 text-white"
                  onClick={async () => {
                    if (!value.trim()) return;
                    await props.onRename(section.id, value.trim());
                    setEditingId(null);
                    setValue("");
                  }}
                >
                  Сохранить
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  className="h-10 rounded-2xl px-4 text-[#5563ff]"
                  onClick={() => {
                    setEditingId(section.id);
                    setValue(section.title);
                  }}
                >
                  Изменить
                </Button>
              )}
            </div>
          ))}
          <div className="flex justify-end pt-2">
            <Button type="button" className="h-9 rounded-xl bg-[#5563ff] px-3.5 text-[13.5px] text-white hover:bg-[#4554ff]" onClick={() => props.onOpenChange(false)}>
              Закрыть
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AddSectionDialog(props: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  onCreate: (title: string) => Promise<void>;
  title: string;
  placeholder: string;
}) {
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!props.open) {
      setValue("");
      setSubmitting(false);
    }
  }, [props.open]);

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent showCloseButton={false} className="w-[calc(100vw-2rem)] max-w-[calc(100vw-1rem)] rounded-[28px] border-0 p-0 sm:max-w-[620px]">
        <DialogHeader className="border-b px-8 py-6">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-[22px] font-semibold tracking-[-0.03em] text-black">
              {props.title}
            </DialogTitle>
            <button type="button" className="rounded-xl p-2" onClick={() => props.onOpenChange(false)}>
              <X className="size-7" />
            </button>
          </div>
        </DialogHeader>
        <div className="space-y-4 px-8 py-6">
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={props.placeholder}
            className="h-9 rounded-xl border-[#d8dae6] px-3.5 text-[13.5px]"
          />
          <div className="flex justify-end">
            <Button
              type="button"
              disabled={submitting || !value.trim()}
              className="h-9 rounded-xl bg-[#5563ff] px-3.5 text-[13.5px] text-white hover:bg-[#4554ff]"
              onClick={async () => {
                setSubmitting(true);
                try {
                  await props.onCreate(value.trim());
                  props.onOpenChange(false);
                } finally {
                  setSubmitting(false);
                }
              }}
            >
              {submitting ? "Добавление..." : "Добавить"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AddRowDialog(props: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  sections: AuditPlanSection[];
  /** Правка существующей строки; null — добавление новой. */
  editRow?: AuditPlanRow | null;
  /** «(k из N)» при правке по очереди. */
  titleSuffix?: string;
  onCreate: (sectionId: string, text: string) => Promise<void>;
  onOpenAddSection: () => void;
  onOpenManageSections: () => void;
}) {
  const [sectionId, setSectionId] = useState(props.sections[0]?.id || "");
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const editRow = props.editRow ?? null;

  useEffect(() => {
    if (props.open) {
      setSectionId(props.editRow?.sectionId || props.sections[0]?.id || "");
      setText(props.editRow?.text || "");
      setSubmitting(false);
    }
  }, [props.editRow, props.open, props.sections]);

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent showCloseButton={false} className="w-[calc(100vw-2rem)] max-w-[calc(100vw-1rem)] rounded-[28px] border-0 p-0 sm:max-w-[620px]">
        <DialogHeader className="border-b px-8 py-6">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-[22px] font-semibold tracking-[-0.03em] text-black">
              {editRow ? `Редактирование строки${props.titleSuffix ? ` ${props.titleSuffix}` : ""}` : "Добавление новой строки"}
            </DialogTitle>
            <button type="button" className="rounded-xl p-2" onClick={() => props.onOpenChange(false)}>
              <X className="size-7" />
            </button>
          </div>
        </DialogHeader>
        <div className="space-y-4 px-8 py-6">
          <div className="space-y-2">
            <Label className="text-[14px] text-[#73738a]">Раздел</Label>
            <Select value={sectionId} onValueChange={setSectionId}>
              <SelectTrigger className="h-10 rounded-xl border-[#d8dae6] bg-[#f1f2f8] px-3.5 text-[13.5px]">
                <SelectValue placeholder="Выберите из списка" />
              </SelectTrigger>
              <SelectContent>
                {props.sections.map((section) => (
                  <SelectItem key={section.id} value={section.id}>
                    {section.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label className="text-[14px] text-[#73738a]">Текст</Label>
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="min-h-[160px] rounded-2xl border-[#d8dae6] px-4 py-3 text-[18px]"
            />
          </div>
          <div className="space-y-1 text-[16px]">
            <button type="button" className="block text-[#5563ff] hover:underline" onClick={props.onOpenAddSection}>
              Добавить новый раздел
            </button>
            <button type="button" className="block text-[#5563ff] hover:underline" onClick={props.onOpenManageSections}>
              Редактировать список &quot;разделов&quot;
            </button>
          </div>
          <div className="flex justify-end">
            <Button
              type="button"
              disabled={submitting || !sectionId || !text.trim()}
              className="h-9 rounded-xl bg-[#5563ff] px-3.5 text-[13.5px] text-white hover:bg-[#4554ff]"
              onClick={async () => {
                setSubmitting(true);
                try {
                  await props.onCreate(sectionId, text.trim());
                  props.onOpenChange(false);
                } finally {
                  setSubmitting(false);
                }
              }}
            >
              {submitting ? "Сохранение..." : "Сохранить"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CellValueDialog(props: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  initialValue: string;
  title: string;
  onSave: (value: string) => Promise<void>;
}) {
  const [value, setValue] = useState(props.initialValue);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (props.open) {
      setValue(props.initialValue);
      setSubmitting(false);
    }
  }, [props.initialValue, props.open]);

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent showCloseButton={false} className="w-[calc(100vw-2rem)] max-w-[calc(100vw-1rem)] rounded-[28px] border-0 p-0 sm:max-w-[520px]">
        <DialogHeader className="border-b px-8 py-6">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-[24px] font-semibold text-black">{props.title}</DialogTitle>
            <button type="button" className="rounded-xl p-2" onClick={() => props.onOpenChange(false)}>
              <X className="size-7" />
            </button>
          </div>
        </DialogHeader>
        <div className="space-y-4 px-8 py-6">
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Например: 29-05-2023 или X"
            className="h-9 rounded-xl border-[#d8dae6] px-3.5 text-[13.5px]"
          />
          <div className="flex flex-wrap justify-end gap-3">
            <Button
              type="button"
              variant="outline"
              className="h-12 rounded-2xl"
              onClick={async () => {
                setSubmitting(true);
                try {
                  await props.onSave("");
                  props.onOpenChange(false);
                } finally {
                  setSubmitting(false);
                }
              }}
            >
              Очистить
            </Button>
            <Button
              type="button"
              disabled={submitting}
              className="h-9 rounded-xl bg-[#5563ff] px-3.5 text-[13.5px] text-white hover:bg-[#4554ff]"
              onClick={async () => {
                setSubmitting(true);
                try {
                  await props.onSave(value.trim());
                  props.onOpenChange(false);
                } finally {
                  setSubmitting(false);
                }
              }}
            >
              {submitting ? "Сохранение..." : "Сохранить"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function AuditPlanDocumentClient({
  documentId,
  title,
  organizationName,
  status,
  users,
  config,
  useV2 = false,
}: Props) {
  const router = useRouter();
  const normalized = normalizeAuditPlanConfig(config, { organizationName, users });
  // «УТВЕРЖДАЮ»: должность и ФИО одного человека — из его карточки.
  const approver = resolveApprover(normalized, users);
  const readOnly = status === "closed";
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [manageSectionsOpen, setManageSectionsOpen] = useState(false);
  const [addSectionOpen, setAddSectionOpen] = useState(false);
  const [addColumnOpen, setAddColumnOpen] = useState(false);
  const [addRowOpen, setAddRowOpen] = useState(false);
  // Текст требования нельзя было исправить нигде: то же окно работает и
  // как правка — проставленные по колонкам даты не трогаются.
  const [editingRow, setEditingRow] = useState<AuditPlanRow | null>(null);
  const [selectedRowIds, setSelectedRowIds] = useState<string[]>([]);
  // Окно само зовёт onOpenChange(false) после сохранения — это не отмена.
  const rowSavedRef = useRef(false);
  const [cellEditor, setCellEditor] = useState<{
    rowId: string;
    columnId: string;
    title: string;
    value: string;
  } | null>(null);

  const rowsBySection = useMemo(
    () =>
      normalized.sections.map((section) => ({
        section,
        rows: normalized.rows.filter((row) => row.sectionId === section.id),
      })),
    [normalized.rows, normalized.sections]
  );

  const settingsState: SettingsState = {
    title,
    documentDate: normalized.documentDate,
    year: String(normalized.year),
    approveRole: normalized.approveRole,
    approveEmployeeId: normalized.approveEmployeeId || "",
    approveEmployee: normalized.approveEmployee,
  };

  async function patchConfig(nextConfig: AuditPlanConfig, nextTitle = title) {
    const response = await fetch(`/api/journal-documents/${documentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: nextTitle,
        dateFrom: nextConfig.documentDate,
        dateTo: nextConfig.documentDate,
        config: nextConfig,
      }),
    });
    if (!response.ok) {
      toast.error("Не удалось сохранить документ");
      return;
    }
    router.refresh();
  }

  async function renameSection(id: string, nextTitle: string) {
    await patchConfig({
      ...normalized,
      sections: normalized.sections.map((section) =>
        section.id === id ? { ...section, title: nextTitle } : section
      ),
    });
  }

  async function addSection(nextTitle: string) {
    await patchConfig({
      ...normalized,
      sections: [...normalized.sections, createAuditPlanSection(nextTitle)],
    });
  }

  async function addColumn(nextTitle: string) {
    const nextColumnId = `audit-${normalized.columns.length + 1}`;
    await patchConfig({
      ...normalized,
      columns: [...normalized.columns, { id: nextColumnId, title: nextTitle, auditorName: "" }],
      rows: normalized.rows.map((row) => ({
        ...row,
        values: { ...row.values, [nextColumnId]: "" },
      })),
    });
  }

  /** Правка выделенных строк по очереди — тем же окном. */
  const seq = useSequentialEdit({
    open: (id) => {
      const row = normalized.rows.find((item) => item.id === id);
      if (!row || readOnly) return false;
      setEditingRow(row);
      setAddRowOpen(true);
      return true;
    },
    close: () => {
      setAddRowOpen(false);
      setEditingRow(null);
    },
  });

  async function addRow(sectionId: string, textValue: string) {
    if (editingRow) {
      await patchConfig({
        ...normalized,
        rows: normalized.rows.map((row) =>
          row.id === editingRow.id
            ? { ...row, sectionId, text: textValue }
            : row
        ),
      });
      // Очередь правок откроет следующую строку или закроет окно.
      rowSavedRef.current = true;
      seq.saved();
      return;
    }
    await patchConfig({
      ...normalized,
      rows: [
        ...normalized.rows,
        createAuditPlanRow(sectionId, textValue, normalized.columns.map((column) => column.id)),
      ],
    });
  }

  async function updateRowChecked(rowId: string, checked: boolean) {
    await patchConfig({
      ...normalized,
      rows: normalized.rows.map((row) => (row.id === rowId ? { ...row, checked } : row)),
    });
  }

  async function deleteSelectedRows() {
    if (selectedRowIds.length === 0) return;
    setSelectedRowIds([]);
    await patchConfig({
      ...normalized,
      rows: normalized.rows.filter((row) => !selectedRowIds.includes(row.id)),
    });
  }

  async function updateCellValue(rowId: string, columnId: string, value: string) {
    await patchConfig({
      ...normalized,
      rows: normalized.rows.map((row) =>
        row.id === rowId ? { ...row, values: { ...row.values, [columnId]: value } } : row
      ),
    });
  }

  async function updateColumnAuditor(columnId: string, auditorName: string) {
    await patchConfig({
      ...normalized,
      columns: normalized.columns.map((column) =>
        column.id === columnId ? { ...column, auditorName } : column
      ),
    });
  }

  const allSelected =
    normalized.rows.length > 0 && selectedRowIds.length === normalized.rows.length;
  const { mobileView, switchMobileView } = useMobileView("audit_plan");

  const cardItems: RecordCardItem[] = normalized.rows.map((row, index) => {
    const section = normalized.sections.find((s) => s.id === row.sectionId);
    return {
      id: row.id,
      title: `№${index + 1} · ${row.text || "—"}`,
      subtitle: section?.title || undefined,
      leading: !readOnly ? (
        <Checkbox
          checked={selectedRowIds.includes(row.id)}
          onCheckedChange={(checked) =>
            setSelectedRowIds((current) =>
              checked === true
                ? [...new Set([...current, row.id])]
                : current.filter((id) => id !== row.id)
            )
          }
          className="size-5"
        />
      ) : null,
      onClick: !readOnly
        ? () => {
            setEditingRow(row);
            setAddRowOpen(true);
          }
        : undefined,
      fields: normalized.columns.map((column) => ({
        label: `${column.title}${column.auditorName ? ` — ${column.auditorName}` : ""}`,
        value: row.values[column.id] || "",
        hideIfEmpty: false,
        onClick: !readOnly
          ? () =>
              setCellEditor({
                rowId: row.id,
                columnId: column.id,
                title: `${row.text} / ${column.title}`,
                value: row.values[column.id] || "",
              })
          : undefined,
      })),
    };
  });

  return (
    <div className="space-y-5">
      {selectedRowIds.length > 0 && !readOnly && (
        <JournalSelectionBar
          count={selectedRowIds.length}
          onClear={() => setSelectedRowIds([])}
          onDelete={() => void deleteSelectedRows()}
          hint="Строки плана будут удалены без возможности отмены"
        >
          <SelectionEditButton count={selectedRowIds.length} disabled={readOnly} onClick={() => seq.start(selectedRowIds)} />
        </JournalSelectionBar>
      )}

      <FocusTodayScroller selector="[data-focus-today]" emptyTitle="Записей пока нет" emptyBody="Нажмите «Добавить» в таблице ниже, чтобы создать запись." />

      <JournalDocumentShell
        title={title}
        documentId={documentId}
        backHref="/journals/audit_plan"
        onSettings={!readOnly ? () => setSettingsOpen(true) : undefined}
        closed={readOnly}
        closedHint="Откройте журнал заново, чтобы менять план-программу аудитов."
        mobileView={mobileView}
        onMobileView={switchMobileView}
        cards={
          <RecordCardsView items={cardItems} emptyLabel="Требований пока не добавлено." />
        }
        paperHeader={
          <>
            <JournalDocumentHeader
              orgName={organizationName}
              title="ПЛАН-ПРОГРАММА ВНУТРЕННИХ АУДИТОВ"
              startedAt={normalized.documentDate}
              finishedAt={null}
            />
            <div className="ml-auto w-full max-w-[420px] text-right text-[14px] leading-tight">
              <div className="font-semibold">УТВЕРЖДАЮ</div>
              <div>{approver.title}</div>
              <div>{approver.name}</div>
              <div>{getAuditPlanPrintDateLabel(normalized.documentDate)}</div>
            </div>
          </>
        }
        sheetTitle={`План-программа внутренних аудитов на ${normalized.year} г.`}
        toolbar={
          !readOnly ? (
            // Свой flex-wrap: в карточном виде на телефоне оболочка
            // отдаёт тулбар без ряда-обёртки, и кнопки слипались.
            <div className="flex flex-wrap items-center gap-2">
              <Button className="h-9 rounded-xl bg-[#5563ff] px-3.5 text-[13.5px] text-white hover:bg-[#4554ff]" onClick={() => setAddRowOpen(true)}>
                <Plus className="size-5" /> Добавить
              </Button>
              <Button className="h-9 rounded-xl bg-[#5563ff] px-3.5 text-[13.5px] text-white hover:bg-[#4554ff]" onClick={() => setAddColumnOpen(true)}>
                <Plus className="size-5" /> Добавить подразделение
              </Button>
            </div>
          ) : undefined
        }
      >
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr>
              <th rowSpan={3} className={`w-14 ${GRID_HEAD_CELL_CLASS} px-2 py-1.5 font-semibold leading-tight`}>
                {!readOnly && <Checkbox checked={allSelected} onCheckedChange={(checked) => setSelectedRowIds(checked === true ? normalized.rows.map((row) => row.id) : [])} />}
              </th>
              <th rowSpan={3} className={`w-[60px] ${GRID_HEAD_CELL_CLASS} px-2 py-1.5 text-center font-semibold leading-tight`}>№ п/п</th>
              <th rowSpan={3} className={`min-w-[620px] ${GRID_HEAD_CELL_CLASS} px-3 py-1.5 font-semibold leading-tight`}>Требования</th>
              <th colSpan={normalized.columns.length} className={`${GRID_HEAD_CELL_CLASS} px-3 py-1.5 text-center font-semibold leading-tight`}>Дата аудита в подразделениях / назначенный(е) аудитор(ы):</th>
            </tr>
            <tr>
              {normalized.columns.map((column) => (
                <th key={column.id} className={`min-w-[150px] ${GRID_HEAD_CELL_CLASS} px-2 py-1.5 text-center italic font-semibold leading-tight`}>{column.title}</th>
              ))}
            </tr>
            <tr>
              {normalized.columns.map((column) => (
                <th key={column.id} className={`${GRID_HEAD_CELL_CLASS} px-2 py-1.5 text-center font-semibold leading-tight`}>
                  {readOnly ? (
                    column.auditorName || "—"
                  ) : (
                    <select className="w-full bg-transparent text-center text-[16px] outline-none" value={users.find((user) => user.name === column.auditorName)?.id || (column.auditorName ? "__saved" : "")} onChange={(e) => void updateColumnAuditor(column.id, e.target.value === "__saved" ? column.auditorName : users.find((user) => user.id === e.target.value)?.name || "")}>
                      <option value="">Добавить ФИО</option>
                      {/* Сохранённое имя: аудитор мог уволиться, и тогда
                          в шапке рисовалось «Добавить ФИО» вместо него. */}
                      {column.auditorName && !users.some((user) => user.name === column.auditorName) ? (
                        <option value="__saved">{column.auditorName}</option>
                      ) : null}
                      {users.map((user) => (
                        <option key={user.id} value={user.id}>{user.name}</option>
                      ))}
                    </select>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rowsBySection.map(({ section, rows }) => (
              <Fragment key={section.id}>
                <tr key={`${section.id}-title`}>
                  <td colSpan={3 + normalized.columns.length} className={`${GRID_CELL_CLASS} px-3 py-1 text-center font-semibold leading-tight`}>{section.title}</td>
                </tr>
                {rows.map((row) => {
                  const rowNumber = normalized.rows.findIndex((item) => item.id === row.id) + 1;
                  return (
                    <tr key={row.id}>
                      <td className={`${GRID_CELL_CLASS} px-2 py-1 text-center leading-tight`}>
                        {!readOnly && (
                          <Checkbox checked={selectedRowIds.includes(row.id)} onCheckedChange={(checked) => setSelectedRowIds((current) => checked === true ? [...new Set([...current, row.id])] : current.filter((id) => id !== row.id))} />
                        )}
                      </td>
                      <td className={`${GRID_CELL_CLASS} px-2 py-1 text-center leading-tight`}>{rowNumber}</td>
                      <td className={`${GRID_CELL_CLASS} px-3 py-1 leading-tight`}>
                        <div className="flex items-start gap-3">
                          {!readOnly && <Checkbox checked={row.checked} onCheckedChange={(checked) => void updateRowChecked(row.id, checked === true)} />}
                          {readOnly ? (
                            <span>{row.text}</span>
                          ) : (
                            <button
                              type="button"
                              className="flex-1 rounded px-1 text-left transition-colors duration-150 hover:bg-[#f5f6ff]"
                              onClick={() => {
                                setEditingRow(row);
                                setAddRowOpen(true);
                              }}
                            >
                              {row.text}
                            </button>
                          )}
                        </div>
                      </td>
                      {normalized.columns.map((column) => (
                        <td key={column.id} className={`${GRID_CELL_CLASS} px-2 py-1 text-center leading-tight`}>
                          {readOnly ? (
                            row.values[column.id] || ""
                          ) : (
                            <button type="button" className="min-h-[28px] w-full rounded px-1 text-center hover:bg-[#f5f6ff]" onClick={() => setCellEditor({ rowId: row.id, columnId: column.id, title: `${row.text} / ${column.title}`, value: row.values[column.id] || "" })}>
                              {row.values[column.id] || ""}
                            </button>
                          )}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </Fragment>
            ))}
            {!readOnly ? (
              <JournalAddRow
                // Галочка + № п/п — leading, «Требования» (широкая колонка)
                // — под подпись, колонки подразделений остаются пустыми.
                leading={2}
                labelSpan={1}
                trailing={normalized.columns.length}
                label="Добавить"
                onClick={() => setAddRowOpen(true)}
              />
            ) : null}
          </tbody>
        </table>
      </JournalDocumentShell>

      <DocumentSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} users={users} initial={settingsState} useV2={useV2} onSubmit={async (value) => {
        const nextConfig = normalizeAuditPlanConfig({ ...normalized, year: Number(value.year), documentDate: value.documentDate, approveRole: value.approveRole, approveEmployeeId: value.approveEmployeeId || null, approveEmployee: value.approveEmployee });
        await patchConfig(nextConfig, value.title.trim() || title);
      }} />

      <ManageSectionsDialog open={manageSectionsOpen} onOpenChange={setManageSectionsOpen} sections={normalized.sections} onRename={renameSection} />
      <AddSectionDialog open={addSectionOpen} onOpenChange={setAddSectionOpen} onCreate={addSection} title="Добавить новый раздел" placeholder="Введите название раздела" />
      <AddSectionDialog open={addColumnOpen} onOpenChange={setAddColumnOpen} onCreate={addColumn} title="Добавление нового подразделения" placeholder="Введите название подразделения" />
      <AddRowDialog open={addRowOpen} onOpenChange={(open) => { if (open) { setAddRowOpen(true); return; } if (rowSavedRef.current) { rowSavedRef.current = false; return; } seq.cancelled(); }} sections={normalized.sections} editRow={editingRow} titleSuffix={seq.progress ?? undefined} onCreate={addRow} onOpenAddSection={() => setAddSectionOpen(true)} onOpenManageSections={() => setManageSectionsOpen(true)} />
      <CellValueDialog open={!!cellEditor} onOpenChange={(open) => { if (!open) setCellEditor(null); }} initialValue={cellEditor?.value || ""} title={cellEditor?.title || "Редактирование ячейки"} onSave={async (value) => {
        if (!cellEditor) return;
        await updateCellValue(cellEditor.rowId, cellEditor.columnId, value);
      }} />
    </div>
  );
}
