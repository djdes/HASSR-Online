"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Pencil, Plus, Trash2, X } from "lucide-react";
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
import {
  getSanitaryDayChecklistTitle,
  normalizeSdcConfig,
  mergeSdcEntries,
  dropSdcMarksForMissingItems,
  resolveSdcSignerId,
  resolveSdcSignerName,
  getItemNumber,
  type SdcConfig,
  type SdcEntryData,
  type SdcZone,
  type SdcItem,
} from "@/lib/sanitary-day-checklist-document";
import { DOC_PRIMARY_BUTTON_CLASS } from "@/components/journals/journal-responsive";
import { JournalDocumentShell } from "@/components/journals/journal-document-shell";
import { JournalDocumentHeader } from "@/components/journals/journal-document-header";
import {
  GRID_CELL_CLASS,
  GRID_HEAD_CELL_CLASS,
} from "@/components/journals/journal-grid";
import { JournalAddRow } from "@/components/journals/journal-add-row";
import { JournalSettingsModal } from "@/components/journals/v2/journal-settings-modal";
import { FocusTodayScroller } from "@/components/journals/focus-today-scroller";
import { useMobileView } from "@/lib/use-mobile-view";

import { toast } from "sonner";
import { useJournalUndo } from "@/lib/journal-undo";
import { ORG_NAME_FALLBACK } from "@/lib/journal-constants";
import { confirmAsync } from "@/components/ui/confirm-async";
import {
  NO_ROW_EMPLOYEE_MESSAGE,
  useRosterViewerId,
} from "@/components/journals/use-roster-viewer";
import { humanizeFetchError } from "@/lib/humanize-fetch-error";

/* ─── Types ─── */

type UserItem = { id: string; name: string; role: string };

type Props = {
  documentId: string;
  title: string;
  organizationName: string;
  status: string;
  dateFrom: string;
  users: UserItem[];
  /** Ответственный документа — на него пишется запись отметок. */
  responsibleUserId?: string | null;
  config: SdcConfig;
  initialEntries: { id: string; date: string; data: SdcEntryData }[];
  routeCode: string;
  /** Design v2 toggle. */
  useV2?: boolean;
};

/* ─── Helpers ─── */

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
const MINUTES = Array.from({ length: 12 }, (_, i) =>
  String(i * 5).padStart(2, "0")
);

function createId(): string {
  return typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function formatRuDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function parseTime(t: string): { h: string; m: string } {
  const parts = t.split(":");
  return { h: parts[0] || "12", m: parts[1] || "00" };
}

async function requestJson(url: string, init: RequestInit) {
  const response = await fetch(url, init);
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      (result && typeof result.error === "string" && result.error) ||
        "Операция не выполнена"
    );
  }
  return result;
}

/* ─── Settings Dialog ─── */

function SettingsDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  documentId: string;
  title: string;
  dateFrom: string;
  users: UserItem[];
  config: SdcConfig;
  onSaved: (config: SdcConfig) => void;
  useV2?: boolean;
}) {
  const [docTitle, setDocTitle] = useState(props.title);
  const [dateFrom, setDateFrom] = useState(props.dateFrom);
  // Храним id, а не имя: после переименования сотрудника селект по имени
  // оказывался пустым. Старые документы подхватываются по совпадению имени.
  const [responsibleId, setResponsibleId] = useState(() =>
    resolveSdcSignerId(
      props.config.responsibleUserId,
      props.config.responsibleName,
      props.users
    )
  );
  const [checkerId, setCheckerId] = useState(() =>
    resolveSdcSignerId(
      props.config.checkerUserId,
      props.config.checkerName,
      props.users
    )
  );
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!props.open) return;
    setDocTitle(props.title);
    setDateFrom(props.dateFrom);
    setResponsibleId(
      resolveSdcSignerId(
        props.config.responsibleUserId,
        props.config.responsibleName,
        props.users
      )
    );
    setCheckerId(
      resolveSdcSignerId(
        props.config.checkerUserId,
        props.config.checkerName,
        props.users
      )
    );
  }, [
    props.open,
    props.title,
    props.dateFrom,
    props.users,
    props.config.responsibleName,
    props.config.checkerName,
    props.config.responsibleUserId,
    props.config.checkerUserId,
  ]);

  async function handleSave() {
    setSubmitting(true);
    const nameOf = (id: string) =>
      props.users.find((user) => user.id === id)?.name || "";
    const nextConfig: SdcConfig = {
      ...props.config,
      responsibleUserId: responsibleId,
      checkerUserId: checkerId,
      // Снимок имени остаётся: по нему печатаются старые документы и
      // читают бланк те, кого уже нет в организации.
      responsibleName: nameOf(responsibleId),
      checkerName: nameOf(checkerId),
    };
    try {
      await requestJson(`/api/journal-documents/${props.documentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: docTitle.trim() || props.title,
          dateFrom,
          config: nextConfig,
        }),
      });
      props.onOpenChange(false);
      props.onSaved(nextConfig);
    } catch (error) {
      toast.error(
        humanizeFetchError(error, "Ошибка сохранения")
      );
    } finally {
      setSubmitting(false);
    }
  }

  // «Выполнил» и «Проверил» — из сотрудников организации. Значение селекта
  // — id сотрудника; имя пишется рядом снимком (печать, старые документы).
  const peopleSelects = (
    <>
      <div className="space-y-1">
        <Label className="text-[16px] text-[#6f7282]">Выполнил</Label>
        <Select
          value={responsibleId || "__none__"}
          onValueChange={(v) => setResponsibleId(v === "__none__" ? "" : v)}
        >
          <SelectTrigger className="h-10 rounded-xl border-[#dfe1ec] px-3.5 text-[13.5px]">
            <SelectValue placeholder="- Не выбран -" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">- Не выбран -</SelectItem>
            {props.users.map((user) => (
              <SelectItem key={user.id} value={user.id}>
                {user.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label className="text-[16px] text-[#6f7282]">Проверил</Label>
        <Select
          value={checkerId || "__none__"}
          onValueChange={(v) => setCheckerId(v === "__none__" ? "" : v)}
        >
          <SelectTrigger className="h-10 rounded-xl border-[#dfe1ec] px-3.5 text-[13.5px]">
            <SelectValue placeholder="- Не выбран -" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">- Не выбран -</SelectItem>
            {props.users.map((user) => (
              <SelectItem key={user.id} value={user.id}>
                {user.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </>
  );

  if (props.useV2) {
    return (
      <JournalSettingsModal
        open={props.open}
        onOpenChange={props.onOpenChange}
        title="Настройки документа"
        description="Название документа и дата документа."
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
            value={docTitle}
            onChange={(e) => setDocTitle(e.target.value)}
            className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px] focus:border-[#5566f6] focus:ring-4 focus:ring-[#5566f6]/15"
          />
        </div>
        <div className="space-y-2">
          <Label className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
            Дата
          </Label>
          <Input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="h-9 rounded-xl border-[#dcdfed] px-3.5 text-[13.5px]"
          />
        </div>
        {peopleSelects}
      </JournalSettingsModal>
    );
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent showCloseButton={false} className="max-h-[90vh] supports-[height:100dvh]:max-h-[90dvh] w-[calc(100vw-2rem)] max-w-[calc(100vw-1rem)] overflow-y-auto rounded-[24px] border-0 p-0 sm:max-w-[560px]">
        <DialogHeader className="flex flex-row items-center justify-between border-b px-7 py-5">
          <DialogTitle className="text-[24px] font-semibold tracking-[-0.03em] text-black">
            Настройки документа
          </DialogTitle>
          <button
            type="button"
            className="rounded-md p-1 text-black/80 hover:bg-black/5"
            onClick={() => props.onOpenChange(false)}
          >
            <X className="size-6" />
          </button>
        </DialogHeader>
        <div className="space-y-5 px-7 py-6">
          <div className="space-y-1">
            <Label className="text-[16px] text-[#6f7282]">
              Название документа
            </Label>
            <Input
              value={docTitle}
              onChange={(e) => setDocTitle(e.target.value)}
              className="h-9 rounded-xl border-[#dfe1ec] px-3.5 text-[13.5px]"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[16px] text-[#6f7282]">Дата</Label>
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="h-9 rounded-xl border-[#dfe1ec] px-3.5 text-[13.5px]"
            />
          </div>
          {peopleSelects}
          <div className="flex justify-end pt-1">
            <Button
              type="button"
              disabled={submitting}
              onClick={handleSave}
              className="h-9 rounded-xl bg-[#5863f8] px-3.5 text-[13.5px] font-medium text-white hover:bg-[#4b57f3]"
            >
              {submitting ? "Сохранение..." : "Сохранить"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ─── Add Item Dialog ─── */

function AddItemDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  zones: SdcZone[];
  onAdd: (zoneId: string, text: string) => void;
}) {
  const [zoneId, setZoneId] = useState(props.zones[0]?.id || "");
  const [text, setText] = useState("");

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent showCloseButton={false} className="max-h-[90vh] supports-[height:100dvh]:max-h-[90dvh] w-[calc(100vw-2rem)] max-w-[calc(100vw-1rem)] overflow-y-auto rounded-[24px] border-0 p-0 sm:max-w-[560px]">
        <DialogHeader className="flex flex-row items-center justify-between border-b px-7 py-5">
          <DialogTitle className="text-[24px] font-semibold tracking-[-0.03em] text-black">
            Добавление новой строки
          </DialogTitle>
          <button
            type="button"
            className="rounded-md p-1 text-black/80 hover:bg-black/5"
            onClick={() => props.onOpenChange(false)}
          >
            <X className="size-6" />
          </button>
        </DialogHeader>
        <div className="space-y-5 px-7 py-6">
          <div className="space-y-1">
            <Label className="text-[16px] text-[#6f7282]">Зона</Label>
            <Select value={zoneId} onValueChange={setZoneId}>
              <SelectTrigger className="h-10 rounded-xl border-[#dfe1ec] bg-[#f3f4fb] px-3.5 text-[13.5px]">
                <SelectValue placeholder="- Выберите зону -" />
              </SelectTrigger>
              <SelectContent>
                {props.zones.map((zone) => (
                  <SelectItem key={zone.id} value={zone.id}>
                    {zone.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-[16px] text-[#6f7282]">Описание</Label>
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={4}
              className="rounded-2xl border-[#dfe1ec] px-4 py-3 text-[18px]"
              placeholder="Введите описание действия..."
            />
          </div>
          <div className="flex justify-end pt-1">
            <Button
              type="button"
              disabled={!zoneId || !text.trim()}
              onClick={() => {
                props.onAdd(zoneId, text.trim());
                props.onOpenChange(false);
              }}
              className="h-9 rounded-xl bg-[#5863f8] px-3.5 text-[13.5px] font-medium text-white hover:bg-[#4b57f3]"
            >
              Добавить
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ─── Edit Item Dialog ─── */

function EditItemDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  zones: SdcZone[];
  item: SdcItem | null;
  onSave: (itemId: string, zoneId: string, text: string) => void;
}) {
  const [zoneId, setZoneId] = useState(props.item?.zoneId || "");
  const [text, setText] = useState(props.item?.text || "");

  if (!props.item) return null;

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent showCloseButton={false} className="max-h-[90vh] supports-[height:100dvh]:max-h-[90dvh] w-[calc(100vw-2rem)] max-w-[calc(100vw-1rem)] overflow-y-auto rounded-[24px] border-0 p-0 sm:max-w-[560px]">
        <DialogHeader className="flex flex-row items-center justify-between border-b px-7 py-5">
          <DialogTitle className="text-[24px] font-semibold tracking-[-0.03em] text-black">
            Редактирование строки
          </DialogTitle>
          <button
            type="button"
            className="rounded-md p-1 text-black/80 hover:bg-black/5"
            onClick={() => props.onOpenChange(false)}
          >
            <X className="size-6" />
          </button>
        </DialogHeader>
        <div className="space-y-5 px-7 py-6">
          <div className="space-y-1">
            <Label className="text-[16px] text-[#6f7282]">Зона</Label>
            <Select value={zoneId} onValueChange={setZoneId}>
              <SelectTrigger className="h-10 rounded-xl border-[#dfe1ec] bg-[#f3f4fb] px-3.5 text-[13.5px]">
                <SelectValue placeholder="- Выберите зону -" />
              </SelectTrigger>
              <SelectContent>
                {props.zones.map((zone) => (
                  <SelectItem key={zone.id} value={zone.id}>
                    {zone.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-[16px] text-[#6f7282]">Описание</Label>
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={4}
              className="rounded-2xl border-[#dfe1ec] px-4 py-3 text-[18px]"
            />
          </div>
          <div className="flex justify-end pt-1">
            <Button
              type="button"
              disabled={!zoneId || !text.trim()}
              onClick={() => {
                props.onSave(props.item!.id, zoneId, text.trim());
                props.onOpenChange(false);
              }}
              className="h-9 rounded-xl bg-[#5863f8] px-3.5 text-[13.5px] font-medium text-white hover:bg-[#4b57f3]"
            >
              Сохранить
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ─── Edit Zones Dialog ─── */

function EditZonesDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  zones: SdcZone[];
  onSave: (zones: SdcZone[]) => void;
}) {
  // Состояние окна — копия текущих зон. Раньше стартовало пустым списком,
  // и «Закрыть» сохраняло пустоту, стирая весь чек-лист.
  const [zones, setZones] = useState<SdcZone[]>(() =>
    props.zones.map((zone) => ({ ...zone }))
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [newName, setNewName] = useState("");

  useEffect(() => {
    if (!props.open) return;
    setZones(props.zones.map((zone) => ({ ...zone })));
    setSelected(new Set());
    setEditingId(null);
    setNewName("");
  }, [props.open, props.zones]);

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleAddZone() {
    if (!newName.trim()) return;
    const zone: SdcZone = { id: createId(), name: newName.trim() };
    setZones((prev) => [...prev, zone]);
    setNewName("");
  }

  async function handleDeleteSelected() {
    const confirmed = await confirmAsync({
      title: "Удалить выбранные зоны?",
      description: `Будет удалено зон: ${selected.size}. Вместе с зоной исчезнут её пункты чек-листа.`,
      variant: "danger",
      confirmLabel: "Удалить",
    });
    if (!confirmed) return;
    setZones((prev) => prev.filter((z) => !selected.has(z.id)));
    setSelected(new Set());
  }

  async function handleDeleteAll() {
    const confirmed = await confirmAsync({
      title: "Удалить все зоны?",
      description:
        "Чек-лист станет пустым: исчезнут все зоны и все их пункты. Восстановить нельзя.",
      variant: "danger",
      confirmLabel: "Удалить всё",
    });
    if (!confirmed) return;
    setZones([]);
    setSelected(new Set());
  }

  function startEdit(zone: SdcZone) {
    setEditingId(zone.id);
    setEditingName(zone.name);
  }

  function confirmEdit() {
    if (!editingId || !editingName.trim()) return;
    setZones((prev) =>
      prev.map((z) =>
        z.id === editingId ? { ...z, name: editingName.trim() } : z
      )
    );
    setEditingId(null);
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent showCloseButton={false} className="max-h-[90vh] supports-[height:100dvh]:max-h-[90dvh] w-[calc(100vw-2rem)] max-w-[calc(100vw-1rem)] overflow-y-auto rounded-[24px] border-0 p-0 sm:max-w-[560px]">
        <DialogHeader className="flex flex-row items-center justify-between border-b px-7 py-5">
          <DialogTitle className="text-[24px] font-semibold tracking-[-0.03em] text-black">
            Редактировать список
          </DialogTitle>
          <button
            type="button"
            className="rounded-md p-1 text-black/80 hover:bg-black/5"
            onClick={() => props.onOpenChange(false)}
          >
            <X className="size-6" />
          </button>
        </DialogHeader>
        <div className="space-y-4 px-7 py-6">
          {/* Zone list */}
          <div className="space-y-2">
            {zones.map((zone) => (
              <div
                key={zone.id}
                className="flex items-center gap-3 rounded-xl border border-[#dfe1ec] px-4 py-3"
              >
                <Checkbox
                  checked={selected.has(zone.id)}
                  onCheckedChange={() => toggleSelect(zone.id)}
                  className="size-5 rounded border-[#dfe1ec] data-[state=checked]:border-[#5566f6] data-[state=checked]:bg-[#5566f6]"
                />
                {editingId === zone.id ? (
                  <div className="flex flex-1 items-center gap-2">
                    <Input
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      className="h-10 flex-1 rounded-xl border-[#dfe1ec] px-3 text-[16px]"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") confirmEdit();
                      }}
                    />
                    <button
                      type="button"
                      className="rounded-md p-1 text-[#5566f6] hover:bg-[#f3f4fb]"
                      onClick={confirmEdit}
                    >
                      <Check className="size-5" />
                    </button>
                  </div>
                ) : (
                  <>
                    <span className="flex-1 text-[16px] text-black">
                      {zone.name}
                    </span>
                    <button
                      type="button"
                      className="rounded-md p-1 text-[#6f7282] hover:bg-[#f3f4fb]"
                      onClick={() => startEdit(zone)}
                    >
                      <Pencil className="size-4" />
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>

          {/* Selection actions */}
          {selected.size > 0 && (
            <div className="flex flex-wrap items-center gap-4 rounded-xl bg-[#f3f4fb] px-4 py-3">
              <span className="text-[14px] text-[#6f7282]">
                Выбрано: {selected.size}
              </span>
              <button
                type="button"
                className="text-[14px] font-medium text-[#ff3b30] hover:underline"
                onClick={() => void handleDeleteSelected()}
              >
                Удалить
              </button>
              <button
                type="button"
                className="text-[14px] font-medium text-[#ff3b30] hover:underline"
                onClick={() => void handleDeleteAll()}
              >
                Удалить все
              </button>
            </div>
          )}

          {/* Add new zone */}
          <div className="flex items-center gap-2">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Новая зона..."
              className="h-12 flex-1 rounded-xl border-[#dfe1ec] px-4 text-[16px]"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAddZone();
              }}
            />
            <Button
              type="button"
              size="icon"
              onClick={handleAddZone}
              disabled={!newName.trim()}
              className="size-12 rounded-xl bg-[#5566f6] text-white hover:bg-[#4b57ff]"
            >
              <Plus className="size-5" />
            </Button>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => props.onOpenChange(false)}
              className="h-9 rounded-xl px-3.5 text-[13.5px] font-medium"
            >
              Отмена
            </Button>
            <Button
              type="button"
              onClick={() => {
                props.onSave(zones);
                props.onOpenChange(false);
              }}
              className="h-9 rounded-xl bg-[#5863f8] px-3.5 text-[13.5px] font-medium text-white hover:bg-[#4b57f3]"
            >
              Сохранить
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ─── Time Input Cell ─── */

function TimeCell({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const { h, m } = value ? parseTime(value) : { h: "", m: "" };

  if (disabled) {
    return (
      <span className="text-[14px] text-[#6f7282]">{value || ""}</span>
    );
  }

  if (!editing && !value) {
    return (
      <button
        type="button"
        className="w-full text-center text-[14px] text-[#b0b3c4] hover:text-[#5566f6]"
        onClick={() => setEditing(true)}
      >
        —
      </button>
    );
  }

  if (!editing) {
    return (
      <button
        type="button"
        className="w-full text-center text-[14px] text-black hover:text-[#5566f6]"
        onClick={() => setEditing(true)}
      >
        {value}
      </button>
    );
  }

  return (
    <div
      className="flex items-center justify-center gap-1"
      // Раньше режим правки закрывался только выбором минут и залипал,
      // если из ячейки просто уходили.
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setEditing(false);
        }
      }}
    >
      <select
        value={h || "12"}
        onChange={(e) => {
          // Пустой пункт — единственный способ снять ошибочно
          // поставленное время, не удаляя сам пункт чек-листа.
          if (!e.target.value) {
            onChange("");
            setEditing(false);
            return;
          }
          const newVal = `${e.target.value}:${m || "00"}`;
          onChange(newVal);
        }}
        className="h-8 w-12 rounded border border-[#dfe1ec] text-center text-[13px]"
      >
        <option value="">—</option>
        {HOURS.map((hh) => (
          <option key={hh} value={hh}>
            {hh}
          </option>
        ))}
      </select>
      <span className="text-[13px]">:</span>
      <select
        value={m || "00"}
        onChange={(e) => {
          if (!e.target.value) {
            onChange("");
            setEditing(false);
            return;
          }
          const newVal = `${h || "12"}:${e.target.value}`;
          onChange(newVal);
          setEditing(false);
        }}
        className="h-8 w-12 rounded border border-[#dfe1ec] text-center text-[13px]"
      >
        <option value="">—</option>
        {MINUTES.map((mm) => (
          <option key={mm} value={mm}>
            {mm}
          </option>
        ))}
      </select>
    </div>
  );
}

/* ─── Print Header ─── */


/* ─── Main Component ─── */

export function SanitaryDayChecklistDocumentClient({
  documentId,
  title,
  organizationName,
  status,
  dateFrom,
  users,
  responsibleUserId,
  config: initialConfig,
  initialEntries,
  routeCode,
  useV2 = false,
}: Props) {
  const router = useRouter();
  const [config, setConfig] = useState<SdcConfig>(() =>
    normalizeSdcConfig(initialConfig)
  );
  // Сливаем ВСЕ записи документа, как это делает PDF: раньше читалась
  // только `initialEntries[0]`, и отметки второго заполнявшего пропадали
  // с экрана, а первое же сохранение их затирало.
  const [marks, setMarks] = useState<Record<string, string>>(
    () => mergeSdcEntries(initialEntries).marks
  );
  // Отметки «выполнено» приходят с сервера: раньше жили только в useState
  // и обнулялись на F5.
  const [checked, setChecked] = useState<Set<string>>(() => {
    const done = mergeSdcEntries(initialEntries).done;
    return new Set(Object.keys(done).filter((key) => done[key]));
  });
  const viewerId = useRosterViewerId(users);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [addItemOpen, setAddItemOpen] = useState(false);
  const [editItemOpen, setEditItemOpen] = useState(false);
  const [editZonesOpen, setEditZonesOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<SdcItem | null>(null);
  const [saving, setSaving] = useState(false);

  const isActive = status === "active";
  // История отмены: только правки этого человека в этой вкладке.
  const undoStack = useJournalUndo({ enabled: status === "active" });
  const { mobileView, switchMobileView } = useMobileView("sanitary_day_control");
  const organizationLabel = organizationName || ORG_NAME_FALLBACK;
  const documentTitle = title || getSanitaryDayChecklistTitle(routeCode);
  const entryDate = dateFrom;

  // Group items by zone
  const zoneGroups = useMemo(() => {
    return config.zones.map((zone, zoneIndex) => ({
      zone,
      zoneIndex,
      items: config.items.filter((item) => item.zoneId === zone.id),
    }));
  }, [config.zones, config.items]);

  // Save config to server
  const saveConfig = useCallback(
    async (newConfig: SdcConfig) => {
      setSaving(true);
      try {
        await requestJson(`/api/journal-documents/${documentId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ config: newConfig }),
        });
        setConfig(newConfig);
      } catch (error) {
        toast.error(
          humanizeFetchError(error, "Ошибка сохранения")
        );
      } finally {
        setSaving(false);
      }
    },
    [documentId]
  );

  /**
   * Запись отметок времени. Отмена (Ctrl+Z) — это повторная запись
   * прежней карты отметок тем же PUT, а не правка состояния на клиенте:
   * серверные запреты обязаны сработать и на откате.
   *
   * `silent` — вызов из истории: нового шага не кладём и пробрасываем
   * ошибку наружу, чтобы протухший шаг вылетел из стека.
   */
  // Запись пишется на ответственного документа, иначе на вошедшего: такого
  // сотрудника как "system" в организации нет, и сервер отвечал 404.
  const entryEmployeeId =
    (responsibleUserId && users.some((u) => u.id === responsibleUserId)
      ? responsibleUserId
      : "") || viewerId;

  type Snapshot = {
    marks: Record<string, string>;
    done: Record<string, boolean>;
  };

  const saveEntry = useCallback(
    async (next: Snapshot, options?: { silent?: boolean; previous?: Snapshot }) => {
      const previous: Snapshot = options?.previous ?? {
        marks,
        done: Object.fromEntries([...checked].map((id) => [id, true])),
      };
      if (!entryEmployeeId) {
        toast.error(NO_ROW_EMPLOYEE_MESSAGE);
        setMarks(previous.marks);
        setChecked(new Set(Object.keys(previous.done)));
        return;
      }
      try {
        await requestJson(`/api/journal-documents/${documentId}/entries`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            employeeId: entryEmployeeId,
            date: entryDate,
            data: { marks: next.marks, done: next.done },
          }),
        });
        if (!options?.silent) {
          undoStack.push({
            undo: () => {
              setMarks(previous.marks);
              setChecked(new Set(Object.keys(previous.done)));
              return saveEntry(previous, { silent: true, previous: next });
            },
            redo: () => {
              setMarks(next.marks);
              setChecked(new Set(Object.keys(next.done)));
              return saveEntry(next, { silent: true, previous });
            },
          });
        }
      } catch (error) {
        setMarks(previous.marks);
        setChecked(new Set(Object.keys(previous.done)));
        if (options?.silent) throw error;
        toast.error(
          humanizeFetchError(error, "Ошибка сохранения")
        );
      }
    },
    [documentId, entryDate, entryEmployeeId, marks, checked, undoStack]
  );

  // Handlers
  function handleToggleCheck(itemId: string) {
    const nextDone = Object.fromEntries([...checked].map((id) => [id, true]));
    if (checked.has(itemId)) delete nextDone[itemId];
    else nextDone[itemId] = true;
    setChecked(new Set(Object.keys(nextDone)));
    void saveEntry({ marks, done: nextDone });
  }

  function handleTimeChange(itemId: string, time: string) {
    const newMarks = { ...marks, [itemId]: time };
    setMarks(newMarks);
    void saveEntry({
      marks: newMarks,
      done: Object.fromEntries([...checked].map((id) => [id, true])),
    });
  }

  function handleAddItem(zoneId: string, text: string) {
    const newItem: SdcItem = { id: createId(), zoneId, text };
    const newConfig = {
      ...config,
      items: [...config.items, newItem],
    };
    saveConfig(newConfig);
  }

  function handleEditItem(itemId: string, zoneId: string, text: string) {
    const newConfig = {
      ...config,
      items: config.items.map((item) =>
        item.id === itemId ? { ...item, zoneId, text } : item
      ),
    };
    saveConfig(newConfig);
  }

  /**
   * Отметки удалённых пунктов оставались в данных записи мусором —
   * вычищаем их сразу после правки списка.
   */
  function purgeMarksForItems(nextItems: SdcItem[]) {
    const current = {
      marks,
      done: Object.fromEntries([...checked].map((id) => [id, true])),
    };
    const cleaned = dropSdcMarksForMissingItems(
      current,
      nextItems.map((item) => item.id)
    );
    const changed =
      Object.keys(cleaned.marks).length !== Object.keys(current.marks).length ||
      Object.keys(cleaned.done).length !== Object.keys(current.done).length;
    if (!changed) return;
    setMarks(cleaned.marks);
    setChecked(new Set(Object.keys(cleaned.done)));
    void saveEntry(cleaned, { silent: true, previous: current }).catch(() => {
      toast.error("Не удалось очистить отметки удалённых пунктов");
    });
  }

  async function handleDeleteItem(itemId: string) {
    // Пункт чек-листа удалялся молча, одним кликом по корзине.
    const item = config.items.find((entry) => entry.id === itemId);
    const confirmed = await confirmAsync({
      title: "Удалить пункт чек-листа?",
      description: item?.text
        ? `«${item.text}» исчезнет из бланка и из печати. Восстановить нельзя.`
        : "Пункт исчезнет из бланка и из печати. Восстановить нельзя.",
      variant: "danger",
      confirmLabel: "Удалить",
    });
    if (!confirmed) return;
    const newConfig = {
      ...config,
      items: config.items.filter((entry) => entry.id !== itemId),
    };
    saveConfig(newConfig);
    purgeMarksForItems(newConfig.items);
  }

  function handleSaveZones(zones: SdcZone[]) {
    const zoneIds = new Set(zones.map((z) => z.id));
    const newConfig = {
      ...config,
      zones,
      items: config.items.filter((item) => zoneIds.has(item.zoneId)),
    };
    saveConfig(newConfig);
    // Вместе с зоной исчезают её пункты — их отметки тоже.
    purgeMarksForItems(newConfig.items);
  }

  function openEditItem(item: SdcItem) {
    setEditingItem(item);
    setEditItemOpen(true);
  }

  return (
    <div className="bg-white text-black">
      <FocusTodayScroller selector="[data-focus-today]" emptyTitle="Записей пока нет" emptyBody="Нажмите «Добавить» в таблице ниже, чтобы создать запись." />
      {/* A1: чек-лист санитарного дня — единственный ВЕРТИКАЛЬНЫЙ бланк
          среди журналов. Маркер переопределяет альбомный @page страницы
          документа на именованный @page journal-portrait. */}
      <span data-journal-print-root="portrait" hidden aria-hidden="true" />
      <style jsx global>{`

        @media print {
          html,
          body {
            background: #ffffff !important;
          }

          body {
            margin: 0;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }

          .screen-only {
            display: none !important;
          }

          .sdc-sheet {
            width: 100%;
            max-width: none !important;
            padding: 0 !important;
            margin: 0 !important;
          }

          .sdc-table th,
          .sdc-table td {
            font-size: 10px !important;
            line-height: 1.2 !important;
            padding: 4px 3px !important;
          }
        }
      `}</style>

      <div className="sdc-sheet max-w-[960px] py-4 sm:py-6">
        <JournalDocumentShell
          title={title || getSanitaryDayChecklistTitle(routeCode)}
          documentId={documentId}
          backHref={`/journals/${routeCode}`}
          onSettings={isActive ? () => setSettingsOpen(true) : undefined}
          menuItems={
            isActive
              ? [
                  {
                    key: "edit-zones",
                    label: "Редактировать списки",
                    icon: <Pencil className="size-4" />,
                    onSelect: () => setEditZonesOpen(true),
                  },
                ]
              : []
          }
          undo={
            isActive
              ? {
                  canUndo: undoStack.canUndo,
                  canRedo: undoStack.canRedo,
                  onUndo: () => void undoStack.undo(),
                  onRedo: () => void undoStack.redo(),
                  undoCount: undoStack.undoCount,
                }
              : undefined
          }
          beforeToggle={
            <div className="mb-6 flex items-center gap-3 text-[18px]">
              <span className="font-semibold uppercase">Дата проведения</span>
              <span>{formatRuDate(entryDate)}</span>
            </div>
          }
          mobileView={mobileView}
          onMobileView={switchMobileView}
          cards={
            <div className="space-y-4">
              {zoneGroups.map(({ zone, items }, zoneIndex) => (
                <div
                  key={zone.id}
                  className="overflow-hidden rounded-2xl border border-[#ececf4] bg-white"
                >
                  <div className="flex items-center justify-between gap-3 border-b border-[#ececf4] bg-[#fafbff] px-4 py-3">
                    <span className="text-[14px] font-semibold uppercase tracking-[0.08em] text-[#0b1024]">
                      {zoneIndex + 1}. {zone.name}
                    </span>
                    <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-[#6f7282]">
                      {items.filter((it) => checked.has(it.id)).length}/{items.length}
                    </span>
                  </div>
                  <ul className="divide-y divide-[#ececf4]">
                    {items.map((item) => {
                      const isChecked = checked.has(item.id);
                      const time = marks[item.id];
                      return (
                        <li key={item.id} className="flex items-start gap-3 px-4 py-3">
                          <button
                            type="button"
                            disabled={!isActive}
                            onClick={() => handleToggleCheck(item.id)}
                            className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md border transition-colors disabled:opacity-60 ${
                              isChecked
                                ? "border-[#5566f6] bg-[#5566f6] text-white"
                                : "border-[#dcdfed] bg-white"
                            }`}
                            aria-label={isChecked ? "Снять отметку" : "Отметить выполненным"}
                          >
                            {isChecked ? "✓" : ""}
                          </button>
                          <div className="min-w-0 flex-1">
                            <button
                              type="button"
                              disabled={!isActive}
                              onClick={() => openEditItem(item)}
                              className="text-left text-[14px] text-[#0b1024] hover:text-[#5566f6] disabled:cursor-default disabled:text-[#0b1024]"
                            >
                              {item.text}
                            </button>
                            {/* Время печатается в бланк, но в карточках его
                                показывали текстом — с телефона проставить
                                отметку было нечем. */}
                            <div className="mt-1 flex items-center gap-2 text-[12px] text-[#6f7282]">
                              <span>Отметка времени:</span>
                              <TimeCell
                                value={time || ""}
                                onChange={(value) => handleTimeChange(item.id, value)}
                                disabled={!isActive}
                              />
                            </div>
                          </div>
                        </li>
                      );
                    })}
                    {items.length === 0 ? (
                      <li className="px-4 py-4 text-center text-[13px] text-[#9b9fb3]">
                        В зоне пока нет пунктов.
                      </li>
                    ) : null}
                  </ul>
                </div>
              ))}
            </div>
          }
          paperHeader={
            <JournalDocumentHeader
              orgName={organizationLabel}
              title="ЧЕК-ЛИСТ (ПАМЯТКА) ПРОВЕДЕНИЯ САНИТАРНОГО ДНЯ"
              startedAt={dateFrom}
              finishedAt={null}
            />
          }
          sheetMinWidth={1100}
          toolbar={
            isActive ? (
              <Button
                type="button"
                onClick={() => setAddItemOpen(true)}
                className={DOC_PRIMARY_BUTTON_CLASS}
              >
                <Plus className="mr-2 size-5" />
                Добавить
              </Button>
            ) : undefined
          }
          extra={
            <div className="mt-10 space-y-6 text-[16px]">
              <div className="flex items-end justify-between">
                <span className="font-semibold uppercase">Выполнил:</span>
                <span className="min-w-[200px] border-b border-black text-right">
                  {resolveSdcSignerName(
                    config.responsibleUserId,
                    config.responsibleName,
                    users
                  )}
                </span>
              </div>
              <div className="flex items-end justify-between">
                <span className="font-semibold uppercase">Проверил:</span>
                <span className="min-w-[200px] border-b border-black text-right">
                  {resolveSdcSignerName(
                    config.checkerUserId,
                    config.checkerName,
                    users
                  )}
                </span>
              </div>
            </div>
          }
        >
          {/* ─── Checklist Table ─── */}
          <table className="sdc-table w-full border-collapse text-[13px]">
            <thead>
              <tr>
                <th className={`w-[48px] ${GRID_HEAD_CELL_CLASS} px-2 py-1.5 text-center font-semibold leading-tight`}>
                  <span className="screen-only">✓</span>
                </th>
                <th className={`w-[72px] ${GRID_HEAD_CELL_CLASS} px-2 py-1.5 text-center font-semibold leading-tight`}>
                  № п/п
                </th>
                <th className={`${GRID_HEAD_CELL_CLASS} px-2 py-1.5 text-center font-semibold leading-tight`}>
                  Действия
                </th>
                <th className={`w-[130px] ${GRID_HEAD_CELL_CLASS} px-2 py-1.5 text-center font-semibold leading-tight`}>
                  Отметка времени
                </th>
              </tr>
            </thead>
            <tbody>
              {zoneGroups.map(({ zone, zoneIndex, items }) => (
                <ZoneBlock
                  key={zone.id}
                  zone={zone}
                  zoneIndex={zoneIndex}
                  items={items}
                  config={config}
                  marks={marks}
                  checked={checked}
                  showPrinciples={zoneIndex === 0}
                  generalPrinciples={config.generalPrinciples}
                  isActive={isActive}
                  onToggleCheck={handleToggleCheck}
                  onTimeChange={handleTimeChange}
                  onEditItem={openEditItem}
                  onDeleteItem={handleDeleteItem}
                />
              ))}

              {isActive ? (
                <JournalAddRow
                  // Галочка + № п/п — leading, «Действия» (широкая колонка)
                  // — под подпись, «Отметка времени» остаётся пустой
                  // ячейкой справа.
                  leading={2}
                  labelSpan={1}
                  trailing={1}
                  label="Добавить"
                  onClick={() => setAddItemOpen(true)}
                />
              ) : null}

              {/* Пустая строка для отступа — раньше висела на экране как
                  ещё одна (нерабочая) строка таблицы. Теперь единственная
                  пустая строка на экране — кликабельная JournalAddRow
                  выше, а эта остаётся только для печати. */}
              <tr className="hidden print:table-row">
                <td className={`${GRID_CELL_CLASS} px-2 py-1 leading-tight`} />
                <td className={`${GRID_CELL_CLASS} px-2 py-1 leading-tight`} />
                <td className={`${GRID_CELL_CLASS} px-2 py-1 leading-tight`} />
                <td className={`${GRID_CELL_CLASS} px-2 py-1 leading-tight`} />
              </tr>
            </tbody>
          </table>
        </JournalDocumentShell>
      </div>

      {/* ─── Dialogs ─── */}
      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        documentId={documentId}
        title={documentTitle}
        dateFrom={entryDate}
        users={users}
        config={config}
        onSaved={(nextConfig) => {
          setConfig(nextConfig);
          router.refresh();
        }}
        useV2={useV2}
      />
      {addItemOpen && (
        <AddItemDialog
          key={`add-item-${config.zones[0]?.id || "empty"}`}
          open={addItemOpen}
          onOpenChange={setAddItemOpen}
          zones={config.zones}
          onAdd={handleAddItem}
        />
      )}
      {editItemOpen && (
        <EditItemDialog
          key={`edit-item-${editingItem?.id || "empty"}`}
          open={editItemOpen}
          onOpenChange={setEditItemOpen}
          zones={config.zones}
          item={editingItem}
          onSave={handleEditItem}
        />
      )}
      {editZonesOpen && (
        <EditZonesDialog
          key={`edit-zones-${config.zones.map((zone) => zone.id).join("-")}`}
          open={editZonesOpen}
          onOpenChange={setEditZonesOpen}
          zones={config.zones}
          onSave={handleSaveZones}
        />
      )}
    </div>
  );
}

/* ─── Zone Block ─── */

function ZoneBlock({
  zone,
  zoneIndex,
  items,
  config,
  marks,
  checked,
  showPrinciples,
  generalPrinciples,
  isActive,
  onToggleCheck,
  onTimeChange,
  onEditItem,
  onDeleteItem,
}: {
  zone: SdcZone;
  zoneIndex: number;
  items: SdcItem[];
  config: SdcConfig;
  marks: Record<string, string>;
  checked: Set<string>;
  showPrinciples: boolean;
  generalPrinciples: string[];
  isActive: boolean;
  onToggleCheck: (id: string) => void;
  onTimeChange: (id: string, time: string) => void;
  onEditItem: (item: SdcItem) => void;
  onDeleteItem: (id: string) => void;
}) {
  return (
    <>
      {/* Zone header */}
      <tr className="bg-[#e8e8e8]">
        <td colSpan={4} className={`${GRID_CELL_CLASS} px-2 py-1 text-center leading-tight`}>
          <span className="text-[16px] font-bold uppercase">
            {zoneIndex + 1} {zone.name.toUpperCase()}
          </span>
        </td>
      </tr>

      {/* General principles (only after first zone header) */}
      {showPrinciples && generalPrinciples.length > 0 && (
        <tr>
          <td colSpan={4} className={`${GRID_CELL_CLASS} px-2 py-1 leading-tight`}>
            <div className="text-[14px] font-semibold uppercase">
              Общие принципы
            </div>
            <ul className="mt-1 list-disc pl-5 text-[14px] leading-relaxed text-[#333]">
              {generalPrinciples.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
          </td>
        </tr>
      )}

      {/* Items */}
      {items.map((item) => {
        const itemNumber = getItemNumber(config, item);
        const isChecked = checked.has(item.id);
        const timeValue = marks[item.id] || "";

        return (
          <tr
            key={item.id}
            className={isChecked ? "bg-[#f0fff0]" : "hover:bg-[#fafbff]"}
          >
            {/* Checkbox */}
            <td className={`${GRID_CELL_CLASS} px-2 py-1 text-center leading-tight`}>
              {isActive && (
                <Checkbox
                  checked={isChecked}
                  onCheckedChange={() => onToggleCheck(item.id)}
                  className="size-5 rounded border-[#dfe1ec] data-[state=checked]:border-[#5566f6] data-[state=checked]:bg-[#5566f6]"
                />
              )}
            </td>

            {/* Number */}
            <td className={`${GRID_CELL_CLASS} px-2 py-1 text-center text-[14px] leading-tight`}>
              {itemNumber}
            </td>

            {/* Description */}
            <td
              className={`${GRID_CELL_CLASS} px-2 py-1 leading-tight ${isActive ? "cursor-pointer hover:bg-[#f5f6ff]" : ""}`}
              onClick={() => isActive && onEditItem(item)}
            >
              <div className="group flex items-start gap-2">
                <div className="flex-1 whitespace-pre-line text-[14px] leading-relaxed">
                  {item.text}
                </div>
                {isActive && (
                  <div
                    className="screen-only flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <button
                      type="button"
                      className="rounded p-1 text-[#6f7282] hover:bg-[#f3f4fb] hover:text-[#5566f6]"
                      onClick={() => onEditItem(item)}
                    >
                      <Pencil className="size-4" />
                    </button>
                    <button
                      type="button"
                      className="rounded p-1 text-[#6f7282] hover:bg-[#fff0f0] hover:text-[#ff3b30]"
                      onClick={() => onDeleteItem(item.id)}
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                )}
              </div>
            </td>

            {/* Time */}
            <td className={`${GRID_CELL_CLASS} px-2 py-1 text-center leading-tight`}>
              <TimeCell
                value={timeValue}
                onChange={(v) => onTimeChange(item.id, v)}
                disabled={!isActive}
              />
            </td>
          </tr>
        );
      })}
    </>
  );
}
