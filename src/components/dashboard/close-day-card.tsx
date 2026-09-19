"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, AlertTriangle, CalendarDays, CheckCheck, CheckCircle2, Wand2 } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { LinkPendingSpinner } from "@/components/ui/link-pending";
import { toast } from "sonner";
import { localDayKey } from "@/lib/entry-defaults";

type Summary = {
  templateCode: string;
  templateName: string;
  documentId: string;
  documentTitle: string;
  filled: number;
  days: number;
  documentCreated: boolean;
  responsiblesAssigned: boolean;
  skippedReason?:
    | "out_of_period"
    | "no_document"
    | "period_closed"
    | "no_employees"
    | "no_responsible"
    | "unsupported"
    | "error";
};

type Result = {
  totalFilled: number;
  documentsCreated: number;
  processed: number;
  upToKey: string;
  todayKey: string;
  summaries: Summary[];
};

const SKIP_LABELS: Record<NonNullable<Summary["skippedReason"]>, string> = {
  out_of_period: "дата вне периода",
  no_document: "нет документа",
  period_closed: "журнал за этот период закрыт — верните его в активные",
  no_employees: "нет сотрудников",
  no_responsible: "нет ответственного",
  unsupported: "не заполняется автоматически",
  error: "ошибка",
};

function formatDayRu(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  if (!y || !m || !d) return dateKey;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
}

function pluralRu(one: string, few: string, many: string) {
  return (count: number) => {
    const abs = Math.abs(count) % 100;
    const lastDigit = abs % 10;
    if (abs > 10 && abs < 20) return many;
    if (lastDigit === 1) return one;
    if (lastDigit >= 2 && lastDigit <= 4) return few;
    return many;
  };
}
const recordWord = pluralRu("запись", "записи", "записей");
const journalWord = pluralRu("журнал", "журнала", "журналов");
const documentWord = pluralRu("документ", "документа", "документов");

/**
 * «Закрыть день одним кликом» — дозаполняет все пустые дни ежедневных
 * журналов до выбранной даты (по умолчанию сегодня): на основании
 * прошлого успешного заполнения, а без него — по настройкам журнала и
 * реальным сотрудникам. Ответственные и проверяющие подбираются по
 * правилам должностей. Уже заполненные строки НЕ перезаписываются —
 * фишка именно в том чтобы догнать пропуски, а не сломать данные.
 *
 * Видна только management-ролям. На дашборде — рядом с
 * BulkAssignTodayButton; вместе они закрывают пару «есть пропуски —
 * либо разошлите задачи всем, либо просто скопируйте вчера за смену».
 */
export function CloseDayCard({
  unfilledCount,
  closableCount,
  compact,
}: {
  unfilledCount: number;
  /**
   * Сколько из незаполненных журналов эта кнопка действительно
   * закроет (ежедневные). Остальные — «по событию» и раз-в-месяц,
   * их она не трогает. Не передан — считаем, что закроет все.
   */
  closableCount?: number;
  /** Только кнопки — для строки над списком журналов. */
  compact?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [confirming, setConfirming] = useState(false);
  const todayKey = localDayKey();
  // «По какую дату»: по умолчанию сегодня, можно откатиться назад.
  const [upTo, setUpTo] = useState(todayKey);
  const upToValid = /^\d{4}-\d{2}-\d{2}$/.test(upTo) && upTo <= todayKey;

  async function handleClose() {
    setSubmitting(true);
    setResult(null);
    try {
      const response = await fetch("/api/dashboard/close-day", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ upTo }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.error || "Не удалось закрыть день");
      }
      const r = data as Result;
      // В компактном режиме подробную панель не показываем: тост уже
      // сказал главное, а в шапке секции панели негде развернуться.
      setResult(compact ? null : r);
      const touched = r.summaries.filter((s) => s.filled > 0).length;
      if (r.totalFilled === 0 && r.documentsCreated === 0) {
        toast.info(
          r.processed === 0
            ? "Нет ежедневных журналов для заполнения."
            : "Всё уже заполнено — по эту дату пустых дней нет."
        );
      } else {
        const parts = [
          `Заполнено ${r.totalFilled} ${recordWord(r.totalFilled)} в ${touched} ${journalWord(touched)}`,
        ];
        if (r.documentsCreated > 0) {
          parts.push(`создано ${r.documentsCreated} ${documentWord(r.documentsCreated)}`);
        }
        toast.success(parts.join(", "), {
          description: `По ${formatDayRu(r.upToKey)}. Данные можно поправить в самих журналах.`,
        });
        startTransition(() => router.refresh());
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Ошибка при закрытии дня"
      );
    } finally {
      setSubmitting(false);
    }
  }

  const busy = submitting || pending;

  // Сколько незаполненных журналов кнопка реально закроет. Остальные
  // ведутся по событию — там нечего дозаполнять.
  const closable = closableCount ?? unfilledCount;
  const unfilledHint =
    unfilledCount === 0
      ? ""
      : closable === unfilledCount
        ? ` Сейчас ${unfilledCount} ${journalWord(unfilledCount)} без записей за сегодня.`
        : ` Сейчас ${unfilledCount} ${journalWord(unfilledCount)} без записей за сегодня, из них ежедневных — ${closable}. Остальные ведутся по событию, их кнопка не трогает.`;

  const dialog = (
    <ConfirmDialog
      open={confirming}
      onClose={() => setConfirming(false)}
      onConfirm={async () => {
        setConfirming(false);
        await handleClose();
      }}
      variant="info"
      icon={CheckCheck}
      title="Закрыть день?"
      description={`Пустые дни ежедневных журналов заполнятся по выбранную дату на основании прошлого успешного заполнения.${unfilledHint}`}
      bullets={[
        { label: "Если заполнений ещё не было — данные сгенерируются по настройкам журнала и реальным сотрудникам, даже если сотрудник один" },
        { label: "Ответственные и проверяющие подберутся по правилам должностей журнала; документ на период создастся, если его нет" },
        { label: "Выходные, отпуска и больничные из графика попадут в гигиенический журнал" },
        { label: "Уже заполненные ячейки не трогаются, всё можно поправить после" },
      ]}
      confirmLabel="Закрыть день"
      confirmDisabled={!upToValid}
    >
      <label className="flex items-center justify-between gap-3 rounded-2xl border border-[#ececf4] bg-[#fafbff] px-3 py-2.5">
        <span className="flex items-center gap-2 text-[13px] text-[#3c4053]">
          <CalendarDays className="size-4 text-[#5566f6]" />
          Заполнить по дату
        </span>
        <input
          type="date"
          value={upTo}
          max={todayKey}
          onChange={(e) => setUpTo(e.target.value)}
          className="h-9 rounded-xl border border-[#dcdfed] bg-white px-2.5 text-[13px] text-[#0b1024] outline-none transition-colors focus:border-[#5566f6] focus:ring-4 focus:ring-[#5566f6]/15"
        />
      </label>
    </ConfirmDialog>
  );


  // Без рамки и подложки: карточка живёт внутри секции, и своя коробка
  // делала из неё блок в блоке.
  //
  // `compact` — только две кнопки, без иконки и объяснения: над
  // списком журналов нужна кнопка, а не абзац. На десктопе они стоят
  // в строку, на мобиле — друг под другом.
  if (compact) {
    return (
      // Секция раскрывается по клику на <summary>; кнопки лежат внутри
      // него, поэтому событие гасим здесь — иначе каждое нажатие
      // сворачивало бы список журналов.
      // На мобиле кнопки стоят рядом в два столбца: секция и так
      // отдаёт им отдельную строку под заголовком, а столбиком они
      // съедали два ряда. Чтобы влезть в 390px, вторая подпись
      // укорочена до «Выборочно». Тап-таргет 44px.
      <div
        className="grid w-full grid-cols-2 gap-2 sm:flex sm:items-center"
        onClick={(e) => e.preventDefault()}
      >
        <button
          type="button"
          onClick={() => setConfirming(true)}
          disabled={busy}
          className="inline-flex h-11 items-center justify-center gap-2 whitespace-nowrap rounded-2xl bg-[#5566f6] px-4 text-[13px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors hover:bg-[#4a5bf0] disabled:opacity-60 sm:h-10 sm:flex-1"
        >
          <CheckCheck className="size-4" />
          {busy ? "Заполняю…" : "Закрыть день"}
        </button>
        <Link
          href="/dashboard/catch-up"
          className="inline-flex h-11 items-center justify-center gap-2 whitespace-nowrap rounded-2xl border border-[#dcdfed] bg-white px-4 text-[13px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] sm:h-10 sm:flex-1"
        >
          <Wand2 className="size-4 text-[#5566f6]" />
          <span className="sm:hidden">Выборочно</span>
          <span className="hidden sm:inline">Закрыть выборочно</span>
          <LinkPendingSpinner />
        </Link>
        {/* Итог показываем тостом, а не строкой рядом с кнопками:
            в шапке секции ей негде развернуться, а цифры нужны сразу
            и заметно. */}
        {dialog}
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#3848c7]">
          <Sparkles className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-semibold text-[#0b1024]">
            Закрыть день
          </div>
          <p className="mt-0.5 text-[13px] leading-snug text-[#6f7282]">
            Заполняет пустые дни ежедневных журналов по сегодня на
            основании прошлого заполнения, а без него — по настройкам
            журнала и реальным сотрудникам. Уже заполненные строки
            сохраняются. {unfilledHint ? (
              <span className="font-medium text-[#3848c7]">{unfilledHint.trim()}</span>
            ) : null}
          </p>
        </div>
        <div className="flex w-full shrink-0 flex-wrap items-center gap-2 sm:w-auto">
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={busy}
            className="inline-flex h-10 flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-2xl bg-[#5566f6] px-4 text-[13px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors hover:bg-[#4a5bf0] disabled:opacity-60 sm:flex-none"
          >
            <CheckCheck className="size-4" />
            {busy ? "Заполняю…" : "Закрыть день"}
          </button>
          <Link
            href="/dashboard/catch-up"
            className="inline-flex h-10 flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-lg border-0 bg-[#5566f6]/[0.04] px-4 text-[14px] font-semibold text-[#5566f6] transition-colors hover:bg-[#5566f6]/[0.09] sm:flex-none"
          >
            <Wand2 className="size-4" />
            Закрыть выборочно
            <LinkPendingSpinner />
          </Link>
        </div>
      </div>

      {result ? (
        <div className="mt-3 space-y-1.5 rounded-xl border border-[#dcdfed] bg-white px-3 py-2.5 text-[12px]">
          <div className="flex items-center justify-between gap-2 text-[12px] font-medium text-[#0b1024]">
            <span>
              Итого: <span className="text-[#136b2a]">+{result.totalFilled}</span>
              {result.documentsCreated > 0 ? (
                <span className="ml-2 text-[#6f7282]">
                  создано {result.documentsCreated} {documentWord(result.documentsCreated)}
                </span>
              ) : null}
            </span>
            <span className="text-[#9b9fb3]">по {result.upToKey}</span>
          </div>
          <div className="space-y-1 pt-1">
            {result.summaries.map((s) => (
              <div
                key={s.documentId}
                className="flex items-center justify-between gap-2 text-[12px]"
              >
                <span className="min-w-0 truncate text-[#3c4053]">
                  {s.templateName}
                </span>
                <span className="shrink-0 inline-flex items-center gap-1.5">
                  {s.skippedReason ? (
                    <span className="inline-flex items-center gap-1 text-[#9b9fb3]">
                      <AlertTriangle className="size-3" />
                      {SKIP_LABELS[s.skippedReason]}
                    </span>
                  ) : s.filled > 0 ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-[#ecfdf5] px-2 py-0.5 text-[11px] font-medium text-[#136b2a]">
                      <CheckCircle2 className="size-3" />+{s.filled}
                    </span>
                  ) : (
                    <span className="text-[#6f7282]">всё уже есть</span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {dialog}
    </div>
  );
}
