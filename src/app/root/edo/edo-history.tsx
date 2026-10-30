"use client";

import { Loader2, RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { EdoSignLink, EdoStatusChip } from "@/components/root/edo-status";
import { edoStatusKind, edoWaitsSender } from "@/lib/edo/saby/status";
import type { EdoDocumentView } from "@/lib/edo/send-core";
import { cn } from "@/lib/utils";

import { BTN_OUTLINE, CARD, EYEBROW } from "./edo-ui";

const ruDate = (ymd: string) => ymd.split("-").reverse().join(".");

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

export function EdoHistory({
  documents,
  canRefresh,
  onDocuments,
}: {
  documents: EdoDocumentView[];
  canRefresh: boolean;
  onDocuments: (docs: EdoDocumentView[]) => void;
}) {
  const t = useTranslations("rootEdo");
  const [refreshing, setRefreshing] = useState(false);

  async function refresh() {
    setRefreshing(true);
    try {
      const res = await fetch("/api/root/edo/documents/refresh", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const data = (await res.json().catch(() => null)) as
        | { checked?: number; changed?: number; failed?: number; documents?: EdoDocumentView[]; error?: string }
        | null;
      if (!res.ok || !data?.documents) {
        toast.error(data?.error ?? t("errors.generic"));
        return;
      }
      onDocuments(data.documents);
      if (!data.checked) toast.success(t("history.refresh.nothing"));
      else toast.success(t("history.refresh.done", { checked: String(data.checked), changed: String(data.changed ?? 0) }));
      if (data.failed) toast.error(t("history.refresh.failed", { failed: String(data.failed) }));
    } catch {
      toast.error(t("errors.network"));
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <section className={CARD} data-testid="edo-history">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className={cn(EYEBROW, "mb-0")}>{t("history.title")}</div>
        <button type="button" onClick={() => void refresh()} disabled={refreshing || !canRefresh || documents.length === 0} className={BTN_OUTLINE} data-testid="edo-refresh">
          {refreshing ? <Loader2 className="size-4 animate-spin text-[#5566f6]" /> : <RefreshCw className="size-4 text-[#5566f6]" />}
          {t("history.refresh.button")}
        </button>
      </div>
      <p className="-mt-2 mb-4 text-[12.5px] text-[#6f7282]">{t("history.hint")}</p>

      {documents.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-6 py-12 text-center">
          <div className="text-[15px] font-medium text-[#0b1024]">{t("history.empty.title")}</div>
          <p className="mx-auto mt-1.5 max-w-[380px] text-[13px] text-[#6f7282]">{t("history.empty.text")}</p>
        </div>
      ) : (
        <ul className="divide-y divide-[#ececf4]" data-testid="edo-history-list">
          {documents.map((doc) => {
            const kind = edoStatusKind(doc);
            return (
              <li key={doc.id} className="flex flex-col gap-2 py-3.5 sm:flex-row sm:items-center sm:justify-between" data-testid="edo-history-row" data-id={doc.id}>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="rounded-full bg-[#f5f6ff] px-2 py-0.5 text-[11.5px] font-medium text-[#3848c7]">{t(`kinds.${doc.kind}.title`)}</span>
                    <span className="text-[14px] font-medium text-[#0b1024]">{t("history.docTitle", { number: doc.number, date: ruDate(doc.docDate) })}</span>
                  </div>
                  <div className="mt-0.5 truncate text-[12.5px] text-[#6f7282]">
                    {doc.organizationName} · {t("history.inn", { inn: doc.recipientInn })}
                    {doc.recipientEdo ? ` · ${t(`history.recipient.${doc.recipientEdo as "saby" | "roaming" | "invited" | "none"}`, { operator: doc.recipientOperator ?? "—" })}` : ""}
                  </div>
                  <div className="mt-0.5 truncate text-[12px] text-[#9b9fb3]">
                    {doc.fileName} · {t("history.sentAt", { at: formatDateTime(doc.createdAt) })}
                  </div>
                  {doc.error ? <div className="mt-1 text-[12.5px] text-[#a13a32]">{doc.error}</div> : null}
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <EdoStatusChip stateCode={doc.stateCode} deletedAt={doc.deletedAt} error={doc.error} stateName={doc.stateName} />
                  {edoWaitsSender(kind) && doc.signUrl ? <EdoSignLink href={doc.signUrl} compact /> : null}
                  {!edoWaitsSender(kind) && doc.signUrl && kind !== "deleted" ? (
                    <a href={doc.signUrl} target="_blank" rel="noreferrer noopener" className="text-[12.5px] font-medium text-[#3848c7] hover:underline">
                      {t("history.openInSaby")}
                    </a>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
