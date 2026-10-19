"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Copy, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import type { Locale } from "@/i18n/locales";
import { roomKindLabel, roomKindOptions, type RoomKind } from "@/lib/room-kinds";
import { countRoomsPerUser, toUserIdList } from "@/lib/cleaning-room-responsibles";
import type { RoomResponsibleUser } from "@/lib/room-responsible-candidates";
import { RoomEditorDialog, type RoomEditorInitial } from "@/components/cleaning/room-editor-dialog";
import { roomEditorInitial, type BuildingRoom } from "@/app/(dashboard)/settings/buildings/buildings-client";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { confirmAsync } from "@/components/ui/confirm-async";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PointBlock, PointBlockEmpty } from "@/components/settings/point-block";

const OUTLINE_BUTTON =
  "inline-flex h-10 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 disabled:opacity-60";

export type PointHead = {
  id: string;
  name: string;
  address: string | null;
  kpp: string | null;
  phone: string | null;
  journalName: string | null;
};

/** Блок 1 — «Название и адрес»: сведения для документов точки, правка окном. */
export function PointHeadBlock({ point, readOnly }: { point: PointHead; readOnly: boolean }) {
  const t = useTranslations("settingsManagement.points.head");
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState(() => draftOf(point));

  function draftOf(value: PointHead) {
    return {
      name: value.name,
      journalName: value.journalName ?? "",
      address: value.address ?? "",
      kpp: value.kpp ?? "",
      phone: value.phone ?? "",
    };
  }

  async function save() {
    const name = draft.name.trim();
    if (!name) {
      toast.error(t("nameRequired"));
      return;
    }
    setSaving(true);
    try {
      const response = await fetch(`/api/settings/buildings/${point.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          address: draft.address.trim() || null,
          kpp: draft.kpp.trim() || null,
          phone: draft.phone.trim() || null,
          journalName: draft.journalName.trim() || null,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? t("failed"));
      toast.success(t("saved"));
      setOpen(false);
      // Название точки — ещё и пункт меню: обновляем всю разметку.
      startTransition(() => router.refresh());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("failed"));
    } finally {
      setSaving(false);
    }
  }

  const rows: Array<{ key: string; label: string; value: string | null }> = [
    { key: "name", label: t("name"), value: point.name },
    { key: "journalName", label: t("journalName"), value: point.journalName },
    { key: "address", label: t("address"), value: point.address },
    { key: "kpp", label: t("kpp"), value: point.kpp },
    { key: "phone", label: t("phone"), value: point.phone },
  ];

  const fields: Array<{ key: keyof ReturnType<typeof draftOf>; label: string; placeholder: string; hint?: string; type?: string; inputMode?: "numeric" | "tel" }> = [
    { key: "name", label: t("name"), placeholder: t("namePlaceholder") },
    { key: "journalName", label: t("journalName"), placeholder: t("journalNamePlaceholder"), hint: t("journalNameHint") },
    { key: "address", label: t("address"), placeholder: t("addressPlaceholder") },
    { key: "kpp", label: t("kpp"), placeholder: t("kppPlaceholder"), inputMode: "numeric" },
    { key: "phone", label: t("phone"), placeholder: t("phonePlaceholder"), type: "tel", inputMode: "tel" },
  ];

  return (
    <PointBlock
      number={1}
      testId="head"
      title={t("title")}
      hint={t("hint")}
      action={
        readOnly ? null : (
          <button
            type="button"
            className={OUTLINE_BUTTON}
            onClick={() => {
              setDraft(draftOf(point));
              setOpen(true);
            }}
          >
            <Pencil className="size-4 text-[#5566f6]" />
            {t("edit")}
          </button>
        )
      }
    >
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
        {rows.map((row) => (
          <div key={row.key} className="min-w-0">
            <dt className="text-[12.5px] text-[#6f7282]">{row.label}</dt>
            <dd
              className={
                row.value
                  ? "mt-0.5 break-words text-[14.5px] text-[#0b1024]"
                  : "mt-0.5 text-[14px] text-[#9b9fb3]"
              }
            >
              {row.value || t("notSet")}
            </dd>
          </div>
        ))}
      </dl>
      <Dialog open={open} onOpenChange={(value) => (saving ? null : setOpen(value))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("dialogTitle")}</DialogTitle>
            <DialogDescription>{t("dialogHint")}</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            {fields.map((field) => (
              <div key={field.key} className="space-y-1.5">
                <Label htmlFor={`point-${field.key}`}>
                  {field.label}
                  {field.key === "name" ? <span className="text-[#a13a32]"> *</span> : null}
                </Label>
                <Input
                  id={`point-${field.key}`}
                  type={field.type ?? "text"}
                  inputMode={field.inputMode}
                  value={draft[field.key]}
                  placeholder={field.placeholder}
                  autoFocus={field.key === "name"}
                  maxLength={field.key === "kpp" ? 20 : field.key === "phone" ? 40 : 200}
                  onChange={(event) => setDraft((prev) => ({ ...prev, [field.key]: event.target.value }))}
                />
                {field.hint ? <p className="text-[12.5px] leading-[1.45] text-[#6f7282]">{field.hint}</p> : null}
              </div>
            ))}
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={saving}>
                {t("cancel")}
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? <Loader2 className="size-4 animate-spin" /> : null}
                {saving ? t("saving") : t("save")}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </PointBlock>
  );
}

/** Блок 2 — «Цеха и помещения»: помещения точки, окно помещения, копирование из другой точки. */
export function PointRoomsBlock({
  pointId,
  rooms,
  users,
  orgRooms,
  donors,
  readOnly,
}: {
  pointId: string;
  rooms: BuildingRoom[];
  users: RoomResponsibleUser[];
  /** Все помещения организации — подсказка нагрузки в окне помещения. */
  orgRooms: Array<{ id: string; cleanerUserIds: unknown; verifierUserIds: unknown }>;
  /** Другие точки с помещениями — откуда скопировать. */
  donors: Array<{ id: string; name: string; roomsCount: number }>;
  readOnly: boolean;
}) {
  const t = useTranslations("settingsManagement.points.rooms");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [editorRoom, setEditorRoom] = useState<RoomEditorInitial | null>(null);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<RoomKind>("other");
  const [adding, setAdding] = useState(false);
  const [donorId, setDonorId] = useState(donors[0]?.id ?? "");
  const [copying, setCopying] = useState(false);
  const userNameById = new Map(users.map((user) => [user.id, user.name]));

  const otherRooms = orgRooms
    .filter((room) => room.id !== editorRoom?.id)
    .map((room) => ({
      id: room.id,
      cleanerUserIds: toUserIdList(room.cleanerUserIds),
      verifierUserIds: toUserIdList(room.verifierUserIds),
    }));

  function refresh() {
    startTransition(() => router.refresh());
  }

  async function addRoom() {
    const clean = name.trim();
    if (!clean) return;
    setAdding(true);
    try {
      const response = await fetch("/api/settings/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ buildingId: pointId, name: clean, kind }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? t("addFailed"));
      toast.success(t("added", { name: clean }));
      setName("");
      setKind("other");
      refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("addFailed"));
    } finally {
      setAdding(false);
    }
  }

  async function copyRooms() {
    if (!donorId) return;
    setCopying(true);
    try {
      const response = await fetch(`/api/settings/buildings/${pointId}/copy-rooms`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromBuildingId: donorId }),
      });
      const data = (await response.json().catch(() => ({}))) as { copied?: number; error?: string };
      if (!response.ok) throw new Error(data.error ?? t("copyFailed"));
      toast.success(t("copied", { count: String(data.copied ?? 0) }));
      refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("copyFailed"));
    } finally {
      setCopying(false);
    }
  }

  async function deleteRoom(room: BuildingRoom) {
    // Сколько отметок держит помещение — спрашиваем сервер (как на обзоре точек).
    let bullets: Array<{ label: string; tone?: "default" | "warn" | "info" }> = [];
    try {
      const usage = await fetch(`/api/settings/rooms/${room.id}/usage`);
      if (usage.ok) {
        const body = (await usage.json()) as { bullets?: unknown };
        if (Array.isArray(body.bullets)) {
          bullets = body.bullets
            .filter((line): line is string => typeof line === "string")
            .map((label) => ({ label, tone: "warn" as const }));
        }
      }
    } catch {
      /* последствия не показали — подтверждение всё равно спросим */
    }
    const ok = await confirmAsync({
      title: t("deleteTitle"),
      description: t("deleteDescription", { name: room.name }),
      bullets,
      variant: "danger",
      confirmLabel: t("deleteConfirm"),
    });
    if (!ok) return;
    const response = await fetch(`/api/settings/rooms/${room.id}`, { method: "DELETE" });
    if (!response.ok) {
      toast.error(t("deleteFailed"));
      return;
    }
    toast.success(t("deleted"));
    refresh();
  }

  return (
    <PointBlock
      number={2}
      testId="rooms"
      title={t("title")}
      hint={t("hint")}
      action={
        rooms.length > 0 ? (
          <span className="rounded-full bg-[#f5f6ff] px-3 py-1.5 text-[13px] font-medium tabular-nums text-[#3848c7]">
            {t("count", { count: rooms.length })}
          </span>
        ) : null
      }
    >
      {rooms.length === 0 ? (
        <PointBlockEmpty title={t("emptyTitle")} body={t("emptyBody")}>
          {!readOnly && donors.length > 0 ? (
            <>
              <span className="text-[13px] text-[#3c4053]">{t("copyFrom")}</span>
              <Select value={donorId} onValueChange={setDonorId}>
                <SelectTrigger className="h-10 w-auto min-w-[180px] max-w-full rounded-2xl" aria-label={t("copyFrom")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {donors.map((donor) => (
                    <SelectItem key={donor.id} value={donor.id}>
                      {donor.name} · {donor.roomsCount}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <button type="button" className={OUTLINE_BUTTON} onClick={() => void copyRooms()} disabled={copying}>
                {copying ? <Loader2 className="size-4 animate-spin" /> : <Copy className="size-4 text-[#5566f6]" />}
                {copying ? t("copying") : t("copy")}
              </button>
            </>
          ) : null}
        </PointBlockEmpty>
      ) : (
        <ul className="grid gap-2 lg:grid-cols-2">
          {rooms.map((room) => {
            const steps =
              (Array.isArray(room.currentScope) ? room.currentScope.length : 0) +
              (Array.isArray(room.generalScope) ? room.generalScope.length : 0);
            const cleaningSet = steps > 0 || Boolean(room.detergent && room.detergent.length > 0);
            const cleaners = toUserIdList(room.cleanerUserIds).map((id) => userNameById.get(id) ?? "—");
            return (
              <li
                key={room.id}
                data-point-room={room.id}
                className="flex min-w-0 flex-wrap items-start justify-between gap-x-2 gap-y-1 rounded-2xl border border-[#ececf4] bg-[#fafbff] px-3.5 py-3"
              >
                {/* На телефоне кнопки уходят под пилюли, а не сжимают название в столбик. */}
                <div className="min-w-0 flex-1 basis-[220px] space-y-1.5">
                  <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                    <span className="break-words text-[14.5px] font-medium text-[#0b1024]">{room.name}</span>
                    <span className="rounded-full bg-[#eef1ff] px-2 py-0.5 text-[11.5px] text-[#3848c7]">
                      {roomKindLabel(room.kind, locale)}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 text-[11.5px]">
                    <span
                      className={
                        cleaningSet
                          ? "rounded-full bg-[#ecfdf5] px-2 py-0.5 text-[#116b2a]"
                          : "rounded-full bg-[#fff8eb] px-2 py-0.5 text-[#a16d32]"
                      }
                    >
                      {cleaningSet ? t("cleaningSet") : t("cleaningMissing")}
                    </span>
                    <span className="rounded-full bg-white px-2 py-0.5 text-[#6f7282] ring-1 ring-inset ring-[#ececf4]">
                      {cleaners.length > 0 ? t("cleaners", { names: cleaners.join(", ") }) : t("noCleaners")}
                    </span>
                  </div>
                </div>
                {readOnly ? null : (
                  <div className="-ml-2.5 flex shrink-0 items-center gap-1 sm:ml-0">
                    <button
                      type="button"
                      onClick={() => setEditorRoom(roomEditorInitial(room))}
                      title={t("configureHint")}
                      className="inline-flex h-9 items-center gap-1 rounded-xl px-2.5 text-[13px] font-medium text-[#3848c7] transition-colors duration-150 hover:bg-white focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
                    >
                      <Pencil className="size-3.5" />
                      {t("configure")}
                    </button>
                    <button
                      type="button"
                      onClick={() => void deleteRoom(room)}
                      aria-label={t("deleteAria", { name: room.name })}
                      className="inline-flex size-9 items-center justify-center rounded-xl text-[#9b9fb3] transition-colors duration-150 hover:bg-[#fff4f2] hover:text-[#a13a32] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
                    >
                      <X className="size-4" />
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {readOnly ? null : (
        <form
          className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-end"
          onSubmit={(event) => {
            event.preventDefault();
            void addRoom();
          }}
        >
          <div className="min-w-0 flex-1 space-y-1.5">
            <Label htmlFor="point-room-name">{t("name")}</Label>
            <Input
              id="point-room-name"
              value={name}
              maxLength={120}
              placeholder={t("namePlaceholder")}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="space-y-1.5 sm:w-[220px]">
            <Label htmlFor="point-room-kind">{t("kind")}</Label>
            <Select value={kind} onValueChange={(value) => setKind(value as RoomKind)}>
              <SelectTrigger id="point-room-kind" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {roomKindOptions(locale).map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button type="submit" disabled={adding || !name.trim()} className="sm:shrink-0">
            {adding ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            {adding ? t("adding") : t("add")}
          </Button>
        </form>
      )}

      <RoomEditorDialog
        open={editorRoom !== null}
        onOpenChange={(value) => {
          if (!value) setEditorRoom(null);
        }}
        initial={editorRoom}
        onSaved={refresh}
        users={users}
        roomsPerCleaner={countRoomsPerUser(otherRooms, "cleaner")}
        roomsPerVerifier={countRoomsPerUser(otherRooms, "verifier")}
      />
    </PointBlock>
  );
}

/** Удаление точки — в конце страницы: `ConfirmDialog` с вводом названия и последствиями. */
export function PointDeleteBlock({
  point,
  roomsCount,
  equipmentCount,
}: {
  point: { id: string; name: string };
  roomsCount: number;
  equipmentCount: number;
}) {
  const t = useTranslations("settingsManagement.points.danger");
  const router = useRouter();
  const [open, setOpen] = useState(false);

  async function remove() {
    const response = await fetch(`/api/settings/buildings/${point.id}`, { method: "DELETE" });
    if (!response.ok) {
      toast.error(t("failed"));
      return;
    }
    setOpen(false);
    toast.success(t("deleted", { name: point.name }));
    // Точки больше нет и в меню: к обзору точек, разметка — заново.
    router.push("/settings/buildings");
    router.refresh();
  }

  return (
    <section
      data-point-block="delete"
      className="flex flex-col gap-3 rounded-3xl border border-[#ffd9d3] bg-[#fffaf9] p-5 sm:flex-row sm:items-center sm:justify-between md:p-6"
    >
      <div className="min-w-0">
        <h2 className="text-[16px] font-semibold text-[#a13a32]">{t("title")}</h2>
        <p className="mt-1 text-[13.5px] leading-[1.5] text-[#6f7282]">{t("hint")}</p>
      </div>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-2xl bg-[#a13a32] px-4 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(161,58,50,0.55)] transition-colors duration-150 hover:bg-[#8b3128] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#a13a32]/20"
      >
        <Trash2 className="size-4" />
        {t("button")}
      </button>
      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        onConfirm={remove}
        variant="danger"
        title={t("confirmTitle", { name: point.name })}
        description={t("confirmDescription")}
        bullets={[
          { label: t("bulletRooms", { count: String(roomsCount) }), tone: "warn" },
          { label: t("bulletEquipment", { count: String(equipmentCount) }), tone: "info" },
          { label: t("bulletDocuments"), tone: "info" },
        ]}
        typeToConfirm={point.name}
        confirmLabel={t("confirm")}
      />
    </section>
  );
}
