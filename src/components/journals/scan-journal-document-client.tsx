"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ScanTranslate } from "@/lib/scan-journal-presentation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FocusTodayScroller } from "@/components/journals/focus-today-scroller";
import { JournalDocumentShell } from "@/components/journals/journal-document-shell";

type Props = {
  templateCode: string;
  templateName: string;
  documentId: string;
  pageCount: number;
  currentPage: number;
};

export function ScanJournalDocumentClient({
  templateCode,
  templateName,
  documentId,
  pageCount,
  currentPage,
}: Props) {
  const t = useTranslations() as unknown as ScanTranslate;
  const totalPages = pageCount;
  const canPrev = currentPage > 1;
  const canNext = currentPage < totalPages;
  const imageUrl = `/api/journal-scans/${templateCode}?page=${currentPage}`;

  return (
    <div className="space-y-5">
      <FocusTodayScroller selector="[data-focus-today]" emptyTitle={t("journalScan.focus.emptyTitle")} emptyBody={t("journalScan.focus.emptyBody")} copy={{ noCreateBody: t("journalScan.focus.noCreateBody"), later: t("journalScan.focus.later"), close: t("common.close") }} />
      <JournalDocumentShell
        title={<>{templateName}</>}
        subtitle={t("journalScan.document.pageSubtitle", { currentPage, totalPages })}
        documentId={documentId}
        backHref={`/journals/${templateCode}`}
      >
        <div className="overflow-hidden rounded-[16px] border border-[#dbe0f1] bg-white p-2">
          <img
            src={imageUrl}
            alt={t("journalScan.document.imageAlt", { code: templateCode, currentPage })}
            className="h-auto w-full rounded-[12px] bg-white"
          />
        </div>
      </JournalDocumentShell>

      <div className="flex flex-wrap items-center justify-between gap-3">
        {canPrev ? (
          <Button asChild>
            <Link href={`/journals/${templateCode}/documents/${documentId}?page=${currentPage - 1}`}>
              <ChevronLeft className="size-4" />
              {t("journalScan.document.previous")}
            </Link>
          </Button>
        ) : (
          <div />
        )}

        <div className="text-sm text-[#7a7d8e]">
          {currentPage} / {totalPages}
        </div>

        {canNext ? (
          <Button asChild>
            <Link href={`/journals/${templateCode}/documents/${documentId}?page=${currentPage + 1}`}>
              {t("journalScan.document.next")}
              <ChevronRight className="size-4" />
            </Link>
          </Button>
        ) : (
          <div />
        )}
      </div>
    </div>
  );
}
