"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { MapPin, Plus, Store, X } from "lucide-react";
import { SearchPickDialog } from "@/components/ui/search-pick-dialog";

export type PointJournalsCard = {
  /** Точка; null — набор всей компании (журналы не делятся по точкам). */
  id: string | null;
  name: string;
  address: string | null;
  enabledCodes: string[];
};

/**
 * Карточки «Журналы точек»: журналы набора каждой точки, «×» — убрать
 * (с «Вернуть» в уведомлении), «Добавить журнал» — выбор из невключённых.
 * Сохранение сразу (`POST /api/journals/points`), правка меняет только
 * свою точку.
 */
export function PointJournalsClient({
  cards,
  journals,
  perPoint,
}: {
  cards: PointJournalsCard[];
  journals: { code: string; name: string }[];
  perPoint: boolean;
}) {
  const t = useTranslations("pointJournals");
  const router = useRouter();
  const [enabled, setEnabled] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(cards.map((card) => [card.id ?? "", card.enabledCodes])),
  );
  const [picking, setPicking] = useState<PointJournalsCard | null>(null);
  const [busy, setBusy] = useState(false);
  const nameOf = new Map(journals.map((journal) => [journal.code, journal.name]));

  async function apply(card: PointJournalsCard, code: string, on: boolean): Promise<boolean> {
    const key = card.id ?? "";
    const before = enabled[key] ?? [];
    const order = journals.map((journal) => journal.code);
    const next = on
      ? order.filter((entry) => entry === code || before.includes(entry))
      : before.filter((entry) => entry !== code);
    setEnabled((current) => ({ ...current, [key]: next }));
    setBusy(true);
    try {
      const response = await fetch("/api/journals/points", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ buildingId: card.id, code, enabled: on }),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error || t("failed"));
      }
      router.refresh();
      return true;
    } catch (error) {
      setEnabled((current) => ({ ...current, [key]: before }));
      toast.error(error instanceof Error && error.message ? error.message : t("failed"));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function remove(card: PointJournalsCard, code: string) {
    const name = nameOf.get(code) ?? code;
    if (!(await apply(card, code, false))) return;
    toast.success(t("removed", { name }), {
      action: { label: t("undo"), onClick: () => void apply(card, code, true) },
    });
  }

  return (
    <div className="grid gap-4 xl:grid-cols-2" data-point-journals>
      {cards.map((card) => {
        const codes = enabled[card.id ?? ""] ?? [];
        return (
          <section
            key={card.id ?? "all"}
            data-point-journals-card={card.id ?? "all"}
            className="flex flex-col rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] md:p-6"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#3848c7]">
                  <Store className="size-5" aria-hidden />
                </span>
                <div className="min-w-0">
                  <h2 className="text-[16px] font-semibold leading-tight text-[#0b1024]">{card.name}</h2>
                  {card.address ? (
                    <p className="mt-0.5 flex items-center gap-1 text-[12.5px] text-[#6f7282]">
                      <MapPin className="size-3.5 shrink-0" aria-hidden />
                      <span className="truncate">{card.address}</span>
                    </p>
                  ) : null}
                  <p className="mt-1 text-[13px] font-medium text-[#3848c7] tabular-nums">
                    {t("inWork", { count: codes.length })}
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => setPicking(card)}
                data-point-journals-add
                className="inline-flex h-10 shrink-0 items-center gap-2 rounded-2xl bg-[#5566f6] px-4 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors duration-150 hover:bg-[#4a5bf0] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 disabled:opacity-60"
              >
                <Plus className="size-4" aria-hidden />
                {t("add")}
              </button>
            </div>
            {codes.length === 0 ? (
              <div className="mt-4 rounded-2xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-4 py-6 text-center text-[13.5px] text-[#6f7282]">
                {t("empty")}
              </div>
            ) : (
              <ul className="mt-4 flex flex-wrap gap-2">
                {codes.map((code) => {
                  const name = nameOf.get(code) ?? code;
                  return (
                    <li
                      key={code}
                      data-point-journal={code}
                      className="inline-flex max-w-full items-center gap-1 rounded-2xl border border-[#ececf4] bg-[#fafbff] py-1 pr-1 pl-3 text-[13.5px] text-[#0b1024]"
                    >
                      <span className="min-w-0 truncate">{name}</span>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void remove(card, code)}
                        aria-label={t("removeAria", { name, point: card.name })}
                        title={t("removeAria", { name, point: card.name })}
                        className="flex size-7 shrink-0 items-center justify-center rounded-full text-[#9b9fb3] transition-colors duration-150 hover:bg-[#fff4f2] hover:text-[#a13a32] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 disabled:opacity-60"
                      >
                        <X className="size-3.5" aria-hidden />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}
      <SearchPickDialog
        // Новая точка — новое окно: поиск не тянется от прошлой точки.
        key={picking ? (picking.id ?? "all") : "closed"}
        open={picking !== null}
        onOpenChange={(open) => {
          if (!open) setPicking(null);
        }}
        title={picking ? (perPoint ? t("pickTitle", { point: picking.name }) : t("add")) : ""}
        description={perPoint ? t("pickDescription") : t("pickDescriptionShared")}
        searchPlaceholder={t("search")}
        emptyText={t("nothing")}
        notFoundText={t("notFound")}
        busy={busy}
        testId="point-journals"
        groups={[
          {
            label: null,
            items: picking
              ? journals
                  .filter((journal) => !(enabled[picking.id ?? ""] ?? []).includes(journal.code))
                  .map((journal) => ({ id: journal.code, label: journal.name }))
              : [],
          },
        ]}
        onPick={async (code) => {
          if (!picking) return;
          const card = picking;
          if (await apply(card, code, true)) {
            setPicking(null);
            toast.success(t("added", { name: nameOf.get(code) ?? code }));
          }
        }}
      />
    </div>
  );
}
