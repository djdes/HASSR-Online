import { Inbox } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * «Записей пока нет» in a journal (spec site-motion-round2-2026-11-22, AC7): an icon above the
 * text instead of a lone grey line.
 *
 * • `box` — on its own (the cards view on a phone): a plain veil box, no dashed border.
 * • `cell` — inside the empty row of a table: no box (the cell is the frame).
 *
 * On paper only the text is left: the printed sheet is the same as before.
 */
export function JournalEmpty({
  children,
  variant = "box",
  className,
}: {
  children: React.ReactNode;
  variant?: "box" | "cell";
  className?: string;
}) {
  return (
    <div
      data-journal-empty
      className={cn(
        "flex flex-col items-center justify-center gap-2 text-center print:block",
        variant === "box" && "rounded-2xl bg-[var(--app-veil)] px-5 py-6 text-[13px] text-[#6f7282] print:bg-transparent print:p-0",
        className,
      )}
    >
      <Inbox aria-hidden className="size-6 text-[#9b9fb3] print:hidden" strokeWidth={1.75} />
      <span>{children}</span>
    </div>
  );
}
