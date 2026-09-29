"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Ban, Loader2, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { SuppressionDto } from "@/lib/mailing/contacts.server";
import { SUPPRESSION_REASON_LABELS } from "@/lib/mailing/labels";
import { cn } from "@/lib/utils";

import { CARD, DANGER_SM, INPUT, OUTLINE, SECTION_LABEL, api, formatDateTime } from "./ui";

export function StopListTab() {
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [data, setData] = useState<{ total: number; rows: SuppressionDto[] }>({ total: 0, rows: [] });
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<SuppressionDto | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setQuery(search.trim()), 350);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api(`/api/root/mailing/suppression?search=${encodeURIComponent(query)}`));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось загрузить");
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    void load();
  }, [load]);

  async function add() {
    setAdding(true);
    try {
      await api("/api/root/mailing/suppression", { method: "POST", json: { email, note } });
      toast.success(`${email.trim().toLowerCase()} — в стоп-листе`);
      setEmail("");
      setNote("");
      void load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось добавить");
    } finally {
      setAdding(false);
    }
  }

  async function remove(row: SuppressionDto) {
    try {
      await api(`/api/root/mailing/suppression/${row.id}`, { method: "DELETE" });
      toast.success(`${row.email} убран из стоп-листа`);
      setRemoving(null);
      void load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось убрать");
    }
  }

  return (
    <div className="space-y-5" data-testid="mailing-stoplist-tab">
      <section className={CARD}>
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-[#fff4f2] text-[#a13a32]">
            <Ban className="size-5" />
          </span>
          <div>
            <div className="text-[16px] font-semibold text-[#0b1024]">Стоп-лист рекламных писем</div>
            <p className="mt-0.5 max-w-[720px] text-[13px] leading-[1.55] text-[#6f7282]">
              На эти адреса не уходит ни одна рассылка — ни пользователям, ни загруженным контактам. Сюда сами попадают
              отписавшиеся и адреса, которые почтовый сервер назвал несуществующими. Служебные письма (коды входа, счета)
              приходят как обычно.
            </p>
          </div>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="adres@example.ru"
            inputMode="email"
            className={INPUT}
            data-testid="stoplist-email"
          />
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Почему (для себя)"
            maxLength={300}
            className={INPUT}
          />
          <button
            type="button"
            className={OUTLINE}
            disabled={adding || !email.trim()}
            onClick={() => void add()}
            data-testid="stoplist-add"
          >
            {adding ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4 text-[#5566f6]" />}
            Добавить
          </button>
        </div>
      </section>

      <section className={CARD}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className={SECTION_LABEL}>Адреса · {data.total}</div>
          <label className="relative block w-full sm:w-[320px]">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-[#9b9fb3]" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск по адресу"
              className={cn(INPUT, "pl-10")}
              data-testid="stoplist-search"
            />
          </label>
        </div>
        {loading ? (
          <div className="flex items-center gap-2 py-8 text-[14px] text-[#6f7282]">
            <Loader2 className="size-4 animate-spin" /> Загружаем…
          </div>
        ) : data.rows.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-6 py-10 text-center text-[13px] text-[#6f7282]">
            {query ? "Ничего не нашлось." : "Стоп-лист пуст — отписавшихся пока нет."}
          </div>
        ) : (
          <ul className="divide-y divide-[#f2f3f8]" data-testid="stoplist-rows">
            {data.rows.map((row) => (
              <li key={row.id} className="flex flex-wrap items-start justify-between gap-3 py-3" data-testid="stoplist-row">
                <div className="min-w-0">
                  <div className="font-medium text-[#0b1024] [overflow-wrap:anywhere]">{row.email}</div>
                  <div className="mt-0.5 text-[13px] text-[#6f7282]">
                    {SUPPRESSION_REASON_LABELS[row.reason] ?? row.reason} · {formatDateTime(row.createdAt)}
                    {row.campaignId ? (
                      <>
                        {" · "}
                        <Link href={`/root/mailing/${row.campaignId}`} className="text-[#3848c7] hover:text-[#5566f6]">
                          {row.campaignTitle ?? "рассылка"}
                        </Link>
                      </>
                    ) : null}
                    {row.note ? ` · ${row.note}` : ""}
                  </div>
                </div>
                <button type="button" className={DANGER_SM} onClick={() => setRemoving(row)}>
                  <Trash2 className="size-4" /> Убрать
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        onConfirm={() => (removing ? remove(removing) : undefined)}
        variant="warn"
        title={removing ? `Убрать ${removing.email} из стоп-листа?` : "Убрать из стоп-листа?"}
        description="На этот адрес снова смогут уходить рекламные письма."
        bullets={[
          ...(removing?.reason === "unsubscribed"
            ? [{ label: "Человек отписался сам — писать ему снова можно только с его нового согласия", tone: "warn" as const }]
            : []),
          ...(removing?.reason === "bounced"
            ? [{ label: "Почтовый сервер отвечал, что адреса нет — письма, скорее всего, снова не дойдут", tone: "warn" as const }]
            : []),
          { label: "Действие попадёт в аудит", tone: "info" as const },
        ]}
        confirmLabel="Убрать"
      />
    </div>
  );
}
