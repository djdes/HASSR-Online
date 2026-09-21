"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  JournalTabs,
  JournalTopBar,
  EmptyDocumentsState,
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
import { Ellipsis, Pencil, Copy, Printer, Archive, Trash2, ArchiveRestore, X } from "lucide-react";
import {
  normalizeEquipmentCalibrationConfig,
  formatCalibrationDate,
} from "@/lib/equipment-calibration-document";
import { buildStaffOptionLabel } from "@/lib/journal-staff-binding";
import { buildDocumentCopy } from "@/lib/journal-document-copy";
import { localDayKey } from "@/lib/entry-defaults";

import { toast } from "sonner";
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

export function EquipmentCalibrationDocumentsClient({
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
  const [deleteDoc, setDeleteDoc] = useState<JournalListDocument | null>(null);
  const [archiveDoc, setArchiveDoc] = useState<JournalListDocument | null>(null);
  const [title, setTitle] = useState("");
  const [docDate, setDocDate] = useState("");
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [approveRole, setApproveRole] = useState("");
  const [approveEmployeeId, setApproveEmployeeId] = useState("");
  const [approveEmployee, setApproveEmployee] = useState("");
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
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!editingDoc) return;
    const cfg = normalizeEquipmentCalibrationConfig(editingDoc.config);
    setTitle(editingDoc.title);
    setDocDate(cfg.documentDate);
    setYear(String(cfg.year));
    setApproveRole(cfg.approveRole);
    setApproveEmployeeId(cfg.approveEmployeeId || "");
    setApproveEmployee(cfg.approveEmployee);
  }, [editingDoc]);

  async function handleDelete(docId: string) {
    const response = await fetch(`/api/journal-documents/${docId}`, { method: "DELETE" });
    if (!response.ok) throw new Error("Не удалось удалить документ");
    setDeleteDoc(null);
    router.refresh();
  }

  async function handleStatusChange(docId: string, newStatus: "active" | "closed") {
    const response = await fetch(`/api/journal-documents/${docId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });
    if (!response.ok) throw new Error("Не удалось изменить статус документа");
    setArchiveDoc(null);
    router.refresh();
  }

  async function handleCopy(doc: JournalListDocument) {
    // Копия — перечень приборов на следующий год. Дата последней поверки
    // в копию не переезжает (`buildDocumentCopy`): иначе новый бланк
    // утверждал бы, что прибор уже поверен.
    const copy = buildDocumentCopy({
      templateCode,
      journalName: templateName,
      sourceConfig: normalizeEquipmentCalibrationConfig(doc.config),
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
      const prevConfig = normalizeEquipmentCalibrationConfig(editingDoc.config);
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
        heading="График поверки средств измерений"
        activeTab={activeTab}
        templateCode={templateCode}
        templateName={templateName}
        users={users}
      />
      <JournalTabs activeTab={activeTab} templateCode={templateCode} />
      <div className={JOURNAL_LIST_CARDS_CLASS}>
        {documents.length === 0 && <EmptyDocumentsState />}
        {documents.map((doc) => {
          const cfg = normalizeEquipmentCalibrationConfig(doc.config);
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
                <div className={JOURNAL_CARD_LABEL_CLASS}>Дата документа</div>
                <div className={JOURNAL_CARD_VALUE_CLASS}>{formatCalibrationDate(cfg.documentDate)}</div>
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
                          onSelect: () => setArchiveDoc(doc),
                        },
                      ]
                    : [
                        {
                          key: "restore",
                          label: "Отправить в активные",
                          icon: <ArchiveRestore className="size-4 text-[#6f7282]" />,
                          onSelect: () => handleStatusChange(doc.id, "active"),
                        },
                      ]),
                  ...(doc.status === "active"
                    ? [
                        {
                          key: "delete",
                          label: "Удалить",
                          icon: <Trash2 className="size-4 text-[#6f7282]" />,
                          tone: "danger" as const,
                          onSelect: () => setDeleteDoc(doc),
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

      {/* Settings dialog */}
      <Dialog open={!!editingDoc} onOpenChange={(open) => !open && setEditingDoc(null)}>
        <DialogContent showCloseButton={false} className="max-h-[90vh] supports-[height:100dvh]:max-h-[90dvh] overflow-y-auto w-[calc(100vw-2rem)] max-w-[calc(100vw-1rem)] rounded-[24px] border-0 p-0 sm:max-w-[560px]">
          <DialogHeader className="flex flex-row items-center justify-between border-b px-7 py-5">
            <DialogTitle className="text-[22px] font-semibold text-black">Настройки документа</DialogTitle>
            <button type="button" className="rounded-md p-1 text-black/80 hover:bg-black/5" onClick={() => setEditingDoc(null)}>
              <X className="size-6" />
            </button>
          </DialogHeader>
          <div className="space-y-4 px-7 py-6">
            <div className="space-y-1">
              <Label className="text-[14px] text-[#6f7282]">Название документа</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} className="h-10 rounded-xl border-[#dfe1ec] px-5 text-[16px]" />
            </div>
            <div className="space-y-1">
              <Label className="text-[14px] text-[#6f7282]">Дата документа</Label>
              <Input type="date" value={docDate} onChange={(e) => setDocDate(e.target.value)} className="h-10 rounded-xl border-[#dfe1ec] px-5 text-[16px]" />
            </div>
            <div className="space-y-1">
              <Label className="text-[14px] text-[#6f7282]">Год</Label>
              <Select value={year} onValueChange={setYear}>
                <SelectTrigger className="h-10 rounded-xl border-[#dfe1ec] bg-[#f3f4fb] px-5 text-[16px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 10 }, (_, i) => String(new Date().getFullYear() - 3 + i)).map((y) => (
                    <SelectItem key={y} value={y}>{y}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-[14px] text-[#6f7282]">Должность &quot;Утверждаю&quot;</Label>
              <Select value={approveRole} onValueChange={approveCascade.handlePositionChange}>
                <SelectTrigger className="h-10 rounded-xl border-[#dfe1ec] bg-[#f3f4fb] px-5 text-[16px]"><SelectValue placeholder="Выберите должность" /></SelectTrigger>
                <SelectContent>
                  <PositionSelectItems users={users} />
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-[14px] text-[#6f7282]">Сотрудник</Label>
              <Select value={approveEmployeeId} onValueChange={(value) => {
                const user = users.find((item) => item.id === value);
                setApproveEmployeeId(value);
                setApproveEmployee(user?.name || approveEmployee);
                if (user) setApproveRole(getUserRoleLabel(user.role));
              }} open={approveCascade.employeeOpen} onOpenChange={approveCascade.setEmployeeOpen}>
                <SelectTrigger className="h-10 rounded-xl border-[#dfe1ec] bg-[#f3f4fb] px-5 text-[16px]"><SelectValue placeholder="Выберите сотрудника" /></SelectTrigger>
                <SelectContent>
                  {users.map((u) => <SelectItem key={u.id} value={u.id}>{buildStaffOptionLabel(u)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-end pt-1">
              <Button onClick={saveSettings} disabled={isSaving} className="h-9 rounded-xl bg-[#5863f8] px-3.5 text-[13.5px] font-medium text-white hover:bg-[#4b57f3]">
                {isSaving ? "Сохранение..." : "Сохранить"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation dialog */}
      <Dialog open={!!deleteDoc} onOpenChange={(open) => !open && setDeleteDoc(null)}>
        <DialogContent showCloseButton={false} className="w-[calc(100vw-2rem)] max-w-[calc(100vw-1rem)] rounded-[24px] border-0 p-0 sm:max-w-[560px]">
          <DialogHeader className="flex flex-row items-center justify-between border-b px-7 py-5">
            <DialogTitle className="text-[20px] font-semibold text-black">
              Удаление документа &quot;{deleteDoc?.title}&quot;
            </DialogTitle>
            <button type="button" className="rounded-md p-1 text-black/80 hover:bg-black/5" onClick={() => setDeleteDoc(null)}>
              <X className="size-6" />
            </button>
          </DialogHeader>
          <div className="flex justify-end px-7 py-6">
            <Button
              onClick={() => deleteDoc && handleDelete(deleteDoc.id)}
              className="h-9 rounded-xl bg-[#5863f8] px-3.5 text-[13.5px] font-medium text-white hover:bg-[#4b57f3]"
            >
              Удалить
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Archive confirmation dialog */}
      <Dialog open={!!archiveDoc} onOpenChange={(open) => !open && setArchiveDoc(null)}>
        <DialogContent showCloseButton={false} className="w-[calc(100vw-2rem)] max-w-[calc(100vw-1rem)] rounded-[24px] border-0 p-0 sm:max-w-[560px]">
          <DialogHeader className="flex flex-row items-center justify-between border-b px-7 py-5">
            <DialogTitle className="text-[20px] font-semibold text-black">
              Перенести в архив документ &quot;{archiveDoc?.title}&quot;
            </DialogTitle>
            <button type="button" className="rounded-md p-1 text-black/80 hover:bg-black/5" onClick={() => setArchiveDoc(null)}>
              <X className="size-6" />
            </button>
          </DialogHeader>
          <div className="flex justify-end px-7 py-6">
            <Button
              onClick={() => archiveDoc && handleStatusChange(archiveDoc.id, "closed")}
              className="h-9 rounded-xl bg-[#5863f8] px-3.5 text-[13.5px] font-medium text-white hover:bg-[#4b57f3]"
            >
              В архив
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}


