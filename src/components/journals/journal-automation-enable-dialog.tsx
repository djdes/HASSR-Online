"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarPlus, Loader2, RotateCw, Search, Wand2 } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { PositionEmployeePicker } from "@/components/shared/position-select";
import { getUserPositionLabel, type UserLike } from "@/lib/user-roles";
import type {
  JournalAutomationResponsibles,
  JournalAutomationStaff,
} from "@/lib/journal-automation";
import { humanizeFetchError } from "@/lib/humanize-fetch-error";

/**
 * Диалог включения автоматики журнала.
 *
 * Зачем он есть: раньше тумблер включался молча. Человек не знал ни
 * когда появится следующий документ, ни кто в нём будет ответственным —
 * и узнавал это только на бланке, который уже показывают проверяющему.
 * Теперь перед включением видно и период, и фамилии, и состав строк —
 * с возможностью выбрать своё.
 *
 * Данные грузятся при открытии (`/api/organizations/auto-journals/preview`):
 * скелетон вместо пустоты, retry при ошибке, кнопка подтверждения
 * заблокирована, пока не пришли реальные периоды и люди.
 */

type PersonPreview = { id: string; name: string; positionTitle: string };

type PreviewUser = UserLike & { id: string };

export type AutomationPreview = {
  code: string;
  journalName: string;
  autofillSupported: boolean;
  isPerEmployee: boolean;
  hasActiveDocument: boolean;
  currentPeriod: { label: string };
  nextPeriod: { label: string; startsAtLabel: string } | null;
  responsibles: {
    inherit: {
      responsible: PersonPreview | null;
      verifier: PersonPreview | null;
    };
    auto: { responsible: PersonPreview | null; verifier: PersonPreview | null };
    saved: JournalAutomationResponsibles | null;
  };
  staff: {
    inherit: { count: number; names: string[] };
    selectedUserIds: string[];
  } | null;
  savedStaff: JournalAutomationStaff | null;
  users: PreviewUser[];
};

export type AutomationChoice = {
  responsibles: JournalAutomationResponsibles;
  staff?: JournalAutomationStaff;
};

type Mode = "auto-create" | "auto-fill";

const CARD_BASE =
  "block w-full cursor-pointer rounded-2xl border p-3.5 text-left transition-colors duration-150";
const CARD_ON = "border-[#5566f6] bg-[#f5f6ff]";
const CARD_OFF =
  "border-[#dcdfed] bg-white hover:border-[#5566f6]/40 hover:bg-[#fafbff]";

function personLine(person: PersonPreview | null): string {
  if (!person) return "—";
  return person.positionTitle
    ? `${person.name} · ${person.positionTitle}`
    : person.name;
}

function pluralPeople(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return "сотрудник";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return "сотрудника";
  }
  return "сотрудников";
}

export function JournalAutomationEnableDialog({
  open,
  mode,
  templateCode,
  autoCreateEnabled,
  onClose,
  onConfirm,
}: {
  open: boolean;
  mode: Mode;
  templateCode: string;
  /** Включено ли уже автосоздание — от этого зависит буллет автозаполнения. */
  autoCreateEnabled: boolean;
  onClose: () => void;
  /** Бросок исключения оставляет диалог открытым (ошибку показывает toast). */
  onConfirm: (choice: AutomationChoice) => Promise<void>;
}) {
  const [preview, setPreview] = useState<AutomationPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [responsiblesMode, setResponsiblesMode] = useState<
    "inherit" | "custom"
  >("inherit");
  const [responsible, setResponsible] = useState({
    positionTitle: "",
    userId: "",
  });
  const [verifier, setVerifier] = useState({ positionTitle: "", userId: "" });
  const [staffMode, setStaffMode] = useState<"inherit" | "custom">("inherit");
  const [staffIds, setStaffIds] = useState<string[]>([]);
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(
        `/api/organizations/auto-journals/preview?code=${encodeURIComponent(templateCode)}`,
      );
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.error ?? "Не удалось загрузить данные журнала");
      }
      const next = data as AutomationPreview;
      setPreview(next);

      // Предзаполнение: сохранённая политика важнее умолчания «как в
      // последнем журнале» — человек не должен переставлять свой выбор
      // при каждом открытии.
      const saved = next.responsibles.saved;
      if (saved?.mode === "custom") {
        setResponsiblesMode("custom");
        const user = next.users.find(
          (item) => item.id === saved.responsibleUserId,
        );
        setResponsible({
          positionTitle: user ? getUserPositionLabel(user) : "",
          userId: saved.responsibleUserId,
        });
        const verifierUser = saved.verifierUserId
          ? next.users.find((item) => item.id === saved.verifierUserId)
          : undefined;
        setVerifier({
          positionTitle: verifierUser ? getUserPositionLabel(verifierUser) : "",
          userId: saved.verifierUserId ?? "",
        });
      } else {
        setResponsiblesMode("inherit");
        setResponsible({ positionTitle: "", userId: "" });
        setVerifier({ positionTitle: "", userId: "" });
      }

      setStaffMode(next.savedStaff?.mode === "custom" ? "custom" : "inherit");
      setStaffIds(next.staff?.selectedUserIds ?? []);
      setSearch("");
    } catch (error) {
      setLoadError(
        humanizeFetchError(error, "Не удалось загрузить данные"),
      );
    } finally {
      setLoading(false);
    }
  }, [templateCode]);

  useEffect(() => {
    if (!open) return;
    void load();
  }, [open, load]);

  const grouped = useMemo(() => {
    if (!preview) return [] as { position: string; users: PreviewUser[] }[];
    const query = search.trim().toLowerCase();
    const map = new Map<string, PreviewUser[]>();
    for (const user of preview.users) {
      if (query && !user.name.toLowerCase().includes(query)) continue;
      const position = getUserPositionLabel(user);
      const list = map.get(position) ?? [];
      list.push(user);
      map.set(position, list);
    }
    return [...map.entries()]
      .map(([position, users]) => ({ position, users }))
      .sort((a, b) => a.position.localeCompare(b.position, "ru"));
  }, [preview, search]);

  const bullets = useMemo(() => {
    if (!preview) return undefined;
    const items: { label: string; tone?: "default" | "warn" | "info" }[] = [];

    if (mode === "auto-fill") {
      // Главное, что человек должен понять до включения: сайт сам
      // проставит отметки за уже прошедшие дни периода — до сегодня.
      items.push({
        label: "Заполним по сотрудникам с начала периода по сегодня",
        tone: "info",
      });
      items.push({ label: "Дальше — каждый день сам, ночью" });
      items.push({
        label: "Пустые клетки заполнятся, ваши записи останутся как есть",
      });
      if (!autoCreateEnabled) {
        items.push({ label: "Заодно включится создание нового периода" });
      }
      return items;
    }

    items.push(
      preview.nextPeriod
        ? {
            label: `${preview.nextPeriod.startsAtLabel} появится «${preview.nextPeriod.label}»`,
            tone: "info",
          }
        : { label: "Журнал бессрочный: документ один" },
    );
    if (!preview.hasActiveDocument) {
      items.push({
        label: `Сегодня ночью появится «${preview.currentPeriod.label}»`,
      });
    }
    items.push({ label: "Строки и ответственные — из прошлого журнала" });
    return items;
  }, [preview, mode, autoCreateEnabled]);

  const staffLine = useMemo(() => {
    if (!preview?.staff) return "";
    const { count, names } = preview.staff.inherit;
    if (count === 0) return "Подберём по должностям журнала";
    const shown = names.slice(0, 2).join(", ");
    const rest = count - Math.min(names.length, 2);
    return `${count} ${pluralPeople(count)}: ${shown}${rest > 0 ? `, +${rest}` : ""} · новые сотрудники добавятся сами`;
  }, [preview]);

  const confirmDisabled =
    loading ||
    !preview ||
    (responsiblesMode === "custom" && !responsible.userId) ||
    (preview.isPerEmployee && staffMode === "custom" && staffIds.length === 0);

  async function handleConfirm() {
    if (!preview) return;
    const choice: AutomationChoice = {
      responsibles:
        responsiblesMode === "custom"
          ? {
              mode: "custom",
              responsibleUserId: responsible.userId,
              verifierUserId: verifier.userId || null,
            }
          : { mode: "inherit" },
    };
    if (preview.isPerEmployee) {
      choice.staff =
        staffMode === "custom"
          ? { mode: "custom", userIds: staffIds }
          : { mode: "inherit" };
    }
    await onConfirm(choice);
  }

  const inheritResponsible = preview?.responsibles.inherit.responsible ?? null;
  const inheritVerifier = preview?.responsibles.inherit.verifier ?? null;
  const autoResponsible = preview?.responsibles.auto.responsible ?? null;
  const hasHistory = Boolean(inheritResponsible || inheritVerifier);

  return (
    <ConfirmDialog
      open={open}
      onClose={onClose}
      onConfirm={handleConfirm}
      confirmDisabled={confirmDisabled}
      variant="default"
      icon={mode === "auto-fill" ? Wand2 : CalendarPlus}
      title={
        mode === "auto-fill" ? "Заполнять журнал за вас?" : "Создавать журнал сам?"
      }
      description={
        mode === "auto-fill"
          ? "Сайт заполнит журнал за вас: отметки и показатели проставятся сами. Вам останется проверить."
          : "Новый период журнала заведётся сам — как продолжение прошлого."
      }
      bullets={bullets}
      confirmLabel="Да, включить"
      cancelLabel="Нет"
    >
      {loading && !preview ? (
        <div className="space-y-2.5" aria-busy="true">
          <Skeleton className="h-4 w-2/3 rounded-full" />
          <Skeleton className="h-[68px] rounded-2xl" />
          <Skeleton className="h-[68px] rounded-2xl" />
        </div>
      ) : loadError ? (
        <div className="rounded-2xl border border-[#ffd2cd] bg-[#fff4f2] p-3.5">
          <div className="text-[13px] text-[#a13a32]">{loadError}</div>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-2 inline-flex h-9 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-3 text-[13px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
          >
            <RotateCw className="size-3.5 text-[#5566f6]" />
            Попробовать снова
          </button>
        </div>
      ) : preview ? (
        <div className="space-y-4">
          <section className="space-y-2">
            <div className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
              Ответственный и проверяющий в новых документах
            </div>
            <label
              className={`${CARD_BASE} ${responsiblesMode === "inherit" ? CARD_ON : CARD_OFF}`}
            >
              <span className="flex items-start gap-2.5">
                <input
                  type="radio"
                  name="automation-responsibles"
                  className="mt-1 size-4 accent-[#5566f6]"
                  checked={responsiblesMode === "inherit"}
                  onChange={() => setResponsiblesMode("inherit")}
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13.5px] font-medium text-[#0b1024]">
                    Как в последнем журнале
                  </span>
                  <span className="mt-0.5 block text-[12px] leading-snug text-[#6f7282]">
                    {hasHistory
                      ? `${personLine(inheritResponsible)}${inheritVerifier ? ` · проверяет ${personLine(inheritVerifier)}` : ""}`
                      : `Прошлых документов нет — подберём по должностям: ${personLine(autoResponsible)}`}
                  </span>
                </span>
              </span>
            </label>
            <label
              className={`${CARD_BASE} ${responsiblesMode === "custom" ? CARD_ON : CARD_OFF}`}
            >
              <span className="flex items-start gap-2.5">
                <input
                  type="radio"
                  name="automation-responsibles"
                  className="mt-1 size-4 accent-[#5566f6]"
                  checked={responsiblesMode === "custom"}
                  onChange={() => setResponsiblesMode("custom")}
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13.5px] font-medium text-[#0b1024]">
                    Выбрать вручную
                  </span>
                  <span className="mt-0.5 block text-[12px] leading-snug text-[#6f7282]">
                    Эти люди попадут в шапку каждого нового документа
                  </span>
                </span>
              </span>
            </label>
            {responsiblesMode === "custom" ? (
              <div className="space-y-4 rounded-2xl border border-[#ececf4] bg-[#fafbff] p-3.5">
                <PositionEmployeePicker
                  users={preview.users}
                  value={responsible}
                  onChange={setResponsible}
                  positionLabel="Должность ответственного"
                  employeeLabel="Ответственный"
                  variant="stacked"
                  triggerClassName="h-11 rounded-2xl border-[#dcdfed] bg-white"
                />
                <PositionEmployeePicker
                  users={preview.users}
                  value={verifier}
                  onChange={setVerifier}
                  positionLabel="Должность проверяющего"
                  employeeLabel="Проверяющий"
                  variant="stacked"
                  triggerClassName="h-11 rounded-2xl border-[#dcdfed] bg-white"
                />
              </div>
            ) : null}
          </section>

          {preview.isPerEmployee && preview.staff ? (
            <section className="space-y-2">
              <div className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">
                Сотрудники в журнале
              </div>
              <label
                className={`${CARD_BASE} ${staffMode === "inherit" ? CARD_ON : CARD_OFF}`}
              >
                <span className="flex items-start gap-2.5">
                  <input
                    type="radio"
                    name="automation-staff"
                    className="mt-1 size-4 accent-[#5566f6]"
                    checked={staffMode === "inherit"}
                    onChange={() => setStaffMode("inherit")}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13.5px] font-medium text-[#0b1024]">
                      Как в последнем журнале
                    </span>
                    <span className="mt-0.5 block text-[12px] leading-snug text-[#6f7282]">
                      {staffLine}
                    </span>
                  </span>
                </span>
              </label>
              <label
                className={`${CARD_BASE} ${staffMode === "custom" ? CARD_ON : CARD_OFF}`}
              >
                <span className="flex items-start gap-2.5">
                  <input
                    type="radio"
                    name="automation-staff"
                    className="mt-1 size-4 accent-[#5566f6]"
                    checked={staffMode === "custom"}
                    onChange={() => setStaffMode("custom")}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13.5px] font-medium text-[#0b1024]">
                      Задать свой список
                    </span>
                    <span className="mt-0.5 block text-[12px] leading-snug text-[#6f7282]">
                      Новые сотрудники не будут добавляться автоматически
                    </span>
                  </span>
                </span>
              </label>
              {staffMode === "custom" ? (
                <div className="rounded-2xl border border-[#ececf4] bg-[#fafbff] p-3">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#9b9fb3]" />
                    <input
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="Поиск по фамилии"
                      className="h-10 w-full rounded-2xl border border-[#dcdfed] bg-white pl-9 pr-3 text-[13.5px] text-[#0b1024] placeholder:text-[#9b9fb3] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
                    />
                  </div>
                  <div className="mt-2 max-h-[220px] space-y-2 overflow-y-auto pr-1">
                    {grouped.length === 0 ? (
                      <div className="py-6 text-center text-[13px] text-[#9b9fb3]">
                        Никого не нашлось
                      </div>
                    ) : (
                      grouped.map((group) => (
                        <div key={group.position}>
                          <div className="px-1 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#9b9fb3]">
                            {group.position}
                          </div>
                          {group.users.map((user) => {
                            const checked = staffIds.includes(user.id);
                            return (
                              <label
                                key={user.id}
                                className="flex cursor-pointer items-center gap-2.5 rounded-xl px-1.5 py-1.5 transition-colors duration-150 hover:bg-white"
                              >
                                <input
                                  type="checkbox"
                                  className="size-4 accent-[#5566f6]"
                                  checked={checked}
                                  onChange={() =>
                                    setStaffIds((prev) =>
                                      checked
                                        ? prev.filter((id) => id !== user.id)
                                        : [...prev, user.id],
                                    )
                                  }
                                />
                                <span className="text-[13.5px] text-[#0b1024]">
                                  {user.name}
                                </span>
                              </label>
                            );
                          })}
                        </div>
                      ))
                    )}
                  </div>
                  <div className="mt-2 border-t border-[#ececf4] pt-2 text-[12px] text-[#6f7282]">
                    Выбрано:{" "}
                    <span className="tabular-nums">{staffIds.length}</span>
                  </div>
                </div>
              ) : null}
            </section>
          ) : null}

          {loading ? (
            <div className="flex items-center gap-2 text-[12px] text-[#9b9fb3]">
              <Loader2 className="size-3.5 animate-spin" />
              Обновляем данные журнала
            </div>
          ) : null}
        </div>
      ) : null}
    </ConfirmDialog>
  );
}
