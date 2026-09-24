"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  FileSignature,
  ListChecks,
  Loader2,
  Pencil,
  Sparkles,
  XCircle,
} from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

/**
 * Фаза «Документы» быстрого старта: приказы и чек-листы.
 *
 * Приказ оформляется в обычном редакторе `/orders/<code>` с
 * `?from=onboarding` — после сохранения редактор возвращает сюда, и
 * прогресс «Оформлено N из M» сразу растёт. Чек-лист пустого журнала
 * заполняется типовыми пунктами одной кнопкой; правка — в редакторе
 * `/settings/journal-checklists/<code>`. Фазу закрывает кнопка «Чек-листы
 * проверены»: пункты руководитель должен хотя бы раз просмотреть сам.
 */

export type OnboardingOrderRow = {
  code: string;
  title: string;
  /** Последний оформленный приказ этого вида, если есть. */
  issued: { id: string; number: string; issuedAt: string } | null;
};

export type OnboardingChecklistRow = {
  code: string;
  name: string;
  itemsCount: number;
  defaultsCount: number;
  /** Первый типовой пункт — показываем как пример того, что вставится. */
  defaultsExample: string | null;
};

const PRIMARY_SMALL =
  "inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-2xl bg-[#5566f6] px-3.5 text-[13px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors duration-150 hover:bg-[#4a5bf0] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 disabled:opacity-60";
const OUTLINE_SMALL =
  "inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-2xl border border-[#dcdfed] bg-white px-3.5 text-[13px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15";

function formatDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}.${m}.${y}`;
}

function orderHref(row: OnboardingOrderRow): string {
  return row.issued
    ? `/orders/${row.code}?id=${row.issued.id}&from=onboarding`
    : `/orders/${row.code}?from=onboarding`;
}

function pluralItems(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} пункт`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} пункта`;
  return `${n} пунктов`;
}

export function OnboardingDocumentsPhase({
  requiredOrders,
  recommendedOrders,
  checklists,
  checklistsReviewedAt,
}: {
  requiredOrders: OnboardingOrderRow[];
  recommendedOrders: OnboardingOrderRow[];
  checklists: OnboardingChecklistRow[];
  checklistsReviewedAt: string | null;
}) {
  const router = useRouter();
  const [fillingCode, setFillingCode] = useState<string | null>(null);
  const [confirmReview, setConfirmReview] = useState(false);
  const [marking, setMarking] = useState(false);

  const issuedCount = requiredOrders.filter((row) => row.issued).length;
  const totalRequired = requiredOrders.length;
  const ordersPercent =
    totalRequired > 0 ? Math.round((issuedCount / totalRequired) * 100) : 100;
  const emptyChecklists = checklists.filter((row) => row.itemsCount === 0);
  const recommendedIssued = recommendedOrders.filter((row) => row.issued).length;

  async function fillDefaults(row: OnboardingChecklistRow) {
    if (fillingCode) return;
    setFillingCode(row.code);
    try {
      const res = await fetch("/api/settings/onboarding/checklists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "fill-defaults", code: row.code }),
      });
      const data = (await res.json().catch(() => null)) as
        | { created?: number; error?: string }
        | null;
      if (!res.ok) throw new Error(data?.error ?? "Не удалось заполнить");
      toast.success(
        `«${row.name}»: добавлено ${pluralItems(data?.created ?? 0)}`,
      );
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ошибка сети");
    } finally {
      setFillingCode(null);
    }
  }

  async function markReviewed() {
    setMarking(true);
    try {
      const res = await fetch("/api/settings/onboarding/checklists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "mark-reviewed" }),
      });
      const data = (await res.json().catch(() => null)) as
        | { error?: string }
        | null;
      if (!res.ok) throw new Error(data?.error ?? "Не удалось сохранить");
      toast.success("Чек-листы отмечены проверенными");
      setConfirmReview(false);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ошибка сети");
    } finally {
      setMarking(false);
    }
  }

  function onReviewClick() {
    // Пустой чек-лист — не ошибка, но сотрудник не увидит ни одного
    // пункта. Предупреждаем, а не запрещаем: у кого-то журнал ведёт
    // один человек, и пункты ему не нужны.
    if (emptyChecklists.length > 0) {
      setConfirmReview(true);
      return;
    }
    void markReviewed();
  }

  return (
    <div id="documents" className="scroll-mt-24 space-y-4">
      {/* ─── Приказы ─── */}
      <section className="rounded-3xl border border-[#ececf4] bg-white p-4 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] sm:p-5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#eef1ff] text-[#5566f6]">
            <FileSignature className="size-4" />
          </span>
          {/* basis: на узком экране описание не сжимается в столбик рядом
              с пилюлей — пилюля уходит на свою строку. */}
          <div className="min-w-0 flex-1 basis-[220px]">
            <h4 className="text-[15px] font-semibold text-[#0b1024]">Приказы</h4>
            <p className="text-[12.5px] leading-snug text-[#6f7282]">
              Инспектор спрашивает не только журналы, но и кто за них отвечает.
            </p>
          </div>
          <span
            className={`rounded-full px-2.5 py-1 text-[12px] font-medium tabular-nums ${
              issuedCount === totalRequired
                ? "bg-[#ecfdf5] text-[#116b2a]"
                : "bg-[#f5f6ff] text-[#3848c7]"
            }`}
          >
            Оформлено {issuedCount} из {totalRequired}
          </span>
        </div>
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-[#ececf4]">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              ordersPercent === 100 ? "bg-emerald-400" : "bg-[#5566f6]"
            }`}
            style={{ width: `${ordersPercent}%` }}
          />
        </div>

        <ul className="mt-3 divide-y divide-[#ececf4]">
          {requiredOrders.map((row) => (
            <OrderRow key={row.code} row={row} />
          ))}
        </ul>

        {recommendedOrders.length > 0 ? (
          <details className="group mt-2 rounded-2xl border border-[#ececf4] bg-[#fafbff] px-3.5 py-2.5">
            <summary className="flex cursor-pointer list-none items-center gap-2 text-[13px] font-medium text-[#3c4053] [&::-webkit-details-marker]:hidden">
              Рекомендуемые приказы
              <span className="rounded-full bg-white px-2 py-0.5 text-[11px] tabular-nums text-[#6f7282]">
                {recommendedIssued}/{recommendedOrders.length}
              </span>
              <ChevronDown className="ml-auto size-4 text-[#9b9fb3] transition-transform duration-200 group-open:rotate-180" />
            </summary>
            <p className="mt-1.5 text-[12px] leading-snug text-[#6f7282]">
              Не обязательны для закрытия шага, но пригодятся на проверке.
            </p>
            <ul className="mt-1 divide-y divide-[#ececf4]">
              {recommendedOrders.map((row) => (
                <OrderRow key={row.code} row={row} compact />
              ))}
            </ul>
          </details>
        ) : null}
      </section>

      {/* ─── Чек-листы ─── */}
      <section className="rounded-3xl border border-[#ececf4] bg-white p-4 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] sm:p-5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#eef1ff] text-[#5566f6]">
            <ListChecks className="size-4" />
          </span>
          <div className="min-w-0 flex-1 basis-[220px]">
            <h4 className="text-[15px] font-semibold text-[#0b1024]">Чек-листы</h4>
            <p className="text-[12.5px] leading-snug text-[#6f7282]">
              Пункты, которые сотрудник отмечает при заполнении журнала: что
              взять, куда пойти, что проверить.
            </p>
          </div>
        </div>

        {checklists.length === 0 ? (
          <div className="mt-3 rounded-2xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-4 py-5 text-center text-[13px] text-[#6f7282]">
            Среди включённых журналов нет тех, где нужен чек-лист. Отметьте шаг
            пройденным — вернуться к чек-листам можно в любой момент.
          </div>
        ) : (
          <ul className="mt-3 divide-y divide-[#ececf4]">
            {checklists.map((row) => {
              const empty = row.itemsCount === 0;
              const busy = fillingCode === row.code;
              return (
                <li
                  key={row.code}
                  className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start gap-2">
                      {empty ? (
                        <XCircle className="mt-0.5 size-4 shrink-0 text-[#a13a32]" />
                      ) : (
                        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-[#116b2a]" />
                      )}
                      <div className="min-w-0">
                        <div className="text-[14px] font-medium leading-snug text-[#0b1024]">
                          {row.name}
                        </div>
                        <div
                          className={`mt-0.5 text-[12.5px] leading-snug ${
                            empty ? "text-[#a13a32]" : "text-[#116b2a]"
                          }`}
                        >
                          {empty ? "Пусто" : pluralItems(row.itemsCount)}
                        </div>
                        {empty && row.defaultsExample ? (
                          <div className="mt-1 text-[12px] leading-snug text-[#6f7282]">
                            Вставим {pluralItems(row.defaultsCount)}, например:
                            «{row.defaultsExample}»
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 pl-6 sm:pl-0">
                    {empty && row.defaultsCount > 0 ? (
                      <button
                        type="button"
                        onClick={() => fillDefaults(row)}
                        disabled={fillingCode !== null}
                        className={PRIMARY_SMALL}
                      >
                        {busy ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <Sparkles className="size-4" />
                        )}
                        Заполнить типовыми
                      </button>
                    ) : null}
                    <Link
                      href={`/settings/journal-checklists/${row.code}`}
                      className={OUTLINE_SMALL}
                    >
                      <Pencil className="size-3.5 text-[#5566f6]" />
                      Открыть редактор
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <div className="mt-3 flex flex-col gap-2 rounded-2xl bg-[#fafbff] p-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[12.5px] leading-snug text-[#6f7282]">
            {checklistsReviewedAt
              ? `Проверены ${formatDate(checklistsReviewedAt)}. Если поменяли пункты — отметьте ещё раз.`
              : "Просмотрите пункты и отметьте — шаг закроется, когда оформлены и приказы."}
          </p>
          <button
            type="button"
            onClick={onReviewClick}
            disabled={marking}
            className={
              checklistsReviewedAt
                ? OUTLINE_SMALL
                : PRIMARY_SMALL
            }
          >
            {marking ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <CheckCircle2
                className={`size-4 ${checklistsReviewedAt ? "text-[#116b2a]" : ""}`}
              />
            )}
            Чек-листы проверены
          </button>
        </div>
      </section>

      <ConfirmDialog
        open={confirmReview}
        onClose={() => setConfirmReview(false)}
        onConfirm={markReviewed}
        variant="warn"
        title="Отметить чек-листы проверенными?"
        description="У части журналов чек-лист пуст — сотрудник не увидит ни одного пункта при заполнении."
        bullets={[
          ...emptyChecklists.map((row) => ({
            label: `Пусто: ${row.name}`,
            tone: "warn" as const,
          })),
          {
            label: "Заполнить можно и позже — в редакторе чек-листа",
            tone: "info" as const,
          },
        ]}
        confirmLabel="Да, проверены"
      />
    </div>
  );
}

function OrderRow({
  row,
  compact = false,
}: {
  row: OnboardingOrderRow;
  compact?: boolean;
}) {
  return (
    <li
      className={`flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3 ${
        compact ? "py-2.5" : "py-3"
      }`}
    >
      <div className="flex min-w-0 flex-1 items-start gap-2">
        {row.issued ? (
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-[#116b2a]" />
        ) : (
          <XCircle
            className={`mt-0.5 size-4 shrink-0 ${
              compact ? "text-[#9b9fb3]" : "text-[#a13a32]"
            }`}
          />
        )}
        <div className="min-w-0">
          <div className="text-[14px] font-medium leading-snug text-[#0b1024]">
            {row.title}
          </div>
          <div
            className={`mt-0.5 text-[12.5px] leading-snug ${
              row.issued
                ? "text-[#116b2a]"
                : compact
                  ? "text-[#6f7282]"
                  : "text-[#a13a32]"
            }`}
          >
            {row.issued
              ? `Создан № ${row.issued.number} от ${formatDate(row.issued.issuedAt)}`
              : "Не оформлен"}
          </div>
        </div>
      </div>
      <div className="pl-6 sm:pl-0">
        <Link
          href={orderHref(row)}
          className={row.issued || compact ? OUTLINE_SMALL : PRIMARY_SMALL}
        >
          {row.issued ? "Открыть" : "Оформить"}
          <ArrowRight
            className={`size-4 ${row.issued || compact ? "text-[#5566f6]" : ""}`}
          />
        </Link>
      </div>
    </li>
  );
}
