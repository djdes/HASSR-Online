"use client";

import { FillGuideLauncher } from "@/components/journals/fill-guide-launcher";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BookOpenText,
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
import {
  PPE_ISSUANCE_DOCUMENT_TITLE,
  PPE_ISSUANCE_TEMPLATE_CODE,
  getPpeIssuanceDefaultConfig,
  normalizePpeIssuanceConfig,
  type PpeIssuanceConfig,
} from "@/lib/ppe-issuance-document";
import { getHygienePositionLabel } from "@/lib/hygiene-document";

import { toast } from "sonner";
import {
  EmptyDocumentsState,
  filterManageMenuItems,
  restoreMenuItems,
  useRestoreDocument,
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
import { useAutoDocumentTitle } from "@/components/journals/use-auto-document-title";
import { localDayKey } from "@/lib/entry-defaults";
import { formatJournalDate } from "@/lib/journal-card-date";
import {
  DocumentDialogFeedback,
  readCreatedDocument,
  useDocumentDialogSubmit,
} from "@/components/journals/use-document-dialog-submit";
import { SharedDocumentBadge } from "@/components/journals/shared-document-badge";
type UserItem = { id: string; name: string; role: string };

type DocumentItem = {
  id: string;
  title: string;
  /** Точки: документ без точки рядом с документами точек. */
  shared?: boolean;
  status: "active" | "closed";
  dateFrom: string;
  config: unknown;
};

type Props = {
  routeCode: string;
  templateCode: string;
  activeTab: "active" | "closed";
  users: UserItem[];
  documents: DocumentItem[];
};

type SettingsState = {
  title: string;
  dateFrom: string;
  showGloves: boolean;
  showShoes: boolean;
  showClothing: boolean;
  showCaps: boolean;
  defaultIssuerUserId: string;
  defaultIssuerTitle: string;
};

function formatDateLabel(value: string) {
  // Единый вид даты на экране — «дд.мм.гггг» (src/lib/journal-card-date.ts).
  // Раньше тут было «ДД-ММ-ГГГГ», а у дезинсекции и акта забраковки —
  // «ДД.ММ.ГГГГ»: три разных написания одной и той же вещи в одном заходе.
  return formatJournalDate(value) || value;
}

function roleOptions(users: UserItem[]) {
  return [...new Set(users.map((user) => getHygienePositionLabel(user.role)))];
}

function toSettingsState(document: DocumentItem, users: UserItem[]): SettingsState {
  const config = normalizePpeIssuanceConfig(document.config, users);
  return {
    title: document.title || PPE_ISSUANCE_DOCUMENT_TITLE,
    dateFrom: document.dateFrom,
    showGloves: config.showGloves,
    showShoes: config.showShoes,
    showClothing: config.showClothing,
    showCaps: config.showCaps,
    defaultIssuerUserId: config.defaultIssuerUserId || "",
    defaultIssuerTitle: config.defaultIssuerTitle || "",
  };
}

function defaultCreateState(users: UserItem[]): SettingsState {
  const config = getPpeIssuanceDefaultConfig(users);
  return {
    // Название подставляется автоматически из имени журнала + периода
    // (`useAutoDocumentTitle`, просьба владельца 2026-09-04).
    title: "",
    dateFrom: localDayKey(),
    showGloves: false,
    showShoes: false,
    showClothing: false,
    showCaps: false,
    defaultIssuerUserId: config.defaultIssuerUserId || "",
    defaultIssuerTitle: config.defaultIssuerTitle || "",
  };
}

function FieldToggle({
  checked,
  onCheckedChange,
  label,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onCheckedChange(!checked)}
      className="flex items-center gap-4 text-left"
    >
      <span
        className={`relative h-8 w-16 rounded-full transition-colors ${
          checked ? "bg-[#5863f8]" : "bg-[#d6d6db]"
        }`}
      >
        <span
          className={`absolute top-1 h-6 w-6 rounded-full bg-white transition-all ${
            checked ? "left-9" : "left-1"
          }`}
        />
      </span>
      <span className="text-[18px] text-black">{label}</span>
    </button>
  );
}

function SettingsDialog(props: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  title: string;
  submitText: string;
  users: UserItem[];
  routeCode: string;
  initial: SettingsState | null;
  onSubmit: (value: SettingsState, force: boolean) => Promise<void>;
  mode: "create" | "edit";
}) {
  const [state, setState] = useState<SettingsState | null>(null);
  // Окно закрывается только при успехе, ошибка сервера видна здесь же.
  const submit = useDocumentDialogSubmit({
    onOpenChange: props.onOpenChange,
    fallbackError:
      props.mode === "create"
        ? "Не удалось создать документ"
        : "Не удалось сохранить настройки",
  });
  const submitting = submit.submitting;
  const titles = useMemo(() => roleOptions(props.users), [props.users]);
  const active = state || props.initial;

  const auto = useAutoDocumentTitle({
    templateCode: PPE_ISSUANCE_TEMPLATE_CODE,
    journalName: PPE_ISSUANCE_DOCUMENT_TITLE,
    period: { dateFrom: active?.dateFrom },
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

  function handleSubmit(force = false) {
    if (!active) return;
    void submit.run((forced) => props.onSubmit(active, forced), force);
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
    >
      <DialogContent showCloseButton={false} className="w-[calc(100vw-2rem)] max-w-[calc(100vw-1rem)] rounded-[28px] border-0 p-0 sm:max-w-[760px]">
        <DialogHeader className="border-b px-5 py-6 sm:px-10 sm:py-8">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-[22px] font-semibold tracking-[-0.03em] text-black">
              {props.title}
            </DialogTitle>
            <button
              type="button"
              className="rounded-xl p-2 text-[#0b1024]"
              onClick={() => props.onOpenChange(false)}
            >
              <X className="size-8" />
            </button>
          </div>
        </DialogHeader>
        {active && (
          <div className="space-y-6 px-5 py-6 sm:px-10 sm:py-8">
            <DocumentDialogFeedback
              state={submit}
              routeCode={props.routeCode}
              onOpenChange={props.onOpenChange}
              onForce={() => handleSubmit(true)}
            />
            <div className="space-y-2">
              <Label className="text-[14px] text-[#7a7c8e]">Название документа</Label>
              <Input
                value={active.title}
                placeholder="Введите название документа"
                onChange={(e) => {
                  auto.markTouched();
                  setState({ ...active, title: e.target.value });
                }}
                className="h-9 rounded-xl border-[#d8dae6] px-3.5 text-[13.5px]"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-[14px] text-[#7a7c8e]">Дата начала</Label>
              <div className="relative">
                <Input
                  type="date"
                  value={active.dateFrom}
                  onChange={(e) => {
                    const dateFrom = e.target.value;
                    const next = auto.titleForPeriod({ dateFrom });
                    setState({
                      ...active,
                      dateFrom,
                      ...(next !== null ? { title: next } : {}),
                    });
                  }}
                  className="h-9 rounded-xl border-[#d8dae6] px-3.5 text-[13.5px]"
                />
                {/* Свой значок календаря убран: у `type="date"` уже есть
                    системный, и на телефоне стояли два значка подряд. */}
              </div>
            </div>
            <fieldset className="space-y-4 rounded-[28px] border border-[#d8dae6] px-6 py-5">
              <legend className="px-2 text-[20px] font-semibold text-black">Добавить поля</legend>
              <FieldToggle checked={active.showGloves} onCheckedChange={(checked) => setState({ ...active, showGloves: checked })} label="Выдача перчаток" />
              <FieldToggle checked={active.showShoes} onCheckedChange={(checked) => setState({ ...active, showShoes: checked })} label="Выдача обуви" />
              <FieldToggle checked={active.showClothing} onCheckedChange={(checked) => setState({ ...active, showClothing: checked })} label="Выдача спец. одежды" />
              <FieldToggle checked={active.showCaps} onCheckedChange={(checked) => setState({ ...active, showCaps: checked })} label="Выдача шапочек" />
            </fieldset>
            <div className="space-y-2">
              <Label className="text-[14px] text-[#7a7c8e]">Сотрудник по умолчанию, выдавший СИЗ</Label>
              <Select
                value={active.defaultIssuerUserId}
                onValueChange={(value) => {
                  const user = props.users.find((item) => item.id === value);
                  setState({
                    ...active,
                    defaultIssuerUserId: value,
                    defaultIssuerTitle:
                      active.defaultIssuerTitle ||
                      (user ? getHygienePositionLabel(user.role) : ""),
                  });
                }}
              >
                <SelectTrigger className="h-10 rounded-xl border-[#d8dae6] bg-[#f1f2f8] px-3.5 text-[13.5px]">
                  <SelectValue placeholder="Выберите сотрудника" />
                </SelectTrigger>
                <SelectContent>
                  {props.users.map((user) => (
                    <SelectItem key={user.id} value={user.id}>
                      {user.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-[14px] text-[#7a7c8e]">Должность лица, выдавшего СИЗ</Label>
              <Select
                value={active.defaultIssuerTitle}
                onValueChange={(value) => setState({ ...active, defaultIssuerTitle: value })}
              >
                <SelectTrigger className="h-10 rounded-xl border-[#d8dae6] bg-[#f1f2f8] px-3.5 text-[13.5px]">
                  <SelectValue placeholder="Выберите должность" />
                </SelectTrigger>
                <SelectContent>
                  {titles.map((title) => (
                    <SelectItem key={title} value={title}>
                      {title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-end pt-2">
              <Button
                type="button"
                onClick={() => handleSubmit(false)}
                disabled={submitting}
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

function DeleteDialog(props: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  title: string;
  onDelete: () => Promise<void>;
}) {
  const [submitting, setSubmitting] = useState(false);

  async function handleDelete() {
    setSubmitting(true);
    try {
      await props.onDelete();
      props.onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent showCloseButton={false} className="w-[calc(100vw-2rem)] max-w-[calc(100vw-1rem)] rounded-[28px] border-0 p-0 sm:max-w-[660px]">
        <DialogHeader className="border-b px-8 py-6">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-[22px] font-semibold text-black">
              Удаление документа &quot;{props.title}&quot;
            </DialogTitle>
            <button
              type="button"
              className="rounded-xl p-2"
              onClick={() => props.onOpenChange(false)}
            >
              <X className="size-7" />
            </button>
          </div>
        </DialogHeader>
        <div className="flex justify-end px-8 py-6">
          <Button
            type="button"
            onClick={handleDelete}
            disabled={submitting}
            className="h-9 rounded-xl bg-[#5563ff] px-3.5 text-[13.5px] text-white hover:bg-[#4554ff]"
          >
            {submitting ? "Удаление..." : "Удалить"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function PpeIssuanceDocumentsClient({
  routeCode,
  templateCode,
  activeTab,
  users,
  documents,
}: Props) {
  const router = useRouter();
  // Создание / настройки / удаление документов API отдаёт только
  // руководителю — у остальных эти кнопки не показываем.
  const canManageDocuments = useCanManageDocuments();
  const restore = useRestoreDocument();
  const [createOpen, setCreateOpen] = useState(false);
  const [settingsTarget, setSettingsTarget] = useState<DocumentItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DocumentItem | null>(null);
  const createInitial = useMemo(() => defaultCreateState(users), [users]);

  async function createDocument(value: SettingsState, force: boolean) {
    const config: PpeIssuanceConfig = {
      rows: [],
      showGloves: value.showGloves,
      showShoes: value.showShoes,
      showClothing: value.showClothing,
      showCaps: value.showCaps,
      defaultIssuerUserId: value.defaultIssuerUserId || null,
      defaultIssuerTitle: value.defaultIssuerTitle || null,
    };

    const response = await fetch("/api/journal-documents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        templateCode,
        force,
        title: value.title.trim() || PPE_ISSUANCE_DOCUMENT_TITLE,
        // Период — по правилу журнала (`journal-period.ts`): учёт СИЗ
        // годовой, а окно создавало однодневный документ поверх годового.
        ...resolveJournalPeriodForDate(templateCode, value.dateFrom),
        config,
      }),
    });

    // Ошибку показывает само окно создания: тост её гасил, а окно
    // закрывалось вместе с введённым.
    const created = await readCreatedDocument(response);
    router.push(`/journals/${routeCode}/documents/${created.id}`);
    router.refresh();
  }

  async function saveSettings(documentId: string, value: SettingsState) {
    const current = documents.find((item) => item.id === documentId);
    if (!current) return;
    const currentConfig = normalizePpeIssuanceConfig(current.config, users);

    const response = await fetch(`/api/journal-documents/${documentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: value.title.trim() || PPE_ISSUANCE_DOCUMENT_TITLE,
        dateFrom: value.dateFrom,
        dateTo: value.dateFrom,
        config: {
          ...currentConfig,
          showGloves: value.showGloves,
          showShoes: value.showShoes,
          showClothing: value.showClothing,
          showCaps: value.showCaps,
          defaultIssuerUserId: value.defaultIssuerUserId || null,
          defaultIssuerTitle: value.defaultIssuerTitle || null,
        },
      }),
    });

    if (!response.ok) {
      const failure = await response.json().catch(() => null);
      throw new Error(failure?.error || "Не удалось сохранить настройки");
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
    router.refresh();
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className={JOURNAL_LIST_HEADING_CLASS}>
          {PPE_ISSUANCE_DOCUMENT_TITLE}
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
                {document.title || PPE_ISSUANCE_DOCUMENT_TITLE}
              <SharedDocumentBadge shared={document.shared} />
              </Link>
              <Link href={href} className={JOURNAL_CARD_SECTION_CLASS}>
                <div className={JOURNAL_CARD_LABEL_CLASS}>Дата начала</div>
                <div className={JOURNAL_CARD_VALUE_CLASS}>
                  {formatDateLabel(document.dateFrom)}
                </div>
              </Link>
              <div className="flex justify-center">
                <ResponsiveMenu
                  title="Действия"
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
                    {
                      key: "print",
                      label: "Печать",
                      icon: <Printer className="size-4 text-[#6f7282]" />,
                      onSelect: () =>
                        window.open(`/api/journal-documents/${document.id}/pdf`, "_blank"),
                    },
                    // Закрытый документ раньше уходил навсегда: вернуть
                    // его в активные было нечем.
                    ...restoreMenuItems({ document, siblings: documents, restore }),
                    ...(document.status === "active"
                      ? [
                          {
                            key: "delete",
                            label: "Удалить",
                            icon: <Trash2 className="size-4 text-[#6f7282]" />,
                            tone: "danger" as const,
                            onSelect: () => setDeleteTarget(document),
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
        title="Создание документа"
        submitText="Создать"
        users={users}
        routeCode={routeCode}
        initial={createInitial}
        onSubmit={createDocument}
        mode="create"
      />

      <SettingsDialog
        open={!!settingsTarget}
        onOpenChange={(value) => {
          if (!value) setSettingsTarget(null);
        }}
        title="Настройки документа"
        submitText="Сохранить"
        users={users}
        routeCode={routeCode}
        initial={settingsTarget ? toSettingsState(settingsTarget, users) : null}
        onSubmit={async (value) => {
          if (settingsTarget) await saveSettings(settingsTarget.id, value);
        }}
        mode="edit"
      />

      <DeleteDialog
        open={!!deleteTarget}
        onOpenChange={(value) => {
          if (!value) setDeleteTarget(null);
        }}
        title={deleteTarget?.title || PPE_ISSUANCE_DOCUMENT_TITLE}
        onDelete={async () => {
          if (deleteTarget) {
            await handleDelete(deleteTarget.id);
            setDeleteTarget(null);
          }
        }}
      />
    </div>
  );
}
