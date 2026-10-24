"use client";

/**
 * «Добавить помещение из справочника» — общий пикер для журналов
 * (климат, график ген. уборок). Показывает помещения /settings/buildings,
 * которых ещё нет в документе, сгруппированные по зданиям, и даёт
 * создать новое помещение прямо здесь (POST /api/settings/rooms).
 *
 * Единый справочник помещений, 2026-09-04.
 *
 * 2026-09-22: отдельная группа «Цеха без помещения» — цеха из «Цеха и
 * участки» (Area), для которых ещё нет Room с тем же названием. «+»
 * создаёт помещение с названием цеха и дальше идёт по обычному onCreated.
 */
import { useEffect, useMemo, useState } from "react";
import { Building2, Factory, Plus, Search } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { DirectoryBuilding, DirectoryRoom, OrphanArea } from "@/lib/room-directory";
import { guessRoomKind, normalizePlaceName } from "@/lib/orphan-areas";
import { roomKindOptions } from "@/lib/room-kinds";
import type { Locale } from "@/i18n/locales";

export type RoomDirectoryPickerDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  buildings: ReadonlyArray<DirectoryBuilding>;
  /** Помещения, которые уже есть в документе — в списке не показываем. */
  excludeRoomIds: ReadonlyArray<string>;
  /** Выбрано существующее помещение. */
  onPick: (room: DirectoryRoom) => Promise<void> | void;
  /** Создано новое помещение (уже записано в справочник). */
  onCreated: (room: DirectoryRoom) => Promise<void> | void;
  title?: string;
  hint?: string;
};

/** Ответ POST /api/settings/rooms → DirectoryRoom (свежесозданное — пустое). */
function createdToDirectoryRoom(raw: Record<string, unknown>, fallbackName: string, kind: string): DirectoryRoom {
  return {
    id: String(raw.id ?? ""),
    name: typeof raw.name === "string" ? raw.name : fallbackName,
    kind: typeof raw.kind === "string" ? raw.kind : kind,
    detergent: typeof raw.detergent === "string" ? raw.detergent : "",
    currentScope: Array.isArray(raw.currentScope) ? raw.currentScope : [],
    generalScope: Array.isArray(raw.generalScope) ? raw.generalScope : [],
    currentDays: typeof raw.currentDays === "number" ? raw.currentDays : 127,
    generalDays: typeof raw.generalDays === "number" ? raw.generalDays : 0,
    currentScheduleType: raw.currentScheduleType === "monthly" ? "monthly" : "weekly",
    generalScheduleType: raw.generalScheduleType === "monthly" ? "monthly" : "weekly",
    currentMonthDays: [],
    generalMonthDays: [],
    requirePhoto: raw.requirePhoto === true,
    cleanerUserIds: [],
    verifierUserIds: [],
    climateNorms: null,
  };
}

export function RoomDirectoryPickerDialog(props: RoomDirectoryPickerDialogProps) {
  const t = useTranslations("cleaningUi.roomDirectoryPickerDialog");
  const locale = useLocale() as Locale;
  const equipmentLabel = (count: number): string =>
    count <= 0 ? t("areaNoEquipment") : t("areaEquipment", { count });
  // Виды — общий список (`room-kinds.ts`): `guessRoomKind` уже умеет
  // «Основное производство», и подпись должна быть, а не код `production`.
  const KIND_LABELS: Record<string, string> = Object.fromEntries(
    roomKindOptions(locale).map((option) => [option.value, option.label]),
  );
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newKind, setNewKind] = useState("other");
  const [newBuildingId, setNewBuildingId] = useState<string>(
    props.buildings[0]?.id ?? "",
  );
  const [busy, setBusy] = useState(false);

  const excluded = useMemo(() => new Set(props.excludeRoomIds), [props.excludeRoomIds]);
  const q = query.trim().toLowerCase();
  const groups = useMemo(
    () =>
      props.buildings
        .map((b) => ({
          building: b,
          rooms: b.rooms.filter(
            (r) => !excluded.has(r.id) && (!q || r.name.toLowerCase().includes(q)),
          ),
        }))
        .filter((g) => g.rooms.length > 0),
    [props.buildings, excluded, q],
  );
  // Цеха без помещения — подгружаем сами при открытии. Ошибка загрузки
  // не ломает окно: группа просто не показывается.
  const [orphans, setOrphans] = useState<OrphanArea[]>([]);
  useEffect(() => {
    if (!props.open) return;
    let cancelled = false;
    fetch("/api/settings/rooms/orphan-areas", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { areas?: OrphanArea[] } | null) => {
        if (!cancelled) setOrphans(Array.isArray(body?.areas) ? body.areas : []);
      })
      .catch(() => {
        if (!cancelled) setOrphans([]);
      });
    return () => {
      cancelled = true;
    };
  }, [props.open]);
  const qNorm = normalizePlaceName(query);
  const visibleOrphans = useMemo(
    () => orphans.filter((a) => !qNorm || normalizePlaceName(a.name).includes(qNorm)),
    [orphans, qNorm],
  );
  const roomsLeft = !props.buildings.every((b) =>
    b.rooms.every((r) => excluded.has(r.id)),
  );
  const nothingLeft = !roomsLeft && orphans.length === 0;
  const selectedBuildingId = newBuildingId || props.buildings[0]?.id || "";

  async function postRoom(buildingId: string, name: string, kind: string): Promise<DirectoryRoom> {
    const res = await fetch("/api/settings/rooms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ buildingId, name, kind }),
    });
    const body = (await res.json().catch(() => ({}))) as { room?: Record<string, unknown>; error?: string };
    if (!res.ok || !body.room) {
      throw new Error(body.error ?? `HTTP ${res.status}`);
    }
    return createdToDirectoryRoom(body.room, name, kind);
  }

  async function createFromArea(area: OrphanArea) {
    if (!selectedBuildingId) {
      toast.error(t("needBuilding"));
      return;
    }
    setBusy(true);
    try {
      const room = await postRoom(selectedBuildingId, area.name, guessRoomKind(area.name));
      setOrphans((prev) => prev.filter((a) => a.id !== area.id));
      await props.onCreated(room);
      props.onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("createFailed"));
    } finally {
      setBusy(false);
    }
  }

  const orphanGroup =
    visibleOrphans.length > 0 ? (
      <div>
        <div className="mb-1 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.14em] text-[#9b9fb3]">
          <Factory className="size-3.5" />
          {t("orphanTitle")}
        </div>
        <p className="mb-2 text-[12px] leading-[1.5] text-[#6f7282]">
          {props.buildings.length === 0
            ? t("orphanNoBuilding")
            : t("orphanHint")}
        </p>
        {props.buildings.length > 1 ? (
          <label className="mb-2 flex items-center gap-2 text-[12px] text-[#6f7282]">
            <span className="shrink-0">{t("createInBuilding")}</span>
            <select
              value={selectedBuildingId}
              onChange={(e) => setNewBuildingId(e.target.value)}
              className="h-9 min-w-0 flex-1 rounded-2xl border border-[#dcdfed] bg-white px-3 text-[13px] text-[#0b1024] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
            >
              {props.buildings.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <div className="space-y-1">
          {visibleOrphans.map((area) => (
            <button
              key={area.id}
              type="button"
              disabled={busy || props.buildings.length === 0}
              onClick={() => createFromArea(area)}
              title={t("orphanButtonTitle")}
              className="flex w-full items-center justify-between gap-3 rounded-2xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-4 py-2.5 text-left transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] disabled:opacity-50"
            >
              <span className="min-w-0">
                <span className="block truncate text-[14px] font-medium text-[#0b1024]">
                  {area.name}
                </span>
                <span className="block text-[11.5px] text-[#6f7282]">
                  {equipmentLabel(area.equipmentCount)}
                </span>
              </span>
              <Plus className="size-4 shrink-0 text-[#5566f6]" />
            </button>
          ))}
        </div>
      </div>
    ) : null;

  async function pick(room: DirectoryRoom) {
    setBusy(true);
    try {
      await props.onPick(room);
      props.onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("addFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    const name = newName.trim();
    if (!name) {
      toast.error(t("enterName"));
      return;
    }
    const buildingId = selectedBuildingId;
    if (!buildingId) {
      toast.error(t("needBuilding"));
      return;
    }
    setBusy(true);
    try {
      const room = await postRoom(buildingId, name, newKind);
      setNewName("");
      setCreating(false);
      await props.onCreated(room);
      props.onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("createFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-[calc(100vw-1rem)] max-h-[92vh] supports-[height:100dvh]:max-h-[92dvh] overflow-hidden rounded-[24px] border-0 p-0 sm:max-w-[560px]">
        <DialogHeader className="border-b px-6 py-5">
          <DialogTitle className="text-[18px] font-semibold tracking-[-0.02em] text-[#0b1024]">
            {props.title ?? t("defaultTitle")}
          </DialogTitle>
          <p className="mt-1 text-[12.5px] leading-[1.55] text-[#6f7282]">
            {props.hint ?? t("defaultHint")}
          </p>
        </DialogHeader>

        <div className="max-h-[calc(92vh-170px)] space-y-4 overflow-y-auto px-6 py-5">
          {props.buildings.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-6 py-10 text-center">
              <Building2 className="mx-auto mb-2 size-7 text-[#9b9fb3]" />
              <div className="text-[15px] font-medium text-[#0b1024]">{t("noBuildings")}</div>
              <p className="mx-auto mt-1 max-w-[360px] text-[13px] text-[#6f7282]">
                {t("noBuildingsHint")}
              </p>
            </div>
          ) : null}
          {props.buildings.length === 0 ? (
            orphanGroup
          ) : (
            <>
              {!nothingLeft ? (
                <label className="flex h-11 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 focus-within:border-[#5566f6] focus-within:ring-4 focus-within:ring-[#5566f6]/15">
                  <Search className="size-4 shrink-0 text-[#9b9fb3]" />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={orphans.length > 0 ? t("searchRoomOrArea") : t("searchRoom")}
                    className="h-full w-full bg-transparent text-[14px] text-[#0b1024] placeholder:text-[#9b9fb3] focus:outline-none"
                  />
                </label>
              ) : null}

              {nothingLeft ? (
                <p className="rounded-2xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-4 py-3 text-[13px] text-[#6f7282]">
                  {t("allAdded")}
                </p>
              ) : groups.length === 0 && visibleOrphans.length === 0 ? (
                <p className="px-1 text-[13px] text-[#6f7282]">{t("nothingFound")}</p>
              ) : (
                <>
                {groups.map((g) => (
                  <div key={g.building.id}>
                    <div className="mb-1.5 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.14em] text-[#9b9fb3]">
                      <Building2 className="size-3.5" />
                      {g.building.name}
                    </div>
                    <div className="space-y-1">
                      {g.rooms.map((room) => (
                        <button
                          key={room.id}
                          type="button"
                          disabled={busy}
                          onClick={() => pick(room)}
                          className="flex w-full items-center justify-between gap-3 rounded-2xl border border-[#ececf4] bg-white px-4 py-2.5 text-left transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] disabled:opacity-50"
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-[14px] font-medium text-[#0b1024]">
                              {room.name}
                            </span>
                            <span className="block text-[11.5px] text-[#6f7282]">
                              {KIND_LABELS[room.kind] ?? room.kind}
                            </span>
                          </span>
                          <Plus className="size-4 shrink-0 text-[#5566f6]" />
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
                {orphanGroup}
                </>
              )}

              {creating ? (
                <div className="space-y-3 rounded-3xl border border-[#ececf4] bg-[#fafbff] p-4">
                  <div className="text-[13px] font-semibold text-[#0b1024]">{t("newRoom")}</div>
                  <div className="space-y-2">
                    <Label className="text-[12px] font-medium text-[#3c4053]">{t("nameLabel")}</Label>
                    <Input
                      autoFocus
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      placeholder={t("namePlaceholder")}
                      className="h-11 rounded-2xl border-[#dcdfed] px-4 text-[14px]"
                    />
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label className="text-[12px] font-medium text-[#3c4053]">{t("buildingLabel")}</Label>
                      <select
                        value={newBuildingId || props.buildings[0]?.id || ""}
                        onChange={(e) => setNewBuildingId(e.target.value)}
                        className="h-11 w-full rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
                      >
                        {props.buildings.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-[12px] font-medium text-[#3c4053]">{t("typeLabel")}</Label>
                      <select
                        value={newKind}
                        onChange={(e) => setNewKind(e.target.value)}
                        className="h-11 w-full rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
                      >
                        {Object.entries(KIND_LABELS).map(([k, v]) => (
                          <option key={k} value={k}>
                            {v}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <p className="text-[12px] leading-[1.5] text-[#6f7282]">
                    {t("afterCreate")}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      disabled={busy}
                      onClick={create}
                      className="h-10 rounded-2xl bg-[#5566f6] px-4 text-[13.5px] font-medium text-white hover:bg-[#4a5bf0]"
                    >
                      {busy ? t("creating") : t("createAndConfigure")}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={busy}
                      onClick={() => setCreating(false)}
                      className="h-10 rounded-2xl border-[#dcdfed] px-4 text-[13.5px] shadow-none hover:bg-white"
                    >
                      {t("cancel")}
                    </Button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setCreating(true)}
                  className="inline-flex h-10 items-center gap-1.5 rounded-2xl border border-dashed border-[#dcdfed] bg-white px-4 text-[13.5px] font-medium text-[#3c4053] transition-colors duration-150 hover:border-[#5566f6]/50 hover:bg-[#f5f6ff] hover:text-[#5566f6]"
                >
                  <Plus className="size-4" />
                  {t("createNew")}
                </button>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
