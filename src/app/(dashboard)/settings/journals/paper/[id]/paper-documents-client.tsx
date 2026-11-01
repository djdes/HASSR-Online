"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Archive, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useLocale, useTranslations } from "next-intl";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { formatJournalPeriodLabel } from "@/lib/journal-document-title";
import type { PaperJournal } from "@/lib/sphere-journal-rules";
import { cn } from "@/lib/utils";
import {
  CreatePaperDocumentDialog,
  type PaperPickerUser,
} from "./create-paper-document-dialog";

/**
 * Документы бумажного журнала — как в электронных: активные и закрытые.
 *
 * Бумажный журнал ведут периодами, и после закрытия периода бланк не
 * должен продолжать заполняться. Документ открывается отдельной
 * страницей, как у электронных журналов; создаётся через модалку с
 * периодом и людьми.
 *
 * Оригиналом остаётся распечатанный лист с живыми подписями. Здесь
 * хранится подготовка к печати, чтобы не перезаполнять бланк каждый раз.
 */

export type PaperDocument = {
  id: string;
  title: string;
  status: string;
  dateFrom: string | null;
  dateTo: string | null;
  responsible: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** Точка документа (2026-11-01); null — общий документ. */
  buildingName?: string | null;
};

/** `Date` из API приходит ISO-строкой — для подписи периода нужна дата. */
function isoDay(value: string | null): string | null {
  return value ? value.slice(0, 10) : null;
}

export function PaperDocumentsClient({
  journal,
  users,
}: {
  journal: PaperJournal;
  users: PaperPickerUser[];
}) {
  const t = useTranslations("settingsUi.paperDocumentsClient");
  const tc = useTranslations("common");
  const locale = useLocale();
  const dateLocale =
    locale === "en" ? "en-GB" : locale === "uz" ? "uz-UZ" : "ru-RU";
  const [documents, setDocuments] = useState<PaperDocument[] | null>(null);
  const [tab, setTab] = useState<"active" | "closed">("active");
  const [closing, setClosing] = useState<PaperDocument | null>(null);
  const [removing, setRemoving] = useState<PaperDocument | null>(null);

  async function reload() {
    const res = await fetch(
      `/api/settings/journals/paper/${journal.id}/documents`,
    ).catch(() => null);
    if (!res?.ok) {
      setDocuments([]);
      return;
    }
    const data = await res.json();
    setDocuments(data.documents ?? []);
  }

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [journal.id]);

  async function patch(id: string, body: Record<string, unknown>) {
    const res = await fetch(
      `/api/settings/journals/paper/${journal.id}/documents/${id}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    if (!res.ok) {
      toast.error(t("saveFailed"));
      return false;
    }
    await reload();
    return true;
  }

  const visible = (documents ?? []).filter((doc) =>
    tab === "active" ? doc.status === "active" : doc.status === "closed",
  );

  if (documents === null) {
    return (
      <div className="flex items-center gap-2 text-[13px] text-[#9b9fb3]">
        <Loader2 className="size-4 animate-spin" />
        {t("loading")}
      </div>
    );
  }

  return (
    <section className="rounded-3xl border border-[#ececf4] bg-white shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
      <div className="flex flex-wrap items-center gap-3 border-b border-[#eef0f6] px-5 py-4">
        <div className="flex gap-1">
          {(["active", "closed"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setTab(value)}
              className={cn(
                "h-9 rounded-xl px-3 text-[13.5px] transition-colors",
                tab === value
                  ? "bg-[#eef1ff] font-medium text-[#3848c7]"
                  : "text-[#6f7282] hover:bg-[#f5f6ff]",
              )}
            >
              {value === "active" ? t("tabActive") : t("tabClosed")}
              <span className="ml-1.5 text-[12px] opacity-70">
                {
                  (documents ?? []).filter((d) =>
                    value === "active"
                      ? d.status === "active"
                      : d.status === "closed",
                  ).length
                }
              </span>
            </button>
          ))}
        </div>
        <CreatePaperDocumentDialog
          journal={journal}
          users={users}
          triggerClassName="ml-auto"
        />
      </div>

      {visible.length === 0 ? (
        <p className="px-5 py-8 text-center text-[13.5px] text-[#6f7282]">
          {tab === "active"
            ? t("emptyActive")
            : t("emptyClosed")}
        </p>
      ) : (
        <ul className="divide-y divide-[#eef0f6]">
          {visible.map((doc) => {
            const period = formatJournalPeriodLabel(
              isoDay(doc.dateFrom),
              isoDay(doc.dateTo),
            );
            const meta = [
              doc.buildingName,
              period,
              doc.responsible,
              doc.closedAt
                ? t("closedOn", {
                    date: new Date(doc.closedAt).toLocaleDateString(dateLocale),
                  })
                : t("changedAt", {
                    date: new Date(doc.updatedAt).toLocaleString(dateLocale),
                  }),
            ].filter(Boolean);
            return (
              <li
                key={doc.id}
                className="flex flex-wrap items-center gap-3 px-5 py-3"
              >
                <Link
                  href={`/settings/journals/paper/${journal.id}/documents/${doc.id}`}
                  className="min-w-0 flex-1 text-left text-[14px] text-[#0b1024] transition-colors hover:text-[#3848c7]"
                >
                  {doc.title}
                  <span className="mt-0.5 block text-[12px] font-normal text-[#9b9fb3]">
                    {meta.join(" · ")}
                  </span>
                </Link>

                {doc.status === "active" ? (
                  <button
                    type="button"
                    onClick={() => setClosing(doc)}
                    className="inline-flex h-9 items-center gap-2 rounded-xl border border-[#dcdfed] bg-white px-3 text-[13px] font-medium text-[#6f7282] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
                  >
                    <Archive className="size-4" />
                    {tc("close")}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void patch(doc.id, { status: "active" })}
                    className="inline-flex h-9 items-center gap-2 rounded-xl border border-[#dcdfed] bg-white px-3 text-[13px] font-medium text-[#6f7282] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
                  >
                    {t("reopen")}
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => setRemoving(doc)}
                  aria-label={t("removeAria")}
                  className="rounded-lg p-2 text-[#9b9fb3] transition-colors hover:bg-[#fff4f2] hover:text-[#a13a32]"
                >
                  <Trash2 className="size-4" />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <ConfirmDialog
        open={Boolean(closing)}
        onClose={() => setClosing(null)}
        onConfirm={async () => {
          if (!closing) return;
          await patch(closing.id, { status: "closed" });
          setClosing(null);
        }}
        variant="info"
        title={t("closeTitle")}
        description={t("closeDescription")}
        bullets={[
          { label: t("closeBulletSaved") },
          { label: t("closeBulletReopen") },
        ]}
        confirmLabel={tc("close")}
      />

      <ConfirmDialog
        open={Boolean(removing)}
        onClose={() => setRemoving(null)}
        onConfirm={async () => {
          if (!removing) return;
          await fetch(
            `/api/settings/journals/paper/${journal.id}/documents/${removing.id}`,
            { method: "DELETE" },
          );
          await reload();
          setRemoving(null);
        }}
        variant="danger"
        title={t("removeTitle", { title: removing?.title ?? "" })}
        description={t("removeDescription")}
        bullets={[
          { label: t("removeBullet"), tone: "info" },
        ]}
        confirmLabel={tc("delete")}
      />
    </section>
  );
}
