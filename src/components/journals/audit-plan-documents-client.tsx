"use client";

import { FillGuideLauncher } from "@/components/journals/fill-guide-launcher";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BookOpenText,
  CalendarDays,
  Copy,
  Ellipsis,
  Pencil,
  Plus,
  Printer,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ResponsiveMenu } from "@/components/ui/responsive-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getDistinctRoleLabels } from "@/lib/user-roles";
import { buildStaffOptionLabel } from "@/lib/journal-staff-binding";
import {
  AUDIT_PLAN_DOCUMENT_TITLE,
  AUDIT_PLAN_HEADING,
  AUDIT_PLAN_TEMPLATE_CODE,
  getAuditPlanApproveLabel,
  getAuditPlanDefaultConfig,
  getAuditPlanDocumentDateLabel,
  normalizeAuditPlanConfig,
  type AuditPlanConfig,
} from "@/lib/audit-plan-document";
import { openDocumentPdf } from "@/lib/open-document-pdf";
import { buildDocumentCopy } from "@/lib/journal-document-copy";

import { toast } from "sonner";
import {
  EmptyDocumentsState,
  filterManageMenuItems,
  useCanManageDocuments,
} from "@/components/journals/document-list-ui";
import { resolveJournalPeriodForDate } from "@/lib/journal-period";
import {
  JOURNAL_CARD_LABEL_CLASS,
  JOURNAL_CARD_SECTION_CLASS,
  JOURNAL_CARD_TITLE_CLASS,
  JOURNAL_CARD_VALUE_CLASS,
  JOURNAL_LIST_ACTIONS_CLASS,
  JOURNAL_LIST_HEADING_CLASS,
  JOURNAL_LIST_CARD_CLASS,
  JOURNAL_LIST_CARDS_CLASS,
} from "@/components/journals/journal-responsive";
import {
  PositionSelectItems,
  usePositionEmployeeCascade,
} from "@/components/shared/position-select";
import { useAutoDocumentTitle } from "@/components/journals/use-auto-document-title";
import { localDayKey } from "@/lib/entry-defaults";
import { SharedDocumentBadge } from "@/components/journals/shared-document-badge";
type UserItem = { id: string; name: string; role: string };

type AuditPlanDocumentItem = {
  id: string;
  title: string;
  /** Точки: документ без точки рядом с документами точек. */
  shared?: boolean;
  status: "active" | "closed";
  dateFrom: string;
  dateTo: string;
  config: unknown;
};

type Props = {
  routeCode: string;
  templateCode: string;
  activeTab: "active" | "closed";
  users: UserItem[];
  documents: AuditPlanDocumentItem[];
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

function toIsoDate(value: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return localDayKey();
  return date.toISOString().slice(0, 10);
}

function toUiState(document: AuditPlanDocumentItem, users: UserItem[]): SettingsState {
  const cfg = normalizeAuditPlanConfig(document.config, { users });
  return {
    title: document.title || AUDIT_PLAN_DOCUMENT_TITLE,
    documentDate: cfg.documentDate,
    year: String(cfg.year),
    approveRole: cfg.approveRole,
    approveEmployeeId: cfg.approveEmployeeId || "",
    approveEmployee: cfg.approveEmployee,
  };
}

function SettingsDialog(props: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  users: UserItem[];
  initial: SettingsState | null;
  onSubmit: (value: SettingsState) => Promise<void>;
  submitText: string;
  title: string;
  mode: "create" | "edit";
}) {
  const [state, setState] = useState<SettingsState | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const roles = useMemo(() => roleOptionsFromUsers(props.users), [props.users]);
  const activeState = state || props.initial;

  const auto = useAutoDocumentTitle({
    templateCode: AUDIT_PLAN_TEMPLATE_CODE,
    journalName: AUDIT_PLAN_DOCUMENT_TITLE,
    period: { dateFrom: activeState?.documentDate, year: activeState?.year },
    enabled: props.mode === "create",
  });

  /**
   * Сброс и автоназвание — на открытии по `props.open`, а не в
   * `Dialog.onOpenChange`: тот не срабатывает при программном
   * `setCreateOpen(true)`. `initial` читаем через ref, чтобы нестабильный
   * объект из родителя не сбрасывал форму на каждом рендере.
   */
  const initialRef = useRef(props.initial);
  useEffect(() => {
    initialRef.current = props.initial;
  });
  const { reset: resetAuto, seedTitle } = auto;
  useEffect(() => {
    if (!props.open) {
      setState(null);
      return;
    }
    const initial = initialRef.current;
    resetAuto();
    setState(initial ? { ...initial, title: initial.title || seedTitle() } : initial);
  }, [props.open, resetAuto, seedTitle]);

  const cascade = usePositionEmployeeCascade({
    users: props.users,
    positionTitle: activeState?.approveRole ?? "",
    userId: activeState?.approveEmployeeId ?? "",
    onChange: (next) => {
      if (!activeState) return;
      const user = props.users.find((item) => item.id === next.userId);
      setState({
        ...activeState,
        approveRole: next.positionTitle,
        approveEmployeeId: next.userId,
        approveEmployee: user?.name || activeState.approveEmployee,
      });
    },
    autoPick: "first",
  });

  async function handleSubmit() {
    if (!activeState) return;
    setSubmitting(true);
    try {
      await props.onSubmit(activeState);
      props.onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
    >
      <DialogContent showCloseButton={false} className="w-[calc(100vw-2rem)] max-w-[calc(100vw-1rem)] rounded-[28px] border-0 p-0 sm:max-w-[760px]">
        <DialogHeader className="border-b px-8 py-6">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-[22px] font-semibold tracking-[-0.03em] text-black">
              {props.title}
            </DialogTitle>
            <button
              type="button"
              className="rounded-xl p-2"
              onClick={() => props.onOpenChange(false)}
            >
              <X className="size-8" />
            </button>
          </div>
        </DialogHeader>
        {activeState && (
          <div className="space-y-4 px-8 py-6">
            <div className="space-y-2">
              <Label className="text-[14px] text-[#73738a]">Название документа</Label>
              <Input
                value={activeState.title}
                onChange={(e) => {
                  auto.markTouched();
                  setState({ ...activeState, title: e.target.value });
                }}
                className="h-9 rounded-xl border-[#d8dae6] px-3.5 text-[13.5px]"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-[14px] text-[#73738a]">Дата документа</Label>
              <div className="relative">
                <Input
                  type="date"
                  value={activeState.documentDate}
                  onChange={(e) => {
                    const documentDate = toIsoDate(e.target.value);
                    const next = auto.titleForPeriod({
                      dateFrom: documentDate,
                      year: activeState.year,
                    });
                    setState({
                      ...activeState,
                      documentDate,
                      ...(next !== null ? { title: next } : {}),
                    });
                  }}
                  className="h-9 rounded-xl border-[#d8dae6] px-3.5 pr-14 text-[13.5px]"
                />
                <CalendarDays className="pointer-events-none absolute right-4 top-1/2 size-6 -translate-y-1/2 text-[#6e7080]" />
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-[14px] text-[#73738a]">Год</Label>
              <Select
                value={activeState.year}
                onValueChange={(v) => {
                  const next = auto.titleForPeriod({
                    dateFrom: activeState.documentDate,
                    year: v,
                  });
                  setState({
                    ...activeState,
                    year: v,
                    ...(next !== null ? { title: next } : {}),
                  });
                }}
              >
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
                value={activeState.approveRole}
                onValueChange={cascade.handlePositionChange}
              >
                <SelectTrigger className="h-10 rounded-xl border-[#d8dae6] bg-[#f1f2f8] px-3.5 text-[13.5px]">
                  <SelectValue placeholder="- Выберите значение -" />
                </SelectTrigger>
                <SelectContent>
                  <PositionSelectItems users={props.users} />
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-[14px] text-[#73738a]">Сотрудник</Label>
              <Select
                value={activeState.approveEmployeeId}
                onValueChange={cascade.handleEmployeeChange}
                open={cascade.employeeOpen}
                onOpenChange={cascade.setEmployeeOpen}
              >
                <SelectTrigger className="h-10 rounded-xl border-[#d8dae6] bg-[#f1f2f8] px-3.5 text-[13.5px]">
                  <SelectValue placeholder="- Выберите значение -" />
                </SelectTrigger>
                <SelectContent>
                  {cascade.candidates.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {buildStaffOptionLabel(u)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-end pt-2">
              <Button
                type="button"
                disabled={submitting}
                onClick={handleSubmit}
                className="h-9 rounded-xl bg-[#5563ff] px-3.5 text-[13.5px] text-white hover:bg-[#4554ff]"
              >
                {submitting ? "Сохранение..." : props.submitText}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function AuditPlanDocumentsClient({
  routeCode,
  templateCode,
  activeTab,
  users,
  documents,
}: Props) {
  const router = useRouter();
  const [settingsTarget, setSettingsTarget] = useState<AuditPlanDocumentItem | null>(null);
  // Создание / настройки / удаление документов API отдаёт только
  // руководителю — у остальных эти кнопки не показываем.
  const canManageDocuments = useCanManageDocuments();
  const [createOpen, setCreateOpen] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<AuditPlanDocumentItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AuditPlanDocumentItem | null>(null);

  const defaultConfig = useMemo(
    () => getAuditPlanDefaultConfig({ users }),
    [users]
  );

  async function createDocument(payload: SettingsState) {
    const config: AuditPlanConfig = {
      ...defaultConfig,
      year: Number(payload.year),
      documentDate: payload.documentDate,
      approveRole: payload.approveRole,
      approveEmployeeId: payload.approveEmployeeId || null,
      approveEmployee: payload.approveEmployee,
    };

    const response = await fetch("/api/journal-documents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        templateCode,
        title: payload.title.trim() || AUDIT_PLAN_DOCUMENT_TITLE,
        // Период — по правилу журнала (`journal-period.ts`): план аудитов
        // годовой. «Дата документа» остаётся в шапке (config.documentDate).
        ...resolveJournalPeriodForDate(templateCode, payload.documentDate),
        config,
      }),
    });
    if (!response.ok) {
      // Текст сервера («За этот период уже есть документ «…»») объясняет
      // отказ. Общая фраза оставляла человека без причины и без выхода.
      const failure = await response.json().catch(() => null);
      toast.error(failure?.error || "Не удалось создать документ");
      return;
    }

    const data = (await response.json()) as { document: { id: string } };
    router.push(`/journals/${routeCode}/documents/${data.document.id}`);
    router.refresh();
  }

  async function saveSettings(documentId: string, payload: SettingsState) {
    const current = documents.find((d) => d.id === documentId);
    if (!current) return;
    const currentConfig = normalizeAuditPlanConfig(current.config, { users });
    const config: AuditPlanConfig = {
      ...currentConfig,
      year: Number(payload.year),
      documentDate: payload.documentDate,
      approveRole: payload.approveRole,
      approveEmployeeId: payload.approveEmployeeId || null,
      approveEmployee: payload.approveEmployee,
    };
    const response = await fetch(`/api/journal-documents/${documentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: payload.title.trim() || AUDIT_PLAN_DOCUMENT_TITLE,
        dateFrom: payload.documentDate,
        dateTo: payload.documentDate,
        config,
      }),
    });
    if (!response.ok) {
      toast.error("Не удалось сохранить документ");
      return;
    }
    router.refresh();
  }

  async function handleDelete(documentId: string) {
    const response = await fetch(`/api/journal-documents/${documentId}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      toast.error("Не удалось удалить документ");
      return;
    }
    setDeleteTarget(null);
    router.refresh();
  }

  async function moveToStatus(documentId: string, newStatus: "active" | "closed") {
    const response = await fetch(`/api/journal-documents/${documentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });
    if (!response.ok) {
      toast.error("Не удалось изменить статус документа");
      return;
    }
    setArchiveTarget(null);
    router.refresh();
  }

  async function copyDocument(document: AuditPlanDocumentItem) {
    // Копия — это ЧИСТЫЙ бланк на следующий период: состав разделов и
    // требований переносится, галочки и значения по колонкам — нет
    // (`buildDocumentCopy`). Раньше копия повторяла период и факт
    // источника, и сервер отвечал «за этот период уже есть документ».
    const copy = buildDocumentCopy({
      templateCode,
      journalName: AUDIT_PLAN_DOCUMENT_TITLE,
      sourceConfig: normalizeAuditPlanConfig(document.config, { users }),
      sourcePeriod: { dateFrom: document.dateFrom, dateTo: document.dateTo },
      today: localDayKey(),
      existingTitles: documents.map((item) => item.title),
    });
    const response = await fetch("/api/journal-documents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        templateCode,
        title: copy.title,
        dateFrom: copy.dateFrom,
        dateTo: copy.dateTo,
        config: copy.config,
      }),
    });
    if (!response.ok) {
      const failure = await response.json().catch(() => null);
      toast.error(failure?.error || "Не удалось сделать копию документа");
      return;
    }
    const data = (await response.json()) as { document: { id: string } };
    router.push(`/journals/${routeCode}/documents/${data.document.id}`);
    router.refresh();
  }

  const defaultCreateState = useMemo<SettingsState>(
    () => ({
      // Название подставляется автоматически из имени журнала + периода
      // (`useAutoDocumentTitle`, просьба владельца 2026-09-04).
      title: "",
      documentDate: defaultConfig.documentDate,
      year: String(defaultConfig.year),
      approveRole: defaultConfig.approveRole,
      approveEmployeeId: defaultConfig.approveEmployeeId || "",
      approveEmployee: defaultConfig.approveEmployee,
    }),
    [defaultConfig]
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className={JOURNAL_LIST_HEADING_CLASS}>
          {AUDIT_PLAN_HEADING}
        </h1>
        <div className={JOURNAL_LIST_ACTIONS_CLASS}>
          <FillGuideLauncher
            code={templateCode}
            page="list"
            variant="button"
          />
          {canManageDocuments && activeTab === "active" && (
            <Button
              className="h-12 w-full rounded-2xl bg-[#5563ff] px-8 text-[16px] text-white hover:bg-[#4554ff] sm:w-auto"
              onClick={() => setCreateOpen(true)}
            >
              <Plus className="size-5" /> Создать документ
            </Button>
          )}
        </div>
      </div>

      <div className="border-b border-[#d9dce8]">
        <div className="flex flex-wrap gap-6 text-[15px] sm:gap-12 sm:text-[16px]">
          <Link
            href={`/journals/${routeCode}`}
            className={`relative pb-6 ${
              activeTab === "active"
                ? "font-semibold text-black after:absolute after:bottom-[-1px] after:left-0 after:h-[3px] after:w-full after:bg-[#5566f6]"
                : "text-[#8a8ea4]"
            }`}
          >
            Активные
          </Link>
          <Link
            href={`/journals/${routeCode}?tab=closed`}
            className={`relative pb-6 ${
              activeTab === "closed"
                ? "font-semibold text-black after:absolute after:bottom-[-1px] after:left-0 after:h-[3px] after:w-full after:bg-[#5566f6]"
                : "text-[#8a8ea4]"
            }`}
          >
            Закрытые
          </Link>
        </div>
      </div>

      <div className={JOURNAL_LIST_CARDS_CLASS}>
        {documents.length === 0 && (
          <EmptyDocumentsState />
        )}

        {documents.map((document) => {
          const cfg = normalizeAuditPlanConfig(document.config, { users });
          const href = `/journals/${routeCode}/documents/${document.id}`;
          return (
            <div
              key={document.id}
              className={JOURNAL_LIST_CARD_CLASS}
            >
              <Link
                href={href}
                className={JOURNAL_CARD_TITLE_CLASS}
              >
                {document.title || AUDIT_PLAN_DOCUMENT_TITLE}
              <SharedDocumentBadge shared={document.shared} />
              </Link>
              <Link href={href} className={JOURNAL_CARD_SECTION_CLASS}>
                <div className={JOURNAL_CARD_LABEL_CLASS}>Год</div>
                <div className={JOURNAL_CARD_VALUE_CLASS}>{cfg.year}</div>
              </Link>
              <Link href={href} className={JOURNAL_CARD_SECTION_CLASS}>
                <div className={JOURNAL_CARD_LABEL_CLASS}>Должность &quot;Утверждаю&quot;</div>
                <div className={JOURNAL_CARD_VALUE_CLASS}>
                  {getAuditPlanApproveLabel(cfg.approveRole, cfg.approveEmployee)}
                </div>
              </Link>
              <Link href={href} className={JOURNAL_CARD_SECTION_CLASS}>
                <div className={JOURNAL_CARD_LABEL_CLASS}>Дата документа</div>
                <div className={JOURNAL_CARD_VALUE_CLASS}>
                  {getAuditPlanDocumentDateLabel(cfg.documentDate)}
                </div>
              </Link>
              <div className="flex justify-start sm:justify-center">
                <ResponsiveMenu
                  title="Действия с документом"
                  contentClassName="w-[320px] rounded-[28px] border-0 p-5 shadow-xl"
                  items={filterManageMenuItems([
                    ...(document.status === "active"
                      ? [
                          {
                            key: "settings",
                            label: "Настройки",
                            icon: <Pencil className="size-4 text-[#6f7282]" />,
                            onSelect: () => setSettingsTarget(document),
                          },
                        ]
                      : []),
                    ...(document.status === "active"
                      ? [
                          {
                            key: "copy",
                            label: "Сделать копию",
                            icon: <Copy className="size-4 text-[#6f7282]" />,
                            onSelect: () => copyDocument(document),
                          },
                        ]
                      : []),
                    {
                      key: "print",
                      label: "Печать",
                      icon: <Printer className="size-4 text-[#6f7282]" />,
                      onSelect: () =>
                        void openDocumentPdf(document.id).catch((error) =>
                          toast.error(
                            error instanceof Error ? error.message : "Не удалось открыть PDF"
                          )
                        ),
                    },
                    {
                      key: document.status === "active" ? "archive" : "unarchive",
                      label:
                        document.status === "active"
                          ? "Отправить в закрытые"
                          : "Вернуть в активные",
                      icon: <BookOpenText className="size-4 text-[#6f7282]" />,
                      onSelect: () =>
                        document.status === "active"
                          ? setArchiveTarget(document)
                          : moveToStatus(document.id, "active"),
                    },
                    ...(document.status === "active"
                      ? [
                          {
                            key: "delete",
                            label: "Удалить",
                            icon: <Trash2 className="size-4 text-[#ff3b30]" />,
                            onSelect: () => setDeleteTarget(document),
                            tone: "danger" as const,
                          },
                        ]
                      : []),
                  ], canManageDocuments)}
                  trigger={
                    <button
                      type="button"
                      className="flex size-10 items-center justify-center rounded-full text-[#5566f6] hover:bg-[#f5f6ff]"
                    >
                      <Ellipsis className="size-8" />
                    </button>
                  }
                />
              </div>
            </div>
          );
        })}
      </div>

      <SettingsDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        users={users}
        initial={defaultCreateState}
        onSubmit={createDocument}
        submitText="Создать"
        title="Создание документа"
        mode="create"
      />

      <SettingsDialog
        open={!!settingsTarget}
        onOpenChange={(v) => {
          if (!v) setSettingsTarget(null);
        }}
        users={users}
        initial={settingsTarget ? toUiState(settingsTarget, users) : null}
        onSubmit={async (value) => {
          if (settingsTarget) await saveSettings(settingsTarget.id, value);
        }}
        submitText="Сохранить"
        title="Настройки документа"
        mode="edit"
      />

      <Dialog
        open={!!archiveTarget}
        onOpenChange={(v) => {
          if (!v) setArchiveTarget(null);
        }}
      >
        <DialogContent showCloseButton={false} className="w-[calc(100vw-2rem)] max-w-[calc(100vw-1rem)] rounded-[28px] border-0 p-0 sm:max-w-[660px]">
          <DialogHeader className="border-b px-8 py-6">
            <div className="flex items-center justify-between">
              <DialogTitle className="text-[22px] font-semibold text-black">
                Перенести в архив документ &quot;{archiveTarget?.title}&quot;
              </DialogTitle>
              <button type="button" className="rounded-xl p-2" onClick={() => setArchiveTarget(null)}>
                <X className="size-7" />
              </button>
            </div>
          </DialogHeader>
          <div className="flex justify-end px-8 py-6">
            <Button
              className="h-9 rounded-xl bg-[#5563ff] px-3.5 text-[13.5px] text-white hover:bg-[#4554ff]"
              onClick={() => archiveTarget && moveToStatus(archiveTarget.id, "closed")}
            >
              В архив
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!deleteTarget}
        onOpenChange={(v) => {
          if (!v) setDeleteTarget(null);
        }}
      >
        <DialogContent showCloseButton={false} className="w-[calc(100vw-2rem)] max-w-[calc(100vw-1rem)] rounded-[28px] border-0 p-0 sm:max-w-[660px]">
          <DialogHeader className="border-b px-8 py-6">
            <div className="flex items-center justify-between">
              <DialogTitle className="text-[22px] font-semibold text-black">
                Удаление документа &quot;{deleteTarget?.title}&quot;
              </DialogTitle>
              <button type="button" className="rounded-xl p-2" onClick={() => setDeleteTarget(null)}>
                <X className="size-7" />
              </button>
            </div>
          </DialogHeader>
          <div className="flex justify-end px-8 py-6">
            <Button
              className="h-9 rounded-xl bg-[#5563ff] px-3.5 text-[13.5px] text-white hover:bg-[#4554ff]"
              onClick={() => deleteTarget && handleDelete(deleteTarget.id)}
            >
              Удалить
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
