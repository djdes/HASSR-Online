"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { PageGuide } from "@/components/ui/page-guide";
import { SectionPageHeader } from "@/components/layout/section-page-header";
import { HeadcountField, parseHeadcountInput } from "@/components/staff/staff-dialogs";
import {
  STAFF_BUTTON_OUTLINE,
  STAFF_BUTTON_PRIMARY,
  STAFF_ICON_BUTTON,
  STAFF_PILL,
  StaffCard,
  StaffEmptyState,
} from "@/components/staff/staff-page-ui";
import {
  POSITION_CATEGORIES,
  movePositionWithinCategory,
  positionStaffing,
  type PositionCategoryKey,
  type StaffingTotals,
} from "@/lib/staffing";
import { cn } from "@/lib/utils";

export type PositionRow = {
  id: string;
  name: string;
  categoryKey: PositionCategoryKey;
  sortOrder: number;
  plannedHeadcount: number | null;
  occupied: number;
  vacancies: number;
  overstaffed: number;
};

type DialogState = { kind: "create"; categoryKey: PositionCategoryKey } | { kind: "edit"; position: PositionRow };

/** Ответ API с ошибкой: по-русски берём текст сервера, на других языках — свой по коду. */
async function apiErrorMessage(
  response: Response,
  locale: string,
  fallback: (status: number) => string
): Promise<string> {
  const payload = (await response.json().catch(() => null)) as { error?: unknown } | null;
  if (locale === "ru" && typeof payload?.error === "string" && payload.error.trim()) return payload.error;
  return fallback(response.status);
}

/** Должности в порядке показа: Руководство, Сотрудники, Комиссия; внутри — по `sortOrder`. */
function inDisplayOrder(rows: readonly PositionRow[]): PositionRow[] {
  return POSITION_CATEGORIES.flatMap((category) =>
    rows.filter((row) => row.categoryKey === category).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
  );
}

export function PositionsPageClient(props: {
  canManage: boolean;
  totals: StaffingTotals;
  positions: PositionRow[];
}) {
  const t = useTranslations("staffPages.positions");
  const tPage = useTranslations("staffManagement.page");
  const locale = useLocale();
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [rows, setRows] = useState(() => inDisplayOrder(props.positions));
  const [source, setSource] = useState(props.positions);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PositionRow | null>(null);
  const [moving, setMoving] = useState(false);

  // Сервер прислал свежие данные (после правки или перестановки) — берём их.
  if (source !== props.positions) {
    setSource(props.positions);
    setRows(inDisplayOrder(props.positions));
  }

  const refresh = () => startTransition(() => router.refresh());

  const errorText = (status: number, kind: "save" | "delete" | "order") => {
    if (status === 403) return t("errors.forbidden");
    if (status === 409 && kind === "save") return t("errors.duplicate");
    if (status === 409 && kind === "delete") return t("errors.hasPeople");
    if (status === 404) return t("errors.notFound");
    return kind === "save" ? t("errors.saveFailed") : kind === "delete" ? t("errors.deleteFailed") : t("errors.orderFailed");
  };

  async function move(position: PositionRow, direction: -1 | 1) {
    const ids = movePositionWithinCategory(rows, position.id, direction);
    if (!ids || moving) return;
    const previous = rows;
    const byId = new Map(rows.map((row) => [row.id, row]));
    // Сразу показываем новый порядок; при ошибке — возвращаем прежний.
    setRows(ids.map((id, index) => ({ ...(byId.get(id) as PositionRow), sortOrder: index + 1 })));
    setMoving(true);
    try {
      const response = await fetch("/api/positions/order", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      if (!response.ok) {
        setRows(previous);
        toast.error(await apiErrorMessage(response, locale, (status) => errorText(status, "order")));
        return;
      }
      refresh();
    } catch {
      setRows(previous);
      toast.error(t("errors.network"));
    } finally {
      setMoving(false);
    }
  }

  async function remove(position: PositionRow) {
    try {
      const response = await fetch(`/api/positions/${position.id}`, { method: "DELETE" });
      if (!response.ok) {
        toast.error(await apiErrorMessage(response, locale, (status) => errorText(status, "delete")));
        return;
      }
      toast.success(t("toast.deleted", { name: position.name }));
      setRows((current) => current.filter((row) => row.id !== position.id));
      refresh();
    } catch {
      toast.error(t("errors.network"));
    }
  }

  const totals = props.totals;
  const grouped = useMemo(
    () => POSITION_CATEGORIES.map((category) => ({ category, items: rows.filter((row) => row.categoryKey === category) })),
    [rows]
  );

  return (
    <div className="space-y-4" data-positions-page>
      <SectionPageHeader
        description={t("description")}
        actions={
          <>
            <Link href="/settings/users" className={STAFF_BUTTON_OUTLINE}>
              <Users className="size-4 text-[#5566f6]" />
              {t("toStaff")}
            </Link>
            {props.canManage ? (
              <button
                type="button"
                onClick={() => setDialog({ kind: "create", categoryKey: "staff" })}
                className={STAFF_BUTTON_PRIMARY}
                data-testid="position-create"
              >
                <Plus className="size-4" />
                {t("add")}
              </button>
            ) : null}
          </>
        }
      />

      {/* Итог по организации — одной строкой пилюль. */}
      <div className="flex flex-wrap items-center gap-2" data-positions-totals>
        {totals.withPlan > 0 ? (
          <>
            <span className={cn(STAFF_PILL, "bg-[#f5f6ff] px-3 py-1.5 text-[13px] text-[#3848c7]")}>
              {t("totals.planned", { count: String(totals.planned) })}
            </span>
            <span className={cn(STAFF_PILL, "bg-[#f5f6ff] px-3 py-1.5 text-[13px] text-[#3848c7]")}>
              {t("totals.occupied", { count: String(totals.occupiedPlanned) })}
            </span>
            <span
              className={cn(
                STAFF_PILL,
                "px-3 py-1.5 text-[13px]",
                totals.vacancies > 0 ? "bg-[#fff8eb] text-[#b25f00]" : "bg-[#ecfdf5] text-[#116b2a]"
              )}
            >
              {t("totals.vacancies", { count: String(totals.vacancies) })}
            </span>
            {totals.overstaffed > 0 ? (
              <span className={cn(STAFF_PILL, "bg-[#fff4f2] px-3 py-1.5 text-[13px] text-[#a13a32]")}>
                {t("totals.overstaffed", { count: String(totals.overstaffed) })}
              </span>
            ) : null}
          </>
        ) : (
          <>
            <span className={cn(STAFF_PILL, "bg-[#f5f6ff] px-3 py-1.5 text-[13px] text-[#3848c7]")}>
              {t("totals.people", { count: String(totals.occupied) })}
            </span>
            <span className={cn(STAFF_PILL, "bg-[#f3f4f8] px-3 py-1.5 text-[13px] text-[#6f7282]")}>
              {t("totals.noPlan")}
            </span>
          </>
        )}
      </div>

      <PageGuide
        storageKey="settings-positions"
        title={t("guide.title")}
        bullets={[
          { title: t("guide.headcountTitle"), body: t("guide.headcountBody") },
          { title: t("guide.occupiedTitle"), body: t("guide.occupiedBody") },
          { title: t("guide.orderTitle"), body: t("guide.orderBody") },
          { title: t("guide.deleteTitle"), body: t("guide.deleteBody") },
        ]}
      />

      {!props.canManage ? (
        <p className="rounded-2xl bg-[#f5f6ff] px-4 py-3 text-[13px] text-[#3848c7]">{t("readOnly")}</p>
      ) : null}

      {grouped.map(({ category, items }, index) => (
        <StaffCard
          key={category}
          id={`positions-${category}`}
          number={index + 1}
          title={t(`categories.${category}.title`)}
          description={t(`categories.${category}.hint`)}
          aside={
            props.canManage ? (
              <button
                type="button"
                onClick={() => setDialog({ kind: "create", categoryKey: category })}
                className="inline-flex h-9 items-center gap-1.5 rounded-2xl bg-[#eef1ff] px-3 text-[13px] font-semibold text-[#3848c7] transition-colors duration-150 hover:bg-[#5566f6] hover:text-white focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
              >
                <Plus className="size-4" />
                {t("addInCategory")}
              </button>
            ) : null
          }
        >
          {items.length === 0 ? (
            <StaffEmptyState title={t("empty.title")} hint={props.canManage ? t("empty.hint") : t("empty.hintReadOnly")} />
          ) : (
            <ul className="divide-y divide-[#ececf4] overflow-hidden rounded-2xl border border-[#ececf4]">
              {items.map((position, itemIndex) => (
                <li
                  key={position.id}
                  data-position-row={position.name}
                  className="flex flex-wrap items-center gap-x-3 gap-y-2 bg-white px-3 py-3 transition-colors duration-150 hover:bg-[#fafbff] sm:px-4"
                >
                  <div className="min-w-0 flex-1 basis-[200px]">
                    <div className="text-[14.5px] font-medium text-[#0b1024] [overflow-wrap:anywhere]">{position.name}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[12.5px] text-[#6f7282]">
                      <span className="tabular-nums">
                        {position.plannedHeadcount === null
                          ? t("row.noPlan")
                          : t("row.plan", { count: String(position.plannedHeadcount) })}
                      </span>
                      <span aria-hidden className="text-[#c9cde0]">·</span>
                      <span className="tabular-nums">{t("row.people", { count: position.occupied })}</span>
                    </div>
                  </div>
                  {position.plannedHeadcount !== null ? (
                    <StaffingPill position={position} label={tPage("staffingPill", { occupied: String(position.occupied), planned: String(position.plannedHeadcount) })} hint={
                      position.overstaffed > 0
                        ? tPage("staffingOver", { count: position.overstaffed })
                        : position.vacancies > 0
                          ? tPage("staffingVacancies", { count: position.vacancies })
                          : tPage("staffingFull")
                    } />
                  ) : null}
                  {props.canManage ? (
                    <div className="flex shrink-0 items-center gap-0.5">
                      <button
                        type="button"
                        onClick={() => void move(position, -1)}
                        disabled={moving || itemIndex === 0}
                        aria-label={t("row.moveUp", { name: position.name })}
                        title={t("row.moveUpShort")}
                        className={STAFF_ICON_BUTTON}
                        data-testid="position-up"
                      >
                        <ArrowUp className="size-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void move(position, 1)}
                        disabled={moving || itemIndex === items.length - 1}
                        aria-label={t("row.moveDown", { name: position.name })}
                        title={t("row.moveDownShort")}
                        className={STAFF_ICON_BUTTON}
                        data-testid="position-down"
                      >
                        <ArrowDown className="size-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setDialog({ kind: "edit", position })}
                        aria-label={t("row.edit", { name: position.name })}
                        title={t("row.editShort")}
                        className={STAFF_ICON_BUTTON}
                        data-testid="position-edit"
                      >
                        <Pencil className="size-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setPendingDelete(position)}
                        aria-label={t("row.delete", { name: position.name })}
                        title={t("row.deleteShort")}
                        className={cn(STAFF_ICON_BUTTON, "hover:bg-[#fff4f2] hover:text-[#a13a32]")}
                        data-testid="position-delete"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </StaffCard>
      ))}

      {dialog ? (
        <PositionDialog
          state={dialog}
          onClose={() => setDialog(null)}
          errorText={(status) => errorText(status, "save")}
          onSaved={(saved) => {
            // Правку показываем сразу (пилюля «занято N из M» пересчитывается тут же),
            // новую должность — когда сервер пришлёт список с её id.
            if (dialog.kind === "edit") {
              const id = dialog.position.id;
              setRows((current) =>
                inDisplayOrder(
                  current.map((row) =>
                    row.id === id
                      ? { ...row, ...saved, ...positionStaffing(saved.plannedHeadcount, row.occupied) }
                      : row
                  )
                )
              );
            }
            setDialog(null);
            refresh();
          }}
        />
      ) : null}

      {pendingDelete ? (
        pendingDelete.occupied > 0 ? (
          <ConfirmDialog
            open
            onClose={() => setPendingDelete(null)}
            onConfirm={() => {
              setPendingDelete(null);
              router.push("/settings/users");
            }}
            variant="warn"
            title={t("delete.blockedTitle", { name: pendingDelete.name })}
            description={t("delete.blockedDescription")}
            bullets={[
              { label: t("delete.blockedPeople", { count: pendingDelete.occupied }), tone: "warn" },
              { label: t("delete.blockedMove") },
              { label: t("delete.blockedAfter") },
            ]}
            confirmLabel={t("delete.blockedConfirm")}
            cancelLabel={t("cancel")}
          />
        ) : (
          <ConfirmDialog
            open
            onClose={() => setPendingDelete(null)}
            onConfirm={async () => {
              const position = pendingDelete;
              setPendingDelete(null);
              await remove(position);
            }}
            variant="danger"
            title={t("delete.title", { name: pendingDelete.name })}
            description={t("delete.description")}
            bullets={[
              { label: t("delete.gone"), tone: "warn" },
              { label: t("delete.journals"), tone: "warn" },
              { label: t("delete.irreversible"), tone: "warn" },
            ]}
            confirmLabel={t("delete.confirm")}
            cancelLabel={t("cancel")}
          />
        )
      ) : null}
    </div>
  );
}

/**
 * «занято N из M»: зелёная — штат укомплектован, янтарная — есть вакансии,
 * розовая — сверх штата (те же цвета, что на странице «Сотрудники»).
 */
function StaffingPill({ position, label, hint }: { position: PositionRow; label: string; hint: string }) {
  const tone =
    position.overstaffed > 0
      ? "bg-[#fff4f2] text-[#a13a32]"
      : position.vacancies > 0
        ? "bg-[#fff8eb] text-[#b25f00]"
        : "bg-[#ecfdf5] text-[#116b2a]";
  return (
    <span title={hint} data-testid="staffing-pill" className={cn(STAFF_PILL, "shrink-0", tone)}>
      {label}
      <span className="sr-only">. {hint}</span>
    </span>
  );
}

const FIELD_CLASS =
  "h-12 w-full rounded-xl border border-[#dcdfed] bg-white px-4 pt-6 text-[14px] text-[#0b1024] placeholder:text-[#9b9fb3] transition-colors duration-150 focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15";

/** Окно создания и правки должности: группа, название, штатная численность. */
function PositionDialog({
  state,
  onClose,
  onSaved,
  errorText,
}: {
  state: DialogState;
  onClose: () => void;
  onSaved: (saved: { name: string; categoryKey: PositionCategoryKey; plannedHeadcount: number | null }) => void;
  errorText: (status: number) => string;
}) {
  const t = useTranslations("staffPages.positions");
  const locale = useLocale();
  const editing = state.kind === "edit" ? state.position : null;
  const [categoryKey, setCategoryKey] = useState<PositionCategoryKey>(editing?.categoryKey ?? (state.kind === "create" ? state.categoryKey : "staff"));
  const [name, setName] = useState(editing?.name ?? "");
  const [headcount, setHeadcount] = useState(editing?.plannedHeadcount == null ? "" : String(editing.plannedHeadcount));
  const [pending, setPending] = useState(false);

  async function submit() {
    if (name.trim().length < 2) {
      toast.error(t("dialog.nameShort"));
      return;
    }
    const plannedHeadcount = parseHeadcountInput(headcount);
    if (!plannedHeadcount.ok) {
      toast.error(t("dialog.headcountInvalid"));
      return;
    }
    setPending(true);
    try {
      const response = await fetch(editing ? `/api/positions/${editing.id}` : "/api/positions", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), categoryKey, plannedHeadcount: plannedHeadcount.value }),
      });
      if (!response.ok) {
        toast.error(await apiErrorMessage(response, locale, errorText));
        return;
      }
      toast.success(editing ? t("toast.updated", { name: name.trim() }) : t("toast.created", { name: name.trim() }));
      onSaved({ name: name.trim(), categoryKey, plannedHeadcount: plannedHeadcount.value });
    } catch {
      toast.error(t("errors.network"));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[88vh] max-w-[calc(100vw-1rem)] flex-col gap-0 overflow-hidden rounded-2xl p-0 supports-[height:100dvh]:max-h-[88dvh] sm:max-w-[480px]">
        <DialogHeader className="shrink-0 border-b px-4 py-5 pr-14 sm:pl-6">
          <DialogTitle className="text-[18px] font-semibold text-[#0b1024]">
            {editing ? t("dialog.editTitle") : t("dialog.createTitle")}
          </DialogTitle>
          <DialogDescription className="text-[13px] text-[#6f7282]">{t("dialog.description")}</DialogDescription>
        </DialogHeader>
        <form
          className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-5 sm:px-6"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <fieldset>
            <legend className="mb-2 text-[12px] font-semibold uppercase tracking-[0.14em] text-[#9b9fb3]">
              {t("dialog.category")}
            </legend>
            <div role="radiogroup" aria-label={t("dialog.category")} className="grid grid-cols-1 gap-1.5 sm:grid-cols-3">
              {POSITION_CATEGORIES.map((category) => {
                const selected = categoryKey === category;
                return (
                  <button
                    key={category}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setCategoryKey(category)}
                    data-testid={`position-category-${category}`}
                    className={cn(
                      "rounded-2xl border px-3 py-2.5 text-left text-[13.5px] font-medium transition-[background-color,border-color] duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15",
                      selected
                        ? "border-[#5566f6] bg-[#f5f6ff] text-[#3848c7]"
                        : "border-[#ececf4] bg-white text-[#0b1024] hover:border-[#5566f6]/40 hover:bg-[#fafbff]"
                    )}
                  >
                    {t(`categories.${category}.title`)}
                  </button>
                );
              })}
            </div>
            <p className="mt-1.5 text-[12px] leading-snug text-[#6f7282]">{t(`categories.${categoryKey}.hint`)}</p>
          </fieldset>
          <div className="relative">
            <label htmlFor="position-name" className="absolute left-4 top-2 text-[11px] font-medium text-[#9b9fb3]">
              {t("dialog.name")}
            </label>
            <input
              id="position-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t("dialog.namePlaceholder")}
              maxLength={120}
              autoFocus={!editing}
              data-testid="position-name"
              className={FIELD_CLASS}
            />
          </div>
          <HeadcountField id="position-headcount" value={headcount} onChange={setHeadcount} />
          {/* Enter в поле отправляет форму. */}
          <button type="submit" hidden aria-hidden tabIndex={-1} />
        </form>
        <DialogFooter className="shrink-0 flex-wrap justify-end gap-2 border-t bg-white px-4 py-4 sm:flex-row sm:px-6">
          <button type="button" onClick={onClose} className={STAFF_BUTTON_OUTLINE}>
            {t("cancel")}
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={pending}
            className={STAFF_BUTTON_PRIMARY}
            data-testid="position-save"
          >
            {pending ? t("dialog.saving") : editing ? t("dialog.save") : t("dialog.create")}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
