"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, KeyRound, Plus, Search, Trash2, UserPlus, Users } from "lucide-react";
import { toast } from "sonner";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { BrakerageCommissionMember } from "@/lib/brakerage-commission";
import { cn } from "@/lib/utils";

type Candidate = {
  id: string;
  name: string;
  position: string;
  group: "commission" | "management" | "staff";
  hasPin: boolean;
};

const GROUP_LABEL: Record<Candidate["group"], string> = {
  commission: "Комиссия",
  management: "Руководство",
  staff: "Сотрудники",
};

/**
 * «Сторонняя бракеражная комиссия» журнала (готовая продукция, скоропорт).
 * Состав — сотрудники организации (выбор из групп «Комиссия / Руководство /
 * Сотрудники» с поиском) или «Новый человек»: он попадает на страницу
 * сотрудников в колонку «Комиссия», ПИН выдаётся сразу. Сохранение —
 * на уровне организации, с копией в активные документы журнала.
 */
export function CommissionDialog({
  code,
  open,
  onClose,
  onSaved,
}: {
  code: string;
  open: boolean;
  onClose: () => void;
  onSaved?: (members: BrakerageCommissionMember[]) => void;
}) {
  const [members, setMembers] = useState<Array<{ employeeId: string; role: string; name: string }>>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState("");
  const [newPerson, setNewPerson] = useState<{ fullName: string; role: string; phone: string } | null>(null);
  const [issuedPin, setIssuedPin] = useState<{ name: string; pin: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/settings/brakerage-commission/${code}`, { cache: "no-store" });
      const body = (await response.json().catch(() => null)) as {
        members?: BrakerageCommissionMember[];
        candidates?: Candidate[];
        canManage?: boolean;
      } | null;
      setMembers((body?.members ?? []).map((m) => ({ employeeId: m.employeeId, role: m.role, name: m.employeeName })));
      setCandidates(body?.candidates ?? []);
      setCanManage(body?.canManage === true);
    } finally {
      setLoading(false);
    }
  }, [code]);

  useEffect(() => {
    if (!open) return;
    setIssuedPin(null);
    setNewPerson(null);
    setPicking(false);
    void load();
  }, [open, load]);

  const byId = useMemo(() => new Map(candidates.map((c) => [c.id, c])), [candidates]);
  const chosen = new Set(members.map((m) => m.employeeId));
  const filtered = candidates.filter(
    (c) => !chosen.has(c.id) && (!query.trim() || c.name.toLowerCase().includes(query.trim().toLowerCase()))
  );
  const grouped = (["commission", "management", "staff"] as const)
    .map((group) => ({ group, items: filtered.filter((c) => c.group === group) }))
    .filter((entry) => entry.items.length > 0);

  function addMember(candidate: Candidate) {
    setMembers((prev) => [
      ...prev,
      { employeeId: candidate.id, name: candidate.name, role: prev.length === 0 ? "Председатель" : "Член комиссии" },
    ]);
    setPicking(false);
    setQuery("");
  }

  async function createPerson() {
    if (!newPerson) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/settings/brakerage-commission/${code}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullName: newPerson.fullName, phone: newPerson.phone }),
      });
      const body = (await response.json().catch(() => null)) as {
        user?: { id: string; name: string };
        pin?: string | null;
        error?: string;
      } | null;
      if (!response.ok || !body?.user) throw new Error(body?.error || "Не удалось добавить человека");
      const user = body.user;
      setCandidates((prev) => [...prev, { id: user.id, name: user.name, position: "Член бракеражной комиссии", group: "commission", hasPin: Boolean(body.pin) }]);
      setMembers((prev) => [
        ...prev,
        { employeeId: user.id, name: user.name, role: newPerson.role.trim() || (prev.length === 0 ? "Председатель" : "Член комиссии") },
      ]);
      if (body.pin) setIssuedPin({ name: user.name, pin: body.pin });
      setNewPerson(null);
      toast.success(`${user.name} — в комиссии и в сотрудниках, колонка «Комиссия»`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось добавить человека");
    } finally {
      setSaving(false);
    }
  }

  async function save() {
    setSaving(true);
    try {
      const response = await fetch(`/api/settings/brakerage-commission/${code}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ members: members.map((m) => ({ employeeId: m.employeeId, role: m.role })) }),
      });
      const body = (await response.json().catch(() => null)) as {
        members?: BrakerageCommissionMember[];
        updatedDocuments?: number;
        error?: string;
      } | null;
      if (!response.ok || !body?.members) throw new Error(body?.error || "Не удалось сохранить состав");
      toast.success(
        body.updatedDocuments
          ? `Состав комиссии сохранён · обновлено документов: ${body.updatedDocuments}`
          : "Состав комиссии сохранён"
      );
      onSaved?.(body.members);
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось сохранить состав");
    } finally {
      setSaving(false);
    }
  }

  const input =
    "h-10 rounded-xl border border-[#dcdfed] bg-white px-3 text-[14px] text-[#0b1024] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15";

  return (
    <Dialog open={open} onOpenChange={(value) => (!value ? onClose() : undefined)}>
      <DialogContent className="flex max-h-[90vh] max-w-[calc(100vw-1rem)] flex-col gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-[560px] supports-[height:100dvh]:max-h-[90dvh]">
        <DialogHeader className="shrink-0 border-b border-[#ececf4] px-6 py-4">
          <DialogTitle className="flex items-center gap-2 text-[18px] font-semibold tracking-[-0.02em] text-[#0b1024]">
            <Users className="size-5 text-[#5566f6]" />
            Сторонняя бракеражная комиссия
          </DialogTitle>
          <p className="text-[13px] leading-snug text-[#6f7282]">
            Члены комиссии подписывают каждое блюдо. Без подписи хотя бы одного из них строка бракеража не закрыта.
          </p>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">
          {loading ? <p className="text-[13px] text-[#6f7282]">Загружаем…</p> : null}

          {issuedPin ? (
            <div className="rounded-2xl border border-[#d4f5e3] bg-[#f3fdf7] p-4 text-[13.5px] text-[#116b2a]" role="status">
              <div className="flex items-center gap-2 font-semibold">
                <KeyRound className="size-4" /> ПИН для {issuedPin.name}: <span className="font-mono text-[18px] tracking-[0.3em]">{issuedPin.pin}</span>
              </div>
              <p className="mt-1 text-[12.5px]">
                Передайте человеку. Посмотреть позже — «Показать» в его карточке на странице сотрудников.
              </p>
            </div>
          ) : null}

          <div className="space-y-2">
            {members.length === 0 && !loading ? (
              <p className="rounded-2xl border border-dashed border-[#dcdfed] px-4 py-3 text-[13.5px] text-[#6f7282]">
                Состав не задан — строки бракеража закрываются без подписи комиссии.
              </p>
            ) : null}
            {members.map((member, index) => {
              const candidate = byId.get(member.employeeId);
              return (
                <div key={member.employeeId} className="flex flex-wrap items-center gap-2 rounded-2xl border border-[#ececf4] bg-[#fafbff] px-3 py-2">
                  <input
                    value={member.role}
                    disabled={!canManage}
                    onChange={(event) =>
                      setMembers((prev) => prev.map((m, i) => (i === index ? { ...m, role: event.target.value } : m)))
                    }
                    maxLength={80}
                    aria-label={`Роль в комиссии: ${member.name}`}
                    className={cn(input, "h-9 w-[40%] min-w-[130px]")}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14px] font-medium text-[#0b1024]">{member.name}</div>
                    <div className="text-[12px] text-[#6f7282]">
                      {candidate?.position || "—"} · {candidate?.hasPin ? "ПИН задан" : "ПИН не задан — выдайте в карточке сотрудника"}
                    </div>
                  </div>
                  {canManage ? (
                    <button
                      type="button"
                      onClick={() => setMembers((prev) => prev.filter((_, i) => i !== index))}
                      className="rounded-xl p-2 text-[#a13a32] transition-colors duration-150 hover:bg-[#fff4f2]"
                      aria-label={`Убрать ${member.name} из комиссии`}
                    >
                      <Trash2 className="size-4" />
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>

          {canManage && members.length < 10 ? (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  setPicking((value) => !value);
                  setNewPerson(null);
                }}
                className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-[#dcdfed] bg-white px-3 text-[13.5px] font-medium text-[#3848c7] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
              >
                <Plus className="size-4" /> Добавить из сотрудников
              </button>
              <button
                type="button"
                onClick={() => {
                  setNewPerson({ fullName: "", role: members.length === 0 ? "Председатель" : "Член комиссии", phone: "" });
                  setPicking(false);
                }}
                className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-[#dcdfed] bg-white px-3 text-[13.5px] font-medium text-[#3848c7] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
              >
                <UserPlus className="size-4" /> Новый человек
              </button>
            </div>
          ) : null}

          {picking ? (
            <div className="space-y-2 rounded-2xl border border-[#ececf4] bg-white p-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#9b9fb3]" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Найти по фамилии"
                  autoFocus
                  className={cn(input, "w-full pl-9")}
                />
              </div>
              <div className="max-h-[260px] space-y-3 overflow-y-auto">
                {grouped.length === 0 ? <p className="px-1 text-[13px] text-[#6f7282]">Никого не нашли</p> : null}
                {grouped.map(({ group, items }) => (
                  <div key={group}>
                    <div className="px-1 pb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#9b9fb3]">
                      {GROUP_LABEL[group]}
                    </div>
                    {items.map((candidate) => (
                      <button
                        key={candidate.id}
                        type="button"
                        onClick={() => addMember(candidate)}
                        className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors duration-150 hover:bg-[#f5f6ff]"
                      >
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[#eef1ff] text-[13px] font-semibold text-[#3848c7]">
                          {candidate.name.slice(0, 1)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[14px] text-[#0b1024]">{candidate.name}</span>
                          <span className="block truncate text-[12px] text-[#6f7282]">{candidate.position || "—"}</span>
                        </span>
                        {candidate.hasPin ? <Check className="size-4 text-[#16a34a]" aria-label="ПИН задан" /> : null}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {newPerson ? (
            <div className="space-y-2 rounded-2xl border border-[#ececf4] bg-white p-3">
              <input
                value={newPerson.fullName}
                onChange={(event) => setNewPerson({ ...newPerson, fullName: event.target.value })}
                placeholder="ФИО"
                autoFocus
                className={cn(input, "w-full")}
              />
              <div className="grid gap-2 sm:grid-cols-2">
                <input
                  value={newPerson.role}
                  onChange={(event) => setNewPerson({ ...newPerson, role: event.target.value })}
                  placeholder="Роль в комиссии"
                  maxLength={80}
                  className={input}
                />
                <input
                  value={newPerson.phone}
                  onChange={(event) => setNewPerson({ ...newPerson, phone: event.target.value })}
                  placeholder="Телефон (по желанию)"
                  inputMode="tel"
                  className={input}
                />
              </div>
              <p className="text-[12px] leading-snug text-[#6f7282]">
                Человек появится на странице сотрудников в колонке «Комиссия» с доступом только к бракеражным журналам.
                ПИН выдадим сразу.
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={saving || newPerson.fullName.trim().length < 2}
                  onClick={() => void createPerson()}
                  className="inline-flex h-10 items-center rounded-xl bg-[#5566f6] px-4 text-[13.5px] font-medium text-white transition-colors duration-150 hover:bg-[#4a5bf0] disabled:opacity-50"
                >
                  Добавить в комиссию
                </button>
                <button type="button" onClick={() => setNewPerson(null)} className="inline-flex h-10 items-center rounded-xl px-3 text-[13.5px] text-[#6f7282] hover:bg-[#f5f6ff]">
                  Отмена
                </button>
              </div>
            </div>
          ) : null}

          <p className="rounded-2xl bg-[#f5f6ff] px-4 py-3 text-[12.5px] leading-snug text-[#3848c7]">
            Что дальше: член комиссии сканирует QR журнала, выбирает себя, вводит ПИН — и видит блюда за сегодня. Ставит
            оценку и подписывает; подпись появится в колонке «Подпись бракеражной комиссии».
          </p>
        </div>
        <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-[#ececf4] bg-white px-6 py-4 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} className="h-10 rounded-xl border border-[#dcdfed] px-5 text-[14px] font-medium text-[#0b1024] hover:bg-[#fafbff]">
            {canManage ? "Отмена" : "Закрыть"}
          </button>
          {canManage ? (
            <button
              type="button"
              disabled={saving || loading}
              onClick={() => void save()}
              className="h-10 rounded-xl bg-[#5566f6] px-5 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors duration-150 hover:bg-[#4a5bf0] disabled:opacity-50"
            >
              Сохранить состав
            </button>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
