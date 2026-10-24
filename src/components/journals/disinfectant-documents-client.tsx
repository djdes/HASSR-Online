"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { captureDisinfectantTitle, type DisinfectantDisplayTitle } from "@/lib/disinfectant-document-presentation";
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
import { confirmAsync } from "@/components/ui/confirm-async";
import { useJournalDocumentActions } from "@/components/journals/use-journal-document-actions";
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
  PositionSelectItems,
  usePositionEmployeeCascade,
} from "@/components/shared/position-select";
import { useAutoDocumentTitle } from "@/components/journals/use-auto-document-title";
import { buildStaffOptionLabel } from "@/lib/journal-staff-binding";
import {
  DISINFECTANT_DOCUMENT_TITLE,
  getDisinfectantDefaultConfig,
  normalizeDisinfectantConfig,
  type DisinfectantDocumentConfig,
} from "@/lib/disinfectant-document";

import {
  EmptyDocumentsState,
  JournalTabs,
  JournalTopBar,
  filterManageMenuItems,
  useCanManageDocuments,
} from "@/components/journals/document-list-ui";
import {
  JOURNAL_CARD_LABEL_CLASS,
  JOURNAL_CARD_SECTION_CLASS,
  JOURNAL_CARD_TITLE_CLASS,
  JOURNAL_CARD_VALUE_CLASS,
} from "@/components/journals/journal-responsive";
import { SharedDocumentBadge } from "@/components/journals/shared-document-badge";
import {
  DocumentDialogFeedback,
  readCreatedDocument,
  useDocumentDialogSubmit,
} from "@/components/journals/use-document-dialog-submit";
type UserItem = { id: string; name: string; role: string };

type DisinfectantDocumentItem = {
  id: string;
  title: string;
  /** Точки: документ без точки рядом с документами точек. */
  shared?: boolean;
  status: "active" | "closed";
  config: unknown;
};

type Props = {
  routeCode: string;
  templateCode: string;
  activeTab: "active" | "closed";
  users: UserItem[];
  documents: DisinfectantDocumentItem[];
};

type SettingsState = {
  title: string;
  responsibleRole: string;
  responsibleEmployeeId: string;
  responsibleEmployee: string;
};

function SettingsDialog(props: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  users: UserItem[];
  /** Бессрочный журнал: периода в названии нет, автоназвание — имя журнала. */
  templateCode: string;
  routeCode: string;
  initial: SettingsState | null;
  onSubmit: (value: SettingsState, force: boolean) => Promise<void>;
  submitText: string;
  dialogTitle: string;
  /** Создание — название подставляется автоматически (просьба владельца 2026-09-04). */
  mode: "create" | "edit";
}) {
  const t = useTranslations();
  const [state, setState] = useState<SettingsState | null>(null);
  // Окно закрывается только при успехе, ошибка сервера видна здесь же.
  const submit = useDocumentDialogSubmit({
    onOpenChange: props.onOpenChange,
    fallbackError:
      props.mode === "create"
        ? t("journalControls.documentDialog.createError")
        : t("journalDisinfectant.saveFailed"),
  });
  const submitting = submit.submitting;
  const auto = useAutoDocumentTitle({
    templateCode: props.templateCode,
    journalName: DISINFECTANT_DOCUMENT_TITLE,
    period: {},
    enabled: props.mode === "create",
  });
  // Диалог открывается кнопкой снаружи (Radix не зовёт onOpenChange(true)),
  // поэтому автоназвание подставляем и в fallback «состояния ещё нет».
  const activeState =
    state ||
    (props.initial
      ? { ...props.initial, title: props.initial.title || auto.seedTitle() }
      : null);

  const cascade = usePositionEmployeeCascade({
    users: props.users,
    positionTitle: activeState?.responsibleRole || "",
    userId: activeState?.responsibleEmployeeId || "",
    onChange: (next) => {
      if (!activeState) return;
      const user = props.users.find((item) => item.id === next.userId);
      setState({
        ...activeState,
        responsibleRole: next.positionTitle,
        responsibleEmployeeId: next.userId,
        responsibleEmployee: user?.name || activeState.responsibleEmployee,
      });
    },
    autoPick: "first",
  });

  function handleSubmit(force = false) {
    if (!activeState) return;
    void submit.run((forced) => props.onSubmit(activeState, forced), force);
  }

  return (
    <Dialog
      open={props.open}
      onOpenChange={(v) => {
        auto.reset();
        // На закрытии — сброс, чтобы следующее открытие шло от `initial`.
        setState(v ? activeState : null);
        props.onOpenChange(v);
      }}
    >
      <DialogContent showCloseButton={false} className="w-[calc(100vw-2rem)] max-w-[calc(100vw-1rem)] rounded-[28px] border-0 p-0 sm:max-w-[760px]">
        <DialogHeader className="border-b px-5 py-6 sm:px-10 sm:py-8">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-[22px] font-semibold tracking-[-0.03em] text-black">
              {props.dialogTitle}
            </DialogTitle>
            <button
              type="button"
              aria-label={t("common.close")}
              className="rounded-xl p-2 text-[#0b1024]"
              onClick={() => props.onOpenChange(false)}
            >
              <X className="size-8" />
            </button>
          </div>
        </DialogHeader>
        {activeState && (
          <div className="space-y-5 px-5 py-6 sm:px-10 sm:py-8">
            <DocumentDialogFeedback
              state={submit}
              routeCode={props.routeCode}
              onOpenChange={props.onOpenChange}
              onForce={() => handleSubmit(true)}
            />
            <div className="space-y-2">
              <Label className="text-[14px] text-[#6f7282]">
                {t("journalDisinfectant.documentTitle")}</Label>
              <Input aria-label={t("journalDisinfectant.documentTitle")}
                value={activeState.title}
                onChange={(e) => {
                  auto.markTouched();
                  setState({ ...activeState, title: e.target.value });
                }}
                placeholder={t("journalDisinfectant.documentTitlePlaceholder")}
                className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px]"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-[14px] text-[#6f7282]">
                {t("journalDisinfectant.responsiblePosition")}</Label>
              <Select
                value={activeState.responsibleRole}
                onValueChange={cascade.handlePositionChange}
              >
                <SelectTrigger aria-label={t("journalDisinfectant.responsiblePosition")} className="h-10 rounded-xl border-[#dcdfed] bg-[#fafbff] px-3.5 text-[13.5px]">
                  <SelectValue placeholder={t("journalControls.positionSelect.choosePosition")} />
                </SelectTrigger>
                <SelectContent>
                  <PositionSelectItems users={props.users} />
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-[14px] text-[#6f7282]">{t("journalControls.positionSelect.employeeLabel")}</Label>
              <Select
                value={activeState.responsibleEmployeeId}
                onValueChange={cascade.handleEmployeeChange}
                open={cascade.employeeOpen}
                onOpenChange={cascade.setEmployeeOpen}
              >
                <SelectTrigger aria-label={t("journalControls.positionSelect.employeeLabel")} className="h-10 rounded-xl border-[#dcdfed] bg-[#fafbff] px-3.5 text-[13.5px]">
                  <SelectValue placeholder={t("journalControls.positionSelect.chooseEmployee")} />
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
            <div className="flex justify-end pt-3">
              <Button
                type="button"
                onClick={() => handleSubmit(false)}
                disabled={submitting}
                className="h-10 rounded-xl bg-[#5566f6] px-3.5 text-[13.5px] text-white hover:bg-[#4a5bf0]"
              >
                {submitting ? t("journalDisinfectant.saving") : props.submitText}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function useCommittedDisinfectantCopy() {
  const t = useTranslations();
  const locale = useLocale();
  const committedCopy = useRef({ t, locale });
  useEffect(() => { committedCopy.current = { t, locale }; }, [t, locale]);
  const readCommittedCopy = useCallback(() => committedCopy.current, []);
  return { t, readCommittedCopy };
}

export function DisinfectantDocumentsClient({
  routeCode,
  templateCode,
  activeTab,
  users,
  documents,
}: Props) {
  const { t, readCommittedCopy } = useCommittedDisinfectantCopy();
  const router = useRouter();
  // Настройки / удаление документов API отдаёт только руководителю.
  const canManageDocuments = useCanManageDocuments();
  const [settingsTarget, setSettingsTarget] =
    useState<DisinfectantDocumentItem | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  // delete / status / pdf — общий хук вместо трёх локальных fetch'ей.
  const { deleteDocument, setStatus, openPdf } = useJournalDocumentActions();

  const defaultConfig = getDisinfectantDefaultConfig();

  async function createDocument(payload: SettingsState, force: boolean) {
    const config: DisinfectantDocumentConfig = {
      ...defaultConfig,
      responsibleRole: payload.responsibleRole,
      responsibleEmployeeId: payload.responsibleEmployeeId || null,
      responsibleEmployee: payload.responsibleEmployee,
      subdivisions: [],
      receipts: [],
      consumptions: [],
    };
    const now = new Date();
    const response = await fetch("/api/journal-documents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        templateCode,
        force,
        title: payload.title.trim() || DISINFECTANT_DOCUMENT_TITLE,
        dateFrom: now.toISOString().slice(0, 10),
        dateTo: now.toISOString().slice(0, 10),
        config,
      }),
    });
    // Ошибку показывает само окно создания: тост её гасил, а окно
    // закрывалось вместе с введённым.
    const created = await readCreatedDocument(response);
    router.push(`/journals/${routeCode}/documents/${created.id}`);
    router.refresh();
  }

  async function saveSettings(documentId: string, payload: SettingsState) {
    const current = documents.find((d) => d.id === documentId);
    if (!current) return;
    const currentConfig = normalizeDisinfectantConfig(current.config);
    const config: DisinfectantDocumentConfig = {
      ...currentConfig,
      responsibleRole: payload.responsibleRole,
      responsibleEmployeeId: payload.responsibleEmployeeId || null,
      responsibleEmployee: payload.responsibleEmployee,
    };
    const response = await fetch(`/api/journal-documents/${documentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: payload.title.trim() || DISINFECTANT_DOCUMENT_TITLE,
        config,
      }),
    });
    if (!response.ok) {
      const failure = await response.json().catch(() => null);
      throw new Error(failure?.error || t("journalDisinfectant.saveFailed"));
    }
    router.refresh();
  }

  const namedDeleteSuccess = useCallback((copy: DisinfectantDisplayTitle) => {
    return () => {
      const { t } = readCommittedCopy();
      toast.success(t("journalDisinfectant.documentDeleted", {
        title: copy.standardFallback ? t("sanitationPestPdf.disinfectantTitle") : copy.raw,
      }));
    };
  }, [readCommittedCopy]);

  async function handleDelete(document: DisinfectantDocumentItem) {
    const cfg = normalizeDisinfectantConfig(document.config);
    let titleUsesFallback = false;
    const docTitle = document.title || (titleUsesFallback = true, DISINFECTANT_DOCUMENT_TITLE);
    await deleteDocument({
      documentId: document.id,
      description: t("journalDisinfectant.deleteDocumentDescription", { title: titleUsesFallback ? t("sanitationPestPdf.disinfectantTitle") : `${docTitle}` }),
      bullets: [
        {
          label: t("journalDisinfectant.subdivisionCount", { count: `${cfg.subdivisions.length}` }),
          tone: "info",
        },
        { label: t("journalDisinfectant.receiptCount", { count: `${cfg.receipts.length}` }), tone: "warn" },
        { label: t("journalDisinfectant.consumptionCount", { count: `${cfg.consumptions.length}` }), tone: "warn" },
      ],
      successMessage: null,
      onSuccess: namedDeleteSuccess(captureDisinfectantTitle(docTitle, titleUsesFallback)),
    });
  }

  const handleArchive = useCallback(async (document: DisinfectantDocumentItem) => {
    let titleUsesFallback = false;
    const docTitle = document.title || (titleUsesFallback = true, DISINFECTANT_DOCUMENT_TITLE);
    const confirmed = await confirmAsync({
      locale: readCommittedCopy().locale,
      title: t("journalDisinfectant.archiveTitle"),
      description: t("journalDisinfectant.archiveDescription", { title: titleUsesFallback ? t("sanitationPestPdf.disinfectantTitle") : `${docTitle}` }),
      variant: "warn",
      confirmLabel: t("journalControls.documentLifecycle.archiveAction"),
      bullets: [
        { label: t("journalDisinfectant.archiveDataKept") },
        { label: t("journalDisinfectant.archiveNoEditing"), tone: "warn" },
        { label: t("journalDisinfectant.archiveCanReopen"), tone: "info" },
      ],
    });
    if (!confirmed) return;
    await setStatus("closed", { documentId: document.id });
  }, [readCommittedCopy, setStatus, t]);

  const defaultCreateState = useMemo<SettingsState>(
    () => ({
      title: "",
      responsibleRole: defaultConfig.responsibleRole,
      responsibleEmployeeId: defaultConfig.responsibleEmployeeId || "",
      responsibleEmployee: defaultConfig.responsibleEmployee,
    }),
    []
  );

  return (
    <div className="space-y-5">
      <JournalTopBar
        routeCode={routeCode}
        heading={t("journalDisinfectant.heading")}
        activeTab={activeTab}
        templateCode={templateCode}
        templateName={t("sanitationPestPdf.disinfectantTitle")}
        users={users}
        createSlot={
          <Button
            className="h-10 w-full rounded-xl bg-[#5566f6] px-3.5 text-[13.5px] font-medium text-white transition-colors hover:bg-[#4a5bf0] sm:w-auto"
            onClick={() => setCreateOpen(true)}
          >
            <Plus className="size-4" /> {t("journalControls.list.create")}</Button>
        }
      />

      <JournalTabs activeTab={activeTab} templateCode={routeCode} />

      <div className="space-y-4">
        {documents.length === 0 && (
          <EmptyDocumentsState />
        )}
        {documents.map((document) => {
          const cfg = normalizeDisinfectantConfig(document.config);
          const href = `/journals/${routeCode}/documents/${document.id}`;
          return (
            <div
              key={document.id}
              className="flex items-center justify-between rounded-2xl border border-[#ececf4] bg-white px-6 py-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]"
            >
              <Link
                href={href}
                className={JOURNAL_CARD_TITLE_CLASS}
              >
                {document.title || t("sanitationPestPdf.disinfectantTitle")}
              <SharedDocumentBadge shared={document.shared} copy={{ label: t("journalScan.shared.label"), title: t("journalScan.shared.title") }} />
              </Link>
              <div className="flex items-center gap-6">
                <div className={JOURNAL_CARD_SECTION_CLASS}>
                  <div className={JOURNAL_CARD_LABEL_CLASS}>
                    {t("journalDisinfectant.receiptResponsible")}</div>
                  <div className={JOURNAL_CARD_VALUE_CLASS}>
                    {cfg.responsibleRole}
                    {cfg.responsibleEmployee
                      ? `: ${cfg.responsibleEmployee}`
                      : ""}
                  </div>
                </div>
                <ResponsiveMenu
                  title={t("journalControls.list.actions")}
                  items={filterManageMenuItems([
                    ...(document.status === "active"
                      ? [
                          {
                            key: "settings",
                            label: t("journalControls.list.settings"),
                            icon: <Pencil className="size-4 text-[#6f7282]" />,
                            onSelect: () => setSettingsTarget(document),
                          },
                        ]
                      : []),
                    {
                      key: "print",
                      label: t("journalControls.list.print"),
                      icon: <Printer className="size-4 text-[#6f7282]" />,
                      onSelect: () => openPdf({ documentId: document.id }),
                    },
                    ...(document.status === "active"
                      ? [
                          {
                            key: "archive",
                            label: t("journalControls.documentLifecycle.sendToClosed"),
                            icon: <BookOpenText className="size-4 text-[#6f7282]" />,
                            onSelect: () => void handleArchive(document),
                          },
                          {
                            key: "delete",
                            label: t("common.delete"),
                            icon: <Trash2 className="size-4 text-[#6f7282]" />,
                            tone: "danger" as const,
                            onSelect: () => void handleDelete(document),
                          },
                        ]
                      : []),
                    ...(document.status === "closed"
                      ? [
                          {
                            key: "restore",
                            label: t("journalControls.documentLifecycle.sendToActive"),
                            icon: <BookOpenText className="size-4 text-[#6f7282]" />,
                            onSelect: () =>
                              void setStatus("active", { documentId: document.id }),
                          },
                        ]
                      : []),
                  ], canManageDocuments)}
                  trigger={
                    <button
                      type="button"
                      aria-label={t("journalControls.list.actions")}
                      className="flex size-10 items-center justify-center rounded-full text-[#5566f6] hover:bg-[#f5f6ff]"
                    >
                      <Ellipsis aria-hidden="true" className="size-8" />
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
        templateCode={templateCode}
        routeCode={routeCode}
        initial={defaultCreateState}
        onSubmit={createDocument}
        submitText={t("journalDisinfectant.create")}
        dialogTitle={t("journalDisinfectant.createDocumentTitle")}
        mode="create"
      />
      <SettingsDialog
        open={!!settingsTarget}
        onOpenChange={(v) => {
          if (!v) setSettingsTarget(null);
        }}
        users={users}
        templateCode={templateCode}
        routeCode={routeCode}
        initial={
          settingsTarget
            ? {
                title:
                  settingsTarget.title || DISINFECTANT_DOCUMENT_TITLE,
                responsibleRole: normalizeDisinfectantConfig(
                  settingsTarget.config
                ).responsibleRole,
                responsibleEmployeeId: normalizeDisinfectantConfig(
                  settingsTarget.config
                ).responsibleEmployeeId || "",
                responsibleEmployee: normalizeDisinfectantConfig(
                  settingsTarget.config
                ).responsibleEmployee,
              }
            : null
        }
        onSubmit={async (v) => {
          if (settingsTarget) await saveSettings(settingsTarget.id, v);
        }}
        submitText={t("common.save")}
        dialogTitle={t("journalDisinfectant.settingsTitle")}
        mode="edit"
      />

    </div>
  );
}
