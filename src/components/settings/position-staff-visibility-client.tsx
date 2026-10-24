"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  ChevronDown,
  Loader2,
  Save,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Position = {
  id: string;
  name: string;
  categoryKey: string;
  activeUsers: number;
  visibleUserIds: string[];
};

type Employee = {
  id: string;
  name: string;
  jobPositionId: string | null;
  positionName: string | null;
  positionCategory: string | null;
};

type Props = {
  positions: Position[];
  employees: Employee[];
};

type VisibilityMap = Map<string, Set<string>>; // viewerPositionId → Set<userId>

const UNASSIGNED_GROUP_ID = "__unassigned__";

/**
 * Компактный UI: каждая должность (строка) видит группы-чипы по
 * целевым должностям. Клик по телу чипа — toggle всю группу. Клик
 * по chevron'у — раскрыть и подкрутить отдельных сотрудников. Так
 * для большой компании не нужно листать гигантскую таблицу
 * должность × сотрудник: чаще всего достаточно «Шеф → Повара»,
 * редко нужно тонкое исключение.
 */
export function PositionStaffVisibilityClient({ positions, employees }: Props) {
  const t = useTranslations("settingsUi.positionStaffVisibilityClient");
  const locale = useLocale();
  const router = useRouter();

  // Группируем сотрудников по jobPositionId — это «целевые группы»
  // для чипов. Сотрудники без jobPositionId (новые без должности)
  // собираются в «Без должности».
  const groups = useMemo(() => {
    const byGroup = new Map<
      string,
      {
        groupId: string;
        groupName: string;
        groupCategory: string | null;
        members: Employee[];
      }
    >();
    for (const e of employees) {
      const key = e.jobPositionId ?? UNASSIGNED_GROUP_ID;
      const existing = byGroup.get(key);
      if (existing) {
        existing.members.push(e);
        continue;
      }
      const positionRow = positions.find((p) => p.id === e.jobPositionId);
      byGroup.set(key, {
        groupId: key,
        groupName:
          positionRow?.name ?? e.positionName ?? t("noPosition"),
        groupCategory: positionRow?.categoryKey ?? e.positionCategory ?? null,
        members: [e],
      });
    }
    // Сортируем: сначала management, потом staff, потом без — alphabetical внутри
    return Array.from(byGroup.values()).sort((a, b) => {
      const catRank = (c: string | null) =>
        c === "management" ? 0 : c === "staff" ? 1 : 2;
      const r = catRank(a.groupCategory) - catRank(b.groupCategory);
      if (r !== 0) return r;
      return a.groupName.localeCompare(b.groupName, locale);
    });
  }, [positions, employees, t, locale]);

  const [base] = useState<VisibilityMap>(
    () =>
      new Map(positions.map((p) => [p.id, new Set(p.visibleUserIds)]))
  );
  const [curr, setCurr] = useState<VisibilityMap>(
    () =>
      new Map(positions.map((p) => [p.id, new Set(p.visibleUserIds)]))
  );
  const [query, setQuery] = useState("");
  const [posCatFilter, setPosCatFilter] = useState<
    "all" | "management" | "staff"
  >("all");
  // Развёрнутые группы для каждой строки: rowKey = `${viewerPositionId}:${groupId}`
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const dirty = useMemo(() => {
    const out = new Set<string>();
    for (const [posId, currSet] of curr.entries()) {
      const baseSet = base.get(posId) ?? new Set<string>();
      if (currSet.size !== baseSet.size) {
        out.add(posId);
        continue;
      }
      for (const id of currSet) {
        if (!baseSet.has(id)) {
          out.add(posId);
          break;
        }
      }
    }
    return out;
  }, [base, curr]);

  const q = query.trim().toLowerCase();
  const filteredPositions = useMemo(
    () =>
      positions.filter((p) => {
        if (posCatFilter !== "all" && p.categoryKey !== posCatFilter)
          return false;
        if (q && !p.name.toLowerCase().includes(q)) return false;
        return true;
      }),
    [positions, posCatFilter, q]
  );

  function toggleExpanded(viewerId: string, groupId: string) {
    const key = `${viewerId}:${groupId}`;
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleGroup(viewerId: string, group: (typeof groups)[number]) {
    setCurr((prev) => {
      const next = new Map(prev);
      const set = new Set(next.get(viewerId) ?? new Set<string>());
      const allMembers = group.members.map((m) => m.id);
      const allSelected = allMembers.every((id) => set.has(id));
      if (allSelected) {
        // Полностью включена → выключаем всю группу
        for (const id of allMembers) set.delete(id);
      } else {
        // Любое другое состояние (нет / частично) → включаем всех
        for (const id of allMembers) set.add(id);
      }
      next.set(viewerId, set);
      return next;
    });
  }

  function toggleMember(viewerId: string, userId: string) {
    setCurr((prev) => {
      const next = new Map(prev);
      const set = new Set(next.get(viewerId) ?? new Set<string>());
      if (set.has(userId)) set.delete(userId);
      else set.add(userId);
      next.set(viewerId, set);
      return next;
    });
  }

  function clearViewer(viewerId: string) {
    setCurr((prev) => {
      const next = new Map(prev);
      next.set(viewerId, new Set());
      return next;
    });
  }

  function selectAllForViewer(viewerId: string) {
    setCurr((prev) => {
      const next = new Map(prev);
      const set = new Set<string>();
      for (const e of employees) set.add(e.id);
      next.set(viewerId, set);
      return next;
    });
  }

  async function save() {
    if (saving || dirty.size === 0) return;
    setSaving(true);
    try {
      let ok = 0;
      let failed = 0;
      for (const positionId of dirty) {
        const set = curr.get(positionId) ?? new Set<string>();
        const res = await fetch(
          `/api/settings/positions/${positionId}/visible-users`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userIds: [...set] }),
          }
        );
        if (res.ok) ok += 1;
        else failed += 1;
      }
      if (failed > 0) toast.error(t("savedWithErrors", { ok, failed }));
      else toast.success(t("savedFor", { count: ok }));
      pushToTasksflow(false);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("networkError"));
    } finally {
      setSaving(false);
    }
  }

  async function pushToTasksflow(showError: boolean) {
    setSyncing(true);
    try {
      const res = await fetch(
        "/api/integrations/tasksflow/sync-hierarchy",
        { method: "POST" }
      );
      if (!res.ok && showError) {
        const data = await res.json().catch(() => null);
        toast.error(data?.error ?? `Sync ${res.status}`);
      } else if (res.ok) {
        const data = (await res.json()) as {
          managersUpdated: number;
          managersSkipped: number;
          errors: number;
        };
        toast.success(
          t("syncResult", { updated: data.managersUpdated }) +
            (data.managersSkipped ? t("syncSkipped", { count: data.managersSkipped }) : "") +
            (data.errors ? t("syncErrors", { count: data.errors }) : "")
        );
      }
    } catch {
      if (showError) toast.error(t("tasksflowUnavailable"));
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Top toolbar */}
      <section className="flex flex-wrap items-center gap-3 rounded-3xl border border-[#ececf4] bg-white p-4 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] dark:border-white/10 dark:bg-white/[0.04] dark:shadow-none">
        <div className="relative w-full min-w-[200px] flex-1 sm:w-auto">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#9b9fb3] dark:text-white/50" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("filterPlaceholder")}
            className="h-10 rounded-2xl border-[#dcdfed] pl-9 dark:border-white/15"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {(
            [
              ["all", t("filterAll")],
              ["management", t("filterManagement")],
              ["staff", t("filterStaff")],
            ] as const
          ).map(([k, l]) => (
            <button
              key={k}
              type="button"
              onClick={() => setPosCatFilter(k)}
              className={cn(
                "rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors",
                posCatFilter === k
                  ? "border-[#5566f6] bg-[#5566f6] text-white"
                  : "border-[#dcdfed] bg-white text-[#3c4053] hover:bg-[#f5f6ff] dark:border-white/15 dark:bg-white/10 dark:text-white/85 dark:hover:bg-white/15"
              )}
            >
              {l}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => pushToTasksflow(true)}
          disabled={syncing}
          className="ml-auto inline-flex h-10 items-center gap-2 rounded-lg border-0 bg-[#5566f6]/[0.04] px-4 text-[14px] font-semibold text-[#5566f6] transition-colors hover:bg-[#5566f6]/[0.09] disabled:opacity-60 dark:border-white/15 dark:/5 dark:text-[#c4b5fd] dark:hover:/10"
        >
          {syncing ? <Loader2 className="size-4 animate-spin" /> : null}
          {t("syncTasksflow")}
        </button>
      </section>

      {/* Hint */}
      <div className="rounded-2xl border border-[#dcdfed] bg-[#fafbff] p-4 text-[12px] leading-relaxed text-[#6f7282] dark:border-white/10 dark:bg-white/5 dark:text-white/65">
        <Sparkles className="mr-1.5 inline size-3.5 text-[#5566f6]" />
        {t("hint")}
      </div>

      {/* Position rows */}
      <div className="space-y-3">
        {filteredPositions.map((viewer) => {
          const set = curr.get(viewer.id) ?? new Set<string>();
          const totalSelected = set.size;
          const totalEmployees = employees.length;
          const isDirty = dirty.has(viewer.id);
          return (
            <section
              key={viewer.id}
              className={cn(
                "rounded-3xl border bg-white p-4 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] transition-colors dark:bg-white/[0.04] dark:shadow-none sm:p-5",
                isDirty
                  ? "border-amber-300 bg-amber-50/50 dark:border-amber-400/40 dark:bg-amber-500/5"
                  : "border-[#ececf4] dark:border-white/10"
              )}
            >
              {/* Row header */}
              <div className="flex flex-wrap items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-[15px] font-semibold text-[#0b1024] dark:text-white">
                      {viewer.name}
                    </h3>
                    <span className="inline-flex items-center gap-1 rounded-full bg-[#f5f6ff] px-2 py-0.5 text-[11px] font-medium text-[#3848c7] dark:bg-white/10 dark:text-[#c4b5fd]">
                      {t("employees", { count: viewer.activeUsers })}
                    </span>
                    <span className="text-[11px] text-[#9b9fb3] dark:text-white/50">
                      {viewer.categoryKey === "management"
                        ? t("categoryManagement")
                        : t("categoryStaff")}
                    </span>
                  </div>
                  <div className="mt-1 text-[12px] text-[#6f7282] dark:text-white/60">
                    {totalSelected === 0
                      ? t("seesNobody")
                      : t("seesCount", { selected: totalSelected, total: totalEmployees })}
                  </div>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  <button
                    type="button"
                    onClick={() => selectAllForViewer(viewer.id)}
                    className="rounded-full border border-[#dcdfed] bg-white px-3 py-1 text-[11px] font-medium text-[#3c4053] hover:bg-[#f5f6ff] dark:border-white/15 dark:bg-white/10 dark:text-white/85 dark:hover:bg-white/15"
                  >
                    {t("selectAll")}
                  </button>
                  <button
                    type="button"
                    onClick={() => clearViewer(viewer.id)}
                    className="rounded-full border border-[#dcdfed] bg-white px-3 py-1 text-[11px] font-medium text-[#3c4053] hover:bg-[#f5f6ff] dark:border-white/15 dark:bg-white/10 dark:text-white/85 dark:hover:bg-white/15"
                  >
                    {t("clear")}
                  </button>
                </div>
              </div>

              {/* Group chips */}
              <div className="mt-3 flex flex-wrap gap-2">
                {groups.map((g) => {
                  const memberIds = g.members.map((m) => m.id);
                  const selectedInGroup = memberIds.filter((id) =>
                    set.has(id)
                  ).length;
                  const total = memberIds.length;
                  const state =
                    selectedInGroup === 0
                      ? "none"
                      : selectedInGroup === total
                        ? "full"
                        : "partial";
                  const isExpanded = expanded.has(`${viewer.id}:${g.groupId}`);
                  return (
                    <div key={g.groupId} className="contents">
                      <div
                        className={cn(
                          "inline-flex items-stretch overflow-hidden rounded-full border transition-colors",
                          state === "full" &&
                            "border-[#7cf5c0] bg-[#ecfdf5] text-[#136b2a] dark:border-emerald-400/40 dark:bg-emerald-500/15 dark:text-emerald-200",
                          state === "partial" &&
                            "border-[#fbbf24] bg-[#fff8eb] text-[#9a6300] dark:border-amber-400/45 dark:bg-amber-500/12 dark:text-amber-200",
                          state === "none" &&
                            "border-[#dcdfed] bg-white text-[#3c4053] hover:bg-[#f5f6ff] dark:border-white/15 dark:bg-white/10 dark:text-white/85 dark:hover:bg-white/15"
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => toggleGroup(viewer.id, g)}
                          className="inline-flex items-center gap-1.5 px-3 py-1 text-[12px] font-medium"
                          title={
                            state === "full"
                              ? t("groupFullTitle")
                              : t("groupEnableTitle")
                          }
                        >
                          {state === "full" ? (
                            <Check className="size-3.5" />
                          ) : null}
                          <span>{g.groupName}</span>
                          <span className="opacity-70">
                            {state === "full"
                              ? `${total}`
                              : state === "none"
                                ? `0/${total}`
                                : `${selectedInGroup}/${total}`}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleExpanded(viewer.id, g.groupId)}
                          aria-label={t("expandList")}
                          className="inline-flex items-center px-2 border-l border-current/15 transition-colors hover:bg-black/5 dark:hover:bg-white/5"
                        >
                          <ChevronDown
                            className={cn(
                              "size-3.5 transition-transform",
                              isExpanded ? "rotate-180" : ""
                            )}
                          />
                        </button>
                      </div>

                      {/* Expanded users list — рендерим под чип-row,
                          чтобы рядом с группой; ограничиваем ширину
                          дабы не растягивать на всю карточку. */}
                      {isExpanded ? (
                        <div className="mt-1 basis-full">
                          <div className="ml-1 rounded-2xl border border-[#ececf4] bg-[#fafbff] p-3 dark:border-white/10 dark:bg-white/[0.04]">
                            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[#6f7282] dark:text-white/55">
                              {g.groupName} · {t("employees", { count: total })}
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {g.members.map((m) => {
                                const checked = set.has(m.id);
                                return (
                                  <button
                                    key={m.id}
                                    type="button"
                                    onClick={() => toggleMember(viewer.id, m.id)}
                                    className={cn(
                                      "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] transition-colors",
                                      checked
                                        ? "border-[#5566f6] bg-[#5566f6] text-white"
                                        : "border-[#dcdfed] bg-white text-[#3c4053] hover:bg-[#eef1ff] dark:border-white/15 dark:bg-white/10 dark:text-white/85 dark:hover:bg-white/15"
                                    )}
                                  >
                                    {checked ? (
                                      <Check className="size-3" />
                                    ) : (
                                      <X className="size-3 opacity-50" />
                                    )}
                                    {m.name}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
                {groups.length === 0 ? (
                  <div className="text-[12px] text-[#9b9fb3] dark:text-white/50">
                    {t("noActiveEmployees")}
                  </div>
                ) : null}
              </div>
            </section>
          );
        })}
        {filteredPositions.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-6 py-12 text-center text-[13px] text-[#9b9fb3] dark:border-white/10 dark:bg-white/[0.04] dark:text-white/50">
            {t("noPositionsMatch")}
          </div>
        ) : null}
      </div>

      {/* Sticky save bar */}
      <div className="sticky bottom-4 z-10 flex flex-wrap items-center gap-3 rounded-3xl border border-[#ececf4] bg-white/95 px-4 py-3 shadow-[0_12px_32px_-16px_rgba(11,16,36,0.18)] backdrop-blur dark:border-white/10 dark:bg-[#0b1024]/85 dark:shadow-[0_12px_32px_-16px_rgba(0,0,0,0.6)] sm:px-5">
        <div className="text-[13px] text-[#3c4053] dark:text-white/80">
          {dirty.size === 0
            ? t("noChanges")
            : t("changedCount", { count: dirty.size })}
        </div>
        <Button
          type="button"
          onClick={save}
          disabled={saving || dirty.size === 0}
          className="ml-auto h-11 rounded-2xl bg-[#5566f6] px-5 text-[14px] font-medium text-white hover:bg-[#4a5bf0] disabled:bg-[#c8cbe0]"
        >
          {saving ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Save className="size-4" />
          )}
          {t("save")}
        </Button>
      </div>
    </div>
  );
}

