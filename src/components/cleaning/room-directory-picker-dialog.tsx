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
import { pluralRu } from "@/lib/plural-ru";

function equipmentLabel(count: number): string {
  if (count <= 0) return "цех · без оборудования";
  return `цех · ${count} ${pluralRu(count, "единица", "единицы", "единиц")} оборудования`;
}

const KIND_LABELS: Record<string, string> = {
  guest: "Гостевая зона",
  kitchen: "Кухня / горячий цех",
  wash: "Мойка",
  bar: "Бар",
  storage: "Склад",
  other: "Другое",
};

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
      toast.error("Сначала заведите здание в «Настройки → Помещения»");
      return;
    }
    setBusy(true);
    try {
      const room = await postRoom(selectedBuildingId, area.name, guessRoomKind(area.name));
      setOrphans((prev) => prev.filter((a) => a.id !== area.id));
      await props.onCreated(room);
      props.onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось создать помещение");
    } finally {
      setBusy(false);
    }
  }

  const orphanGroup =
    visibleOrphans.length > 0 ? (
      <div>
        <div className="mb-1 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.14em] text-[#9b9fb3]">
          <Factory className="size-3.5" />
          Цеха без помещения
        </div>
        <p className="mb-2 text-[12px] leading-[1.5] text-[#6f7282]">
          {props.buildings.length === 0
            ? "Сначала заведите здание в «Настройки → Помещения» — тогда цех можно будет добавить в журнал."
            : "Из «Цеха и участки». Нажмите +, и мы создадим помещение с тем же названием и добавим его в журнал."}
        </p>
        {props.buildings.length > 1 ? (
          <label className="mb-2 flex items-center gap-2 text-[12px] text-[#6f7282]">
            <span className="shrink-0">Создать в здании</span>
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
              title="Создать помещение с этим названием и добавить в журнал"
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
      toast.error(e instanceof Error ? e.message : "Не удалось добавить помещение");
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    const name = newName.trim();
    if (!name) {
      toast.error("Введите название помещения");
      return;
    }
    const buildingId = selectedBuildingId;
    if (!buildingId) {
      toast.error("Сначала заведите здание в «Настройки → Помещения»");
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
      toast.error(e instanceof Error ? e.message : "Не удалось создать помещение");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-[calc(100vw-1rem)] max-h-[92vh] supports-[height:100dvh]:max-h-[92dvh] overflow-hidden rounded-[24px] border-0 p-0 sm:max-w-[560px]">
        <DialogHeader className="border-b px-6 py-5">
          <DialogTitle className="text-[18px] font-semibold tracking-[-0.02em] text-[#0b1024]">
            {props.title ?? "Добавить помещение"}
          </DialogTitle>
          <p className="mt-1 text-[12.5px] leading-[1.55] text-[#6f7282]">
            {props.hint ??
              "Помещения общие для всех журналов — из «Настройки → Помещения». Выберите существующее или создайте новое."}
          </p>
        </DialogHeader>

        <div className="max-h-[calc(92vh-170px)] space-y-4 overflow-y-auto px-6 py-5">
          {props.buildings.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-6 py-10 text-center">
              <Building2 className="mx-auto mb-2 size-7 text-[#9b9fb3]" />
              <div className="text-[15px] font-medium text-[#0b1024]">Зданий пока нет</div>
              <p className="mx-auto mt-1 max-w-[360px] text-[13px] text-[#6f7282]">
                Заведите здание и помещения в «Настройки → Помещения» — они появятся во всех журналах.
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
                    placeholder={orphans.length > 0 ? "Поиск помещения или цеха" : "Поиск помещения"}
                    className="h-full w-full bg-transparent text-[14px] text-[#0b1024] placeholder:text-[#9b9fb3] focus:outline-none"
                  />
                </label>
              ) : null}

              {nothingLeft ? (
                <p className="rounded-2xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-4 py-3 text-[13px] text-[#6f7282]">
                  Все помещения справочника уже в этом документе. Можно создать новое.
                </p>
              ) : groups.length === 0 && visibleOrphans.length === 0 ? (
                <p className="px-1 text-[13px] text-[#6f7282]">Ничего не нашли.</p>
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
                  <div className="text-[13px] font-semibold text-[#0b1024]">Новое помещение</div>
                  <div className="space-y-2">
                    <Label className="text-[12px] font-medium text-[#3c4053]">Название</Label>
                    <Input
                      autoFocus
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      placeholder="Например: Сухой склад"
                      className="h-11 rounded-2xl border-[#dcdfed] px-4 text-[14px]"
                    />
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label className="text-[12px] font-medium text-[#3c4053]">Здание</Label>
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
                      <Label className="text-[12px] font-medium text-[#3c4053]">Тип</Label>
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
                    После создания откроется карточка помещения — там нормы, состав уборки, уборщики и проверяющие.
                  </p>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      disabled={busy}
                      onClick={create}
                      className="h-10 rounded-2xl bg-[#5566f6] px-4 text-[13.5px] font-medium text-white hover:bg-[#4a5bf0]"
                    >
                      {busy ? "Создание…" : "Создать и настроить"}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={busy}
                      onClick={() => setCreating(false)}
                      className="h-10 rounded-2xl border-[#dcdfed] px-4 text-[13.5px] shadow-none hover:bg-white"
                    >
                      Отмена
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
                  Создать новое помещение
                </button>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
