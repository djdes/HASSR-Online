"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { MasterBrakerageHistoryBatch } from "@/lib/master-brakerage-history";
import { formatBrakerageDateTime } from "@/lib/brakerage-assessment";

export function MasterBrakerageHistory({ onEdit }: { onEdit: (batch: MasterBrakerageHistoryBatch) => void }) {
  const t = useTranslations("masterUi.masterBrakerageHistory");
  const tc = useTranslations("common");
  const locale = useLocale();
  const dateLocale = locale === "en" ? "en-GB" : locale === "uz" ? "uz-UZ" : "ru-RU";
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
      if (!response.ok) throw new Error(body.error || t("loadFailed"));
      if (requestId === sequence.current) { setBatches(body.batches); setNextCursor(body.nextCursor ?? null); }
    } catch (error) { toast.error(error instanceof Error ? error.message : t("loadFailed")); }
    finally { if (requestId === sequence.current) setLoading(false); }
  }, [t]);
  async function loadMore() {
    if (!nextCursor || loading) return;
    const requestId = ++sequence.current;
    setLoading(true);
    try {
      const response = await fetch(`/api/master/brakerage/history?cursor=${encodeURIComponent(nextCursor)}`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || t("loadFailed"));
      if (requestId === sequence.current) { setBatches(current => [...current, ...body.batches]); setNextCursor(body.nextCursor ?? null); }
    } catch (error) { toast.error(error instanceof Error ? error.message : t("loadFailed")); }
    finally { if (requestId === sequence.current) setLoading(false); }
  }
  useEffect(() => {
    void load();
    const update = () => { void load(); };
    window.addEventListener("master-brakerage-changed", update);
    return () => window.removeEventListener("master-brakerage-changed", update);
  }, [load]);
  return <section className="rounded-3xl border border-[#ececf4] bg-white p-5" data-testid="master-brakerage-history">
    <details><summary className="cursor-pointer text-[16px] font-semibold text-[#0b1024]">{t("heading")} {batches.length ? `· ${batches.length}` : ""}</summary>
      <p className="my-3 text-[13px] text-[#6f7282]">{t("note")}</p>
      {loading ? <p>{tc("loading")}</p> : !batches.length ? <p className="text-[14px] text-[#6f7282]">{t("empty")}</p> : null}
      <div className="space-y-3">{batches.map((batch) => <details key={batch.id} className="rounded-2xl border border-[#ececf4] bg-[#fafbff] p-4">
        <summary className="cursor-pointer text-[14px] font-medium">{formatBrakerageDateTime(batch.input.date)} · {t("items", { count: batch.input.rows.length })} · {batch.createdByName}</summary>
        <ul className="my-3 space-y-1 text-[13px]">{batch.input.rows.map((row, index) => <li key={index}>{row.name} · {row.yield || "—"} · {row.time || batch.input.common.time}</li>)}</ul>
        <p className="mb-3 text-[12px] text-[#6f7282]">{t("recipients", { names: batch.result?.organizations.filter(org => org.added > 0).map(org => org.organizationName).join(", ") || t("noRowsAdded") })}</p>
        <Button variant="outline" className="rounded-2xl" onClick={() => onEdit(batch)}>{t("edit")}</Button>
        {batch.revisions.length > 0 ? <details className="mt-3"><summary className="cursor-pointer text-[13px]">{t("previousVersions", { count: batch.revisions.length })}</summary>{[...batch.revisions].reverse().map((revision, i) => <div key={i} className="mt-2 border-t border-[#ececf4] pt-2 text-[13px]"><p>{new Date(revision.changedAt).toLocaleString(dateLocale, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).replace(/\./g, "-").replace(",", "")} · {revision.changedByName}</p><p>{formatBrakerageDateTime(revision.input.date)} · {revision.input.rows.map((row) => `${row.name} (${row.time || revision.input.common.time})`).join(", ")}</p></div>)}</details> : null}
      </details>)}</div>
      {nextCursor ? <Button variant="outline" className="mt-4 rounded-2xl" disabled={loading} onClick={() => void loadMore()}>{t("showEarlier")}</Button> : null}
    </details>
  </section>;
}
