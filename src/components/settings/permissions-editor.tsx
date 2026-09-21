"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Building2,
  ChevronDown,
  Loader2,
  RotateCcw,
  Save,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Permission } from "@/lib/permissions";

type PermissionGroup = {
  id: string;
  title: string;
  description: string;
  items: ReadonlyArray<{ code: Permission; label: string; hint?: string }>;
};

type PositionItem = {
  id: string;
  name: string;
  categoryKey: "management" | "staff";
  permissions: Permission[] | null;
  memberCount: number;
};

type UserItem = {
  id: string;
  name: string;
  role: string;
  jobPositionId: string | null;
  positionName: string | null;
  positionCategory: string | null;
  permissions: Permission[] | null;
};

type Props = {
  groups: PermissionGroup[];
  positions: PositionItem[];
  users: UserItem[];
  managementDefaults: Permission[];
  staffDefaults: Permission[];
};

export function PermissionsEditor({
  groups,
  positions,
  users,
  managementDefaults,
  staffDefaults,
}: Props) {
  const router = useRouter();
  const [positionState, setPositionState] = useState(positions);
  const [userState, setUserState] = useState(users);
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const positionsByCategory = useMemo(() => {
    const management = positionState.filter((p) => p.categoryKey === "management");
    const staff = positionState.filter((p) => p.categoryKey === "staff");
    return { management, staff };
  }, [positionState]);

  const dirty = useMemo(() => {
    const posChanged = positionState.some((p, idx) => {
      const orig = positions[idx];
      return !samePermissions(p.permissions, orig.permissions);
    });
    if (posChanged) return true;
    return userState.some((u, idx) => {
      const orig = users[idx];
      return !samePermissions(u.permissions, orig.permissions);
    });
  }, [positionState, userState, positions, users]);

  function toggleExpanded(key: string) {
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function updatePositionPermission(
    positionId: string,
    code: Permission,
    enabled: boolean
  ) {
    setPositionState((prev) =>
      prev.map((p) => {
        if (p.id !== positionId) return p;
        const current = new Set(
          p.permissions ?? defaultsForCategory(p.categoryKey, managementDefaults, staffDefaults)
        );
        if (enabled) current.add(code);
        else current.delete(code);
        return { ...p, permissions: [...current] };
      })
    );
  }

  function updateUserPermission(
    userId: string,
    code: Permission,
    enabled: boolean,
    inheritedSet: Set<Permission>
  ) {
    setUserState((prev) =>
      prev.map((u) => {
        if (u.id !== userId) return u;
        const base = new Set(u.permissions ?? inheritedSet);
        if (enabled) base.add(code);
        else base.delete(code);
        return { ...u, permissions: [...base] };
      })
    );
  }

  function resetPosition(positionId: string) {
    setPositionState((prev) =>
      prev.map((p) => (p.id === positionId ? { ...p, permissions: null } : p))
    );
  }

  function resetUser(userId: string) {
    setUserState((prev) =>
      prev.map((u) => (u.id === userId ? { ...u, permissions: null } : u))
    );
  }

  async function save() {
    if (saving || !dirty) return;
    setSaving(true);
    try {
      const positionChanges = positionState
        .map((p, idx) => {
          const orig = positions[idx];
          return samePermissions(p.permissions, orig.permissions)
            ? null
            : { id: p.id, permissions: p.permissions };
        })
        .filter((v): v is { id: string; permissions: Permission[] | null } => !!v);
      const userChanges = userState
        .map((u, idx) => {
          const orig = users[idx];
          return samePermissions(u.permissions, orig.permissions)
            ? null
            : { id: u.id, permissions: u.permissions };
        })
        .filter((v): v is { id: string; permissions: Permission[] | null } => !!v);

      const res = await fetch("/api/organizations/permissions", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          positions: positionChanges,
          users: userChanges,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(data?.error ?? "Не удалось сохранить");
        return;
      }
      toast.success("Права сохранены");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Ошибка сети");
    } finally {
      setSaving(false);
    }
  }

  function getPositionEffective(position: PositionItem): Set<Permission> {
    if (position.permissions !== null) return new Set(position.permissions);
    return new Set(
      defaultsForCategory(position.categoryKey, managementDefaults, staffDefaults)
    );
  }

  function getUserEffective(user: UserItem): {
    set: Set<Permission>;
    inheritedSet: Set<Permission>;
    source: "user" | "position" | "group";
    positionName: string | null;
  } {
    const position = positionState.find((p) => p.id === user.jobPositionId);
    const group: "management" | "staff" = (() => {
      if (position) return position.categoryKey;
      if (user.positionCategory === "staff") return "staff";
      if (user.positionCategory === "management") return "management";
      // fallback по role
      if (user.role === "manager" || user.role === "owner") return "management";
      if (user.role === "head_chef" || user.role === "technologist")
        return "management";
      return "staff";
    })();
    const groupDefaults = new Set(
      defaultsForCategory(group, managementDefaults, staffDefaults)
    );
    const positionEffective = position ? getPositionEffective(position) : groupDefaults;
    if (user.permissions !== null) {
      return {
        set: new Set(user.permissions),
        inheritedSet: positionEffective,
        source: "user",
        positionName: position?.name ?? null,
      };
    }
    if (position && position.permissions !== null) {
      return {
        set: new Set(position.permissions),
        inheritedSet: positionEffective,
        source: "position",
        positionName: position.name,
      };
    }
    return {
      set: groupDefaults,
      inheritedSet: positionEffective,
      source: "group",
      positionName: position?.name ?? null,
    };
  }

  return (
    <div className="space-y-4">
      {/* Group-level defaults — reference card */}
      <section className="rounded-3xl border border-[#ececf4] bg-[#fafbff] p-5">
        <div className="flex items-start gap-3">
          <Building2 className="size-5 shrink-0 text-[#5566f6]" />
          <div className="flex-1">
            <div className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
              Дефолты групп
            </div>
            <p className="mt-1 text-[13px] text-[#3c4053]">
              Если у должности и у конкретного человека ничего не переопределено,
              применяются эти базовые наборы. Меняются через редактирование
              должности.
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <SummaryChip
                label="Руководство"
                total={managementDefaults.length}
                allCount={groups.reduce((n, g) => n + g.items.length, 0)}
              />
              <SummaryChip
                label="Сотрудники"
                total={staffDefaults.length}
                allCount={groups.reduce((n, g) => n + g.items.length, 0)}
              />
            </div>
          </div>
        </div>
      </section>

      {/* Positions */}
      <section className="rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] md:p-6">
        <div className="flex items-center gap-2 border-b border-[#ececf4] pb-3">
          <Users className="size-4 text-[#5566f6]" />
          <h2 className="text-[15px] font-semibold text-[#0b1024]">
            Должности
          </h2>
          <span className="ml-2 rounded-full bg-[#eef1ff] px-2 py-0.5 text-[11px] font-medium text-[#3848c7]">
            {positionState.length}
          </span>
        </div>

        <div className="mt-3 space-y-6">
          <PositionCategoryBlock
            title="Руководство"
            positions={positionsByCategory.management}
            groups={groups}
            expanded={expanded}
            onToggleExpand={toggleExpanded}
            onToggleItem={updatePositionPermission}
            onReset={resetPosition}
            getEffective={getPositionEffective}
            managementDefaults={managementDefaults}
            staffDefaults={staffDefaults}
          />
          <PositionCategoryBlock
            title="Сотрудники"
            positions={positionsByCategory.staff}
            groups={groups}
            expanded={expanded}
            onToggleExpand={toggleExpanded}
            onToggleItem={updatePositionPermission}
            onReset={resetPosition}
            getEffective={getPositionEffective}
            managementDefaults={managementDefaults}
            staffDefaults={staffDefaults}
          />
        </div>
      </section>

      {/* Users (individual overrides) */}
      <section className="rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] md:p-6">
        <div className="flex items-center gap-2 border-b border-[#ececf4] pb-3">
          <Users className="size-4 text-[#5566f6]" />
          <h2 className="text-[15px] font-semibold text-[#0b1024]">
            Индивидуальные права
          </h2>
          <span className="ml-2 rounded-full bg-[#eef1ff] px-2 py-0.5 text-[11px] font-medium text-[#3848c7]">
            {userState.length}
          </span>
        </div>
        <p className="mt-2 text-[13px] text-[#6f7282]">
          Особые права только для конкретного человека. По умолчанию сотрудник
          наследует права своей должности.
        </p>
        <ul className="mt-3 divide-y divide-[#ececf4]">
          {userState.map((u) => {
            const { set, inheritedSet, source, positionName } = getUserEffective(u);
            const expandKey = `user:${u.id}`;
            const isOpen = expanded[expandKey] === true;
            return (
              <li key={u.id} className="py-3">
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => toggleExpanded(expandKey)}
                    className="flex flex-1 items-center gap-2 text-left"
                  >
                    <ChevronDown
                      className={cn(
                        "size-4 text-[#9b9fb3] transition-transform",
                        isOpen ? "rotate-0" : "-rotate-90"
                      )}
                    />
                    <span className="text-[14px] font-medium text-[#0b1024]">
                      {u.name}
                    </span>
                    <span className="text-[12px] text-[#6f7282]">
                      {positionName ? `· ${positionName}` : ""}
                    </span>
                    <span className="ml-auto text-[11px] text-[#9b9fb3]">
                      {source === "user"
                        ? "личные права"
                        : source === "position"
                          ? `от должности${positionName ? ` «${positionName}»` : ""}`
                          : "от группы"}
                    </span>
                  </button>
                  {u.permissions !== null ? (
                    <button
                      type="button"
                      onClick={() => resetUser(u.id)}
                      className="inline-flex items-center gap-1 rounded-full border border-[#dcdfed] bg-white px-2.5 py-1 text-[11px] font-medium text-[#3c4053] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
                      title="Вернуть к наследованию от должности/группы"
                    >
                      <RotateCcw className="size-3" />
                      Сбросить
                    </button>
                  ) : null}
                </div>
                {isOpen ? (
                  <div className="mt-3 space-y-4 pl-6">
                    {groups.map((g) => (
                      <GroupBlock
                        key={g.id}
                        group={g}
                        set={set}
                        onToggle={(code, enabled) =>
                          updateUserPermission(u.id, code, enabled, inheritedSet)
                        }
                      />
                    ))}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>

      {/* Sticky save bar */}
      <div className="sticky bottom-4 z-10 flex flex-wrap items-center gap-3 rounded-3xl border border-[#ececf4] bg-white/95 px-5 py-3 shadow-[0_12px_32px_-16px_rgba(11,16,36,0.18)] backdrop-blur">
        <div className="text-[13px] text-[#3c4053]">
          {dirty
            ? "Есть несохранённые изменения"
            : "Изменений нет"}
        </div>
        <Button
          type="button"
          onClick={save}
          disabled={!dirty || saving}
          className="ml-auto h-11 rounded-2xl bg-[#5566f6] px-5 text-[14px] font-medium text-white hover:bg-[#4a5bf0] disabled:bg-[#c8cbe0]"
        >
          {saving ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Save className="size-4" />
          )}
          Сохранить
        </Button>
      </div>
    </div>
  );
}

function SummaryChip({
  label,
  total,
  allCount,
}: {
  label: string;
  total: number;
  allCount: number;
}) {
  const pct = allCount === 0 ? 0 : Math.round((total / allCount) * 100);
  return (
    <div className="rounded-2xl border border-[#ececf4] bg-white px-3 py-2.5">
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-medium text-[#0b1024]">{label}</span>
        <span className="rounded-full bg-[#eef1ff] px-2 py-0.5 text-[11px] font-semibold text-[#3848c7] tabular-nums">
          {total} / {allCount}
        </span>
      </div>
      <div className="mt-2 h-1.5 rounded-full bg-[#f0f2f7]">
        <div
          className="h-full rounded-full bg-[#5566f6]"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function PositionCategoryBlock({
  title,
  positions,
  groups,
  expanded,
  onToggleExpand,
  onToggleItem,
  onReset,
  getEffective,
}: {
  title: string;
  positions: PositionItem[];
  groups: PermissionGroup[];
  expanded: Record<string, boolean>;
  onToggleExpand: (key: string) => void;
  onToggleItem: (positionId: string, code: Permission, enabled: boolean) => void;
  onReset: (positionId: string) => void;
  getEffective: (p: PositionItem) => Set<Permission>;
  managementDefaults: Permission[];
  staffDefaults: Permission[];
}) {
  if (positions.length === 0) {
    return (
      <div>
        <div className="text-[12px] font-semibold uppercase tracking-[0.14em] text-[#9b9fb3]">
          {title}
        </div>
        <p className="mt-2 text-[13px] text-[#9b9fb3]">
          Должностей в этой группе пока нет.
        </p>
      </div>
    );
  }
  return (
    <div>
      <div className="text-[12px] font-semibold uppercase tracking-[0.14em] text-[#9b9fb3]">
        {title}
      </div>
      <ul className="mt-2 divide-y divide-[#ececf4]">
        {positions.map((p) => {
          const key = `pos:${p.id}`;
          const isOpen = expanded[key] === true;
          const effective = getEffective(p);
          return (
            <li key={p.id} className="py-3">
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => onToggleExpand(key)}
                  className="flex flex-1 items-center gap-2 text-left"
                >
                  <ChevronDown
                    className={cn(
                      "size-4 text-[#9b9fb3] transition-transform",
                      isOpen ? "rotate-0" : "-rotate-90"
                    )}
                  />
                  <span className="text-[14px] font-medium text-[#0b1024]">
                    {p.name}
                  </span>
                  <span className="text-[12px] text-[#6f7282]">
                    · {p.memberCount}{" "}
                    {pluralizePeople(p.memberCount)}
                  </span>
                  <span className="ml-auto text-[11px] text-[#9b9fb3]">
                    {p.permissions === null
                      ? "по умолчанию для группы"
                      : `настроено: ${p.permissions.length}`}
                  </span>
                </button>
                {p.permissions !== null ? (
                  <button
                    type="button"
                    onClick={() => onReset(p.id)}
                    className="inline-flex items-center gap-1 rounded-full border border-[#dcdfed] bg-white px-2.5 py-1 text-[11px] font-medium text-[#3c4053] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
                    title="Вернуть к дефолтам группы"
                  >
                    <RotateCcw className="size-3" />
                    Сбросить
                  </button>
                ) : null}
              </div>
              {isOpen ? (
                <div className="mt-3 space-y-4 pl-6">
                  {groups.map((g) => (
                    <GroupBlock
                      key={g.id}
                      group={g}
                      set={effective}
                      onToggle={(code, enabled) => onToggleItem(p.id, code, enabled)}
                    />
                  ))}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function GroupBlock({
  group,
  set,
  onToggle,
}: {
  group: PermissionGroup;
  set: Set<Permission>;
  onToggle: (code: Permission, enabled: boolean) => void;
}) {
  return (
    <div>
      <div className="text-[12px] font-semibold text-[#0b1024]">
        {group.title}
      </div>
      <p className="text-[12px] text-[#6f7282]">{group.description}</p>
      <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
        {group.items.map((it) => (
          <label
            key={it.code}
            className="flex cursor-pointer items-start gap-2 rounded-xl px-2 py-1.5 text-[13px] hover:bg-[#fafbff]"
          >
            <Checkbox
              checked={set.has(it.code)}
              onCheckedChange={(v) => onToggle(it.code, v === true)}
              className="mt-0.5"
            />
            <span className="text-[#3c4053]">{it.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

function samePermissions(
  a: Permission[] | null,
  b: Permission[] | null
): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  if (a.length !== b.length) return false;
  const sorted = (xs: Permission[]) => [...xs].sort();
  const la = sorted(a);
  const lb = sorted(b);
  return la.every((x, i) => x === lb[i]);
}

function defaultsForCategory(
  category: "management" | "staff",
  management: Permission[],
  staff: Permission[]
): Permission[] {
  return category === "staff" ? staff : management;
}

function pluralizePeople(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "человек";
  if ([2, 3, 4].includes(mod10) && ![12, 13, 14].includes(mod100))
    return "человека";
  return "человек";
}
