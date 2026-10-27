"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { roomKindOptions } from "@/lib/room-kinds";
import type { Locale } from "@/i18n/locales";
import { useRouter } from "next/navigation";
import { ArrowRight, Building2, Check, Copy, MapPin, Pencil, Plus, Trash2, Users, X } from "lucide-react";
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
  /** "office" — офис организации (2026-10-26), иначе торговая точка. */
  kind?: string;
  sortOrder: number;
  rooms: Room[];
};

/** Помещение точки со всем, что нужно окну помещения (обзор и страница точки). */
export type BuildingRoom = Room;

/** Карточка помещения → начальные значения окна помещения (`RoomEditorDialog`). */
export function roomEditorInitial(room: Room): RoomEditorInitial {
  return {
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
  };
}

export function BuildingsClient({
  initial,
  users,
  perLocationJournals = false,
  readOnly = false,
  unnamedCount = 0,
  userBuildingIds = {},
  openableIds = [],
  pointManager = false,
}: {
  initial: Building[];
  /**
   * Руководитель точки (фаза 2 «Офис и точки»): видит свои точки, а
   * заводить, удалять точки и включать деление по точкам — дело офиса.
   */
  pointManager?: boolean;
  users: RoomResponsibleUser[];
  /** Точки, чью страницу человек откроет (`listPersonBuildings`), — у них «Открыть точку». */
  openableIds?: string[];
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
  const tPoint = useTranslations("navigation.shell.point");
  const t = useTranslations("settingsUi.buildingsClient");
  const [, startTransition] = useTransition();
  const [flagPending, setFlagPending] = useState(false);
  const [editorRoom, setEditorRoom] = useState<RoomEditorInitial | null>(null);
  const openable = new Set(openableIds);
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
    setEditorRoom(roomEditorInitial(room));
  }

  // Тумблер «Вести журналы отдельно по точкам» — единственный переключатель
  // режима точек: после включения в шапке появляется выбор точки, а ночное
  // автосоздание делает документ на каждую.
  async function togglePerLocation(next: boolean) {
    if (next) {
      // Включение меняло режим молча, и управляющая не понимала, куда
      // делись прежние документы (никуда — они общие и видны везде).
      const ok = await confirmAsync({
        title: t("enableTitle"),
        description: t("enableDescription"),
        bullets: [
          {
            label: t("enableBullet1"),
            tone: "info",
          },
          {
            label: t("enableBullet2"),
            tone: "info",
          },
          {
            label: t("enableBullet3"),
            tone: "default",
          },
        ],
        variant: "warn",
        confirmLabel: t("enable"),
      });
      if (!ok) return;
    }
    if (!next) {
      const ok = await confirmAsync({
        title: t("disableTitle"),
        description: t("disableDescription"),
        variant: "warn",
        confirmLabel: t("disable"),
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
      if (!res.ok) throw new Error(data?.error ?? t("saveFailed"));
      toast.success(
        next ? t("perPointOn") : t("perPointOff"),
      );
      refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("error"));
    } finally {
      setFlagPending(false);
    }
  }

  async function deleteBuilding(id: string, name: string) {
    const ok = await confirmAsync({
      title: t("deletePointTitle"),
      description: t("deletePointDescription", { name }),
      variant: "danger",
      confirmLabel: t("deletePointConfirm"),
    });
    if (!ok) return;
    const res = await fetch(`/api/settings/buildings/${id}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error(t("deleteFailed"));
      return;
    }
    toast.success(t("pointDeleted"));
    refresh();
  }

  return (
    <div className="space-y-5">
      {initial.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-6 py-14 text-center">
          <Building2 className="mx-auto mb-3 size-8 text-[#9b9fb3]" />
          <div className="text-[15px] font-medium text-[#0b1024]">
            {t("noPoints")}
          </div>
          <p className="mx-auto mt-1.5 max-w-[400px] text-[13px] text-[#6f7282]">
            {t("noPointsHint")}
          </p>
        </div>
      ) : null}

      {initial.length >= 2 && !pointManager ? (
        <div className="flex items-start justify-between gap-4 rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[14px] font-semibold text-[#0b1024]">
              <MapPin className="size-4 text-[#5566f6]" />
              {t("perPointTitle")}
            </div>
            <p className="mt-1 text-[13px] leading-[1.55] text-[#6f7282]">
              {perLocationJournals
                ? t("perPointOnHint")
                : t("perPointOffHint")}
            </p>
          </div>
          <Switch
            checked={perLocationJournals}
            disabled={flagPending || readOnly}
            title={readOnly ? t("readOnlyHint") : undefined}
            onCheckedChange={(next) => void togglePerLocation(next)}
            aria-label={t("perPointTitle")}
          />
        </div>
      ) : null}

      {perLocationJournals && unnamedCount > 0 && !readOnly ? (
        <div className="flex items-start gap-3 rounded-2xl border border-[#ffe1b5] bg-[#fff8ec] px-4 py-3 text-[13px] leading-snug text-[#8a5a12]">
          <Pencil className="mt-0.5 size-4 shrink-0" />
          <span>
            {t("unnamedHint", { count: unnamedCount })}
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
          onDelete={pointManager ? null : () => deleteBuilding(b.id, b.name)}
          onEditRoom={openEditor}
          openHref={openable.has(b.id) ? `/settings/buildings/${b.id}` : null}
          openLabel={tPoint("open")}
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

      {/* Новая точка — мастером (название и адрес, помещения, оборудование). */}
      {readOnly || pointManager ? null : (
        <Link
          href="/settings/buildings/new"
          data-add-point
          className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl border border-dashed border-[#dcdfed] bg-white px-5 text-[14px] font-medium text-[#3c4053] transition-colors duration-150 hover:border-[#5566f6]/50 hover:bg-[#f5f6ff] hover:text-[#5566f6] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
        >
          <Plus className="size-4" />
          {tPoint("add")}
        </Link>
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
  openHref = null,
  openLabel,
}: {
  /** Страница точки (блоки 1–5); null — точка человеку недоступна. */
  openHref?: string | null;
  openLabel: string;
  building: Building;
  userNameById: Map<string, string>;
  readOnly?: boolean;
  perLocationJournals?: boolean;
  users: RoomResponsibleUser[];
  userBuildingIds: Record<string, string[]>;
  /** Другие точки с помещениями — откуда можно скопировать справочник. */
  donors: Array<{ id: string; name: string; roomsCount: number }>;
  onRefresh: () => void;
  /** null — удалять точку нельзя (руководитель точки). */
  onDelete: (() => void) | null;
  onEditRoom: (room: Room) => void;
}) {
  const t = useTranslations("settingsUi.buildingsClient");
  const locale = useLocale();
  const kindLabels = useMemo<Record<string, string>>(
    () =>
      Object.fromEntries(
        roomKindOptions(locale as Locale).map((option) => [option.value, option.label]),
      ),
    [locale],
  );
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
      if (!res.ok) throw new Error(d?.error ?? t("saveFailed"));
      toast.success(d.changed ? t("staffUpdated", { count: d.changed }) : t("noChanges"));
      setEditingStaff(false);
      onRefresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("error"));
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
      toast.error(t("enterName"));
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
      if (!res.ok) throw new Error(d?.error ?? t("saveFailed"));
      toast.success(t("pointUpdated"));
      setEditing(false);
      onRefresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("error"));
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
      if (!res.ok) throw new Error(d?.error ?? t("copyFailed"));
      toast.success(t("roomsCopied", { count: d.copied ?? 0 }));
      onRefresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("error"));
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
      toast.error(d?.error ?? t("addFailed"));
      return;
    }
    const created = (await res.json().catch(() => ({}))) as { room?: Room };
    setRoomName("");
    setRoomKind("other");
    setAddingRoom(false);
    toast.success(t("roomAdded"));
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
      title: t("deleteRoomTitle"),
      description: t("deleteRoomDescription", { name }),
      bullets,
      variant: "danger",
      confirmLabel: t("deleteRoomConfirm"),
    });
    if (!ok) return;
    const res = await fetch(`/api/settings/rooms/${id}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error(t("deleteFailed"));
      return;
    }
    toast.success(t("roomDeleted"));
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
              aria-label={t("pointNameLabel")}
              autoFocus
              className="h-10 w-full rounded-xl border border-[#dcdfed] px-3 text-[15px] font-semibold text-[#0b1024] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
            />
            <input
              type="text"
              value={draftAddress}
              onChange={(e) => setDraftAddress(e.target.value)}
              placeholder={t("addressPlaceholder")}
              aria-label={t("addressLabel")}
              className="h-10 w-full rounded-xl border border-[#dcdfed] px-3 text-[14px] text-[#0b1024] placeholder:text-[#9b9fb3] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
            />
            <div className="space-y-1">
              <input
                type="text"
                value={draftJournalName}
                maxLength={200}
                onChange={(e) => setDraftJournalName(e.target.value)}
                placeholder={t("journalNamePlaceholder")}
                aria-label={t("journalNameLabel")}
                className="h-10 w-full rounded-xl border border-[#dcdfed] px-3 text-[14px] text-[#0b1024] placeholder:text-[#9b9fb3] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
              />
              <p className="px-1 text-[12px] leading-[1.45] text-[#6f7282]">
                {t("journalNameHint")}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="text"
                inputMode="numeric"
                value={draftKpp}
                onChange={(e) => setDraftKpp(e.target.value)}
                placeholder={t("kppLabel")}
                aria-label={t("kppLabel")}
                className="h-10 w-full rounded-xl border border-[#dcdfed] px-3 text-[14px] text-[#0b1024] placeholder:text-[#9b9fb3] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
              />
              <input
                type="tel"
                value={draftPhone}
                onChange={(e) => setDraftPhone(e.target.value)}
                placeholder={t("phoneLabel")}
                aria-label={t("phoneLabel")}
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
                {t("save")}
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
                {t("cancel")}
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
              {building.kind === "office" ? (
                <span className="rounded-full bg-[#f5f6ff] px-2.5 py-1 text-[12px] font-medium text-[#3848c7]" data-building-office>
                  {t("officeBadge")}
                </span>
              ) : null}
            </div>
            {building.address ? (
              <div className="mt-0.5 text-[13px] text-[#6f7282]">{building.address}</div>
            ) : (
              <div className="mt-0.5 text-[13px] text-[#9b9fb3]">{t("noAddress")}</div>
            )}
            {building.journalName ? (
              <div className="mt-0.5 text-[12px] text-[#6f7282]">
                {t.rich("journalHeader", {
                  name: building.journalName,
                  span: (chunks) => <span className="text-[#3848c7]">{chunks}</span>,
                })}
              </div>
            ) : null}
            {building.kpp || building.phone ? (
              <div className="mt-0.5 text-[12px] text-[#9b9fb3]">
                {[building.kpp ? t("kppValue", { kpp: building.kpp }) : null, building.phone ? t("phoneValue", { phone: building.phone }) : null]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
            ) : null}
            {openHref ? (
              <Link
                href={openHref}
                data-open-point={building.id}
                className="mt-2 inline-flex items-center gap-1 rounded-lg text-[13.5px] font-medium text-[#3848c7] transition-colors duration-150 hover:text-[#5566f6] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
              >
                {openLabel}
                <ArrowRight className="size-4" />
              </Link>
            ) : null}
          </div>
        )}
        {!readOnly && !editing ? (
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => setEditing(true)}
              aria-label={t("renameLabel")}
              title={t("renameTitle")}
              className="rounded-full p-1.5 text-[#9b9fb3] hover:bg-[#f5f6ff] hover:text-[#5566f6]"
            >
              <Pencil className="size-4" />
            </button>
            {onDelete ? (
              <button
                type="button"
                onClick={onDelete}
                aria-label={t("deletePointConfirm")}
                className="rounded-full p-1.5 text-[#9b9fb3] hover:bg-[#fff4f2] hover:text-[#d2453d]"
              >
                <Trash2 className="size-4" />
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {perLocationJournals ? (
        <div className="mb-3 rounded-2xl border border-[#ececf4] bg-[#fafbff] px-3.5 py-2.5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
            <span className="inline-flex items-center gap-1.5 font-medium text-[#0b1024]">
              <Users className="size-4 text-[#5566f6]" />
              {t("pointStaff")}
            </span>
            <span className="text-[#6f7282]">
              {t.rich("staffHere", {
                count: staffHere.length,
                b: (chunks) => <b className="font-semibold text-[#0b1024] tabular-nums">{chunks}</b>,
              })}
              {staffEverywhere.length > 0 ? (
                <>
                  {" "}
                  {t.rich("staffEverywhere", {
                    count: staffEverywhere.length,
                    b: (chunks) => <b className="font-semibold text-[#0b1024] tabular-nums">{chunks}</b>,
                  })}
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
                {editingStaff ? t("hide") : t("change")}
              </button>
            ) : null}
          </div>
          {!editingStaff && staffHere.length > 0 ? (
            <div className="mt-1 truncate text-[12px] text-[#6f7282]">
              {staffHere.slice(0, 6).map((u) => u.name).join(", ")}
              {staffHere.length > 6 ? ` ${t("andMore", { count: staffHere.length - 6 })}` : ""}
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
                        <span className="shrink-0 text-[11px] text-[#9b9fb3]">{t("everywhere")}</span>
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
                  {t("save")}
                </button>
                <span className="text-[11px] leading-snug text-[#6f7282]">
                  {t("everywhereHint")}
                </span>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="space-y-1.5">
        {building.rooms.length === 0 && !addingRoom ? (
          <div className="rounded-2xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-4 py-3 text-center text-[13px] text-[#6f7282]">
            {t("noRooms")}
            {!readOnly && donors.length > 0 ? (
              <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
                <span className="text-[#3c4053]">{t("orCopyFrom")}</span>
                <select
                  value={donorId}
                  onChange={(e) => setDonorId(e.target.value)}
                  aria-label={t("copyFromLabel")}
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
                  {copying ? t("copying") : t("copy")}
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
                    {kindLabels[room.kind] ?? room.kind}
                  </span>
                  {hasCleaningCfg ? (
                    <span
                      className="rounded-full bg-[#ecfdf5] px-2 py-0.5 text-[11px] text-[#136b2a]"
                      title={t("cleaningSteps", { current: currentLen, general: generalLen })}
                    >
                      🧽 {t("cleaningConfigured", { current: currentLen, general: generalLen })}
                    </span>
                  ) : (
                    <span className="rounded-full bg-[#fff8eb] px-2 py-0.5 text-[11px] text-[#a16d32]">
                      {t("cleaningNotConfigured")}
                    </span>
                  )}
                </div>
                {/* Кто убирает / кто проверяет — видно без открытия карточки. */}
                <div className="flex flex-wrap items-center gap-1.5 text-[11.5px]">
                  {cleanerNames.length > 0 ? (
                    <span className="rounded-full bg-[#f5f6ff] px-2 py-0.5 text-[#3848c7]">
                      {t("cleaners", { names: cleanerNames.join(", ") })}
                    </span>
                  ) : (
                    <span className="rounded-full bg-white px-2 py-0.5 text-[#9b9fb3] ring-1 ring-inset ring-[#ececf4]">
                      {t("noCleaners")}
                    </span>
                  )}
                  {verifierNames.length > 0 ? (
                    <span className="rounded-full bg-[#f5f6ff] px-2 py-0.5 text-[#3848c7]">
                      {t("verifiers", { names: verifierNames.join(", ") })}
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => onEditRoom(room)}
                  aria-label={t("configureCleaning")}
                  className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[12px] font-medium text-[#3848c7] transition-colors hover:bg-white"
                >
                  <Pencil className="size-3.5" />
                  {t("configure")}
                </button>
                <button
                  type="button"
                  onClick={() => deleteRoom(room.id, room.name)}
                  aria-label={t("deleteRoomConfirm")}
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
              placeholder={t("roomNamePlaceholder")}
              value={roomName}
              onChange={(e) => setRoomName(e.target.value)}
              className="h-10 flex-1 rounded-xl border border-[#dcdfed] px-3 text-[13.5px] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
            />
            <select
              value={roomKind}
              onChange={(e) => setRoomKind(e.target.value)}
              className="h-10 rounded-xl border border-[#dcdfed] bg-white px-3 text-[13.5px] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
            >
              {Object.entries(kindLabels).map(([k, v]) => (
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
              {t("add")}
            </button>
            <button
              type="button"
              onClick={() => {
                setAddingRoom(false);
                setRoomName("");
              }}
              className="inline-flex h-9 items-center rounded-xl px-3 text-[13px] text-[#6f7282] hover:bg-[#f5f6ff] hover:text-[#0b1024]"
            >
              {t("cancel")}
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
          {t("addRoom")}
        </button>
      )}
    </div>
  );
}
