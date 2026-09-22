"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Building2, Check, Copy, MapPin, Pencil, Plus, Trash2, Users, X } from "lucide-react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { confirmAsync } from "@/components/ui/confirm-async";
import {
  RoomEditorDialog,
  type RoomEditorInitial,
} from "@/components/cleaning/room-editor-dialog";
import {
  countRoomsPerUser,
  toUserIdList,
} from "@/lib/cleaning-room-responsibles";
import type { RoomResponsibleUser } from "@/lib/room-responsible-candidates";

// Cleaning unification 2026-05-08: Room теперь хранит scope/days/detergent.
// RoomEditorDialog позволяет редактировать всё это в /settings/buildings.
type Room = {
  id: string;
  name: string;
  kind: string;
  sortOrder: number;
  // 2026-09-04: кто убирает / кто проверяет.
  cleanerUserIds?: string[];
  fillerUserIds?: string[];
  verifierUserIds?: string[];
  detergent?: string | null;
  currentScope?: unknown;
  generalScope?: unknown;
  currentDays?: number;
  generalDays?: number;
  currentScheduleType?: string;
  generalScheduleType?: string;
  currentMonthDays?: unknown;
  generalMonthDays?: unknown;
  requirePhoto?: boolean;
};
type Building = {
  id: string;
  name: string;
  address: string | null;
  /** Точки: реквизиты для шапки PDF. */
  kpp?: string | null;
  phone?: string | null;
  /** Наименование в шапке журналов; в интерфейсе — короткое `name`. */
  journalName?: string | null;
  sortOrder: number;
  rooms: Room[];
};

const KIND_LABELS: Record<string, string> = {
  guest: "Гостевая зона",
  kitchen: "Кухня / горячий цех",
  wash: "Мойка",
  bar: "Бар",
  storage: "Склад",
  other: "Другое",
};

export function BuildingsClient({
  initial,
  users,
  perLocationJournals = false,
  readOnly = false,
  unnamedCount = 0,
  userBuildingIds = {},
}: {
  initial: Building[];
  users: RoomResponsibleUser[];
  /** Точки: id точек каждого сотрудника (пусто — работает везде). */
  userBuildingIds?: Record<string, string[]>;
  /** Точки (2026-09-05): документы журналов ведутся отдельно по зданиям. */
  perLocationJournals?: boolean;
  /** Консультант уровня «просмотр»: всё видно, ничего не меняется. */
  readOnly?: boolean;
  /** Сколько точек ещё называются «Точка N» — подсказать переименовать. */
  unnamedCount?: number;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);
  const [flagPending, setFlagPending] = useState(false);
  const [newName, setNewName] = useState("");
  const [newAddr, setNewAddr] = useState("");
  const [editorRoom, setEditorRoom] = useState<RoomEditorInitial | null>(null);
  const userNameById = new Map(users.map((u) => [u.id, u.name]));

  // Нагрузка по ДРУГИМ помещениям — подсказка в мультивыборе.
  const otherRooms = initial
    .flatMap((b) => b.rooms)
    .filter((r) => r.id !== editorRoom?.id)
    .map((r) => ({
      id: r.id,
      cleanerUserIds: toUserIdList(r.cleanerUserIds),
      verifierUserIds: toUserIdList(r.verifierUserIds),
    }));
  const roomsPerCleaner = countRoomsPerUser(otherRooms, "cleaner");
  const roomsPerVerifier = countRoomsPerUser(otherRooms, "verifier");

  function refresh() {
    startTransition(() => router.refresh());
  }

  function openEditor(room: Room) {
    setEditorRoom({
      id: room.id,
      name: room.name,
      kind: room.kind,
      cleanerUserIds: toUserIdList(room.cleanerUserIds),
      verifierUserIds: toUserIdList(room.verifierUserIds),
      fillerUserIds: toUserIdList(room.fillerUserIds),
      detergent: room.detergent ?? "",
      // Передаём scope как-есть — RoomEditorDialog.parseScopeSteps
      // нормализует и legacy string[] и новый ScopeStep[] (с per-step
      // requirePhoto). Раньше фильтровали по typeof === "string" → новые
      // объект-шаги дропались, и юзер видел пустой pipeline после
      // первого save (баг сообщён 2026-05-10).
      currentScope: Array.isArray(room.currentScope)
        ? (room.currentScope as Array<string | { label: string; requirePhoto?: boolean }>).filter(
            (s) =>
              typeof s === "string" ||
              (s && typeof s === "object" && typeof (s as { label?: unknown }).label === "string"),
          )
        : [],
      generalScope: Array.isArray(room.generalScope)
        ? (room.generalScope as Array<string | { label: string; requirePhoto?: boolean }>).filter(
            (s) =>
              typeof s === "string" ||
              (s && typeof s === "object" && typeof (s as { label?: unknown }).label === "string"),
          )
        : [],
      currentDays: typeof room.currentDays === "number" ? room.currentDays : 127,
      generalDays: typeof room.generalDays === "number" ? room.generalDays : 0,
      currentScheduleType:
        room.currentScheduleType === "monthly" ? "monthly" : "weekly",
      generalScheduleType:
        room.generalScheduleType === "monthly" ? "monthly" : "weekly",
      currentMonthDays: Array.isArray(room.currentMonthDays)
        ? (room.currentMonthDays as string[]).filter(
            (s) => typeof s === "string",
          )
        : [],
      generalMonthDays: Array.isArray(room.generalMonthDays)
        ? (room.generalMonthDays as string[]).filter(
            (s) => typeof s === "string",
          )
        : [],
      requirePhoto: room.requirePhoto === true,
    });
  }

  async function addBuilding() {
    if (!newName.trim()) return;
    const res = await fetch("/api/settings/buildings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName.trim(), address: newAddr.trim() || null }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      toast.error(d?.error ?? "Не удалось создать");
      return;
    }
    setNewName("");
    setNewAddr("");
    setAdding(false);
    toast.success("Здание создано");
    refresh();
  }

  // Тумблер «Вести журналы отдельно по точкам» — единственный переключатель
  // режима точек: после включения в шапке появляется выбор точки, а ночное
  // автосоздание делает документ на каждую.
  async function togglePerLocation(next: boolean) {
    if (next) {
      // Включение меняло режим молча, и управляющая не понимала, куда
      // делись прежние документы (никуда — они общие и видны везде).
      const ok = await confirmAsync({
        title: "Вести журналы отдельно по точкам?",
        description: "Что произойдёт с тем, что уже заполнено:",
        bullets: [
          {
            label:
              "Уже созданные документы не привязаны к точке — они останутся общими и будут видны на каждой точке",
            tone: "info",
          },
          {
            label:
              "Отдельные документы появятся только у новых: ближайшей ночью автосоздание сделает по документу на каждую точку",
            tone: "info",
          },
          {
            label: "В шапке появится выбор точки — списки журналов станут точечными",
            tone: "default",
          },
        ],
        variant: "warn",
        confirmLabel: "Включить",
      });
      if (!ok) return;
    }
    if (!next) {
      const ok = await confirmAsync({
        title: "Выключить раздельные журналы?",
        description:
          "Документы всех точек будут показываться вместе, а ночное автосоздание вернётся к одному общему документу на журнал. Уже созданные документы точек останутся.",
        variant: "warn",
        confirmLabel: "Выключить",
      });
      if (!ok) return;
    }
    setFlagPending(true);
    try {
      const res = await fetch("/api/settings/buildings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ perLocationJournals: next }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Не удалось сохранить");
      toast.success(
        next
          ? "Журналы ведутся отдельно по точкам — переключатель в шапке"
          : "Журналы снова общие для всех зданий",
      );
      refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ошибка");
    } finally {
      setFlagPending(false);
    }
  }

  async function deleteBuilding(id: string, name: string) {
    const ok = await confirmAsync({
      title: "Удалить точку?",
      description: `Точка «${name}» и её помещения будут удалены. Документы журналов этой точки останутся в организации и станут общими — видимыми на каждой точке.`,
      variant: "danger",
      confirmLabel: "Удалить точку",
    });
    if (!ok) return;
    const res = await fetch(`/api/settings/buildings/${id}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error("Не удалось удалить");
      return;
    }
    toast.success("Точка удалена");
    refresh();
  }

  return (
    <div className="space-y-5">
      {initial.length === 0 && !adding ? (
        <div className="rounded-3xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-6 py-14 text-center">
          <Building2 className="mx-auto mb-3 size-8 text-[#9b9fb3]" />
          <div className="text-[15px] font-medium text-[#0b1024]">
            Пока нет ни одной точки
          </div>
          <p className="mx-auto mt-1.5 max-w-[400px] text-[13px] text-[#6f7282]">
            Заведите первое — например, основную точку или цех. Внутри
            добавите помещения, по которым будут раздаваться задачи уборки.
          </p>
        </div>
      ) : null}

      {initial.length >= 2 ? (
        <div className="flex items-start justify-between gap-4 rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[14px] font-semibold text-[#0b1024]">
              <MapPin className="size-4 text-[#5566f6]" />
              Вести журналы отдельно по точкам
            </div>
            <p className="mt-1 text-[13px] leading-[1.55] text-[#6f7282]">
              {perLocationJournals
                ? "Включено: в шапке есть выбор точки, документы журналов создаются на каждую точку, сотрудники и настройки общие."
                : "Сейчас здания — просто группы помещений, документы общие. Включите, если это разные точки: у каждой будут свои документы, а в шапке появится выбор точки."}
            </p>
          </div>
          <Switch
            checked={perLocationJournals}
            disabled={flagPending || readOnly}
            title={readOnly ? "Изменяет клиент — у консультанта только просмотр" : undefined}
            onCheckedChange={(next) => void togglePerLocation(next)}
            aria-label="Вести журналы отдельно по точкам"
          />
        </div>
      ) : null}

      {perLocationJournals && unnamedCount > 0 && !readOnly ? (
        <div className="flex items-start gap-3 rounded-2xl border border-[#ffe1b5] bg-[#fff8ec] px-4 py-3 text-[13px] leading-snug text-[#8a5a12]">
          <Pencil className="mt-0.5 size-4 shrink-0" />
          <span>
            {unnamedCount === 1 ? "Одна точка ещё называется" : `${unnamedCount} точки ещё называются`}{" "}
            «Точка N». Название и адрес печатаются в шапке журналов и PDF —
            нажмите карандаш у точки и впишите настоящие.
          </span>
        </div>
      ) : null}

      {initial.map((b) => (
        <BuildingCard
          key={b.id}
          building={b}
          userNameById={userNameById}
          readOnly={readOnly}
          perLocationJournals={perLocationJournals}
          users={users}
          userBuildingIds={userBuildingIds}
          donors={initial
            .filter((x) => x.id !== b.id && x.rooms.length > 0)
            .map((x) => ({ id: x.id, name: x.name, roomsCount: x.rooms.length }))}
          onRefresh={refresh}
          onDelete={() => deleteBuilding(b.id, b.name)}
          onEditRoom={openEditor}
        />
      ))}

      <RoomEditorDialog
        open={editorRoom !== null}
        onOpenChange={(o) => {
          if (!o) setEditorRoom(null);
        }}
        initial={editorRoom}
        onSaved={refresh}
        users={users}
        roomsPerCleaner={roomsPerCleaner}
        roomsPerVerifier={roomsPerVerifier}
      />

      {readOnly ? null : adding ? (
        <div className="rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-[14px] font-semibold text-[#0b1024]">Новая точка</div>
            <button
              type="button"
              onClick={() => setAdding(false)}
              className="rounded-full p-1 text-[#9b9fb3] hover:bg-[#fafbff] hover:text-[#0b1024]"
            >
              <X className="size-4" />
            </button>
          </div>
          <input
            type="text"
            placeholder="Название (например, «Основная точка»)"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="mb-2 h-11 w-full rounded-2xl border border-[#dcdfed] px-4 text-[14px] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
          />
          <input
            type="text"
            placeholder="Адрес (необязательно)"
            value={newAddr}
            onChange={(e) => setNewAddr(e.target.value)}
            className="mb-3 h-11 w-full rounded-2xl border border-[#dcdfed] px-4 text-[14px] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
          />
          <button
            type="button"
            onClick={addBuilding}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-[#5566f6] px-5 text-[14px] font-medium text-white hover:bg-[#4a5bf0]"
          >
            Создать
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl border border-dashed border-[#dcdfed] bg-white px-5 text-[14px] font-medium text-[#3c4053] hover:border-[#5566f6]/50 hover:bg-[#f5f6ff] hover:text-[#5566f6]"
        >
          <Plus className="size-4" />
          Добавить точку
        </button>
      )}
    </div>
  );
}

function BuildingCard({
  building,
  userNameById,
  readOnly = false,
  perLocationJournals = false,
  users,
  userBuildingIds,
  donors,
  onRefresh,
  onDelete,
  onEditRoom,
}: {
  building: Building;
  userNameById: Map<string, string>;
  readOnly?: boolean;
  perLocationJournals?: boolean;
  users: RoomResponsibleUser[];
  userBuildingIds: Record<string, string[]>;
  /** Другие точки с помещениями — откуда можно скопировать справочник. */
  donors: Array<{ id: string; name: string; roomsCount: number }>;
  onRefresh: () => void;
  onDelete: () => void;
  onEditRoom: (room: Room) => void;
}) {
  const [addingRoom, setAddingRoom] = useState(false);
  const [roomName, setRoomName] = useState("");
  const [roomKind, setRoomKind] = useState<string>("other");
  // Название и адрес точки правятся на месте: они печатаются в шапке
  // журналов и PDF, и «Точка 1» из анкеты должна стать настоящим адресом.
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(building.name);
  const [draftAddress, setDraftAddress] = useState(building.address ?? "");
  const [draftKpp, setDraftKpp] = useState(building.kpp ?? "");
  const [draftPhone, setDraftPhone] = useState(building.phone ?? "");
  const [draftJournalName, setDraftJournalName] = useState(building.journalName ?? "");
  // Сотрудники точки: кто работает здесь (User.buildingIds содержит точку).
  const staffHere = users.filter((u) => (userBuildingIds[u.id] ?? []).includes(building.id));
  const staffEverywhere = users.filter((u) => (userBuildingIds[u.id] ?? []).length === 0);
  const [editingStaff, setEditingStaff] = useState(false);
  const [staffDraft, setStaffDraft] = useState<Set<string>>(() => new Set(staffHere.map((u) => u.id)));
  const [savingStaff, setSavingStaff] = useState(false);

  async function saveStaff() {
    setSavingStaff(true);
    try {
      const res = await fetch(`/api/settings/buildings/${building.id}/staff`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userIds: Array.from(staffDraft) }),
      });
      const d = (await res.json().catch(() => ({}))) as { changed?: number; error?: string };
      if (!res.ok) throw new Error(d?.error ?? "Не удалось сохранить");
      toast.success(d.changed ? `Обновлено сотрудников: ${d.changed}` : "Без изменений");
      setEditingStaff(false);
      onRefresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ошибка");
    } finally {
      setSavingStaff(false);
    }
  }
  const [savingHead, setSavingHead] = useState(false);
  const [donorId, setDonorId] = useState<string>(donors[0]?.id ?? "");
  const [copying, setCopying] = useState(false);

  async function saveHead() {
    const name = draftName.trim();
    if (!name) {
      toast.error("Введите название точки");
      return;
    }
    setSavingHead(true);
    try {
      const res = await fetch(`/api/settings/buildings/${building.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          address: draftAddress.trim() || null,
          kpp: draftKpp.trim() || null,
          phone: draftPhone.trim() || null,
          journalName: draftJournalName.trim() || null,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d?.error ?? "Не удалось сохранить");
      toast.success("Точка обновлена");
      setEditing(false);
      onRefresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ошибка");
    } finally {
      setSavingHead(false);
    }
  }

  async function copyRooms() {
    if (!donorId) return;
    setCopying(true);
    try {
      const res = await fetch(`/api/settings/buildings/${building.id}/copy-rooms`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromBuildingId: donorId }),
      });
      const d = (await res.json().catch(() => ({}))) as { copied?: number; error?: string };
      if (!res.ok) throw new Error(d?.error ?? "Не удалось скопировать");
      toast.success(`Скопировано помещений: ${d.copied ?? 0}`);
      onRefresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ошибка");
    } finally {
      setCopying(false);
    }
  }

  async function addRoom() {
    if (!roomName.trim()) return;
    const res = await fetch("/api/settings/rooms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        buildingId: building.id,
        name: roomName.trim(),
        kind: roomKind,
      }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      toast.error(d?.error ?? "Не удалось добавить");
      return;
    }
    const created = (await res.json().catch(() => ({}))) as { room?: Room };
    setRoomName("");
    setRoomKind("other");
    setAddingRoom(false);
    toast.success("Помещение добавлено — назначьте, кто убирает");
    onRefresh();
    // «При добавлении»: сразу открываем карточку нового помещения —
    // уборщики, проверяющие и состав уборки настраиваются в одном окне.
    if (created.room?.id) onEditRoom(created.room);
  }

  async function deleteRoom(id: string, name: string) {
    // Спрашиваем сервер, сколько отметок держит помещение: без числа
    // человек не знает, что в журнале уборки пропадёт целая строка.
    let bullets: Array<{ label: string; tone?: "default" | "warn" | "info" }> = [];
    try {
      const usageResponse = await fetch(`/api/settings/rooms/${id}/usage`);
      if (usageResponse.ok) {
        const usage = await usageResponse.json();
        if (Array.isArray(usage?.bullets)) {
          bullets = usage.bullets
            .filter((line: unknown) => typeof line === "string")
            .map((label: string) => ({ label, tone: "warn" as const }));
        }
      }
    } catch {
      /* последствия не показали — подтверждение всё равно спросим */
    }
    const ok = await confirmAsync({
      title: "Удалить помещение?",
      description: `Помещение «${name}» будет удалено безвозвратно.`,
      bullets,
      variant: "danger",
      confirmLabel: "Удалить помещение",
    });
    if (!ok) return;
    const res = await fetch(`/api/settings/rooms/${id}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error("Не удалось удалить");
      return;
    }
    toast.success("Помещение удалено");
    onRefresh();
  }

  return (
    <div className="rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
      <div className="mb-3 flex items-start justify-between gap-3">
        {editing ? (
          <div className="min-w-0 flex-1 space-y-2">
            <input
              type="text"
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              aria-label="Название точки"
              autoFocus
              className="h-10 w-full rounded-xl border border-[#dcdfed] px-3 text-[15px] font-semibold text-[#0b1024] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
            />
            <input
              type="text"
              value={draftAddress}
              onChange={(e) => setDraftAddress(e.target.value)}
              placeholder="Адрес — печатается в шапке журналов"
              aria-label="Адрес точки"
              className="h-10 w-full rounded-xl border border-[#dcdfed] px-3 text-[14px] text-[#0b1024] placeholder:text-[#9b9fb3] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
            />
            <div className="space-y-1">
              <input
                type="text"
                value={draftJournalName}
                maxLength={200}
                onChange={(e) => setDraftJournalName(e.target.value)}
                placeholder="Наименование в шапке журналов — точное юридическое"
                aria-label="Наименование в шапке журналов"
                className="h-10 w-full rounded-xl border border-[#dcdfed] px-3 text-[14px] text-[#0b1024] placeholder:text-[#9b9fb3] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
              />
              <p className="px-1 text-[12px] leading-[1.45] text-[#6f7282]">
                Печатается в шапке журналов и PDF вместо названия и адреса точки. В меню и списках остаётся короткое
                название. Пусто — «название, адрес».
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="text"
                inputMode="numeric"
                value={draftKpp}
                onChange={(e) => setDraftKpp(e.target.value)}
                placeholder="КПП точки"
                aria-label="КПП точки"
                className="h-10 w-full rounded-xl border border-[#dcdfed] px-3 text-[14px] text-[#0b1024] placeholder:text-[#9b9fb3] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
              />
              <input
                type="tel"
                value={draftPhone}
                onChange={(e) => setDraftPhone(e.target.value)}
                placeholder="Телефон точки"
                aria-label="Телефон точки"
                className="h-10 w-full rounded-xl border border-[#dcdfed] px-3 text-[14px] text-[#0b1024] placeholder:text-[#9b9fb3] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
              />
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void saveHead()}
                disabled={savingHead}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[#5566f6] px-3 text-[13px] font-medium text-white hover:bg-[#4a5bf0] disabled:opacity-60"
              >
                <Check className="size-3.5" />
                Сохранить
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditing(false);
                  setDraftName(building.name);
                  setDraftAddress(building.address ?? "");
                  setDraftKpp(building.kpp ?? "");
                  setDraftPhone(building.phone ?? "");
                  setDraftJournalName(building.journalName ?? "");
                }}
                className="inline-flex h-9 items-center rounded-xl px-3 text-[13px] text-[#6f7282] hover:bg-[#f5f6ff] hover:text-[#0b1024]"
              >
                Отмена
              </button>
            </div>
          </div>
        ) : (
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Building2 className="size-4 text-[#5566f6]" />
              <h2 className="text-[18px] font-semibold tracking-[-0.01em] text-[#0b1024]">
                {building.name}
              </h2>
            </div>
            {building.address ? (
              <div className="mt-0.5 text-[13px] text-[#6f7282]">{building.address}</div>
            ) : (
              <div className="mt-0.5 text-[13px] text-[#9b9fb3]">Адрес не указан</div>
            )}
            {building.journalName ? (
              <div className="mt-0.5 text-[12px] text-[#6f7282]">
                В шапке журналов: <span className="text-[#3848c7]">«{building.journalName}»</span>
              </div>
            ) : null}
            {building.kpp || building.phone ? (
              <div className="mt-0.5 text-[12px] text-[#9b9fb3]">
                {[building.kpp ? `КПП ${building.kpp}` : null, building.phone ? `тел. ${building.phone}` : null]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
            ) : null}
          </div>
        )}
        {!readOnly && !editing ? (
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => setEditing(true)}
              aria-label="Переименовать точку и адрес"
              title="Название и адрес"
              className="rounded-full p-1.5 text-[#9b9fb3] hover:bg-[#f5f6ff] hover:text-[#5566f6]"
            >
              <Pencil className="size-4" />
            </button>
            <button
              type="button"
              onClick={onDelete}
              aria-label="Удалить точку"
              className="rounded-full p-1.5 text-[#9b9fb3] hover:bg-[#fff4f2] hover:text-[#d2453d]"
            >
              <Trash2 className="size-4" />
            </button>
          </div>
        ) : null}
      </div>

      {perLocationJournals ? (
        <div className="mb-3 rounded-2xl border border-[#ececf4] bg-[#fafbff] px-3.5 py-2.5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
            <span className="inline-flex items-center gap-1.5 font-medium text-[#0b1024]">
              <Users className="size-4 text-[#5566f6]" />
              Сотрудники точки
            </span>
            <span className="text-[#6f7282]">
              здесь: <b className="font-semibold text-[#0b1024] tabular-nums">{staffHere.length}</b>
              {staffEverywhere.length > 0 ? (
                <>
                  {" "}· везде: <b className="font-semibold text-[#0b1024] tabular-nums">{staffEverywhere.length}</b>
                </>
              ) : null}
            </span>
            {!readOnly ? (
              <button
                type="button"
                onClick={() => {
                  setStaffDraft(new Set(staffHere.map((u) => u.id)));
                  setEditingStaff((v) => !v);
                }}
                className="ml-auto text-[13px] font-medium text-[#5566f6] hover:text-[#4a5bf0]"
              >
                {editingStaff ? "Скрыть" : "Изменить"}
              </button>
            ) : null}
          </div>
          {!editingStaff && staffHere.length > 0 ? (
            <div className="mt-1 truncate text-[12px] text-[#6f7282]">
              {staffHere.slice(0, 6).map((u) => u.name).join(", ")}
              {staffHere.length > 6 ? ` и ещё ${staffHere.length - 6}` : ""}
            </div>
          ) : null}
          {editingStaff ? (
            <div className="mt-2 space-y-2">
              <div className="grid max-h-56 gap-1 overflow-y-auto sm:grid-cols-2">
                {users.map((u) => {
                  const checked = staffDraft.has(u.id);
                  const everywhere = (userBuildingIds[u.id] ?? []).length === 0;
                  return (
                    <label
                      key={u.id}
                      className="flex cursor-pointer items-center gap-2 rounded-xl px-2 py-1.5 text-[13px] text-[#0b1024] hover:bg-white"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => {
                          const next = new Set(staffDraft);
                          if (e.target.checked) next.add(u.id);
                          else next.delete(u.id);
                          setStaffDraft(next);
                        }}
                        className="size-4 rounded border-[#dcdfed] accent-[#5566f6]"
                      />
                      <span className="min-w-0 flex-1 truncate">{u.name}</span>
                      {everywhere && !checked ? (
                        <span className="shrink-0 text-[11px] text-[#9b9fb3]">везде</span>
                      ) : null}
                    </label>
                  );
                })}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void saveStaff()}
                  disabled={savingStaff}
                  className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[#5566f6] px-3 text-[13px] font-medium text-white hover:bg-[#4a5bf0] disabled:opacity-60"
                >
                  <Check className="size-3.5" />
                  Сохранить
                </button>
                <span className="text-[11px] leading-snug text-[#6f7282]">
                  «Везде» — у сотрудника не выбрано ни одной точки. Снять единственную точку — он снова будет получать задачи со всех.
                </span>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="space-y-1.5">
        {building.rooms.length === 0 && !addingRoom ? (
          <div className="rounded-2xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-4 py-3 text-center text-[13px] text-[#6f7282]">
            Помещений пока нет — добавьте, чтобы они появились в журналах
            уборки.
            {!readOnly && donors.length > 0 ? (
              <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
                <span className="text-[#3c4053]">или скопируйте из</span>
                <select
                  value={donorId}
                  onChange={(e) => setDonorId(e.target.value)}
                  aria-label="Точка, откуда скопировать помещения"
                  className="h-9 rounded-xl border border-[#dcdfed] bg-white px-2.5 text-[13px] text-[#0b1024] focus:border-[#5566f6] focus:outline-none"
                >
                  {donors.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} · {d.roomsCount}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => void copyRooms()}
                  disabled={copying}
                  className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-[#dcdfed] bg-white px-3 text-[13px] font-medium text-[#0b1024] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] disabled:opacity-60"
                >
                  <Copy className="size-3.5 text-[#5566f6]" />
                  {copying ? "Копируем…" : "Скопировать"}
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
        {building.rooms.map((room) => {
          const currentLen = Array.isArray(room.currentScope)
            ? (room.currentScope as unknown[]).length
            : 0;
          const generalLen = Array.isArray(room.generalScope)
            ? (room.generalScope as unknown[]).length
            : 0;
          const hasCleaningCfg =
            currentLen + generalLen > 0 ||
            (room.detergent && room.detergent.length > 0);
          const nameOf = (id: string) => userNameById.get(id) ?? "—";
          const cleanerNames = toUserIdList(room.cleanerUserIds).map(nameOf);
          const verifierNames = toUserIdList(room.verifierUserIds).map(nameOf);
          return (
            <div
              key={room.id}
              className="flex items-center justify-between gap-2 rounded-2xl border border-[#ececf4] bg-[#fafbff] px-3 py-2 text-[13.5px]"
            >
              <div className="min-w-0 space-y-1">
                <div className="flex min-w-0 items-center gap-2 flex-wrap">
                  <span className="font-medium text-[#0b1024]">{room.name}</span>
                  <span className="rounded-full bg-[#eef1ff] px-2 py-0.5 text-[11px] text-[#3848c7]">
                    {KIND_LABELS[room.kind] ?? room.kind}
                  </span>
                  {hasCleaningCfg ? (
                    <span
                      className="rounded-full bg-[#ecfdf5] px-2 py-0.5 text-[11px] text-[#136b2a]"
                      title={`Текущая: ${currentLen} шаг(ов), Генеральная: ${generalLen}`}
                    >
                      🧽 Уборка настроена ({currentLen}/{generalLen})
                    </span>
                  ) : (
                    <span className="rounded-full bg-[#fff8eb] px-2 py-0.5 text-[11px] text-[#a16d32]">
                      Уборка не настроена
                    </span>
                  )}
                </div>
                {/* Кто убирает / кто проверяет — видно без открытия карточки. */}
                <div className="flex flex-wrap items-center gap-1.5 text-[11.5px]">
                  {cleanerNames.length > 0 ? (
                    <span className="rounded-full bg-[#f5f6ff] px-2 py-0.5 text-[#3848c7]">
                      Убирает: {cleanerNames.join(", ")}
                    </span>
                  ) : (
                    <span className="rounded-full bg-white px-2 py-0.5 text-[#9b9fb3] ring-1 ring-inset ring-[#ececf4]">
                      Уборщики не назначены
                    </span>
                  )}
                  {verifierNames.length > 0 ? (
                    <span className="rounded-full bg-[#f5f6ff] px-2 py-0.5 text-[#3848c7]">
                      Проверяет: {verifierNames.join(", ")}
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => onEditRoom(room)}
                  aria-label="Настроить уборку"
                  className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[12px] font-medium text-[#3848c7] transition-colors hover:bg-white"
                >
                  <Pencil className="size-3.5" />
                  Настроить
                </button>
                <button
                  type="button"
                  onClick={() => deleteRoom(room.id, room.name)}
                  aria-label="Удалить помещение"
                  className="rounded-full p-1 text-[#9b9fb3] hover:bg-white hover:text-[#d2453d]"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {addingRoom ? (
        <div className="mt-3 rounded-2xl border border-[#dcdfed] bg-white p-3">
          <div className="mb-2 flex gap-2">
            <input
              type="text"
              autoFocus
              placeholder="Название помещения"
              value={roomName}
              onChange={(e) => setRoomName(e.target.value)}
              className="h-10 flex-1 rounded-xl border border-[#dcdfed] px-3 text-[13.5px] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
            />
            <select
              value={roomKind}
              onChange={(e) => setRoomKind(e.target.value)}
              className="h-10 rounded-xl border border-[#dcdfed] bg-white px-3 text-[13.5px] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
            >
              {Object.entries(KIND_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={addRoom}
              className="inline-flex h-9 items-center rounded-xl bg-[#5566f6] px-3 text-[13px] font-medium text-white hover:bg-[#4a5bf0]"
            >
              Добавить
            </button>
            <button
              type="button"
              onClick={() => {
                setAddingRoom(false);
                setRoomName("");
              }}
              className="inline-flex h-9 items-center rounded-xl px-3 text-[13px] text-[#6f7282] hover:bg-[#f5f6ff] hover:text-[#0b1024]"
            >
              Отмена
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAddingRoom(true)}
          className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-xl border border-dashed border-[#dcdfed] px-3 text-[13px] text-[#3c4053] hover:border-[#5566f6]/50 hover:bg-[#f5f6ff] hover:text-[#5566f6]"
        >
          <Plus className="size-3.5" />
          Добавить помещение
        </button>
      )}
    </div>
  );
}
