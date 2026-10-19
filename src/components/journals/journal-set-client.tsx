"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ArrowRight, Check, CheckCheck, Circle, CircleDashed, Clock3, Loader2, Power } from "lucide-react";
import { toast } from "sonner";
import { createTranslator } from "use-intl/core";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { Locale } from "@/i18n/locales";
import type { JournalSetId } from "@/lib/journal-sets";
import type { JournalSetTodayStatus } from "@/lib/journal-set-today";
import { cn } from "@/lib/utils";

/**
 * Клиентская часть страниц наборов журналов (`journal-set-page.tsx`): кнопка
 * «Включить весь набор» с подтверждением и список журналов с «Включить» по
 * одному. Тексты приходят с сервера уже переведёнными; шаблоны с числом или
 * названием (`{count}`, `{name}`) — сырыми, форматируются здесь.
 */

export type JournalSetJournal = {
  code: string;
  name: string;
  enabled: boolean;
  today: JournalSetTodayStatus;
  href: string | null;
};

export type JournalSetCardItem = JournalSetJournal & { related: JournalSetJournal[] };

type ListCopy = {
  status: Record<"on" | "off" | "filled" | "notFilled" | "notRequired", string>;
  related: string;
  relatedHint: string;
  open: string;
  enableOne: string;
  /** Сырой шаблон: «Журнал включён: {name}». */
  enableOneDone: string;
  enableFailed: string;
};

function format(locale: Locale, template: string, values: Record<string, string | number>): string {
  return createTranslator({ locale, messages: { message: template } })("message", values);
}

async function readError(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
  return typeof body?.error === "string" && body.error ? body.error : fallback;
}

const PRIMARY_BUTTON =
  "inline-flex h-10 items-center gap-2 rounded-2xl bg-[#5566f6] px-4 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors duration-150 hover:bg-[#4a5bf0] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 disabled:pointer-events-none disabled:opacity-60";
const OUTLINE_BUTTON =
  "inline-flex h-10 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 disabled:pointer-events-none disabled:opacity-60";
const SOFT_BUTTON =
  "inline-flex h-10 items-center gap-2 rounded-2xl bg-[#eef1ff] px-4 text-[14px] font-medium text-[#3848c7] transition-colors duration-150 hover:bg-[#e2e7ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 disabled:pointer-events-none disabled:opacity-60";

/** «Включить весь набор»: подтверждение со списком журналов → POST → тост → обновление страницы. */
export function JournalSetEnableAll({
  setId,
  locale,
  names,
  copy,
}: {
  setId: JournalSetId;
  locale: Locale;
  /** Журналы, которые включатся (выключенные основные пункты набора). */
  names: string[];
  copy: {
    button: string;
    title: string;
    description: string;
    confirm: string;
    /** Сырой шаблон: «Включено журналов: {count}». */
    done: string;
    failed: string;
  };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [refreshing, startRefresh] = useTransition();

  async function enableAll() {
    const response = await fetch("/api/settings/journals/sets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ set: setId }),
    });
    if (!response.ok) {
      toast.error(await readError(response, copy.failed));
      return;
    }
    const body = (await response.json().catch(() => null)) as { changed?: unknown } | null;
    const changed = Array.isArray(body?.changed) ? body.changed.length : 0;
    toast.success(format(locale, copy.done, { count: changed }));
    setOpen(false);
    startRefresh(() => router.refresh());
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={refreshing}
        className={PRIMARY_BUTTON}
        data-journal-set-enable-all
      >
        {refreshing ? <Loader2 className="size-4 animate-spin" /> : <CheckCheck className="size-4" />}
        {copy.button}
      </button>
      <ConfirmDialog
        open={open}
        onClose={() => setOpen(false)}
        onConfirm={enableAll}
        title={copy.title}
        description={copy.description}
        bullets={names.map((name) => ({ label: name }))}
        confirmLabel={copy.confirm}
        variant="info"
        icon={CheckCheck}
      />
    </>
  );
}

const CHIP = "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-medium";

function StatusChips({ journal, copy }: { journal: JournalSetJournal; copy: ListCopy }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {journal.enabled ? (
        <span className={cn(CHIP, "bg-[#ecfdf5] text-[#116b2a]")}>
          <Power className="size-3.5" />
          {copy.status.on}
        </span>
      ) : (
        <span className={cn(CHIP, "border border-[#dcdfed] bg-white text-[#6f7282]")}>
          <Circle className="size-3.5" />
          {copy.status.off}
        </span>
      )}
      {journal.today === "filled" ? (
        <span className={cn(CHIP, "bg-[#ecfdf5] text-[#116b2a]")}>
          <Check className="size-3.5" />
          {copy.status.filled}
        </span>
      ) : journal.today === "notFilled" ? (
        <span className={cn(CHIP, "bg-[#fff4f2] text-[#a13a32]")}>
          <Clock3 className="size-3.5" />
          {copy.status.notFilled}
        </span>
      ) : journal.today === "notRequired" ? (
        <span className={cn(CHIP, "bg-[#f5f6ff] text-[#3848c7]")}>
          <CircleDashed className="size-3.5" />
          {copy.status.notRequired}
        </span>
      ) : null}
    </div>
  );
}

/**
 * «Открыть журнал» — контурная, «Включить» — мягкая индиго: основная кнопка
 * страницы одна — «Включить весь набор» в шапке.
 */
function JournalActions({
  journal,
  canManage,
  busy,
  onEnable,
  copy,
}: {
  journal: JournalSetJournal;
  canManage: boolean;
  busy: boolean;
  onEnable: (journal: JournalSetJournal) => void;
  copy: ListCopy;
}) {
  if (journal.enabled && journal.href) {
    return (
      <Link href={journal.href} className={OUTLINE_BUTTON} data-journal-open={journal.code}>
        {copy.open}
        <ArrowRight className="size-4 text-[#5566f6]" />
      </Link>
    );
  }
  if (!journal.enabled && canManage) {
    return (
      <button
        type="button"
        onClick={() => onEnable(journal)}
        disabled={busy}
        className={SOFT_BUTTON}
        data-journal-enable={journal.code}
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Power className="size-4" />}
        {copy.enableOne}
      </button>
    );
  }
  return null;
}

/** Нумерованный список журналов набора — в порядке `JOURNAL_SETS`. */
export function JournalSetList({
  heading,
  items,
  canManage,
  locale,
  copy,
}: {
  heading: string | null;
  items: JournalSetCardItem[];
  canManage: boolean;
  locale: Locale;
  copy: ListCopy;
}) {
  const router = useRouter();
  const [busyCode, setBusyCode] = useState<string | null>(null);
  const [, startRefresh] = useTransition();

  async function enable(journal: JournalSetJournal) {
    setBusyCode(journal.code);
    try {
      const response = await fetch(`/api/settings/journals/${encodeURIComponent(journal.code)}/enable`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: "journal-page" }),
      });
      if (!response.ok) {
        toast.error(await readError(response, copy.enableFailed));
        return;
      }
      toast.success(format(locale, copy.enableOneDone, { name: journal.name }));
      startRefresh(() => router.refresh());
    } catch {
      toast.error(copy.enableFailed);
    } finally {
      setBusyCode(null);
    }
  }

  return (
    <section className="rounded-3xl border border-[#ececf4] bg-white p-4 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] sm:p-6">
      {heading ? (
        <div className="mb-4 text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]">{heading}</div>
      ) : null}
      <ol className="space-y-2.5">
        {items.map((item, index) => (
          <li
            key={item.code}
            data-journal-set-item={item.code}
            data-enabled={item.enabled ? "true" : "false"}
            data-today={item.today}
            className={cn(
              "flex items-start gap-3 rounded-2xl border p-3.5 transition-colors duration-150 sm:gap-4 sm:p-4",
              item.enabled ? "border-[#ececf4] bg-white hover:border-[#dcdfed]" : "border-[#ececf4] bg-[#fafbff]",
            )}
          >
            <span
              className={cn(
                "flex size-9 shrink-0 items-center justify-center rounded-full text-[14px] font-semibold tabular-nums",
                item.enabled ? "bg-[#eef1ff] text-[#3848c7]" : "bg-white text-[#9b9fb3] ring-1 ring-[#ececf4]",
              )}
            >
              {index + 1}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 space-y-1.5">
                  <div
                    className={cn(
                      "break-words text-[15px] font-medium leading-snug",
                      item.enabled ? "text-[#0b1024]" : "text-[#3c4053]",
                    )}
                  >
                    {item.name}
                  </div>
                  <StatusChips journal={item} copy={copy} />
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <JournalActions
                    journal={item}
                    canManage={canManage}
                    busy={busyCode === item.code}
                    onEnable={enable}
                    copy={copy}
                  />
                </div>
              </div>
              {item.related.map((related) => (
                <div
                  key={related.code}
                  data-journal-set-related={related.code}
                  className="mt-3 flex flex-col gap-2.5 rounded-2xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-3.5 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 space-y-1.5">
                    <div className="text-[12px] font-semibold uppercase tracking-[0.12em] text-[#9b9fb3]">
                      {copy.related}
                    </div>
                    <div className="break-words text-[14px] font-medium text-[#0b1024]">{related.name}</div>
                    <StatusChips journal={related} copy={copy} />
                    {!related.enabled ? (
                      <p className="text-[13px] leading-[1.5] text-[#6f7282]">{copy.relatedHint}</p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <JournalActions
                      journal={related}
                      canManage={canManage}
                      busy={busyCode === related.code}
                      onEnable={enable}
                      copy={copy}
                    />
                  </div>
                </div>
              ))}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
