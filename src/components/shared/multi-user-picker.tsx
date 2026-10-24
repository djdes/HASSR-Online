"use client";

/**
 * Мультивыбор сотрудников для карточки помещения («Кто убирает» /
 * «Кто проверяет»). Визуально — как `UserPicker` в
 * journal-responsibles-client: группы «Рекомендуем / Можно / Не
 * рекомендуем», инициалы, корона у администратора, подсказка справа.
 *
 * Список раскрывается inline (не popover): компонент живёт внутри
 * скроллящегося диалога и на мобильном экране Mini App, где плавающие
 * панели обрезаются.
 *
 * Порядок выбранных = приоритет: первый помечен «основной» (для
 * проверяющих — он получает задачу в TasksFlow). Стрелка на чипе
 * поднимает сотрудника в начало.
 */
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowUp, Check, Crown, Plus, Search, X } from "lucide-react";
import {
  groupRoomResponsibleCandidates,
  type CandidateGroupKey,
  type RoomResponsibleCandidate,
  type RoomResponsibleUser,
} from "@/lib/room-responsible-candidates";
import type { RoomResponsibleRole } from "@/lib/cleaning-room-responsibles";

export type MultiUserPickerProps = {
  value: string[];
  onChange: (ids: string[]) => void;
  users: ReadonlyArray<RoomResponsibleUser>;
  role: RoomResponsibleRole;
  /** userId → сколько помещений уже закреплено (подсказка справа). */
  roomsPerUser?: Map<string, number>;
  /** Подпись под пустым списком. */
  emptyHint: string;
  /** Подпись у первого чипа (например «основной»). Не показывать — undefined. */
  primaryBadge?: string;
  disabled?: boolean;
};

const GROUP_ORDER: CandidateGroupKey[] = ["recommended", "ok", "notRecommended"];

function initialsOf(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

export function MultiUserPicker(props: MultiUserPickerProps) {
  const t = useTranslations("sharedUi.multiUserPicker");
  const groupTitles: Record<CandidateGroupKey, string> = {
    recommended: t("groupRecommended"),
    ok: t("groupOk"),
    notRecommended: t("groupNotRecommended"),
  };
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const userById = useMemo(
    () => new Map(props.users.map((u) => [u.id, u])),
    [props.users],
  );
  const groups = useMemo(
    () => groupRoomResponsibleCandidates(props.users, props.role, props.roomsPerUser),
    [props.users, props.role, props.roomsPerUser],
  );
  const selected = new Set(props.value);
  const q = query.trim().toLowerCase();
  const matches = (c: RoomResponsibleCandidate) =>
    !q ||
    c.user.name.toLowerCase().includes(q) ||
    (c.positionName ?? "").toLowerCase().includes(q);

  function toggle(id: string) {
    if (props.disabled) return;
    props.onChange(
      selected.has(id) ? props.value.filter((x) => x !== id) : [...props.value, id],
    );
  }
  function remove(id: string) {
    if (props.disabled) return;
    props.onChange(props.value.filter((x) => x !== id));
  }
  function makePrimary(id: string) {
    if (props.disabled) return;
    props.onChange([id, ...props.value.filter((x) => x !== id)]);
  }

  return (
    <div className="space-y-2">
      {/* Выбранные — чипы. Первый = основной. */}
      {props.value.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-[#dcdfed] bg-white px-3 py-2.5 text-[12.5px] leading-[1.5] text-[#6f7282]">
          {props.emptyHint}
        </p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {props.value.map((id, idx) => {
            const user = userById.get(id);
            const name = user?.name ?? "—";
            const isPrimary = idx === 0 && props.primaryBadge && props.value.length > 1;
            return (
              <span
                key={id}
                className="inline-flex h-9 items-center gap-1.5 rounded-2xl border border-[#5566f6]/40 bg-[#f5f6ff] pl-1.5 pr-1 text-[13px] font-medium text-[#0b1024]"
              >
                <span className="inline-flex size-6 items-center justify-center rounded-full bg-[#5566f6] text-[10px] font-semibold text-white">
                  {initialsOf(name)}
                </span>
                <span className="max-w-[160px] truncate">{name}</span>
                {isPrimary ? (
                  <span className="rounded-full bg-white px-1.5 py-0.5 text-[10px] font-medium text-[#3848c7]">
                    {props.primaryBadge}
                  </span>
                ) : null}
                {idx > 0 && props.primaryBadge ? (
                  <button
                    type="button"
                    disabled={props.disabled}
                    onClick={() => makePrimary(id)}
                    title={t("makePrimary")}
                    aria-label={t("makePrimaryNamed", { name })}
                    className="rounded-full p-1 text-[#6f7282] transition-colors duration-150 hover:bg-white hover:text-[#5566f6] disabled:opacity-50"
                  >
                    <ArrowUp className="size-3.5" />
                  </button>
                ) : null}
                <button
                  type="button"
                  disabled={props.disabled}
                  onClick={() => remove(id)}
                  aria-label={t("removeNamed", { name })}
                  className="rounded-full p-1 text-[#6f7282] transition-colors duration-150 hover:bg-white hover:text-[#a13a32] disabled:opacity-50"
                >
                  <X className="size-3.5" />
                </button>
              </span>
            );
          })}
        </div>
      )}

      <button
        type="button"
        disabled={props.disabled}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`inline-flex h-9 items-center gap-1.5 rounded-2xl border px-3 text-[13px] font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${
          open
            ? "border-[#5566f6] bg-[#5566f6] text-white hover:bg-[#4a5bf0]"
            : "border-dashed border-[#dcdfed] bg-white text-[#3c4053] hover:border-[#5566f6]/50 hover:bg-[#f5f6ff] hover:text-[#5566f6]"
        }`}
      >
        {open ? <Check className="size-3.5" /> : <Plus className="size-3.5" />}
        {open ? t("done") : props.value.length === 0 ? t("selectEmployees") : t("add")}
      </button>

      {open ? (
        <div className="overflow-hidden rounded-2xl border border-[#ececf4] bg-white">
          <label className="flex items-center gap-2 border-b border-[#ececf4] px-3">
            <Search className="size-4 shrink-0 text-[#9b9fb3]" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("searchPlaceholder")}
              className="h-10 w-full bg-transparent text-[13.5px] text-[#0b1024] placeholder:text-[#9b9fb3] focus:outline-none"
            />
          </label>
          <div className="max-h-[260px] overflow-y-auto p-1.5">
            {GROUP_ORDER.map((key) => {
              const list = groups[key].filter(matches);
              if (list.length === 0) return null;
              return (
                <div key={key} className="mb-1 last:mb-0">
                  <div className="px-2.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#9b9fb3]">
                    {groupTitles[key]}
                  </div>
                  {list.map((c) => {
                    const active = selected.has(c.user.id);
                    return (
                      <button
                        key={c.user.id}
                        type="button"
                        onClick={() => toggle(c.user.id)}
                        aria-pressed={active}
                        className={`flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors duration-150 ${
                          active ? "bg-[#eef1ff]" : "hover:bg-[#f5f6ff]"
                        } ${key === "notRecommended" ? "opacity-80" : ""}`}
                      >
                        <span
                          className={`inline-flex size-5 shrink-0 items-center justify-center rounded-md border transition-colors ${
                            active
                              ? "border-[#5566f6] bg-[#5566f6] text-white"
                              : "border-[#dcdfed] bg-white text-transparent"
                          }`}
                        >
                          <Check className="size-3.5" />
                        </span>
                        <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-[#eef1ff] text-[11px] font-semibold text-[#3848c7]">
                          {initialsOf(c.user.name)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1 text-[13.5px] font-medium text-[#0b1024]">
                            <span className="truncate">{c.user.name}</span>
                            {c.tier === 3 ? (
                              <Crown className="size-3.5 shrink-0 text-[#d9a400]" aria-label={t("administrator")} />
                            ) : null}
                          </span>
                          {c.positionName ? (
                            <span className="block truncate text-[11.5px] text-[#6f7282]">
                              {c.positionName}
                            </span>
                          ) : null}
                        </span>
                        <span className="hidden shrink-0 text-right text-[11px] leading-tight text-[#9b9fb3] sm:block sm:max-w-[170px]">
                          {c.reason}
                        </span>
                      </button>
                    );
                  })}
                </div>
              );
            })}
            {GROUP_ORDER.every((key) => groups[key].filter(matches).length === 0) ? (
              <div className="px-3 py-6 text-center text-[13px] text-[#6f7282]">
                {props.users.length === 0
                  ? t("noActiveEmployees")
                  : t("nobodyFound")}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
