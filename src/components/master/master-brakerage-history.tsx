"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { MasterBrakerageHistoryBatch } from "@/lib/master-brakerage-history";
import { formatBrakerageDateTime } from "@/lib/brakerage-assessment";

export function MasterBrakerageHistory({ onEdit }: { onEdit: (batch: MasterBrakerageHistoryBatch) => void }) {
  const [batches, setBatches] = useState<MasterBrakerageHistoryBatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const sequence = useRef(0);
  const load = useCallback(async () => {
    const requestId = ++sequence.current;
    setLoading(true);
    try {
      const response = await fetch("/api/master/brakerage/history", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Не удалось загрузить историю");
      if (requestId === sequence.current) { setBatches(body.batches); setNextCursor(body.nextCursor ?? null); }
    } catch (error) { toast.error(error instanceof Error ? error.message : "Не удалось загрузить историю"); }
    finally { if (requestId === sequence.current) setLoading(false); }
  }, []);
  async function loadMore() {
    if (!nextCursor || loading) return;
    const requestId = ++sequence.current;
    setLoading(true);
    try {
      const response = await fetch(`/api/master/brakerage/history?cursor=${encodeURIComponent(nextCursor)}`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Не удалось загрузить историю");
      if (requestId === sequence.current) { setBatches(current => [...current, ...body.batches]); setNextCursor(body.nextCursor ?? null); }
    } catch (error) { toast.error(error instanceof Error ? error.message : "Не удалось загрузить историю"); }
    finally { if (requestId === sequence.current) setLoading(false); }
  }
  useEffect(() => {
    void load();
    const update = () => { void load(); };
    window.addEventListener("master-brakerage-changed", update);
    return () => window.removeEventListener("master-brakerage-changed", update);
  }, [load]);
  return <section className="rounded-3xl border border-[#ececf4] bg-white p-5" data-testid="master-brakerage-history">
    <details><summary className="cursor-pointer text-[16px] font-semibold text-[#0b1024]">История выгрузок {batches.length ? `· ${batches.length}` : ""}</summary>
      <p className="my-3 text-[13px] text-[#6f7282]">Предыдущие выгрузки и их версии. Исправления можно сохранить только в истории или применить во всех либо выбранных пищеблоках. Подписанные и проверенные записи сохраняются.</p>
      {loading ? <p>Загрузка…</p> : !batches.length ? <p className="text-[14px] text-[#6f7282]">Сохранённых вводов пока нет.</p> : null}
      <div className="space-y-3">{batches.map((batch) => <details key={batch.id} className="rounded-2xl border border-[#ececf4] bg-[#fafbff] p-4">
        <summary className="cursor-pointer text-[14px] font-medium">{formatBrakerageDateTime(batch.input.date)} · {batch.input.rows.length} позиций · {batch.createdByName}</summary>
        <ul className="my-3 space-y-1 text-[13px]">{batch.input.rows.map((row, index) => <li key={index}>{row.name} · {row.yield || "—"} · {row.time || batch.input.common.time}</li>)}</ul>
        <p className="mb-3 text-[12px] text-[#6f7282]">Получатели: {batch.result?.organizations.filter(org => org.added > 0).map(org => org.organizationName).join(", ") || "Строки не добавлены"}</p>
        <Button variant="outline" className="rounded-2xl" onClick={() => onEdit(batch)}>Исправить выгрузку</Button>
        {batch.revisions.length > 0 ? <details className="mt-3"><summary className="cursor-pointer text-[13px]">Предыдущие версии · {batch.revisions.length}</summary>{[...batch.revisions].reverse().map((revision, i) => <div key={i} className="mt-2 border-t border-[#ececf4] pt-2 text-[13px]"><p>{new Date(revision.changedAt).toLocaleString("ru-RU", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).replace(/\./g, "-").replace(",", "")} · {revision.changedByName}</p><p>{formatBrakerageDateTime(revision.input.date)} · {revision.input.rows.map((row) => `${row.name} (${row.time || revision.input.common.time})`).join(", ")}</p></div>)}</details> : null}
      </details>)}</div>
      {nextCursor ? <Button variant="outline" className="mt-4 rounded-2xl" disabled={loading} onClick={() => void loadMore()}>Показать более ранние выгрузки</Button> : null}
    </details>
  </section>;
}
