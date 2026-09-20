"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  EmptyDocumentsState,
  JournalTabs,
  JournalTopBar,
  filterManageMenuItems,
  useCanManageDocuments,
} from "@/components/journals/document-list-ui";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { USER_ROLE_LABEL_VALUES, getUserRoleLabel } from "@/lib/user-roles";
import { openDocumentPdf } from "@/lib/open-document-pdf";
import { ResponsiveMenu } from "@/components/ui/responsive-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Ellipsis, Pencil, Copy, Printer, Archive, Trash2, ArchiveRestore } from "lucide-react";
import {
  normalizeEquipmentMaintenanceConfig,
  formatMaintenanceDate,
} from "@/lib/equipment-maintenance-document";
import { buildStaffOptionLabel } from "@/lib/journal-staff-binding";
import { buildDocumentCopy } from "@/lib/journal-document-copy";
import { localDayKey } from "@/lib/entry-defaults";

import { toast } from "sonner";
import { confirmAsync } from "@/components/ui/confirm-async";
import {
  JOURNAL_CARD_LABEL_CLASS,
  JOURNAL_CARD_SECTION_CLASS,
  JOURNAL_CARD_TITLE_CLASS,
  JOURNAL_CARD_VALUE_CLASS,
  JOURNAL_LIST_CARD_CLASS,
  JOURNAL_LIST_CARDS_CLASS,
} from "@/components/journals/journal-responsive";
import {
  PositionSelectItems,
  usePositionEmployeeCascade,
} from "@/components/shared/position-select";
import { SharedDocumentBadge } from "@/components/journals/shared-document-badge";
const POSITION_OPTIONS = USER_ROLE_LABEL_VALUES;

type JournalListDocument = {
  id: string;
  title: string;
  /** Точки: документ без точки рядом с документами точек. */
  shared?: boolean;
  status: "active" | "closed";
  dateFrom: string;
  config?: unknown;
};

type Props = {
  activeTab: "active" | "closed";
  templateCode: string;
  templateName: string;
  users: { id: string; name: string; role: string }[];
  documents: JournalListDocument[];
};

export function EquipmentMaintenanceDocumentsClient({
  activeTab,
  templateCode,
  templateName,
  users,
  documents,
}: Props) {
  const router = useRouter();
  // Настройки / удаление документов API отдаёт только руководителю.
  const canManageDocuments = useCanManageDocuments();
  const [editingDoc, setEditingDoc] = useState<JournalListDocument | null>(null);
  const [title, setTitle] = useState("");
  const [docDate, setDocDate] = useState("");
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [approveRole, setApproveRole] = useState("");
  const [approveEmployeeId, setApproveEmployeeId] = useState("");
  const [approveEmployee, setApproveEmployee] = useState("");
  const [responsibleRole, setResponsibleRole] = useState("");
  const [responsibleEmployeeId, setResponsibleEmployeeId] = useState("");
  const [responsibleEmployee, setResponsibleEmployee] = useState("");
  const approveCascade = usePositionEmployeeCascade({
    users,
    positionTitle: approveRole,
    userId: approveEmployeeId,
    onChange: (next) => {
      const user = users.find((item) => item.id === next.userId);
      setApproveRole(next.positionTitle);
      setApproveEmployeeId(next.userId);
      setApproveEmployee(user?.name || approveEmployee);
    },
    autoPick: "first",
  });
  const responsibleCascade = usePositionEmployeeCascade({
    users,
    positionTitle: responsibleRole,
    userId: responsibleEmployeeId,
    onChange: (next) => {
      const user = users.find((item) => item.id === next.userId);
      setResponsibleRole(next.positionTitle);
      setResponsibleEmployeeId(next.userId);
      setResponsibleEmployee(user?.name || responsibleEmployee);
    },
    autoPick: "first",
  });
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!editingDoc) return;
    const cfg = normalizeEquipmentMaintenanceConfig(editingDoc.config);
    setTitle(editingDoc.title);
    setDocDate(cfg.documentDate);
    setYear(String(cfg.year));
    setApproveRole(cfg.approveRole);
    setApproveEmployeeId(cfg.approveEmployeeId || "");
    setApproveEmployee(cfg.approveEmployee);
    setResponsibleRole(cfg.responsibleRole);
    setResponsibleEmployeeId(cfg.responsibleEmployeeId || "");
    setResponsibleEmployee(cfg.responsibleEmployee);
  }, [editingDoc]);

  async function handleDelete(docId: string, docTitle: string) {
    if (!(await confirmAsync({ title: "Удалить документ?", description: `Документ «${docTitle}» и все его записи будут удалены безвозвратно.`, variant: "danger", confirmLabel: "Удалить" }))) return;
    const response = await fetch(`/api/journal-documents/${docId}`, { method: "DELETE" });
    if (!response.ok) throw new Error("Не удалось удалить документ");
    router.refresh();
  }

  async function handleStatusChange(docId: string, newStatus: "active" | "closed", docTitle: string) {
    const toClosed = newStatus === "closed";
    const ok = await confirmAsync({
      title: toClosed
        ? `Отправить документ «${docTitle}» в закрытые?`
        : `Вернуть документ «${docTitle}» в активные?`,
      description: toClosed
        ? "Документ уйдёт из рабочего списка в раздел закрытых. Записи сохранятся, отчёты и PDF по ним останутся."
        : "Документ снова появится в рабочем списке, и его можно будет заполнять.",
      bullets: toClosed
        ? [
            { label: "Заполнять закрытый документ нельзя", tone: "warn" as const },
            { label: "Вернуть в активные можно в любой момент", tone: "info" as const },
          ]
        : undefined,
      confirmLabel: toClosed ? "В закрытые" : "В активные",
      variant: toClosed ? "warn" : "info",
    });
    if (!ok) return;
    const response = await fetch(`/api/journal-documents/${docId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });
    if (!response.ok) throw new Error("Не удалось изменить статус документа");
    router.refresh();
  }

  async function handleCopy(doc: JournalListDocument) {
    // Копия — график на следующий год: перечень оборудования и ПЛАН по
    // месяцам переносятся, ФАКТ («сделано такого-то числа») обнуляется
    // (`buildDocumentCopy`). Раньше новый год рождался уже «выполненным».
    const copy = buildDocumentCopy({
      templateCode,
      journalName: templateName,
      sourceConfig: normalizeEquipmentMaintenanceConfig(doc.config),
      sourcePeriod: { dateFrom: doc.dateFrom, dateTo: doc.dateFrom },
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
      // Ошибку показываем человеку: пункт меню промис не ловил, и копия
      // молча не появлялась.
      const data = await response.json().catch(() => null);
      toast.error(data?.error || "Не удалось скопировать документ");
      return;
    }
    router.refresh();
  }

  async function saveSettings() {
    if (!editingDoc) return;
    setIsSaving(true);
    try {
      const prevConfig = normalizeEquipmentMaintenanceConfig(editingDoc.config);
      const response = await fetch(`/api/journal-documents/${editingDoc.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          dateFrom: docDate,
          config: {
            ...prevConfig,
            year: Number(year),
            documentDate: docDate,
            approveRole,
            approveEmployeeId: approveEmployeeId || null,
            approveEmployee,
            responsibleRole,
            responsibleEmployeeId: responsibleEmployeeId || null,
            responsibleEmployee,
          },
        }),
      });
      if (!response.ok) throw new Error("Не удалось сохранить");
      setEditingDoc(null);
      router.refresh();
    } catch {
      toast.error("Не удалось сохранить");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <JournalTopBar
        heading="График профилактического обслуживания оборудования"
        activeTab={activeTab}
        templateCode={templateCode}
        templateName={templateName}
        users={users}
      />
      <JournalTabs activeTab={activeTab} templateCode={templateCode} />
      <div className={JOURNAL_LIST_CARDS_CLASS}>
        {documents.length === 0 && <EmptyDocumentsState />}
        {documents.map((doc) => {
          const cfg = normalizeEquipmentMaintenanceConfig(doc.config);
          return (
            <div
              key={doc.id}
              className={JOURNAL_LIST_CARD_CLASS}
            >
              <Link href={`/journals/${templateCode}/documents/${doc.id}`} className="min-w-0">
                <div className={JOURNAL_CARD_TITLE_CLASS}>{doc.title}
              <SharedDocumentBadge shared={doc.shared} /></div>
              </Link>
              <div className={JOURNAL_CARD_SECTION_CLASS}>
                <div className={JOURNAL_CARD_LABEL_CLASS}>Год</div>
                <div className={JOURNAL_CARD_VALUE_CLASS}>{cfg.year}</div>
              </div>
              <div className={JOURNAL_CARD_SECTION_CLASS}>
                <div className={JOURNAL_CARD_LABEL_CLASS}>Должность &quot;Утверждаю&quot;</div>
                <div className={JOURNAL_CARD_VALUE_CLASS}>{cfg.approveRole}: {cfg.approveEmployee}</div>
              </div>
              <div className={JOURNAL_CARD_SECTION_CLASS}>
                <div className={JOURNAL_CARD_LABEL_CLASS}>Ответственный</div>
                <div className={JOURNAL_CARD_VALUE_CLASS}>{cfg.responsibleRole}: {cfg.responsibleEmployee}</div>
              </div>
              <div className={JOURNAL_CARD_SECTION_CLASS}>
                <div className={JOURNAL_CARD_LABEL_CLASS}>Дата документа</div>
                <div className={JOURNAL_CARD_VALUE_CLASS}>{formatMaintenanceDate(cfg.documentDate)}</div>
              </div>
              <ResponsiveMenu
                title="Действия"
                items={filterManageMenuItems([
                  ...(doc.status === "active"
                    ? [
                        {
                          key: "settings",
                          label: "Настройки",
                          icon: <Pencil className="size-4 text-[#6f7282]" />,
                          onSelect: () => setEditingDoc(doc),
                        },
                        {
                          key: "copy",
                          label: "Сделать копию",
                          icon: <Copy className="size-4 text-[#6f7282]" />,
                          onSelect: () => handleCopy(doc),
                        },
                      ]
                    : []),
                  {
                    key: "print",
                    label: "Печать",
                    icon: <Printer className="size-4 text-[#6f7282]" />,
                    onSelect: () => openDocumentPdf(doc.id),
                  },
                  ...(doc.status === "active"
                    ? [
                        {
                          key: "archive",
                          label: "Отправить в закрытые",
                          icon: <Archive className="size-4 text-[#6f7282]" />,
                          onSelect: () => handleStatusChange(doc.id, "closed", doc.title),
                        },
                      ]
                    : [
                        {
                          key: "restore",
                          label: "Отправить в активные",
                          icon: <ArchiveRestore className="size-4 text-[#6f7282]" />,
                          onSelect: () => handleStatusChange(doc.id, "active", doc.title),
                        },
                      ]),
                  ...(doc.status === "active"
                    ? [
                        {
                          key: "delete",
                          label: "Удалить",
                          icon: <Trash2 className="size-4 text-[#6f7282]" />,
                          tone: "danger" as const,
                          onSelect: () => handleDelete(doc.id, doc.title),
                        },
                      ]
                    : []),
                ], canManageDocuments)}
                trigger={
                  <button className="flex size-10 items-center justify-center rounded-full hover:bg-gray-100">
                    <Ellipsis className="size-5" />
                  </button>
                }
              />
            </div>
          );
        })}
      </div>

      <Dialog open={!!editingDoc} onOpenChange={(open) => !open && setEditingDoc(null)}>
        <DialogContent className="max-h-[90vh] supports-[height:100dvh]:max-h-[90dvh] overflow-y-auto w-[calc(100vw-2rem)] max-w-[calc(100vw-1rem)] rounded-[24px] border-0 p-0 sm:max-w-[560px]">
          <DialogHeader className="border-b px-6 py-5">
            <DialogTitle className="text-[22px] font-medium text-black">Настройки документа</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 px-6 py-5">
            <div className="space-y-2">
              <Label>Название документа</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Дата документа</Label>
              <Input type="date" value={docDate} onChange={(e) => setDocDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Год</Label>
              <Select value={year} onValueChange={setYear}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 10 }, (_, i) => String(new Date().getFullYear() - 3 + i)).map((y) => (
                    <SelectItem key={y} value={y}>{y}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Должность &quot;Утверждаю&quot;</Label>
              <Select value={approveRole} onValueChange={approveCascade.handlePositionChange}>
                <SelectTrigger><SelectValue placeholder="- Выберите значение -" /></SelectTrigger>
                <SelectContent>
                  <PositionSelectItems users={users} />
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Сотрудник</Label>
              <Select value={approveEmployeeId} onValueChange={(value) => {
                const user = users.find((item) => item.id === value);
                setApproveEmployeeId(value);
                setApproveEmployee(user?.name || approveEmployee);
                if (user) setApproveRole(getUserRoleLabel(user.role));
              }} open={approveCascade.employeeOpen} onOpenChange={approveCascade.setEmployeeOpen}>
                <SelectTrigger><SelectValue placeholder="- Выберите значение -" /></SelectTrigger>
                <SelectContent>
                  {(approveRole ? approveCascade.candidates : users).map((u) => (
                    <SelectItem key={u.id} value={u.id}>{buildStaffOptionLabel(u)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Должность ответственного</Label>
              <Select value={responsibleRole} onValueChange={responsibleCascade.handlePositionChange}>
                <SelectTrigger><SelectValue placeholder="- Выберите значение -" /></SelectTrigger>
                <SelectContent>
                  <PositionSelectItems users={users} />
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Сотрудник</Label>
              <Select value={responsibleEmployeeId} onValueChange={(value) => {
                const user = users.find((item) => item.id === value);
                setResponsibleEmployeeId(value);
                setResponsibleEmployee(user?.name || responsibleEmployee);
                if (user) setResponsibleRole(getUserRoleLabel(user.role));
              }} open={responsibleCascade.employeeOpen} onOpenChange={responsibleCascade.setEmployeeOpen}>
                <SelectTrigger><SelectValue placeholder="- Выберите значение -" /></SelectTrigger>
                <SelectContent>
                  {(responsibleRole ? responsibleCascade.candidates : users).map((u) => (
                    <SelectItem key={u.id} value={u.id}>{buildStaffOptionLabel(u)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-end">
              <Button onClick={saveSettings} disabled={isSaving}>
                {isSaving ? "Сохранение..." : "Сохранить"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}


