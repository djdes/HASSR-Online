"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Bell, Loader2, Mail, Search, Send, Smartphone, UserCheck, UserMinus, Users } from "lucide-react";
import { toast } from "sonner";

import type { AudienceUserRow, UserAudienceFilters } from "@/lib/mailing/audience";
import { BILLING_KIND_LABELS } from "@/lib/mailing/labels";
import { ORG_SPHERES } from "@/lib/org-profile";
import { cn } from "@/lib/utils";

import { CARD, CHECKBOX, FilterSelect, INPUT, OUTLINE_SM, api, formatDate } from "./ui";

const PAGE = 100;

const SPHERE_OPTIONS = [{ value: "any", label: "Все сферы" }, ...ORG_SPHERES.map((s) => ({ value: s.value, label: s.label }))];
const SPHERE_LABEL = new Map<string, string>(ORG_SPHERES.map((s) => [s.value, s.label]));
const BILLING_OPTIONS = [
  { value: "any", label: "Любой тариф" },
  { value: "free", label: BILLING_KIND_LABELS.free },
  { value: "free_period", label: BILLING_KIND_LABELS.free_period },
  { value: "paid", label: BILLING_KIND_LABELS.paid },
  { value: "needs_decision", label: BILLING_KIND_LABELS.needs_decision },
  { value: "legacy", label: BILLING_KIND_LABELS.legacy },
  { value: "exempt", label: BILLING_KIND_LABELS.exempt },
];

function toQuery(f: UserAudienceFilters): URLSearchParams {
  const q = new URLSearchParams();
  q.set("role", f.role);
  q.set("sphere", f.sphere);
  q.set("billing", f.billing);
  if (f.search) q.set("search", f.search);
  if (f.hasEmail) q.set("hasEmail", "1");
  if (f.hasTelegram) q.set("hasTelegram", "1");
  if (f.hasPush) q.set("hasPush", "1");
  if (f.registeredFrom) q.set("registeredFrom", f.registeredFrom);
  if (f.registeredTo) q.set("registeredTo", f.registeredTo);
  return q;
}

export function UsersTab({
  filters,
  onFilters,
  selected,
  onSelect,
  rememberLabels,
}: {
  filters: UserAudienceFilters;
  onFilters: (next: UserAudienceFilters) => void;
  selected: ReadonlySet<string>;
  onSelect: (ids: string[], on: boolean) => void;
  rememberLabels: (entries: Array<[string, string]>) => void;
}) {
  const [rows, setRows] = useState<AudienceUserRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [search, setSearch] = useState(filters.search);

  // Поиск — с паузой, чтобы не дёргать сервер на каждую букву.
  useEffect(() => {
    const t = setTimeout(() => {
      if (search !== filters.search) onFilters({ ...filters, search });
    }, 350);
    return () => clearTimeout(t);
  }, [search, filters, onFilters]);

  const load = useCallback(
    async (offset: number) => {
      const q = toQuery(filters);
      q.set("offset", String(offset));
      q.set("limit", String(PAGE));
      const data = await api<{ total: number; rows: AudienceUserRow[] }>(`/api/root/mailing/audience/users?${q}`);
      rememberLabels(data.rows.map((r) => [`user:${r.id}`, `${r.name} · ${r.organizationName}`]));
      return data;
    },
    [filters, rememberLabels]
  );

  useEffect(() => {
    let alive = true;
    setLoading(true);
    load(0)
      .then((data) => {
        if (!alive) return;
        setRows(data.rows);
        setTotal(data.total);
      })
      .catch((error) => toast.error(error instanceof Error ? error.message : "Не удалось загрузить"))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [load]);

  async function showMore() {
    setMore(true);
    try {
      const data = await load(rows.length);
      setRows((prev) => [...prev, ...data.rows]);
      setTotal(data.total);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось загрузить");
    } finally {
      setMore(false);
    }
  }

  async function selectAllFound(on: boolean) {
    setBulkBusy(true);
    try {
      const q = toQuery(filters);
      q.set("idsOnly", "1");
      const data = await api<{ total: number; ids: string[] }>(`/api/root/mailing/audience/users?${q}`);
      onSelect(data.ids, on);
      toast.success(on ? `Выбрано найденных: ${data.ids.length}` : `Снят выбор: ${data.ids.length}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ошибка");
    } finally {
      setBulkBusy(false);
    }
  }

  const selectedHere = useMemo(() => rows.filter((r) => selected.has(r.id)).length, [rows, selected]);
  const allShownSelected = rows.length > 0 && selectedHere === rows.length;
  const set = (patch: Partial<UserAudienceFilters>) => onFilters({ ...filters, ...patch });

  return (
    <div className="space-y-4" data-testid="mailing-users-tab">
      <section className={CARD}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <FilterSelect
            label="Кому"
            value={filters.role}
            onChange={(v) => set({ role: v === "all" ? "all" : "managers" })}
            options={[
              { value: "managers", label: "Руководители (тариф и настройки)" },
              { value: "all", label: "Все пользователи" },
            ]}
            testId="users-filter-role"
          />
          <FilterSelect
            label="Сфера организации"
            value={filters.sphere}
            onChange={(v) => set({ sphere: v as UserAudienceFilters["sphere"] })}
            options={SPHERE_OPTIONS}
            testId="users-filter-sphere"
          />
          <FilterSelect
            label="Состояние тарифа"
            value={filters.billing}
            onChange={(v) => set({ billing: v as UserAudienceFilters["billing"] })}
            options={BILLING_OPTIONS}
            testId="users-filter-billing"
          />
          <label className="block min-w-0">
            <span className="mb-1.5 block text-[12px] font-medium text-[#6f7282]">Поиск</span>
            <span className="relative block">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-[#9b9fb3]" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Организация, имя или почта"
                className={cn(INPUT, "pl-10")}
                data-testid="users-filter-search"
              />
            </span>
          </label>
        </div>
        <div className="mt-3 flex flex-wrap items-end gap-x-5 gap-y-3">
          {(
            [
              ["hasEmail", "Есть почта", Mail],
              ["hasTelegram", "Есть Telegram", Send],
              ["hasPush", "Есть устройство для push", Smartphone],
            ] as const
          ).map(([key, label, Icon]) => (
            <label key={key} className="inline-flex cursor-pointer items-center gap-2 text-[14px] text-[#3c4053]">
              <input
                type="checkbox"
                checked={filters[key]}
                onChange={(e) => set({ [key]: e.target.checked } as Partial<UserAudienceFilters>)}
                className={CHECKBOX}
                data-testid={`users-filter-${key}`}
              />
              <Icon className="size-4 text-[#5566f6]" />
              {label}
            </label>
          ))}
          <div className="flex flex-wrap items-end gap-2">
            <label className="block">
              <span className="mb-1 block text-[12px] font-medium text-[#6f7282]">Регистрация с</span>
              <input
                type="date"
                value={filters.registeredFrom ?? ""}
                onChange={(e) => set({ registeredFrom: e.target.value || null })}
                className="h-10 rounded-xl border border-[#dcdfed] bg-white px-3 text-[14px] text-[#0b1024] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[12px] font-medium text-[#6f7282]">по</span>
              <input
                type="date"
                value={filters.registeredTo ?? ""}
                onChange={(e) => set({ registeredTo: e.target.value || null })}
                className="h-10 rounded-xl border border-[#dcdfed] bg-white px-3 text-[14px] text-[#0b1024] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
              />
            </label>
          </div>
        </div>
      </section>

      <section className={CARD}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-[14px] text-[#3c4053]" data-testid="users-found">
            Найдено: <span className="font-semibold tabular-nums text-[#0b1024]">{total}</span>
            <span className="text-[#9b9fb3]"> · выбрано всего: </span>
            <span className="font-semibold tabular-nums text-[#3848c7]" data-testid="users-selected-count">
              {selected.size}
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={OUTLINE_SM}
              disabled={bulkBusy || total === 0}
              onClick={() => void selectAllFound(true)}
              data-testid="users-select-all-found"
            >
              {bulkBusy ? <Loader2 className="size-4 animate-spin" /> : <UserCheck className="size-4 text-[#5566f6]" />}
              Выбрать всех найденных ({total})
            </button>
            <button
              type="button"
              className={OUTLINE_SM}
              disabled={bulkBusy || selected.size === 0}
              onClick={() => void selectAllFound(false)}
            >
              <UserMinus className="size-4 text-[#5566f6]" />
              Снять с найденных
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 py-10 text-[14px] text-[#6f7282]">
            <Loader2 className="size-4 animate-spin" /> Загружаем пользователей…
          </div>
        ) : rows.length === 0 ? (
          <div className="mt-4 rounded-3xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-6 py-12 text-center">
            <Users className="mx-auto size-6 text-[#9b9fb3]" />
            <div className="mt-2 text-[15px] font-medium text-[#0b1024]">Под фильтры никто не подходит</div>
            <p className="mx-auto mt-1.5 max-w-[380px] text-[13px] text-[#6f7282]">
              Ослабьте фильтры — например, выберите «Все пользователи» или любую сферу.
            </p>
          </div>
        ) : (
          <>
            {/* Компьютер: таблица. */}
            <div className="mt-4 hidden overflow-x-auto md:block">
              <table className="w-full min-w-[860px] text-[14px]">
                <thead className="text-left text-[12px] text-[#6f7282]">
                  <tr className="border-b border-[#ececf4]">
                    <th className="w-10 py-2.5 pr-2">
                      <input
                        type="checkbox"
                        aria-label="Выбрать показанных"
                        checked={allShownSelected}
                        onChange={(e) => onSelect(rows.map((r) => r.id), e.target.checked)}
                        className={CHECKBOX}
                      />
                    </th>
                    <th className="py-2.5 pr-3 font-medium">Пользователь</th>
                    <th className="py-2.5 pr-3 font-medium">Организация</th>
                    <th className="py-2.5 pr-3 font-medium">Тариф</th>
                    <th className="py-2.5 pr-3 font-medium">Каналы</th>
                    <th className="py-2.5 font-medium">Регистрация</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr
                      key={r.id}
                      className={cn("border-b border-[#f2f3f8] align-top", selected.has(r.id) && "bg-[#f5f6ff]")}
                      data-testid="users-row"
                    >
                      <td className="py-3 pr-2">
                        <input
                          type="checkbox"
                          aria-label={`Выбрать ${r.name}`}
                          checked={selected.has(r.id)}
                          onChange={(e) => onSelect([r.id], e.target.checked)}
                          className={CHECKBOX}
                        />
                      </td>
                      <td className="py-3 pr-3">
                        <div className="font-medium text-[#0b1024]">{r.name}</div>
                        <div className="text-[13px] text-[#6f7282] [overflow-wrap:anywhere]">
                          {r.email ?? <span className="text-[#9b9fb3]">нет почты</span>}
                          {r.marketingOptOut ? <span className="text-[#a16d32]"> · отписался</span> : null}
                          {r.suppressed ? <span className="text-[#a16d32]"> · в стоп-листе</span> : null}
                        </div>
                        {!r.isManagement ? <div className="text-[12px] text-[#9b9fb3]">сотрудник</div> : null}
                      </td>
                      <td className="py-3 pr-3">
                        <div className="text-[#0b1024]">{r.organizationName}</div>
                        <div className="text-[12px] text-[#6f7282]">{SPHERE_LABEL.get(r.sphere) ?? r.sphere}</div>
                      </td>
                      <td className="py-3 pr-3 text-[13px] text-[#3c4053]">{BILLING_KIND_LABELS[r.billing] ?? r.billing}</td>
                      <td className="py-3 pr-3">
                        <ChannelDots row={r} />
                      </td>
                      <td className="py-3 text-[13px] tabular-nums text-[#6f7282]">{formatDate(r.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Телефон: карточки. */}
            <ul className="mt-4 space-y-2 md:hidden">
              {rows.map((r) => (
                <li key={r.id}>
                  <label
                    className={cn(
                      "flex cursor-pointer items-start gap-3 rounded-2xl border border-[#ececf4] p-3",
                      selected.has(r.id) ? "bg-[#f5f6ff]" : "bg-[#fafbff]"
                    )}
                    data-testid="users-card"
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(r.id)}
                      onChange={(e) => onSelect([r.id], e.target.checked)}
                      className={cn(CHECKBOX, "mt-1")}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium text-[#0b1024]">{r.name}</span>
                      <span className="block text-[13px] text-[#6f7282] [overflow-wrap:anywhere]">
                        {r.email ?? "нет почты"}
                      </span>
                      <span className="mt-1 block text-[13px] text-[#3c4053]">
                        {r.organizationName} · {SPHERE_LABEL.get(r.sphere) ?? r.sphere}
                      </span>
                      <span className="mt-1.5 flex flex-wrap items-center gap-2 text-[12px] text-[#6f7282]">
                        {BILLING_KIND_LABELS[r.billing] ?? r.billing} · {formatDate(r.createdAt)}
                        <ChannelDots row={r} />
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>

            {rows.length < total ? (
              <div className="mt-4 flex justify-center">
                <button type="button" className={OUTLINE_SM} disabled={more} onClick={() => void showMore()}>
                  {more ? <Loader2 className="size-4 animate-spin" /> : null}
                  Показать ещё ({total - rows.length})
                </button>
              </div>
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}

function ChannelDots({ row }: { row: AudienceUserRow }) {
  const items = [
    { on: Boolean(row.email) && !row.suppressed && !row.marketingOptOut, Icon: Mail, title: "Почта" },
    { on: true, Icon: Bell, title: "Колокольчик" },
    { on: row.webPushCount + row.appDeviceCount > 0, Icon: Smartphone, title: "Push" },
    { on: row.hasTelegram, Icon: Send, title: "Telegram" },
  ];
  return (
    <span className="inline-flex items-center gap-1">
      {items.map(({ on, Icon, title }) => (
        <span
          key={title}
          title={`${title}: ${on ? "есть" : "нет"}`}
          className={cn(
            "inline-flex size-6 items-center justify-center rounded-lg",
            on ? "bg-[#eef1ff] text-[#3848c7]" : "bg-[#f5f6fa] text-[#c3c6d4]"
          )}
        >
          <Icon className="size-3.5" />
        </span>
      ))}
    </span>
  );
}
