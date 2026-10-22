"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { type Locale } from "@/i18n/locales";
import { formatQueueError, formatQueueWhen } from "../_lib/offline-presentation";
import { useSession } from "next-auth/react";
import { ArrowLeft, Clock, RotateCcw, TriangleAlert, UserCheck } from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { miniHomeHref } from "@/app/mini/_lib/nav-items";
import { haptic } from "../_components/use-haptic";
import {
  claimQueuedEntry,
  flushJournalQueue,
  listOrphanQueuedEntries,
  listOwnQueuedEntries,
  retryQueuedEntry,
  type QueuedJournalEntry,
} from "../_lib/journal-queue";

/**
 * «Что не ушло» — что именно лежит в очереди отправки.
 *
 * Раньше единственным следом очереди была полоса «Записей ждёт
 * отправки: 3». Какие три, почему не ушли, можно ли повторить — узнать
 * было нельзя, и человеку оставалось верить на слово. Для журнала,
 * который предъявляют на проверке, это плохая сделка: невидимое нельзя
 * проверить.
 *
 * Удаления здесь нет намеренно. Случайный тап стёр бы чужую смену
 * работы, а пользы от кнопки почти нет: запись либо уйдёт, либо её
 * отклонит сервер с внятной причиной.
 */
export default function OutboxPage() {
  const t = useTranslations("miniOffline");
  const navigation = useTranslations("navigation.routes");
  const locale = useLocale() as Locale;
  const latestText = useRef(t);
  useEffect(() => { latestText.current = t; }, [t]);
  const { data: session } = useSession();
  const userId = session?.user?.id ?? null;

  const [own, setOwn] = useState<QueuedJournalEntry[]>([]);
  const [orphans, setOrphans] = useState<QueuedJournalEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState<QueuedJournalEntry | null>(null);

  const load = useCallback(async () => {
    const [mine, others] = await Promise.all([
      listOwnQueuedEntries(userId).catch(() => []),
      listOrphanQueuedEntries().catch(() => []),
    ]);
    setOwn(mine);
    setOrphans(others);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    // The initial queue load awaits IndexedDB; keep its existing timing and dependencies.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function retry(entry: QueuedJournalEntry) {
    haptic("light");
    await retryQueuedEntry(entry.id);
    const result = await flushJournalQueue(userId);
    await load();
    if (result.sent > 0) {
      haptic("success");
      toast.success(latestText.current("outbox.retrySent"));
    } else {
      toast.message(latestText.current("outbox.retryPending"));
    }
  }

  async function confirmClaim() {
    if (!claiming || !userId) return;
    await claimQueuedEntry(claiming.id, userId);
    setClaiming(null);
    haptic("success");
    await flushJournalQueue(userId);
    await load();
  }

  const total = own.length + orphans.length;

  return (
    <div className="flex flex-1 flex-col gap-4 pb-28">
      <Link
        href={miniHomeHref(session?.user ?? null)}
        className="mini-btn-ghost mini-press -my-1 -ml-3.5 w-fit"
      >
        <ArrowLeft className="size-5" />
        {navigation("dashboard")}
      </Link>

      <div className="px-1">
        <div className="mini-eyebrow">{t("outbox.eyebrow")}</div>
        <h1 className="mini-h1 mt-1">{t("outbox.title")}</h1>
        <p
          className="mt-1.5 text-[16px] leading-relaxed"
          style={{ color: "var(--mini-text-muted)" }}
        >
          {t("outbox.description")}
        </p>
      </div>

      {loading ? (
        <div className="mini-skeleton-bar" style={{ height: 76, borderRadius: 16 }} />
      ) : total === 0 ? (
        <div
          className="mini-card flex flex-col items-center gap-2 p-8 text-center"
          role="status"
        >
          <span className="text-[18px] font-semibold" style={{ color: "var(--mini-text)" }}>
            {t("outbox.emptyTitle")}
          </span>
          <span className="text-[16px]" style={{ color: "var(--mini-text-muted)" }}>
            {t("outbox.emptyDescription")}
          </span>
        </div>
      ) : null}

      {own.length > 0 ? (
        <section className="flex flex-col gap-2">
          <div className="mini-eyebrow">{t("outbox.ownCount", { count: String(own.length) })}</div>
          {own.map((entry) => (
            <EntryRow key={entry.id} entry={entry} onRetry={() => void retry(entry)} />
          ))}
        </section>
      ) : null}

      {orphans.length > 0 ? (
        <section className="flex flex-col gap-2">
          <div className="mini-eyebrow">{t("outbox.orphanCount", { count: String(orphans.length) })}</div>
          <p
            className="text-[15px] leading-relaxed"
            style={{ color: "var(--mini-text-muted)" }}
          >
            {t("outbox.orphanDescription")}
          </p>
          {orphans.map((entry) => (
            <EntryRow
              key={entry.id}
              entry={entry}
              orphan
              onClaim={() => {
                haptic("light");
                setClaiming(entry);
              }}
            />
          ))}
        </section>
      ) : null}

      <ConfirmDialog
        open={claiming !== null}
        onClose={() => setClaiming(null)}
        onConfirm={confirmClaim}
        variant="warn"
        title={t("outbox.claimTitle")}
        description={
          claiming
            ? t("outbox.claimDescription", { journal: claiming.journalName, time: formatQueueWhen(claiming.createdAt, locale, t) })
            : undefined
        }
        bullets={[
          { label: t("outbox.claimSignature"), tone: "warn" },
          { label: t("outbox.claimOnlyMine"), tone: "warn" },
          { label: t("outbox.claimCannotChange") },
        ]}
        confirmLabel={t("outbox.claimConfirm")}
      />
    </div>
  );
}

function EntryRow({
  entry,
  orphan,
  onRetry,
  onClaim,
}: {
  entry: QueuedJournalEntry;
  orphan?: boolean;
  onRetry?: () => void;
  onClaim?: () => void;
}) {
  const t = useTranslations("miniOffline");
  const locale = useLocale() as Locale;
  return (
    <div className="mini-card flex items-center gap-3 p-3.5">
      <span className="min-w-0 flex-1">
        <span
          className="block truncate text-[17px] font-semibold"
          style={{ color: "var(--mini-text)" }}
        >
          {entry.journalName}
        </span>
        <span
          className="mt-0.5 flex items-center gap-1.5 text-[14px]"
          style={{ color: "var(--mini-text-muted)" }}
        >
          <Clock className="size-3.5" />
          {formatQueueWhen(entry.createdAt, locale, t)}
          {entry.lastError ? (
            <>
              <TriangleAlert className="size-3.5" style={{ color: "var(--mini-amber)" }} />
              <span className="truncate">{formatQueueError(entry.lastError, t)}</span>
            </>
          ) : null}
        </span>
      </span>

      {orphan ? (
        <button
          type="button"
          onClick={onClaim}
          className="mini-btn-primary mini-btn-sm mini-press shrink-0"
        >
          <UserCheck className="size-5" />
          {t("outbox.mine")}
        </button>
      ) : (
        <button
          type="button"
          onClick={onRetry}
          aria-label={t("outbox.retryAria")}
          className="mini-btn-secondary mini-btn-sm mini-press size-12 shrink-0"
          style={{ padding: 0 }}
        >
          <RotateCcw className="size-5" />
        </button>
      )}
    </div>
  );
}
