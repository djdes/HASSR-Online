"use client";

import { useState } from "react";
import { Plus, Trash2, ChevronDown, ChevronUp } from "lucide-react";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";

type Position = { id: string; name: string; categoryKey: string };
type Employee = { id: string; name: string; jobPositionId: string | null; positionTitle: string | null };
type Scope = {
  id: string;
  managerId: string;
  managerName: string;
  managerPosition: string | null;
  viewMode: "all" | "job_positions" | "specific_users" | "none";
  viewJobPositionIds: string[];
  viewUserIds: string[];
  assignableJournalCodes: string[];
};
type Journal = { code: string; name: string };

export function StaffHierarchyClient({
  positions,
  employees,
  scopes: initialScopes,
  journals,
}: {
  positions: Position[];
  employees: Employee[];
  scopes: Scope[];
  journals: Journal[];
}) {
  const [scopes, setScopes] = useState<Scope[]>(initialScopes);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncReport, setSyncReport] = useState<{
    managersUpdated: number;
    managersSkipped: number;
    errors: number;
  } | null>(null);
  /** id правила, которое просят удалить — окно подтверждения. */
  const [scopeToDelete, setScopeToDelete] = useState<string | null>(null);

  // Find managers without scope (can add new)
  const managersWithScope = new Set(scopes.map((s) => s.managerId));
  const availableManagers = employees.filter((e) => !managersWithScope.has(e.id));

  /** Имя руководителя из правила — чтобы в окне было видно, что удаляем. */
  function managerName(scopeId: string): string {
    const scope = scopes.find((s) => s.id === scopeId);
    if (!scope) return "—";
    return employees.find((e) => e.id === scope.managerId)?.name ?? "—";
  }

  async function saveScope(scope: Partial<Scope> & { managerId: string }) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/manager-scope", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          managerId: scope.managerId,
          viewMode: scope.viewMode,
          viewJobPositionIds: scope.viewJobPositionIds,
          viewUserIds: scope.viewUserIds,
          assignableJournalCodes: scope.assignableJournalCodes,
        }),
      });
      if (!res.ok) throw new Error("Failed to save");
      const data = await res.json();
      const updated = data.scope;
      const manager = employees.find((e) => e.id === updated.managerId);
      setScopes((prev) => {
        const idx = prev.findIndex((s) => s.managerId === updated.managerId);
        const next = [...prev];
        const item: Scope = {
          id: updated.id,
          managerId: updated.managerId,
          managerName: manager?.name ?? updated.managerId,
          managerPosition: manager?.positionTitle ?? null,
          viewMode: updated.viewMode,
          viewJobPositionIds: updated.viewJobPositionIds,
          viewUserIds: updated.viewUserIds,
          assignableJournalCodes: updated.assignableJournalCodes,
        };
        if (idx >= 0) next[idx] = item;
        else next.push(item);
        return next;
      });
      // Auto-push в TasksFlow после save — fire-and-forget. Пользователь
      // увидит «Применено в TasksFlow» в баннере, при ошибке — warning,
      // но изменение в WeSetup-БД уже зафиксировано.
      pushHierarchyToTasksflow(false);
    } catch {
      setError("Не удалось сохранить");
    } finally {
      setSaving(false);
    }
  }

  /**
   * Запускает /api/integrations/tasksflow/sync-hierarchy для всей орги.
   * Вызывается автоматически после saveScope и вручную через кнопку.
   * Если showError=true — выводим текст в банер при ошибке.
   */
  async function pushHierarchyToTasksflow(showError: boolean) {
    setSyncing(true);
    if (showError) setSyncReport(null);
    try {
      const res = await fetch(
        "/api/integrations/tasksflow/sync-hierarchy",
        { method: "POST" }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        const msg =
          data?.error ?? `Ошибка синка иерархии (${res.status})`;
        if (showError) setError(msg);
        setSyncReport(null);
      } else {
        const data = (await res.json()) as {
          managersUpdated: number;
          managersSkipped: number;
          errors: number;
        };
        setSyncReport(data);
      }
    } catch {
      if (showError) setError("Не удалось связаться с TasksFlow");
    } finally {
      setSyncing(false);
    }
  }

  async function deleteScope(id: string) {
    try {
      const res = await fetch(`/api/manager-scope?id=${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed");
      setScopes((prev) => prev.filter((s) => s.id !== id));
    } catch {
      setError("Не удалось удалить");
    }
  }

  return (
    <div className="space-y-4">
      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {/* TasksFlow sync — кнопка ручного применения иерархии и
          сводка по последнему пушу. Авто-sync уже запускается после
          каждого saveScope, но если интеграция была отключена/сломана,
          ручная кнопка позволяет применить всё разом. */}
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-[#ececf4] bg-white p-4 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-semibold text-[#0b1024]">
            Синхронизация с TasksFlow
          </div>
          <div className="mt-1 text-[12px] text-[#6f7282]">
            Иерархия живёт здесь, в TasksFlow её зеркалит этот sync —
            каждый руководитель видит у себя только задачи своих
            подчинённых.
          </div>
          {syncReport ? (
            <div className="mt-2 inline-flex items-center gap-2 rounded-full bg-[#ecfdf5] px-3 py-1 text-[12px] font-medium text-[#116b2a]">
              ✓ Применено: {syncReport.managersUpdated}
              {syncReport.managersSkipped > 0
                ? ` · пропущено ${syncReport.managersSkipped}`
                : ""}
              {syncReport.errors > 0 ? ` · ошибок ${syncReport.errors}` : ""}
            </div>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => pushHierarchyToTasksflow(true)}
          disabled={syncing}
          className="inline-flex h-10 items-center gap-2 rounded-2xl bg-[#5566f6] px-4 text-[13px] font-medium text-white transition-colors hover:bg-[#4a5bf0] disabled:bg-[#c8cbe0]"
        >
          {syncing ? "Синхронизация…" : "Применить в TasksFlow"}
        </button>
      </div>

      {/* Existing scopes */}
      {scopes.map((scope) => (
        <ScopeCard
          key={scope.id}
          scope={scope}
          positions={positions}
          employees={employees}
          journals={journals}
          expanded={expanded.has(scope.id)}
          onToggle={() =>
            setExpanded((prev) => {
              const next = new Set(prev);
              if (next.has(scope.id)) next.delete(scope.id);
              else next.add(scope.id);
              return next;
            })
          }
          onSave={(patch) => saveScope({ ...patch, managerId: scope.managerId })}
          onDelete={() => setScopeToDelete(scope.id)}
          saving={saving}
        />
      ))}

      {/* Add new scope */}
      {availableManagers.length > 0 ? (
        <NewScopeCard
          managers={availableManagers}
          positions={positions}
          employees={employees}
          journals={journals}
          onSave={saveScope}
          saving={saving}
        />
      ) : null}

      {scopes.length === 0 && availableManagers.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-6 text-center text-[14px] text-slate-500">
          Нет активных сотрудников для настройки.
        </div>
      ) : null}

      {/* Нативный confirm() в приложении Telegram может не показаться —
          кнопка тогда молча не срабатывает (CLAUDE.md §6). */}
      <ConfirmDialog
        open={scopeToDelete !== null}
        onClose={() => setScopeToDelete(null)}
        onConfirm={async () => {
          const id = scopeToDelete;
          setScopeToDelete(null);
          if (id) await deleteScope(id);
        }}
        title="Удалить правило?"
        description={
          scopeToDelete
            ? `Правило для сотрудника «${managerName(scopeToDelete)}» будет снято.`
            : undefined
        }
        bullets={[
          {
            label:
              "Руководитель снова начнёт видеть всю организацию — ограничение снимется",
            tone: "warn",
          },
          { label: "Сами сотрудники и их задачи не пострадают", tone: "default" },
        ]}
        confirmLabel="Удалить правило"
        cancelLabel="Отмена"
        variant="danger"
      />
    </div>
  );
}

function ScopeCard({
  scope,
  positions,
  employees,
  journals,
  expanded,
  onToggle,
  onSave,
  onDelete,
  saving,
}: {
  scope: Scope;
  positions: Position[];
  employees: Employee[];
  journals: Journal[];
  expanded: boolean;
  onToggle: () => void;
  onSave: (patch: Partial<Scope>) => void;
  onDelete: () => void;
  saving: boolean;
}) {
  const [edit, setEdit] = useState<Scope>(scope);

  const viewModeLabel: Record<string, string> = {
    all: "Все сотрудники",
    job_positions: "Определённые должности",
    specific_users: "Конкретные люди",
    none: "Никого (только себя)",
  };

  return (
    <div className="rounded-2xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[15px] font-semibold text-[#0b1024]">{scope.managerName}</div>
          <div className="text-[13px] text-[#6f7282]">
            {scope.managerPosition ?? "—"} · Видит: {viewModeLabel[scope.viewMode]}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onToggle}
            className="rounded-lg p-2 text-[#6f7282] hover:bg-slate-50"
          >
            {expanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
          </button>
          <button
            onClick={onDelete}
            className="rounded-lg p-2 text-red-400 hover:bg-red-50"
          >
            <Trash2 className="size-4" />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="mt-4 space-y-4 border-t border-[#ececf4] pt-4">
          {/* View mode */}
          <div>
            <label className="block text-[13px] font-medium text-[#0b1024]">
              Кого видит руководитель
            </label>
            <select
              value={edit.viewMode}
              onChange={(e) => setEdit({ ...edit, viewMode: e.target.value as Scope["viewMode"] })}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-[14px] focus:border-slate-400 focus:outline-none"
            >
              <option value="all">Все сотрудники</option>
              <option value="job_positions">Определённые должности</option>
              <option value="specific_users">Конкретные люди</option>
              <option value="none">Никого (только себя)</option>
            </select>
          </div>

          {/* Job positions selector */}
          {edit.viewMode === "job_positions" && (
            <div>
              <label className="block text-[13px] font-medium text-[#0b1024]">
                Должности
              </label>
              <div className="mt-1 flex flex-wrap gap-2">
                {positions.map((p) => (
                  <label
                    key={p.id}
                    className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[13px] ${
                      edit.viewJobPositionIds.includes(p.id)
                        ? "border-[#5566f6] bg-[#eef1ff] text-[#5566f6]"
                        : "border-slate-200 text-slate-600"
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={edit.viewJobPositionIds.includes(p.id)}
                      onChange={(e) => {
                        const ids = e.target.checked
                          ? [...edit.viewJobPositionIds, p.id]
                          : edit.viewJobPositionIds.filter((id) => id !== p.id);
                        setEdit({ ...edit, viewJobPositionIds: ids });
                      }}
                    />
                    {p.name}
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Specific users selector */}
          {edit.viewMode === "specific_users" && (
            <div>
              <label className="block text-[13px] font-medium text-[#0b1024]">
                Сотрудники
              </label>
              <div className="mt-1 flex flex-wrap gap-2">
                {employees
                  .filter((e) => e.id !== edit.managerId)
                  .map((u) => (
                    <label
                      key={u.id}
                      className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[13px] ${
                        edit.viewUserIds.includes(u.id)
                          ? "border-[#5566f6] bg-[#eef1ff] text-[#5566f6]"
                          : "border-slate-200 text-slate-600"
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="sr-only"
                        checked={edit.viewUserIds.includes(u.id)}
                        onChange={(e) => {
                          const ids = e.target.checked
                            ? [...edit.viewUserIds, u.id]
                            : edit.viewUserIds.filter((id) => id !== u.id);
                          setEdit({ ...edit, viewUserIds: ids });
                        }}
                      />
                      {u.name}
                    </label>
                  ))}
              </div>
            </div>
          )}

          {/* Assignable journals */}
          <div>
            <label className="block text-[13px] font-medium text-[#0b1024]">
              Журналы для назначения (пусто = все доступные)
            </label>
            <div className="mt-1 flex flex-wrap gap-2">
              {journals.map((j) => (
                <label
                  key={j.code}
                  className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[13px] ${
                    edit.assignableJournalCodes.includes(j.code)
                      ? "border-[#5566f6] bg-[#eef1ff] text-[#5566f6]"
                      : "border-slate-200 text-slate-600"
                  }`}
                >
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={edit.assignableJournalCodes.includes(j.code)}
                    onChange={(e) => {
                      const codes = e.target.checked
                        ? [...edit.assignableJournalCodes, j.code]
                        : edit.assignableJournalCodes.filter((c) => c !== j.code);
                      setEdit({ ...edit, assignableJournalCodes: codes });
                    }}
                  />
                  {j.name}
                </label>
              ))}
            </div>
          </div>

          <button
            onClick={() => {
              onSave(edit);
              setEdit(edit);
            }}
            disabled={saving}
            className="rounded-xl bg-[#0b1024] px-5 py-2.5 text-[14px] font-medium text-white disabled:opacity-50"
          >
            {saving ? "Сохраняем…" : "Сохранить"}
          </button>
        </div>
      )}
    </div>
  );
}

function NewScopeCard({
  managers,
  positions,
  employees,
  journals,
  onSave,
  saving,
}: {
  managers: Employee[];
  positions: Position[];
  employees: Employee[];
  journals: Journal[];
  onSave: (scope: Partial<Scope> & { managerId: string }) => void;
  saving: boolean;
}) {
  const [managerId, setManagerId] = useState(managers[0]?.id ?? "");
  const [viewMode, setViewMode] = useState<Scope["viewMode"]>("all");
  const [viewJobPositionIds, setViewJobPositionIds] = useState<string[]>([]);
  const [viewUserIds, setViewUserIds] = useState<string[]>([]);
  const [assignableJournalCodes, setAssignableJournalCodes] = useState<string[]>([]);
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-300 bg-slate-50 py-4 text-[14px] font-medium text-slate-500 hover:border-slate-400 hover:text-slate-700"
      >
        <Plus className="size-4" />
        Добавить правило
      </button>
    );
  }

  return (
    <div className="rounded-2xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
      <div className="space-y-4">
        <div>
          <label className="block text-[13px] font-medium text-[#0b1024]">Руководитель</label>
          <select
            value={managerId}
            onChange={(e) => setManagerId(e.target.value)}
            className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-[14px] focus:border-slate-400 focus:outline-none"
          >
            {managers.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-[13px] font-medium text-[#0b1024]">Кого видит</label>
          <select
            value={viewMode}
            onChange={(e) => setViewMode(e.target.value as Scope["viewMode"])}
            className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-[14px] focus:border-slate-400 focus:outline-none"
          >
            <option value="all">Все сотрудники</option>
            <option value="job_positions">Определённые должности</option>
            <option value="specific_users">Конкретные люди</option>
            <option value="none">Никого (только себя)</option>
          </select>
        </div>

        {viewMode === "job_positions" && (
          <div className="flex flex-wrap gap-2">
            {positions.map((p) => (
              <label
                key={p.id}
                className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[13px] ${
                  viewJobPositionIds.includes(p.id)
                    ? "border-[#5566f6] bg-[#eef1ff] text-[#5566f6]"
                    : "border-slate-200 text-slate-600"
                }`}
              >
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={viewJobPositionIds.includes(p.id)}
                  onChange={(e) =>
                    setViewJobPositionIds(
                      e.target.checked
                        ? [...viewJobPositionIds, p.id]
                        : viewJobPositionIds.filter((id) => id !== p.id)
                    )
                  }
                />
                {p.name}
              </label>
            ))}
          </div>
        )}

        {viewMode === "specific_users" && (
          <div className="flex flex-wrap gap-2">
            {employees
              .filter((e) => e.id !== managerId)
              .map((u) => (
                <label
                  key={u.id}
                  className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[13px] ${
                    viewUserIds.includes(u.id)
                      ? "border-[#5566f6] bg-[#eef1ff] text-[#5566f6]"
                      : "border-slate-200 text-slate-600"
                  }`}
                >
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={viewUserIds.includes(u.id)}
                    onChange={(e) =>
                      setViewUserIds(
                        e.target.checked
                          ? [...viewUserIds, u.id]
                          : viewUserIds.filter((id) => id !== u.id)
                      )
                    }
                  />
                  {u.name}
                </label>
              ))}
          </div>
        )}

        <div>
          <label className="block text-[13px] font-medium text-[#0b1024]">
            Журналы для назначения (пусто = все)
          </label>
          <div className="mt-1 flex flex-wrap gap-2">
            {journals.map((j) => (
              <label
                key={j.code}
                className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[13px] ${
                  assignableJournalCodes.includes(j.code)
                    ? "border-[#5566f6] bg-[#eef1ff] text-[#5566f6]"
                    : "border-slate-200 text-slate-600"
                }`}
              >
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={assignableJournalCodes.includes(j.code)}
                  onChange={(e) =>
                    setAssignableJournalCodes(
                      e.target.checked
                        ? [...assignableJournalCodes, j.code]
                        : assignableJournalCodes.filter((c) => c !== j.code)
                    )
                  }
                />
                {j.name}
              </label>
            ))}
          </div>
        </div>

        <div className="flex gap-2">
          <button
            onClick={() =>
              onSave({
                managerId,
                viewMode,
                viewJobPositionIds,
                viewUserIds,
                assignableJournalCodes,
              })
            }
            disabled={saving || !managerId}
            className="rounded-xl bg-[#0b1024] px-5 py-2.5 text-[14px] font-medium text-white disabled:opacity-50"
          >
            {saving ? "Сохраняем…" : "Добавить"}
          </button>
          <button
            onClick={() => {
              setOpen(false);
              setViewMode("all");
              setViewJobPositionIds([]);
              setViewUserIds([]);
              setAssignableJournalCodes([]);
            }}
            className="rounded-xl border border-slate-200 px-5 py-2.5 text-[14px] font-medium text-slate-600"
          >
            Отмена
          </button>
        </div>
      </div>
    </div>
  );
}
