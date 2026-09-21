"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Loader2, X, ShieldCheck } from "lucide-react";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  completionEntryLabel,
  isInternalCompletionKey,
} from "@/lib/completion-labels";
import { humanizeFetchError } from "@/lib/humanize-fetch-error";

const VALUE_LABELS: Record<string, string> = {
  healthy: "здоров",
  sick: "болен",
  day_off: "выходной",
  on_leave: "отпуск",
  passed: "допущен",
  failed: "не допущен",
};

// Словарь подписей общий с «Проверками» (`lib/completion-labels.ts`):
// одно и то же поле не должно называться по-разному на двух экранах.
const formatFieldLabel = completionEntryLabel;

function formatFieldValue(value: unknown): ReactNode {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") {
    return value ? "✓ да" : "— нет";
  }
  if (typeof value === "string") {
    return VALUE_LABELS[value] ?? value;
  }
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) {
    return value.length === 0
      ? "—"
      : value.map((v) => formatFieldValue(v)).join(", ");
  }
  // Объект — рекурсивно plain
  return (
    <span className="text-[#9b9fb3]">
      {JSON.stringify(value).slice(0, 80)}
    </span>
  );
}

function CellDataView({ data }: { data: unknown }) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return (
      <div className="mt-1 rounded-lg bg-white p-2 text-[11px] text-[#9b9fb3]">
        Пусто
      </div>
    );
  }
  const entries = Object.entries(data as Record<string, unknown>).filter(
    ([k, v]) =>
      // Служебные ключи (`_autoSeeded`) ставит система, а не человек.
      !isInternalCompletionKey(k) && v !== null && v !== undefined && v !== "",
  );
  if (entries.length === 0) {
    return (
      <div className="mt-1 rounded-lg bg-white p-2 text-[11px] text-[#9b9fb3]">
        Пусто
      </div>
    );
  }
  return (
    <ul className="mt-1 grid gap-0.5 rounded-lg bg-white p-2 text-[12px] leading-relaxed sm:grid-cols-2">
      {entries.map(([k, v]) => (
        <li key={k} className="flex gap-1.5">
          <span className="text-[#9b9fb3]">{formatFieldLabel(k)}:</span>
          <span className="font-medium text-[#0b1024]">
            {formatFieldValue(v)}
          </span>
        </li>
      ))}
    </ul>
  );
}

type Entry = {
  id: string;
  date: string;
  employeeName: string;
  data: unknown;
  verificationStatus: string | null;
  verificationRejectReason: string | null;
  verificationDecidedAt: string | null;
};

type Props = {
  documentId: string;
  journalCode: string;
  initialEntries: Entry[];
  docVerificationStatus: string | null;
};

export function VerifierClient({
  documentId,
  initialEntries,
  docVerificationStatus,
}: Props) {
  const router = useRouter();
  const [entries, setEntries] = useState(initialEntries);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  // Нативный `confirm()` в WebView Telegram может не показаться вовсе —
  // кнопка тогда просто ничего не делает (CLAUDE.md §6).
  const [approveAllOpen, setApproveAllOpen] = useState(false);

  const grouped = useMemo(() => {
    const map = new Map<string, Entry[]>();
    for (const e of entries) {
      const key = e.date.slice(0, 10);
      const arr = map.get(key) ?? [];
      arr.push(e);
      map.set(key, arr);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([date, items]) => ({ date, items }));
  }, [entries]);

  const allSelected =
    entries.length > 0 && entries.every((e) => selected.has(e.id));
  const anySelected = selected.size > 0;

  function toggleEntry(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(entries.map((e) => e.id)));
    }
  }

  async function call(body: Record<string, unknown>) {
    const res = await fetch(
      `/api/journal-documents/${documentId}/verifier`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    if (!res.ok) {
      const j = await res.json().catch(() => null);
      throw new Error(j?.error ?? `HTTP ${res.status}`);
    }
    return res.json();
  }

  async function approveAll() {
    if (busy) return;
    setBusy(true);
    try {
      await call({ decision: "approve-all" });
      setEntries((prev) =>
        prev.map((e) => ({
          ...e,
          verificationStatus: "approved",
          verificationRejectReason: null,
          verificationDecidedAt: new Date().toISOString(),
        })),
      );
      setSelected(new Set());
      toast.success("Журнал принят целиком");
      router.refresh();
    } catch (err) {
      toast.error(humanizeFetchError(err, "Ошибка"));
    } finally {
      setBusy(false);
    }
  }

  async function approveSelected() {
    if (busy || !anySelected) return;
    setBusy(true);
    try {
      const ids = Array.from(selected);
      await call({ decision: "approve-cells", entryIds: ids });
      setEntries((prev) =>
        prev.map((e) =>
          ids.includes(e.id)
            ? {
                ...e,
                verificationStatus: "approved",
                verificationRejectReason: null,
                verificationDecidedAt: new Date().toISOString(),
              }
            : e,
        ),
      );
      setSelected(new Set());
      toast.success(`Принято ячеек: ${ids.length}`);
      router.refresh();
    } catch (err) {
      toast.error(humanizeFetchError(err, "Ошибка"));
    } finally {
      setBusy(false);
    }
  }

  async function confirmReject() {
    if (busy) return;
    const reason = rejectReason.trim();
    if (!reason) {
      toast.error("Укажите причину");
      return;
    }
    setBusy(true);
    try {
      const ids = Array.from(selected);
      await call({ decision: "reject-cells", entryIds: ids, reason });
      setEntries((prev) =>
        prev.map((e) =>
          ids.includes(e.id)
            ? {
                ...e,
                verificationStatus: "rejected",
                verificationRejectReason: reason,
                verificationDecidedAt: new Date().toISOString(),
              }
            : e,
        ),
      );
      setSelected(new Set());
      setRejectOpen(false);
      setRejectReason("");
      toast.success(`Отклонено ячеек: ${ids.length}`);
      router.refresh();
    } catch (err) {
      toast.error(humanizeFetchError(err, "Ошибка"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-3xl border border-[#ececf4] bg-white p-3 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] md:p-5">
      <div className="flex flex-wrap items-center gap-2 border-b border-[#ececf4] pb-3">
        <button
          type="button"
          onClick={toggleAll}
          disabled={busy}
          className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-[#dcdfed] bg-white px-3 text-[13px] hover:bg-[#fafbff] disabled:opacity-60"
        >
          <input
            type="checkbox"
            checked={allSelected}
            readOnly
            className="size-3.5"
          />
          {allSelected ? "Снять отметку со всех" : "Отметить всё"}
        </button>
        <span className="text-[12px] text-[#6f7282]">
          Выделено: {selected.size}
        </span>
        <div className="ml-auto flex flex-wrap gap-2">
          <button
            type="button"
            onClick={approveSelected}
            disabled={busy || !anySelected}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[#136b2a] px-3 text-[13px] font-medium text-white hover:bg-[#0e5320] disabled:opacity-50"
          >
            {busy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Check className="size-4" />
            )}
            Принять отмеченные
          </button>
          <button
            type="button"
            onClick={() => {
              if (anySelected) setRejectOpen(true);
            }}
            disabled={busy || !anySelected}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-[#a13a32] bg-white px-3 text-[13px] font-medium text-[#a13a32] hover:bg-[#fff4f2] disabled:opacity-50"
          >
            <X className="size-4" />
            Отклонить отмеченные
          </button>
          <button
            type="button"
            onClick={() => setApproveAllOpen(true)}
            disabled={busy || docVerificationStatus === "approved"}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[#5566f6] px-3 text-[13px] font-medium text-white hover:bg-[#4a5bf0] disabled:opacity-50"
          >
            <ShieldCheck className="size-4" />
            Принять весь журнал
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={approveAllOpen}
        onClose={() => setApproveAllOpen(false)}
        onConfirm={async () => {
          setApproveAllOpen(false);
          await approveAll();
        }}
        title="Принять весь журнал?"
        description={`Одобрены будут все записи документа — ${entries.length}. Отмечать ячейки по одной не придётся.`}
        bullets={[
          { label: "Все записи получат статус «Принято»", tone: "info" },
          {
            label: "Отклонить отдельную запись после этого можно, но придётся делать это вручную",
            tone: "warn",
          },
        ]}
        confirmLabel="Принять всё"
        cancelLabel="Отмена"
        variant="info"
      />

      {rejectOpen ? (
        <div className="mt-3 rounded-2xl border border-[#fecaca] bg-[#fff4f2] p-3">
          <div className="text-[13px] font-medium text-[#a13a32]">
            Причина отказа ({selected.size} ячеек):
          </div>
          <textarea
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            rows={2}
            placeholder="Что не так — что нужно исправить"
            className="mt-2 w-full rounded-xl border border-[#dcdfed] bg-white px-3 py-2 text-[13px] focus:border-[#a13a32] focus:outline-none focus:ring-2 focus:ring-[#fecaca]"
          />
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={confirmReject}
              disabled={busy}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[#a13a32] px-3 text-[13px] font-medium text-white hover:bg-[#7a2c26] disabled:opacity-50"
            >
              {busy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <X className="size-4" />
              )}
              Отклонить
            </button>
            <button
              type="button"
              onClick={() => {
                setRejectOpen(false);
                setRejectReason("");
              }}
              disabled={busy}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-[#dcdfed] bg-white px-3 text-[13px] hover:bg-[#fafbff] disabled:opacity-50"
            >
              Отмена
            </button>
          </div>
        </div>
      ) : null}

      <div className="mt-3 space-y-3">
        {grouped.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[#dcdfed] bg-[#fafbff] p-6 text-center text-[13px] text-[#6f7282]">
            В журнале пока нет записей. Сотрудники ещё ничего не заполнили.
          </div>
        ) : (
          grouped.map(({ date, items }) => (
            <div
              key={date}
              className="rounded-2xl border border-[#ececf4] bg-[#fafbff] p-3"
            >
              <div className="mb-2 text-[12px] font-semibold uppercase tracking-[0.12em] text-[#6f7282]">
                {new Date(date).toLocaleDateString("ru-RU", {
                  day: "2-digit",
                  month: "long",
                  year: "numeric",
                })}{" "}
                · {items.length}
              </div>
              <ul className="divide-y divide-[#ececf4]">
                {items.map((e) => (
                  <li
                    key={e.id}
                    className={`flex flex-wrap items-start gap-2 py-2 ${
                      e.verificationStatus === "rejected"
                        ? "rounded-lg bg-[#fff4f2] px-2"
                        : ""
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(e.id)}
                      onChange={() => toggleEntry(e.id)}
                      disabled={busy}
                      className="mt-1 size-4"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 text-[13px]">
                        <span className="font-medium text-[#0b1024]">
                          {e.employeeName}
                        </span>
                        {e.verificationStatus === "approved" ? (
                          <span className="rounded-full bg-[#ecfdf5] px-2 py-0.5 text-[10px] text-[#136b2a]">
                            принято
                          </span>
                        ) : e.verificationStatus === "rejected" ? (
                          <span className="rounded-full bg-[#fff4f2] px-2 py-0.5 text-[10px] text-[#d2453d]">
                            отклонено
                          </span>
                        ) : (
                          <span className="rounded-full bg-[#fff8eb] px-2 py-0.5 text-[10px] text-[#a13a32]">
                            на проверке
                          </span>
                        )}
                      </div>
                      <CellDataView data={e.data} />
                      {e.verificationRejectReason ? (
                        <div className="mt-1 text-[12px] text-[#d2453d]">
                          Причина: {e.verificationRejectReason}
                        </div>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
