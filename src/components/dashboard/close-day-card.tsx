"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { QrCode, Wand2 } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { LinkPendingSpinner } from "@/components/ui/link-pending";
import { toast } from "sonner";
import { localDayKey } from "@/lib/entry-defaults";
import {
  AUTOFILL_DESCRIPTION,
  autofillToast,
  type AutofillResult,
} from "@/lib/journals-autofill";

/**
 * Две кнопки карточки «Обязательные журналы» на главной (решение
 * владельца 2026-09-25):
 *
 *   • «Автозаполнить» — шторка (на телефоне лист снизу, на компьютере
 *     окно) с объяснением и картинкой «было / стало», по подтверждению —
 *     то же, что раньше делала «Закрыть день»: `/api/dashboard/close-day`
 *     дозаполняет пустые дни всех ежедневных журналов по сегодня по
 *     прошлому заполнению (без него — по настройкам журнала и реальным
 *     сотрудникам). Уже введённое не перезаписывается. Итог — тостом.
 *   • «QR-коды» — раздел печати QR `/settings/qr-posters`.
 *
 * Кнопки лежат внутри `<summary>` раскрывающейся секции, поэтому клик по
 * обёртке гасим — иначе каждое нажатие сворачивало бы список журналов.
 */
export function CloseDayCard() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [submitting, setSubmitting] = useState(false);
  const [confirming, setConfirming] = useState(false);

  async function handleAutofill() {
    setSubmitting(true);
    try {
      const response = await fetch("/api/dashboard/close-day", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ upTo: localDayKey() }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.error || "Не удалось заполнить журналы");
      }
      const message = autofillToast(data as AutofillResult);
      if (message.kind === "info") {
        toast.info(message.title);
      } else {
        toast.success(message.title, { description: message.description });
        startTransition(() => router.refresh());
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Ошибка при автозаполнении"
      );
    } finally {
      setSubmitting(false);
    }
  }

  const busy = submitting || pending;

  return (
    <div
      className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:justify-center"
      onClick={(e) => e.preventDefault()}
      data-journals-actions=""
    >
      <button
        type="button"
        onClick={() => setConfirming(true)}
        disabled={busy}
        data-autofill-open=""
        className="inline-flex h-11 items-center justify-center gap-2 whitespace-nowrap rounded-2xl bg-[#5566f6] px-5 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors duration-150 hover:bg-[#4a5bf0] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/25 disabled:opacity-60 sm:min-w-[180px]"
      >
        <Wand2 className="size-4" />
        {busy ? "Заполняю…" : "Автозаполнить"}
      </button>
      <Link
        href="/settings/qr-posters"
        data-qr-link=""
        className="inline-flex h-11 items-center justify-center gap-2 whitespace-nowrap rounded-2xl border border-[#dcdfed] bg-white px-5 text-[14px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 sm:min-w-[180px]"
      >
        <QrCode className="size-4 text-[#5566f6]" />
        QR-коды
        <LinkPendingSpinner />
      </Link>

      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={async () => {
          setConfirming(false);
          await handleAutofill();
        }}
        variant="info"
        icon={Wand2}
        title="Автозаполнить журналы?"
        description={AUTOFILL_DESCRIPTION}
        confirmLabel="Автозаполнить"
      >
        <AutofillIllustration />
      </ConfirmDialog>
    </div>
  );
}

/**
 * Картинка «было / стало»: пустой бланк журнала → тот же бланк с
 * заполненными строками. Цвета — токены темы (`--app-*`), чтобы в тёмной
 * теме бланк не светился белым пятном.
 */
function AutofillIllustration() {
  const rows = [0, 1, 2, 3];
  const sheet = (filled: boolean) => (
    <svg
      viewBox="0 0 120 92"
      className="h-auto w-full"
      role="img"
      aria-label={filled ? "Бланк с заполненными строками" : "Пустой бланк журнала"}
    >
      <rect
        x="1"
        y="1"
        width="118"
        height="90"
        rx="10"
        style={{ fill: "var(--app-surface)", stroke: "var(--app-border-strong)" }}
        strokeWidth="1.5"
      />
      <rect x="10" y="10" width="54" height="7" rx="3.5" style={{ fill: "var(--app-text-faint)" }} opacity="0.55" />
      {rows.map((row) => {
        const y = 26 + row * 15;
        return (
          <g key={row}>
            <line
              x1="10"
              x2="110"
              y1={y + 11}
              y2={y + 11}
              style={{ stroke: "var(--app-border)" }}
              strokeWidth="1"
            />
            {filled ? (
              <>
                <rect x="10" y={y + 2} width={28 + ((row * 7) % 12)} height="6" rx="3" fill="#5566f6" opacity="0.75" />
                <rect x="52" y={y + 2} width="26" height="6" rx="3" fill="#5566f6" opacity="0.4" />
                <circle cx="101" cy={y + 5} r="5" fill="#116b2a" opacity="0.9" />
                <path
                  d={`M98.6 ${y + 5} l1.7 1.7 l3.2 -3.4`}
                  fill="none"
                  stroke="#ffffff"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </>
            ) : (
              <>
                <rect x="10" y={y + 2} width="30" height="6" rx="3" fill="none" style={{ stroke: "var(--app-border-strong)" }} strokeDasharray="3 2" />
                <rect x="52" y={y + 2} width="26" height="6" rx="3" fill="none" style={{ stroke: "var(--app-border-strong)" }} strokeDasharray="3 2" />
                <circle cx="101" cy={y + 5} r="5" fill="none" style={{ stroke: "var(--app-border-strong)" }} strokeDasharray="2 2" />
              </>
            )}
          </g>
        );
      })}
    </svg>
  );

  return (
    <figure
      className="grid grid-cols-[minmax(0,1fr)_28px_minmax(0,1fr)] items-center gap-2 rounded-2xl border border-[#ececf4] bg-[#fafbff] p-3"
      data-autofill-illustration=""
    >
      <div className="space-y-1.5">
        <div className="text-center text-[12px] font-semibold uppercase tracking-[0.12em] text-[#9b9fb3]">
          Было
        </div>
        {sheet(false)}
      </div>
      <svg viewBox="0 0 28 16" className="h-4 w-7 text-[#5566f6]" aria-hidden>
        <path
          d="M2 8h21m-6-6 6 6-6 6"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <div className="space-y-1.5">
        <div className="text-center text-[12px] font-semibold uppercase tracking-[0.12em] text-[#3848c7]">
          Стало
        </div>
        {sheet(true)}
      </div>
      <figcaption className="col-span-3 text-center text-[12.5px] leading-snug text-[#6f7282]">
        Пустые строки за сегодня заполнятся, уже введённое останется как было.
      </figcaption>
    </figure>
  );
}
