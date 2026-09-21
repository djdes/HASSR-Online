"use client";

import { useLiveRefetch } from "@/lib/use-live-refetch";

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  Clock,
  Loader2,
  Sparkles,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/ui/page-header";
import { showRemindResult, type RemindResult } from "@/lib/remind-toast";
import {
  buildCompletionView,
  completionEntryLabel,
} from "@/lib/completion-labels";

type GuideField = { name: string; description: string; norm?: string };
type Guide = {
  title: string;
  purpose: string;
  frequency: string;
  fields: GuideField[];
  checks: string[];
  redFlags: string[];
  normRef?: string;
};

type PendingItem = {
  id: string;
  scopeLabel: string;
  journalCode: string;
  journalLabel: string;
  executedBy: string;
  executedById: string;
  completedAt: string | null;
  verificationStatus: "pending" | "approved" | "rejected" | null;
  verifiedBy: string | null;
  verifiedAt: string | null;
  verifierComment: string | null;
  completionData: Record<string, unknown> | null;
  dateKey: string;
  /** Норма температуры оборудования задачи (холодильники), если задана. */
  temperatureNorm?: { min: number | null; max: number | null } | null;
};

const TEMPERATURE_KEYS = new Set(["temperature", "temperatureC", "temp", "tempC"]);

/** Значение вне нормы → подпись «вне нормы 2…6 °C», иначе null. */
function outOfNormHint(
  key: string,
  raw: unknown,
  norm: { min: number | null; max: number | null } | null | undefined
): string | null {
  if (!norm || !TEMPERATURE_KEYS.has(key)) return null;
  const value =
    typeof raw === "number"
      ? raw
      : typeof raw === "string" && raw.trim() !== ""
        ? Number(raw.replace(",", "."))
        : NaN;
  if (!Number.isFinite(value)) return null;
  const tooLow = typeof norm.min === "number" && value < norm.min;
  const tooHigh = typeof norm.max === "number" && value > norm.max;
  if (!tooLow && !tooHigh) return null;
  const range =
    typeof norm.min === "number" && typeof norm.max === "number"
      ? `${norm.min}…${norm.max} °C`
      : typeof norm.min === "number"
        ? `от ${norm.min} °C`
        : `до ${norm.max} °C`;
  return `вне нормы ${range}`;
}

type InProgressItem = {
  id: string;
  scopeLabel: string;
  journalCode: string;
  journalLabel: string;
  executedBy: string;
  executedById: string;
  claimedAt: string;
  overdue: boolean;
  /** День задачи «ГГГГ-ММ-ДД» — чтобы зависшую со вчера было видно. */
  dateKey?: string;
  fromPreviousDay?: boolean;
};

type NotTakenItem = {
  journalCode: string;
  journalLabel: string;
  scopeKey: string;
  scopeLabel: string;
  sublabel?: string;
  journalDocumentId?: string;
};

type Resp = {
  today: string;
  pendingReview: PendingItem[];
  inProgress: InProgressItem[];
  notTaken: NotTakenItem[];
  hist: PendingItem[];
  summary: { pending: number; inProgress: number; notTaken: number };
};

/** «2026-09-20» → «20.09». Без часовых поясов: это уже день организации. */
function dayMonth(dateKey: string): string {
  const [, month, day] = dateKey.split("-");
  return month && day ? `${day}.${month}` : dateKey;
}

function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.max(0, Math.floor(diff / 60000));
  if (m < 1) return "только что";
  if (m < 60) return `${m} мин`;
  const h = Math.floor(m / 60);
  return `${h} ч ${m % 60} мин`;
}

/**
 * «10 мин назад».
 *
 * Отдельно от `timeAgo`: к нему приклеивали « назад» без разбора, и на
 * экране появлялись «только что назад» и «— назад».
 */
function sinceText(iso: string | null): string {
  const ago = timeAgo(iso);
  if (ago === "—") return "недавно";
  if (ago === "только что") return ago;
  return `${ago} назад`;
}

export function VerificationsClient() {
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [commentByItem, setCommentByItem] = useState<Record<string, string>>({});
  const [guideByCode, setGuideByCode] = useState<Record<string, Guide | null>>({});

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/verifications", { cache: "no-store" });
      if (res.ok) setData((await res.json()) as Resp);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    const t = window.setInterval(() => void load(), 30000);
    return () => window.clearInterval(t);
  }, []);

  // Живое событие «журнал изменился» — перечитать сразу; опрос раз в
  // 30 с остаётся страховкой, если поток не доходит.
  useLiveRefetch(() => void load());

  async function loadGuide(code: string) {
    if (guideByCode[code] !== undefined) return;
    setGuideByCode((m) => ({ ...m, [code]: null }));
    try {
      const res = await fetch(`/api/journal-guides/${code}`, { cache: "force-cache" });
      if (res.ok) {
        const g = (await res.json()) as Guide;
        setGuideByCode((m) => ({ ...m, [code]: g }));
      }
    } catch {
      /* ignore */
    }
  }

  async function decide(id: string, action: "approve" | "reject") {
    setBusy(id);
    try {
      const res = await fetch(`/api/verifications/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          comment: commentByItem[id]?.trim() || undefined,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast.success(action === "approve" ? "Одобрено" : "Отправлено на переделку");
      setCommentByItem((m) => ({ ...m, [id]: "" }));
      setExpandedId(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setBusy(null);
    }
  }

  async function remind(userId: string, scopeLabel: string) {
    setBusy(`remind-${userId}`);
    try {
      const res = await fetch("/api/control-board/remind", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userIds: [userId], scopeLabel }),
      });
      const j = (await res.json().catch(() => ({}))) as RemindResult;
      if (!res.ok) {
        toast.error(j.error || "Не получилось отправить напоминание");
        return;
      }
      showRemindResult(j, () => "Напоминание отправлено");
    } catch {
      toast.error("Не получилось отправить напоминание");
    } finally {
      setBusy(null);
    }
  }

  if (loading && !data) {
    return (
      <div className="flex h-[200px] items-center justify-center text-[#6f7282]">
        <Loader2 className="size-5 animate-spin" />
      </div>
    );
  }
  if (!data) return null;

  return (
    <div className="space-y-6">
      {/* Счётчики pending / inProgress / notTaken в шапку не тащим —
          каждая секция ниже уже показывает свой count. */}
      <PageHeader
        title="Проверка задач"
        description="Нажмите на карточку, чтобы увидеть подробности, подсказку и кнопки «Одобрить» и «Переделать». Сверху — сделанное, снизу — ещё не взятые задачи."
      />

      {/* SECTION: Pending review (top — самое важное) */}
      <Section
        title="Ждут проверки"
        count={data.pendingReview.length}
        empty="Нет задач на проверку"
      >
        {data.pendingReview.map((item) => (
          <PendingCard
            key={item.id}
            item={item}
            expanded={expandedId === item.id}
            onToggle={() => {
              const next = expandedId === item.id ? null : item.id;
              setExpandedId(next);
              if (next) void loadGuide(item.journalCode);
            }}
            guide={guideByCode[item.journalCode]}
            comment={commentByItem[item.id] || ""}
            onCommentChange={(v) =>
              setCommentByItem((m) => ({ ...m, [item.id]: v }))
            }
            onApprove={() => decide(item.id, "approve")}
            onReject={() => decide(item.id, "reject")}
            busy={busy === item.id}
          />
        ))}
      </Section>

      {/* SECTION: In progress */}
      <Section
        title="В работе"
        count={data.inProgress.length}
        empty="Никто сейчас не работает"
      >
        {data.inProgress.map((item) => (
          <InProgressCard
            key={item.id}
            item={item}
            onRemind={() => remind(item.executedById, item.scopeLabel)}
            busy={busy === `remind-${item.executedById}`}
          />
        ))}
      </Section>

      {/* SECTION: Not taken */}
      <Section
        title="Ещё не взято"
        count={data.notTaken.length}
        empty="Все задачи разобрали — отлично!"
      >
        {data.notTaken.map((item) => (
          <NotTakenCard key={item.scopeKey} item={item} />
        ))}
      </Section>
    </div>
  );
}

// `accent` у секции не осталось: заголовок секции нейтральный, цвет несут
// сами карточки внутри — поэтому проп убран, а не оставлен «на будущее».
function Section({
  title,
  count,
  empty,
  children,
}: {
  title: string;
  count: number;
  empty: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <div className="px-1 text-[12px] font-semibold uppercase tracking-[0.16em] text-[#9b9fb3]">
        {title} ({count})
      </div>
      {count === 0 ? (
        <div className="rounded-2xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-6 py-6 text-center text-[13px] text-[#6f7282]">
          {empty}
        </div>
      ) : (
        <div className="space-y-2">{children}</div>
      )}
    </section>
  );
}

function PendingCard({
  item,
  expanded,
  onToggle,
  guide,
  comment,
  onCommentChange,
  onApprove,
  onReject,
  busy,
}: {
  item: PendingItem;
  expanded: boolean;
  onToggle: () => void;
  guide: Guide | null | undefined;
  comment: string;
  onCommentChange: (v: string) => void;
  onApprove: () => void;
  onReject: () => void;
  busy: boolean;
}) {
  // Снимок раскладываем на понятные части: шаги, причина пропуска и
  // обычные поля. Раньше печатали `String(v)` подряд, и заведующая
  // видела «steps [object Object],[object Object]».
  const completion = buildCompletionView(item.completionData);
  const hasCompletion =
    completion.fields.length > 0 ||
    completion.steps.length > 0 ||
    completion.skippedReason !== null;

  return (
    <div className="rounded-3xl border border-[#5d3ab3]/20 bg-[#f5f0ff] shadow-[0_0_0_1px_rgba(180,150,230,0.15)] transition-shadow hover:shadow-[0_8px_24px_-12px_rgba(93,58,179,0.25)]">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-start gap-3 p-4 text-left"
      >
        <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-[#5d3ab3] text-white">
          <ClipboardCheck className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-semibold leading-tight text-[#0b1024]">
            {item.scopeLabel}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[12px] text-[#6f7282]">
            <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-[#5d3ab3]">
              {item.journalLabel}
            </span>
            <span>·</span>
            <span className="font-medium text-[#0b1024]">{item.executedBy}</span>
            <span>·</span>
            <Clock className="size-3" />
            {sinceText(item.completedAt)}
          </div>
        </div>
        {expanded ? (
          <ChevronDown className="mt-2 size-5 shrink-0 text-[#5d3ab3]" />
        ) : (
          <ChevronRight className="mt-2 size-5 shrink-0 text-[#5d3ab3]" />
        )}
      </button>

      {expanded ? (
        <div className="space-y-3 border-t border-[#5d3ab3]/15 px-4 pb-4 pt-3">
          {hasCompletion ? (
            <div className="space-y-2 rounded-2xl border border-[#ececf4] bg-white p-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#9b9fb3]">
                Введённые данные
              </div>

              {completion.skippedReason ? (
                <div className="rounded-xl bg-[#fff8eb] px-3 py-2 text-[13px] text-[#8a5a00]">
                  Пропущено: {completion.skippedReason}
                </div>
              ) : null}

              {completion.steps.length > 0 ? (
                <ul className="space-y-1 text-[13px] text-[#0b1024]">
                  {completion.steps.map((step, i) => (
                    <li key={i}>
                      <span
                        className={
                          step.done
                            ? "text-[#136b2a]"
                            : "font-medium text-[#a13a32]"
                        }
                      >
                        {step.done ? "✓" : "✗"} {step.title}
                      </span>
                      {step.checklist.length > 0 ? (
                        <ul className="ml-5 text-[12px] text-[#6f7282]">
                          {step.checklist.map((c, j) => (
                            <li key={j}>
                              {c.done ? "✓" : "✗"} {c.item}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}

              {completion.fields.length > 0 ? (
                <div className="grid grid-cols-1 gap-x-4 gap-y-1 text-[13px] text-[#0b1024] sm:grid-cols-2">
                  {completion.fields.map((f) => {
                    // Замер вне нормы — красным и с подписью нормы, иначе
                    // заведующая пролистывала отклонение как обычную цифру.
                    const outHint = outOfNormHint(
                      f.key,
                      item.completionData?.[f.key],
                      item.temperatureNorm
                    );
                    return (
                      <div key={f.key} className="flex justify-between gap-2">
                        <span className="text-[#6f7282]">{f.label}</span>
                        <span
                          className={
                            outHint
                              ? "text-right font-semibold text-[#a13a32]"
                              : "text-right font-medium"
                          }
                        >
                          {f.value}
                          {outHint ? (
                            <span className="ml-1.5 inline-flex rounded-full bg-[#fff4f2] px-2 py-0.5 text-[11px] font-medium text-[#a13a32]">
                              {outHint}
                            </span>
                          ) : null}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-[#dcdfed] bg-white p-3 text-[12px] text-[#9b9fb3]">
              Сотрудник завершил задачу, не заполнив поля.
            </div>
          )}

          {/* Inline guide */}
          <div className="rounded-2xl border border-[#dcdfed] bg-white p-3">
            <div className="flex items-start gap-2">
              <BookOpen className="size-4 shrink-0 text-[#3848c7]" />
              <div className="min-w-0 flex-1">
                <div className="text-[12px] font-semibold uppercase tracking-[0.14em] text-[#9b9fb3]">
                  Гайд по проверке
                </div>
                {!guide ? (
                  <div className="mt-1 inline-flex items-center gap-1 text-[12px] text-[#6f7282]">
                    <Loader2 className="size-3 animate-spin" /> Загружаю...
                  </div>
                ) : (
                  <div className="mt-1 space-y-2 text-[12px]">
                    <div className="font-semibold text-[#0b1024]">{guide.title}</div>
                    <div className="text-[#3c4053]">{guide.purpose}</div>
                    {guide.fields.length > 0 ? (
                      <div className="space-y-1">
                        {guide.fields.map((f) => (
                          <div key={f.name}>
                            {/* Подпись поля, а не ключ из базы:
                                «temperature — …» заведующей ничего
                                не сообщает. */}
                            <span className="text-[11px] font-semibold text-[#3848c7]">
                              {completionEntryLabel(f.name)}
                            </span>
                            <span className="text-[#3c4053]"> — {f.description}</span>
                            {f.norm ? (
                              <span className="ml-1 text-[#136b2a]">
                                ({f.norm})
                              </span>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    ) : null}
                    {guide.checks.length > 0 ? (
                      <div className="rounded-xl bg-[#ecfdf5] p-2">
                        <div className="text-[11px] font-semibold text-[#136b2a]">
                          ✓ Проверить:
                        </div>
                        <ul className="ml-4 list-disc text-[#136b2a]">
                          {guide.checks.map((c, i) => (
                            <li key={i}>{c}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {guide.redFlags.length > 0 ? (
                      <div className="rounded-xl bg-[#fff4f2] p-2">
                        <div className="text-[11px] font-semibold text-[#a13a32]">
                          🚩 Переделать если:
                        </div>
                        <ul className="ml-4 list-disc text-[#a13a32]">
                          {guide.redFlags.map((r, i) => (
                            <li key={i}>{r}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {guide.normRef ? (
                      <div className="text-[11px] text-[#6f7282]">📚 {guide.normRef}</div>
                    ) : null}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Action panel */}
          <div className="space-y-2">
            <input
              value={comment}
              onChange={(e) => onCommentChange(e.target.value)}
              placeholder="Комментарий (необязательно) — сотрудник увидит его в задаче и в Telegram"
              className="h-11 w-full rounded-xl border border-[#dcdfed] bg-white px-3 text-[13px] text-[#0b1024] placeholder:text-[#9b9fb3] focus:border-[#5566f6] focus:outline-none"
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={onApprove}
                disabled={busy}
                className="inline-flex h-11 flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#136b2a] px-4 text-[14px] font-medium text-white disabled:opacity-50"
              >
                {busy ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="size-4" />
                )}
                Одобрить
              </button>
              <button
                type="button"
                onClick={onReject}
                disabled={busy}
                className="inline-flex h-11 flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#d2453d] px-4 text-[14px] font-medium text-white disabled:opacity-50"
              >
                <XCircle className="size-4" />
                Переделать
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function InProgressCard({
  item,
  onRemind,
  busy,
}: {
  item: InProgressItem;
  onRemind: () => void;
  busy: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border p-3 transition-colors ${
        item.overdue
          ? "border-[#ffd2cd] bg-[#fff4f2]"
          : "border-[#5566f6]/30 bg-[#eef1ff]"
      }`}
    >
      <div className="flex items-start gap-3">
        <span
          className={`flex size-9 shrink-0 items-center justify-center rounded-xl text-white ${
            item.overdue ? "bg-[#d2453d]" : "bg-[#5566f6]"
          }`}
        >
          <Sparkles className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-medium leading-tight text-[#0b1024]">
            {item.scopeLabel}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[12px] text-[#6f7282]">
            <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-[#3848c7]">
              {item.journalLabel}
            </span>
            <span>·</span>
            <span className="font-medium text-[#0b1024]">{item.executedBy}</span>
            <span>·</span>
            <Clock className="size-3" />
            <span className={item.overdue ? "font-medium text-[#a13a32]" : ""}>
              {timeAgo(item.claimedAt)} в работе
            </span>
            {item.overdue ? (
              <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-[#a13a32]">
                <AlertTriangle className="size-3" />
                {/* «Зависло» без даты ничего не объясняло: задача со
                    вчера выглядела как взятая только что. */}
                {item.fromPreviousDay && item.dateKey
                  ? `Зависло с ${dayMonth(item.dateKey)}`
                  : "Зависло"}
              </span>
            ) : null}
          </div>
        </div>
        <button
          type="button"
          onClick={onRemind}
          disabled={busy}
          className="inline-flex h-9 shrink-0 items-center gap-1 rounded-xl border border-[#dcdfed] bg-white px-3 text-[12px] font-medium text-[#3c4053] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
          Напомнить
        </button>
      </div>
    </div>
  );
}

function NotTakenCard({ item }: { item: NotTakenItem }) {
  return (
    <div className="rounded-2xl border border-[#ffe9b0] bg-[#fff8eb] p-3">
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#fff4d9] text-[#a13a32]">
          <AlertTriangle className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-medium leading-tight text-[#0b1024]">
            {item.scopeLabel}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[12px] text-[#6f7282]">
            <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-[#a13a32]">
              {item.journalLabel}
            </span>
            {item.sublabel ? (
              <>
                <span>·</span>
                <span>{item.sublabel}</span>
              </>
            ) : null}
            <span>·</span>
            <span>никто не взял</span>
          </div>
        </div>
      </div>
    </div>
  );
}
