"use client";

import { ppePositionOption, ppeSourceIdentity, ppeDocumentSourceIdentity, ppeRecipient, tagPpeError, presentPpeError, type PpeErrorKey } from "@/lib/ppe-issuance-presentation";
import { usePpeCommittedRef } from "@/components/journals/use-ppe-committed-ref";
import { useTranslations } from "next-intl";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Archive, ChevronDown, Plus, X } from "lucide-react";
import { JournalSelectionBar } from "@/components/journals/journal-selection-bar";
import { SelectionEditButton } from "@/components/journals/selection-edit-button";
import { useSequentialEdit } from "@/components/journals/use-sequential-edit";
import {
  getDistinctRoleLabels,
  getRowEmployeeTitle,
  getUserDisplayTitle,
  getUsersForRoleLabel,
} from "@/lib/user-roles";
import { DOC_PRIMARY_BUTTON_CLASS } from "@/components/journals/journal-responsive";
import { JournalDocumentShell } from "@/components/journals/journal-document-shell";
import { JournalDocumentHeader } from "@/components/journals/journal-document-header";
import { JournalAddRow } from "@/components/journals/journal-add-row";
import { GRID_CELL_CLASS, GRID_HEAD_CELL_CLASS } from "@/components/journals/journal-grid";
import { JournalSettingsModal } from "@/components/journals/v2/journal-settings-modal";
import { FocusTodayScroller } from "@/components/journals/focus-today-scroller";
import { useRouter } from "next/navigation";
import { ResponsiveMenu } from "@/components/ui/responsive-menu";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  PPE_ISSUANCE_DOCUMENT_TITLE,
  formatPpeIssuanceDate,
  getPpeIssuanceIssuerLabel,
  normalizePpeIssuanceConfig,
  createPpeIssuanceRow,
  type PpeIssuanceConfig,
  type PpeIssuanceRow,
} from "@/lib/ppe-issuance-document";
import { useMobileView } from "@/lib/use-mobile-view";
import {
  RecordCardsView,
} from "@/components/journals/record-cards-view";

import { toast } from "sonner";
import { confirmAsync } from "@/components/ui/confirm-async";
import { localDayKey } from "@/lib/entry-defaults";

type UserItem = {
  id: string;
  name: string;
  role: string;
  // Должность из карточки (как в UserLike) — её пишем и показываем.
  positionTitle?: string | null;
  jobPosition?: { name: string; categoryKey: string } | null;
};

type Props = {
  documentId: string;
  title: string;
  titleIsFallback?: boolean;
  organizationName: string;
  dateFrom: string;
  status: string;
  config: unknown;
  sourceIdentity?: string;
  users: UserItem[];
  /** Design v2 toggle. */
  useV2?: boolean;
};

type RowDialogState = {
  issueDate: string;
  maskCount: string;
  gloveCount: string;
  shoePairsCount: string;
  clothingSetsCount: string;
  capCount: string;
  recipientUserId: string;
  recipientTitle: string;
  issuerUserId: string;
  issuerTitle: string;
};

function usePpeErrorFeedback() {
  const p = useTranslations("journalPpe");
  const controls = useTranslations("journalControls");
  return usePpeCommittedRef((key: PpeErrorKey) =>
    key === "closeDocument.failed" ? controls("closeDocument.failed") : p(key)
  );
}

// Те же метки, по которым `getUsersForRoleLabel` фильтрует сотрудников:
// с лейблами ролей список людей для своей должности («Кладовщик») был пуст.
function roleOptions(users: UserItem[]) {
  return getDistinctRoleLabels(users);
}

function rowToState(row: PpeIssuanceRow, users: UserItem[] = []): RowDialogState {
  const findUser = (id: string) => users.find((user) => user.id === id);
  return {
    issueDate: row.issueDate,
    maskCount: String(row.maskCount || ""),
    gloveCount: String(row.gloveCount || ""),
    shoePairsCount: String(row.shoePairsCount || ""),
    clothingSetsCount: String(row.clothingSetsCount || ""),
    capCount: String(row.capCount || ""),
    recipientUserId: row.recipientUserId,
    // Должность выбранного человека — как в ячейке, иначе в селекте
    // открывалась старая копия, не совпадающая ни с одним пунктом.
    recipientTitle: getRowEmployeeTitle(findUser(row.recipientUserId), row.recipientTitle),
    issuerUserId: row.issuerUserId,
    issuerTitle: getRowEmployeeTitle(findUser(row.issuerUserId), row.issuerTitle),
  };
}

function stateToRow(
  state: RowDialogState,
  initialRow: PpeIssuanceRow | null,
  users: UserItem[] = []
) {
  // ФИО фиксируем в строке на момент выдачи: ростер журнала — только
  // активные сотрудники, и после увольнения фамилия пропадала.
  const recipientName =
    users.find((user) => user.id === state.recipientUserId)?.name ||
    initialRow?.recipientName ||
    "";
  const issuerName =
    users.find((user) => user.id === state.issuerUserId)?.name ||
    initialRow?.issuerName ||
    "";
  return createPpeIssuanceRow({
    recipientName,
    issuerName,
    id: initialRow?.id,
    issueDate: state.issueDate,
    maskCount: Number(state.maskCount || 0),
    gloveCount: Number(state.gloveCount || 0),
    shoePairsCount: Number(state.shoePairsCount || 0),
    clothingSetsCount: Number(state.clothingSetsCount || 0),
    capCount: Number(state.capCount || 0),
    recipientUserId: state.recipientUserId,
    // Копия должности — выбранного человека, а не метка фильтра.
    recipientTitle: getRowEmployeeTitle(
      users.find((user) => user.id === state.recipientUserId),
      state.recipientTitle
    ),
    issuerUserId: state.issuerUserId,
    issuerTitle: getRowEmployeeTitle(
      users.find((user) => user.id === state.issuerUserId),
      state.issuerTitle
    ),
  });
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
      aria-pressed={checked}
      aria-label={label}
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
  dateFrom: string;
  users: UserItem[];
  config: PpeIssuanceConfig;
  onSave: (params: {
    title: string;
    dateFrom: string;
    config: PpeIssuanceConfig;
  }) => Promise<void>;
  useV2?: boolean;
}) {
  const p = useTranslations("journalPpe");
  const pdf = useTranslations("personnelMaintenancePdf");
  const feedback = usePpeErrorFeedback();
  const [documentTitle, setDocumentTitle] = useState(props.title);
  const [documentDate, setDocumentDate] = useState(props.dateFrom);
  const [submitting, setSubmitting] = useState(false);
  const [state, setState] = useState(() => props.config);
  const titles = useMemo(() => roleOptions(props.users), [props.users]);

  const settingsIdentity = ppeSourceIdentity([props.title, props.dateFrom, props.config]);
  const settingsSeen = useRef<string | null>(null);
  useEffect(() => {
    if (!props.open) { settingsSeen.current = null; return; }
    if (settingsSeen.current === settingsIdentity) return;
    settingsSeen.current = settingsIdentity;
    setDocumentTitle(props.title);
    setDocumentDate(props.dateFrom);
    setState(props.config);
  }, [props.config, props.dateFrom, props.open, props.title, settingsIdentity]);

  async function handleSave() {
    setSubmitting(true);
    try {
      await props.onSave({
        title: documentTitle.trim() || PPE_ISSUANCE_DOCUMENT_TITLE,
        dateFrom: documentDate,
        config: state,
      });
      props.onOpenChange(false);
    } catch (error) {
      // Без catch ошибка сохранения уходила в никуда (см. RowDialog).
      toast.error(
        presentPpeError(error, "saveSettingsFailed", feedback.current)
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (props.useV2) {
    return (
      <JournalSettingsModal
        open={props.open}
        onOpenChange={props.onOpenChange}
        title={p("documentSettings")}
        description={p("settingsDescriptionActual")}
        size="md"
        isSaving={submitting}
        onSave={handleSave}
        onCancel={() => props.onOpenChange(false)}
      >
        <div className="space-y-2">
          <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
            {p("documentName") }
          </Label>
          <Input
            aria-label={p("documentName")}
            value={documentTitle}
            onChange={(e) => setDocumentTitle(e.target.value)}
            className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px] focus:border-[#5566f6] focus:ring-4 focus:ring-[#5566f6]/15"
          />
        </div>
        <div className="space-y-2">
          <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
            {p("startDate") }
          </Label>
          <Input
            type="date"
            aria-label={p("startDate")}
            value={documentDate}
            onChange={(e) => setDocumentDate(e.target.value)}
            className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px]"
          />
        </div>
        <div className="space-y-2">
          <div className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
            {p("issuanceColumns") }
          </div>
          <FieldToggle
            checked={state.showGloves}
            onCheckedChange={(checked) => setState({ ...state, showGloves: checked })}
            label={p("showGloves")}
          />
          <FieldToggle
            checked={state.showShoes}
            onCheckedChange={(checked) => setState({ ...state, showShoes: checked })}
            label={p("showShoes")}
          />
          <FieldToggle
            checked={state.showClothing}
            onCheckedChange={(checked) => setState({ ...state, showClothing: checked })}
            label={p("showClothing")}
          />
          <FieldToggle
            checked={state.showCaps}
            onCheckedChange={(checked) => setState({ ...state, showCaps: checked })}
            label={p("showCaps")}
          />
        </div>
        <div className="space-y-2">
          <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
            {p("issuerPosition") }
          </Label>
          <Select
            value={state.defaultIssuerTitle || ""}
            onValueChange={(value) => {
              const candidates = getUsersForRoleLabel(props.users, value);
              const currentId = state.defaultIssuerUserId || "";
              const stillValid = currentId && candidates.some((u) => u.id === currentId);
              setState({
                ...state,
                defaultIssuerTitle: value,
                defaultIssuerUserId: stillValid ? currentId : candidates[0]?.id || "",
              });
            }}
          >
            <SelectTrigger className="h-10 rounded-xl border-[#dcdfed] bg-white text-[13.5px]">
              <SelectValue placeholder={p("chooseActual")} />
            </SelectTrigger>
            <SelectContent>
              {titles.map((title) => (
                <SelectItem key={title} value={title}>
                  {ppePositionOption(title, props.users, key => pdf(key))}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
            {p("defaultEmployee") }
          </Label>
          <Select
            value={state.defaultIssuerUserId || ""}
            onValueChange={(value) => {
              const user = props.users.find((item) => item.id === value);
              setState({
                ...state,
                defaultIssuerUserId: value,
                defaultIssuerTitle: user
                  ? getUserDisplayTitle(user)
                  : state.defaultIssuerTitle,
              });
            }}
          >
            <SelectTrigger className="h-10 rounded-xl border-[#dcdfed] bg-white text-[13.5px]">
              <SelectValue placeholder={p("chooseActual")} />
            </SelectTrigger>
            <SelectContent>
              {(state.defaultIssuerTitle
                ? getUsersForRoleLabel(props.users, state.defaultIssuerTitle)
                : props.users
              ).map((user) => (
                <SelectItem key={user.id} value={user.id}>
                  {user.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </JournalSettingsModal>
    );
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent showCloseButton={false} className="w-[calc(100vw-2rem)] max-w-[calc(100vw-1rem)] rounded-[28px] border-0 p-0 sm:max-w-[760px]">
        <DialogHeader className="border-b px-5 py-6 sm:px-10 sm:py-8">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-[22px] font-semibold tracking-[-0.03em] text-black">
              {p("documentSettings") }
            </DialogTitle>
            <button type="button" aria-label={p("close")} className="rounded-xl p-2 text-[#0b1024]" onClick={() => props.onOpenChange(false)}>
              <X className="size-8" />
            </button>
          </div>
        </DialogHeader>
        <div className="space-y-6 px-5 py-6 sm:px-10 sm:py-8">
          <div className="space-y-2">
            <Label className="text-[14px] text-[#7a7c8e]">{p("documentName") }</Label>
            <Input aria-label={p("documentName")} value={documentTitle} onChange={(e) => setDocumentTitle(e.target.value)} className="h-10 rounded-xl border-[#d8dae6] px-3.5 text-[13.5px]" />
          </div>
          <div className="space-y-2">
            <Label className="text-[14px] text-[#7a7c8e]">{p("startDate") }</Label>
            <Input type="date" aria-label={p("startDate")} value={documentDate} onChange={(e) => setDocumentDate(e.target.value)} className="h-10 rounded-xl border-[#d8dae6] px-3.5 text-[13.5px]" />
          </div>
          <fieldset className="space-y-4 rounded-[28px] border border-[#d8dae6] px-6 py-5">
            <legend className="px-2 text-[20px] font-semibold text-black">{p("addFields") }</legend>
            <FieldToggle checked={state.showGloves} onCheckedChange={(checked) => setState({ ...state, showGloves: checked })} label={p("showGloves")} />
            <FieldToggle checked={state.showShoes} onCheckedChange={(checked) => setState({ ...state, showShoes: checked })} label={p("showShoes")} />
            <FieldToggle checked={state.showClothing} onCheckedChange={(checked) => setState({ ...state, showClothing: checked })} label={p("showClothing")} />
            <FieldToggle checked={state.showCaps} onCheckedChange={(checked) => setState({ ...state, showCaps: checked })} label={p("showCaps")} />
          </fieldset>
          <div className="space-y-2">
            <Label className="text-[14px] text-[#7a7c8e]">{p("defaultIssuer") }</Label>
            <Select value={state.defaultIssuerUserId || ""} onValueChange={(value) => {
              const user = props.users.find((item) => item.id === value);
              setState({
                ...state,
                defaultIssuerUserId: value,
                defaultIssuerTitle: user ? getUserDisplayTitle(user) : state.defaultIssuerTitle,
              });
            }}>
              <SelectTrigger className="h-10 rounded-xl border-[#d8dae6] bg-[#f1f2f8] px-3.5 text-[13.5px]">
                <SelectValue placeholder={p("chooseEmployee")} />
              </SelectTrigger>
              <SelectContent>
                {(state.defaultIssuerTitle
                  ? getUsersForRoleLabel(props.users, state.defaultIssuerTitle)
                  : props.users
                ).map((user) => (
                  <SelectItem key={user.id} value={user.id}>{user.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label className="text-[14px] text-[#7a7c8e]">{p("issuerPosition") }</Label>
            <Select
              value={state.defaultIssuerTitle || ""}
              onValueChange={(value) => {
                const candidates = getUsersForRoleLabel(props.users, value);
                const currentId = state.defaultIssuerUserId || "";
                const stillValid = currentId && candidates.some((u) => u.id === currentId);
                setState({
                  ...state,
                  defaultIssuerTitle: value,
                  defaultIssuerUserId: stillValid
                    ? currentId
                    : candidates[0]?.id || "",
                });
              }}
            >
              <SelectTrigger className="h-10 rounded-xl border-[#d8dae6] bg-[#f1f2f8] px-3.5 text-[13.5px]">
                <SelectValue placeholder={p("chooseEmployee")} />
              </SelectTrigger>
              <SelectContent>
                {titles.map((title) => (
                  <SelectItem key={title} value={title}>{ppePositionOption(title, props.users, key => pdf(key))}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex justify-end pt-2">
            <Button type="button" onClick={handleSave} disabled={submitting} className="h-9 rounded-xl bg-[#5563ff] px-3.5 text-[13.5px] text-white hover:bg-[#4554ff]">
              {submitting ? p("saving") : p("save")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RowDialog(props: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  users: UserItem[];
  config: PpeIssuanceConfig;
  initialRow: PpeIssuanceRow | null;
  onSave: (row: PpeIssuanceRow) => Promise<void>;
  /** «(k из N)» при правке выделенных строк по очереди. */
  titleSuffix?: string;
}) {
  const p = useTranslations("journalPpe");
  const pdf = useTranslations("personnelMaintenancePdf");
  const feedback = usePpeErrorFeedback();
  const [state, setState] = useState<RowDialogState | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const titles = useMemo(() => roleOptions(props.users), [props.users]);

  const rowIdentity = ppeSourceIdentity([props.initialRow, props.users, props.config.defaultIssuerTitle, props.config.defaultIssuerUserId]);
  const rowSeen = useRef<string | null>(null);
  useEffect(() => {
    if (!props.open) { rowSeen.current = null; return; }
    if (rowSeen.current === rowIdentity) return;
    rowSeen.current = rowIdentity;
    setState(
      rowToState(
        props.initialRow ||
          createPpeIssuanceRow({
            issueDate: localDayKey(),
            issuerUserId: props.config.defaultIssuerUserId || "",
            issuerTitle: props.config.defaultIssuerTitle || "",
          }),
        props.users
      )
    );
  }, [
    rowIdentity,
    props.config.defaultIssuerTitle,
    props.config.defaultIssuerUserId,
    props.initialRow,
    props.open,
    props.users,
  ]);

  async function handleSave() {
    if (!state) return;
    setSubmitting(true);
    try {
      await props.onSave(stateToRow(state, props.initialRow, props.users));
      props.onOpenChange(false);
    } catch (error) {
      // Ошибку сохранения раньше глотал `finally` без `catch`: окно
      // закрывалось молча, введённая строка терялась.
      toast.error(
        presentPpeError(error, "saveRowFailed", feedback.current)
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent showCloseButton={false} className="max-h-[92vh] supports-[height:100dvh]:max-h-[92dvh] w-[calc(100vw-2rem)] max-w-[calc(100vw-1rem)] overflow-y-auto rounded-[28px] border-0 p-0 sm:max-w-[720px]">
        <DialogHeader className="border-b px-5 py-6 sm:px-10 sm:py-8">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-[22px] font-semibold tracking-[-0.03em] text-black">
              {props.initialRow ? p("editRow", { suffix: props.titleSuffix ? ` ${props.titleSuffix}` : "" }) : p("addRow")}
            </DialogTitle>
            <button type="button" aria-label={p("close")} className="rounded-xl p-2 text-[#0b1024]" onClick={() => props.onOpenChange(false)}>
              <X className="size-8" />
            </button>
          </div>
        </DialogHeader>
        {state && (
          <div className="space-y-5 px-5 py-6 sm:px-10 sm:py-8">
            <Input type="date" aria-label={pdf("issueDate")} value={state.issueDate} onChange={(e) => setState({ ...state, issueDate: e.target.value })} className="h-10 rounded-xl border-[#d8dae6] px-3.5 text-[13.5px]" />
            <Input aria-label={p("maskPlaceholder")} value={state.maskCount} onChange={(e) => setState({ ...state, maskCount: e.target.value })} placeholder={p("maskPlaceholder")} className="h-10 rounded-xl border-[#d8dae6] px-3.5 text-[13.5px]" />
            {props.config.showGloves && <Input aria-label={p("glovePlaceholder")} value={state.gloveCount} onChange={(e) => setState({ ...state, gloveCount: e.target.value })} placeholder={p("glovePlaceholder")} className="h-10 rounded-xl border-[#d8dae6] px-3.5 text-[13.5px]" />}
            {props.config.showShoes && <Input aria-label={p("shoePlaceholder")} value={state.shoePairsCount} onChange={(e) => setState({ ...state, shoePairsCount: e.target.value })} placeholder={p("shoePlaceholder")} className="h-10 rounded-xl border-[#d8dae6] px-3.5 text-[13.5px]" />}
            {props.config.showClothing && <Input aria-label={p("clothingPlaceholder")} value={state.clothingSetsCount} onChange={(e) => setState({ ...state, clothingSetsCount: e.target.value })} placeholder={p("clothingPlaceholder")} className="h-10 rounded-xl border-[#d8dae6] px-3.5 text-[13.5px]" />}
            {props.config.showCaps && <Input aria-label={p("capPlaceholder")} value={state.capCount} onChange={(e) => setState({ ...state, capCount: e.target.value })} placeholder={p("capPlaceholder")} className="h-10 rounded-xl border-[#d8dae6] px-3.5 text-[13.5px]" />}
            <div className="space-y-2">
              <Label className="text-[14px] text-[#7a7c8e]">{p("recipientPosition") }</Label>
              <Select
                value={state.recipientTitle}
                onValueChange={(value) => {
                  const candidates = getUsersForRoleLabel(props.users, value);
                  const stillValid =
                    state.recipientUserId &&
                    candidates.some((u) => u.id === state.recipientUserId);
                  setState({
                    ...state,
                    recipientTitle: value,
                    recipientUserId: stillValid
                      ? state.recipientUserId
                      : candidates[0]?.id || "",
                  });
                }}
              >
                <SelectTrigger className="h-10 rounded-xl border-[#d8dae6] bg-[#f1f2f8] px-3.5 text-[13.5px]"><SelectValue placeholder={p("chooseEmployee")} /></SelectTrigger>
                <SelectContent>
                  {titles.map((title) => <SelectItem key={title} value={title}>{ppePositionOption(title, props.users, key => pdf(key))}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-[14px] text-[#7a7c8e]">{p("employee") }</Label>
              <Select value={state.recipientUserId} onValueChange={(value) => {
                const user = props.users.find((item) => item.id === value);
                setState({ ...state, recipientUserId: value, recipientTitle: user ? getUserDisplayTitle(user) : state.recipientTitle });
              }}>
                <SelectTrigger className="h-10 rounded-xl border-[#d8dae6] bg-[#f1f2f8] px-3.5 text-[13.5px]"><SelectValue placeholder={p("chooseEmployee")} /></SelectTrigger>
                <SelectContent>
                  {(state.recipientTitle
                    ? getUsersForRoleLabel(props.users, state.recipientTitle)
                    : props.users
                  ).map((user) => <SelectItem key={user.id} value={user.id}>{user.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-[14px] text-[#7a7c8e]">{p("issuerPosition") }</Label>
              <Select
                value={state.issuerTitle}
                onValueChange={(value) => {
                  const candidates = getUsersForRoleLabel(props.users, value);
                  const stillValid =
                    state.issuerUserId &&
                    candidates.some((u) => u.id === state.issuerUserId);
                  setState({
                    ...state,
                    issuerTitle: value,
                    issuerUserId: stillValid
                      ? state.issuerUserId
                      : candidates[0]?.id || "",
                  });
                }}
              >
                <SelectTrigger className="h-10 rounded-xl border-[#d8dae6] bg-[#f1f2f8] px-3.5 text-[13.5px]"><SelectValue placeholder={p("chooseEmployee")} /></SelectTrigger>
                <SelectContent>
                  {titles.map((title) => <SelectItem key={title} value={title}>{ppePositionOption(title, props.users, key => pdf(key))}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-[14px] text-[#7a7c8e]">{p("employee") }</Label>
              <Select value={state.issuerUserId} onValueChange={(value) => {
                const user = props.users.find((item) => item.id === value);
                setState({ ...state, issuerUserId: value, issuerTitle: user ? getUserDisplayTitle(user) : state.issuerTitle });
              }}>
                <SelectTrigger className="h-10 rounded-xl border-[#d8dae6] bg-[#f1f2f8] px-3.5 text-[13.5px]"><SelectValue placeholder={p("chooseEmployee")} /></SelectTrigger>
                <SelectContent>
                  {(state.issuerTitle
                    ? getUsersForRoleLabel(props.users, state.issuerTitle)
                    : props.users
                  ).map((user) => <SelectItem key={user.id} value={user.id}>{user.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-end pt-2">
              <Button type="button" onClick={handleSave} disabled={submitting} className="h-9 rounded-xl bg-[#5563ff] px-3.5 text-[13.5px] text-white hover:bg-[#4554ff]">
                {submitting ? p("saving") : props.initialRow ? p("save") : p("add")}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function CloseDialog(props: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  title: string;
  onConfirm: () => Promise<void>;
}) {
  const t = useTranslations("journalControls");
  const common = useTranslations("common");
  const feedback = usePpeErrorFeedback();
  const [submitting, setSubmitting] = useState(false);

  async function handleConfirm() {
    setSubmitting(true);
    try {
      await props.onConfirm();
      props.onOpenChange(false);
    } catch (error) {
      toast.error(presentPpeError(error, "error", feedback.current));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent showCloseButton={false} className="w-[calc(100vw-2rem)] max-w-[calc(100vw-1rem)] rounded-[28px] border-0 p-0 sm:max-w-[760px]">
        <DialogHeader className="border-b px-8 py-6">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-[24px] font-semibold text-black">
              {t("documentLifecycle.finishTitle", { title: props.title })}
            </DialogTitle>
            <button type="button" aria-label={common("close")} className="rounded-xl p-2" onClick={() => props.onOpenChange(false)}>
              <X className="size-7" />
            </button>
          </div>
        </DialogHeader>
        <div className="flex justify-end px-8 py-6">
          <Button type="button" onClick={handleConfirm} disabled={submitting} className="h-9 rounded-xl bg-[#5563ff] px-3.5 text-[13.5px] text-white hover:bg-[#4554ff]">
            {submitting ? t("documentLifecycle.finishing") : t("documentLifecycle.finishAction")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function PpeIssuanceDocumentClient(props: Props) {
  const p = useTranslations("journalPpe");
  const pdf = useTranslations("personnelMaintenancePdf");
  const feedback = usePpeErrorFeedback();
  const deletedRowsFeedback = usePpeCommittedRef((count: number) => p("deletedRows", { count: `${count}` }));
  const t = useTranslations("journalControls");
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [config, setConfig] = useState(() =>
    normalizePpeIssuanceConfig(props.config, props.users)
  );
  const [title, setTitle] = useState(props.title || PPE_ISSUANCE_DOCUMENT_TITLE);
  const [dateFrom, setDateFrom] = useState(props.dateFrom);
  const [titleFallback, setTitleFallback] = useState(props.titleIsFallback ?? !props.title);
  const [selectedRowIds, setSelectedRowIds] = useState<string[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [rowDialogOpen, setRowDialogOpen] = useState(false);
  const [closeDialogOpen, setCloseDialogOpen] = useState(false);
  const [editingRow, setEditingRow] = useState<PpeIssuanceRow | null>(null);

  const incomingIdentity = ppeDocumentSourceIdentity(props);
  const incomingSeen = useRef(incomingIdentity);
  const documentSeen = useRef(props.documentId);
  useEffect(() => {
    if (incomingSeen.current === incomingIdentity) return;
    incomingSeen.current = incomingIdentity;
    const next = normalizePpeIssuanceConfig(props.config, props.users);
    setConfig(next);
    setTitle(props.title || PPE_ISSUANCE_DOCUMENT_TITLE);
    setTitleFallback(props.titleIsFallback ?? !props.title);
    setDateFrom(props.dateFrom);
    const ids = new Set(next.rows.map(row => row.id));
    const changedDocument = documentSeen.current !== props.documentId;
    documentSeen.current = props.documentId;
    setSelectedRowIds(current => changedDocument ? [] : current.filter(id => ids.has(id)));
    setEditingRow(current => current ? next.rows.find(row => row.id === current.id) ?? null : null);
    setRowDialogOpen(false);
    setSettingsOpen(false);
    setCloseDialogOpen(false);
  }, [incomingIdentity, props.documentId, props.config, props.users, props.title, props.titleIsFallback, props.dateFrom]);

  const rows = config.rows;
  const isClosed = props.status === "closed";
  const allSelected = rows.length > 0 && selectedRowIds.length === rows.length;
  const { mobileView, switchMobileView } = useMobileView("ppe_issuance");

  const columns = useMemo(
    () =>
      [
        {
          key: "maskCount",
          label: pdf("masks"),
          visible: true,
        },
        {
          key: "gloveCount",
          label: pdf("gloves"),
          visible: config.showGloves,
        },
        {
          key: "shoePairsCount",
          label: pdf("shoes"),
          visible: config.showShoes,
        },
        {
          key: "clothingSetsCount",
          label: pdf("clothing"),
          visible: config.showClothing,
        },
        {
          key: "capCount",
          label: pdf("caps"),
          visible: config.showCaps,
        },
      ].filter((item) => item.visible),
    [config.showCaps, config.showClothing, config.showGloves, config.showShoes, pdf]
  );

  async function persist(
    nextTitle: string,
    nextDateFrom: string,
    nextConfig: PpeIssuanceConfig
  ) {
    const response = await fetch(`/api/journal-documents/${props.documentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: nextTitle,
        dateFrom: nextDateFrom,
        dateTo: nextDateFrom,
        config: nextConfig,
      }),
    });
    if (!response.ok) {
      throw tagPpeError(new Error("Не удалось сохранить документ"), "saveDocumentFailed");
    }
    setTitle(nextTitle);
    setTitleFallback(false);
    setDateFrom(nextDateFrom);
    setConfig(nextConfig);
    startTransition(() => router.refresh());
  }

  /** Правка выделенных строк по очереди — тем же окном. */
  const seq = useSequentialEdit({
    open: (id) => {
      const row = config.rows.find((item) => item.id === id);
      if (!row || isClosed) return false;
      setEditingRow(row);
      setRowDialogOpen(true);
      return true;
    },
    close: () => {
      setRowDialogOpen(false);
      setEditingRow(null);
    },
  });
  // RowDialog сам зовёт onOpenChange(false) после сохранения — этот вызов
  // не должен прерывать очередь, поэтому помечаем «уже сохранено».
  const seqSavedRef = useRef(false);

  async function handleSaveRow(row: PpeIssuanceRow) {
    const nextConfig = {
      ...config,
      rows: editingRow
        ? config.rows.map((item) => (item.id === editingRow.id ? row : item))
        : [...config.rows, row],
    };
    await persist(title, dateFrom, nextConfig);
    if (editingRow) {
      // Очередь правок откроет следующую строку или закроет окно.
      seqSavedRef.current = true;
      seq.saved();
      return;
    }
    setEditingRow(null);
  }

  async function handleDeleteSelected() {
    if (selectedRowIds.length === 0) return;
    const count = selectedRowIds.length;
    if (!(await confirmAsync({ title: p("deleteRowsTitle"), description: p("deleteRowsDescription", { count: `${count}` }), variant: "danger", confirmLabel: p("delete") }))) return;
    try {
      const nextConfig = {
        ...config,
        rows: config.rows.filter((row) => !selectedRowIds.includes(row.id)),
      };
      await persist(title, dateFrom, nextConfig);
      setSelectedRowIds([]);
      toast.success(deletedRowsFeedback.current(count));
    } catch (error) {
      toast.error(presentPpeError(error, "deleteRowsFailed", feedback.current));
    }
  }

  async function handleCloseJournal() {
    const response = await fetch(`/api/journal-documents/${props.documentId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "closed" }),
    });
    if (!response.ok) {
      throw tagPpeError(new Error(t("closeDocument.failed")), "closeDocument.failed");
    }
    router.refresh();
  }

  return (
    <div className="space-y-6 text-black">
      {selectedRowIds.length > 0 && !isClosed && (
        <JournalSelectionBar
          count={selectedRowIds.length}
          onClear={() => setSelectedRowIds([])}
          onDelete={() =>
            handleDeleteSelected().catch((error) =>
              toast.error(presentPpeError(error, "error", feedback.current))
            )
          }
          hint={p("deleteRowsHint")}
        >
          <SelectionEditButton count={selectedRowIds.length} disabled={isClosed} onClick={() => seq.start(selectedRowIds)} />
        </JournalSelectionBar>
      )}

      <FocusTodayScroller selector="[data-focus-today]" emptyTitle={p("emptyTitle")} emptyBody={p("emptyBody")} />
      <JournalDocumentShell
        title={titleFallback ? pdf("ppeTitle") : title}
        documentId={props.documentId}
        backHref="/journals/ppe_issuance"
        onSettings={!isClosed ? () => setSettingsOpen(true) : undefined}
        closed={isClosed}
        closedHint={p("closedHint")}
        menuItems={
          !isClosed
            ? [
                {
                  key: "close-journal",
                  label: t("closeDocument.close"),
                  icon: <Archive className="size-4" />,
                  onSelect: () => setCloseDialogOpen(true),
                },
              ]
            : []
        }
        mobileView={mobileView}
        onMobileView={switchMobileView}
        cards={
          <RecordCardsView
            items={rows.map((row, index) => ({
              id: row.id,
              title: `№${index + 1} · ${formatPpeIssuanceDate(row.issueDate) || "—"}`,
              subtitle: ppeRecipient(row, props.users, key => pdf(key)) || undefined,
              leading: !isClosed ? (
                <Checkbox
                  aria-label={p("selectRow", { date: formatPpeIssuanceDate(row.issueDate) })}
                    checked={selectedRowIds.includes(row.id)}
                  onCheckedChange={(value) =>
                    setSelectedRowIds((current) =>
                      value === true
                        ? [...new Set([...current, row.id])]
                        : current.filter((item) => item !== row.id)
                    )
                  }
                  className="size-5"
                />
              ) : null,
              fields: [
                ...columns
                  .filter((c) => c.visible)
                  .map((c) => ({
                    label: c.label,
                    value: String(row[c.key as keyof PpeIssuanceRow] ?? ""),
                    hideIfEmpty: true,
                  })),
                {
                  label: p("issuedBy"),
                  value: getPpeIssuanceIssuerLabel(row, props.users),
                  hideIfEmpty: true,
                },
              ],
              onClick: !isClosed
                ? () => {
                    setEditingRow(row);
                    setRowDialogOpen(true);
                  }
                : undefined,
              actions: !isClosed ? (
                <button
                  type="button"
                  onClick={() => {
                    setEditingRow(row);
                    setRowDialogOpen(true);
                  }}
                  className="inline-flex h-10 items-center justify-center rounded-2xl bg-[#5863f8] px-4 text-[14px] font-medium text-white hover:bg-[#4752e6]"
                >
                  {p("edit") }
                </button>
              ) : null,
            }))}
            emptyLabel={p("emptyIssuances")}
          />
        }
        paperHeader={
          <JournalDocumentHeader
            orgName={props.organizationName || p("organizationFallback")}
            title={pdf("ppeHeader")}
            startedAt={dateFrom}
            finishedAt={null}
          />
        }
        sheetTitle={pdf("ppeHeader")}
        sheetMinWidth={1450}
        toolbar={
          !isClosed ? (
            <ResponsiveMenu
              title={p("add")}
              align="start"
              contentClassName="w-[220px] rounded-2xl border-0 p-2 shadow-xl"
              items={[
                {
                  key: "add-row",
                  label: p("add"),
                  icon: <Plus className="size-4 text-[#5566f6]" />,
                  onSelect: () => {
                    setEditingRow(null);
                    setRowDialogOpen(true);
                  },
                },
              ]}
              trigger={
                <Button type="button" className={DOC_PRIMARY_BUTTON_CLASS}>
                  <Plus className="mr-2 size-5" />
                  {p("add") }
                  <ChevronDown className="ml-2 size-4" />
                </Button>
              }
            />
          ) : null
        }
      >
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr>
              <th className={`w-[44px] ${GRID_HEAD_CELL_CLASS} px-2 py-1.5 font-semibold leading-tight`}>
                <Checkbox
                  aria-label={p("selectAll")}
                  checked={allSelected}
                  onCheckedChange={(value) =>
                    setSelectedRowIds(value === true ? rows.map((row) => row.id) : [])
                  }
                  disabled={rows.length === 0 || isClosed}
                />
              </th>
              <th className={`${GRID_HEAD_CELL_CLASS} px-2 py-1.5 font-semibold leading-tight`}>{pdf("issueDate") }</th>
              {columns.map((column) => (
                <th key={column.key} className={`${GRID_HEAD_CELL_CLASS} px-2 py-1.5 font-semibold leading-tight`}>
                  {column.label}
                </th>
              ))}
              <th className={`${GRID_HEAD_CELL_CLASS} px-2 py-1.5 font-semibold leading-tight`}>
                {pdf("recipient") }
              </th>
              <th className={`${GRID_HEAD_CELL_CLASS} px-2 py-1.5 font-semibold leading-tight`}>
                {pdf("issuer") }
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.id}
                className={!isClosed ? "cursor-pointer hover:bg-[#f5f6ff]" : undefined}
                onClick={() => {
                  if (isClosed) return;
                  setEditingRow(row);
                  setRowDialogOpen(true);
                }}
              >
                <td
                  className={`${GRID_CELL_CLASS} px-2 py-1 text-center leading-tight`}
                  onClick={(e) => e.stopPropagation()}
                >
                  <Checkbox
                    aria-label={p("selectRow", { date: formatPpeIssuanceDate(row.issueDate) })}
                    checked={selectedRowIds.includes(row.id)}
                    onCheckedChange={(value) =>
                      setSelectedRowIds((current) =>
                        value === true
                          ? [...new Set([...current, row.id])]
                          : current.filter((item) => item !== row.id)
                      )
                    }
                    disabled={isClosed}
                  />
                </td>
                <td className={`${GRID_CELL_CLASS} px-2 py-1 text-center leading-tight`}>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (isClosed) return;
                      setEditingRow(row);
                      setRowDialogOpen(true);
                    }}
                    className="w-full text-center hover:text-[#3848c7]"
                  >
                    {formatPpeIssuanceDate(row.issueDate)}
                  </button>
                </td>
                {columns.map((column) => (
                  <td
                    key={`${row.id}:${column.key}`}
                    className={`${GRID_CELL_CLASS} px-2 py-1 text-center leading-tight`}
                  >
                    {String(row[column.key as keyof PpeIssuanceRow] || "")}
                  </td>
                ))}
                <td className={`${GRID_CELL_CLASS} px-2 py-1 text-center leading-tight`}>
                  {ppeRecipient(row, props.users, key => pdf(key))}
                </td>
                <td className={`${GRID_CELL_CLASS} px-2 py-1 text-center leading-tight`}>
                  {getPpeIssuanceIssuerLabel(row, props.users)}
                </td>
              </tr>
            ))}
            {!isClosed ? (
              <JournalAddRow
                // Галочка — leading, «Дата выдачи СИЗ» — под подпись,
                // динамические колонки СИЗ + получатель/выдавший остаются
                // пустыми ячейками.
                leading={1}
                labelSpan={1}
                trailing={columns.length + 2}
                label={p("add")}
                onClick={() => {
                  setEditingRow(null);
                  setRowDialogOpen(true);
                }}
              />
            ) : null}
            {/* Пустая строка бланка — раньше показывалась на экране всегда.
                Теперь единственная пустая строка на экране — кликабельная
                JournalAddRow выше, а эта остаётся только для печати. */}
            <tr className="hidden print:table-row">
              <td className={`${GRID_CELL_CLASS} px-2 py-1 text-center leading-tight`}>
                <Checkbox disabled />
              </td>
              <td colSpan={columns.length + 2} className={`${GRID_CELL_CLASS} px-2 py-1 leading-tight`} />
            </tr>
          </tbody>
        </table>
      </JournalDocumentShell>

      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        title={title}
        dateFrom={dateFrom}
        users={props.users}
        config={config}
        onSave={async (params) => {
          await persist(params.title, params.dateFrom, params.config);
        }}
        useV2={props.useV2}
      />

      <RowDialog
        open={rowDialogOpen}
        onOpenChange={(value) => {
          if (value) {
            setRowDialogOpen(true);
            return;
          }
          if (seqSavedRef.current) {
            seqSavedRef.current = false;
            return;
          }
          // Закрытие без сохранения прерывает очередь («Изменено k из N»).
          seq.cancelled();
        }}
        users={props.users}
        config={config}
        initialRow={editingRow}
        onSave={handleSaveRow}
        titleSuffix={seq.progress ?? undefined}
      />

      <CloseDialog
        open={closeDialogOpen}
        onOpenChange={setCloseDialogOpen}
        title={titleFallback ? pdf("ppeTitle") : title}
        onConfirm={handleCloseJournal}
      />
    </div>
  );
}
