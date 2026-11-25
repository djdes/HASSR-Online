"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { AlertOctagon, CheckCircle2, CircleAlert, Loader2, ShieldCheck, Sparkles, Wand2 } from "lucide-react";

import { WESETUP_BRAND } from "@/lib/smm/brand-profile";
import { FIX_LABELS, GROUP_LABELS, applyAllFixes, applyFix, type CheckGroup, type FixId, type PostReport } from "@/lib/smm/quality";
import { cn } from "@/lib/utils";
import { MotionNumber } from "@/components/motion/motion-number";

export type QualityDraft = {
  text: string;
  images: string[];
  buttonText: string;
  buttonUrl: string;
  campaign: string;
  rubric: string;
  scheduledAt: string;
  channelIds: string[];
  editingId: string | null;
};

const VERDICT: Record<PostReport["verdict"], { label: string; tone: string; ring: string }> = {
  ready: { label: "Готов к публикации", tone: "text-[#116b2a]", ring: "#16a34a" },
  improve: { label: "Можно лучше", tone: "text-[#9a6200]", ring: "#e59b00" },
  block: { label: "Публиковать рано", tone: "text-[#a13a32]", ring: "#dc4b3e" },
};

function Ring({ value, color }: { value: number; color: string }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 64 64" className="size-16 shrink-0" aria-hidden>
      <circle cx="32" cy="32" r={r} fill="none" stroke="#eef0f7" strokeWidth="7" />
      <circle
        cx="32"
        cy="32"
        r={r}
        fill="none"
        stroke={color}
        strokeWidth="7"
        strokeLinecap="round"
        strokeDasharray={`${(value / 100) * c} ${c}`}
        data-meter="ring"
        transform="rotate(-90 32 32)"
      />
      <text x="32" y="37" textAnchor="middle" className="fill-[#0b1024] text-[15px] font-semibold">
        {value}
      </text>
    </svg>
  );
}

function Meter({ label, value, invert }: { label: string; value: number; invert?: boolean }) {
  const good = invert ? value <= 30 : value >= 60;
  const mid = invert ? value <= 60 : value >= 35;
  return (
    <div>
      <div className="flex justify-between text-[12px] text-[#6f7282]">
        <span>{label}</span>
        <MotionNumber value={value} className="tabular-nums" />
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[#eef0f7]">
        <div
          className={cn("h-full rounded-full", good ? "bg-[#16a34a]" : mid ? "bg-[#e59b00]" : "bg-[#dc4b3e]")}
          data-meter
          style={{ width: `${Math.max(4, value)}%` }}
        />
      </div>
    </div>
  );
}

/**
 * Панель качества поста (B01–B30): балл, индексы спама и продажи, чек-лист
 * с подсказками, автоисправления и ИИ-рецензия. Пересчёт — через секунду
 * после правки (сервер учитывает прошлые посты: дубли, частоту, рубрики).
 */
export function SmmQualityPanel({
  draft,
  onText,
  onReport,
}: {
  draft: QualityDraft;
  onText: (text: string) => void;
  onReport?: (report: PostReport | null) => void;
}) {
  const [report, setReport] = useState<PostReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [showOk, setShowOk] = useState(false);
  const [ai, setAi] = useState<null | { status: "running" } | { status: "done"; tone: number; offer: number; notes: string[]; text: string }>(null);
  const seq = useRef(0);

  useEffect(() => {
    if (!draft.text.trim()) {
      setReport(null);
      onReport?.(null);
      return;
    }
    const id = ++seq.current;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const response = await fetch("/api/root/max-channel/quality", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: draft.text,
            images: draft.images,
            buttonText: draft.buttonText || null,
            buttonUrl: draft.buttonUrl || null,
            campaign: draft.campaign || null,
            rubric: draft.rubric || null,
            scheduledAt: draft.scheduledAt ? new Date(draft.scheduledAt).toISOString() : null,
            channelIds: draft.channelIds,
            excludeIds: draft.editingId ? [draft.editingId] : [],
          }),
        });
        const data = (await response.json().catch(() => ({}))) as { quality?: PostReport };
        if (id === seq.current && data.quality) {
          setReport(data.quality);
          onReport?.(data.quality);
        }
      } finally {
        if (id === seq.current) setLoading(false);
      }
    }, 700);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.text, draft.images.join("|"), draft.buttonText, draft.buttonUrl, draft.campaign, draft.rubric, draft.scheduledAt, draft.channelIds.join("|")]);

  const post = { ...draft, images: draft.images.map(() => ({})) };

  function fix(id: FixId) {
    onText(applyFix(post, id, WESETUP_BRAND));
  }

  async function runAi(mode: "review" | "rewrite") {
    setAi({ status: "running" });
    try {
      const start = await fetch("/api/root/max-channel/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: draft.text,
          mode,
          issues: (report?.items ?? []).filter((i) => i.status !== "ok").map((i) => `${i.label}${i.hint ? ` — ${i.hint}` : ""}`),
        }),
      });
      const started = (await start.json().catch(() => ({}))) as { job?: string; error?: string };
      if (!start.ok || !started.job) throw new Error(started.error ?? "ИИ недоступен");
      for (let i = 0; i < 90; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        const poll = await fetch(`/api/root/max-channel/review?job=${encodeURIComponent(started.job)}`);
        const data = (await poll.json().catch(() => ({}))) as {
          status?: string;
          error?: string;
          review?: { tone: number; offer: number; notes: string[]; text: string };
        };
        if (data.status === "done" && data.review) {
          setAi({ status: "done", ...data.review });
          return;
        }
        if (data.status === "failed") throw new Error(data.error ?? "ИИ не ответил");
      }
      throw new Error("ИИ думает слишком долго — попробуйте позже");
    } catch (error) {
      toast.error((error as Error).message);
      setAi(null);
    }
  }

  if (!draft.text.trim()) {
    return (
      <div className="rounded-3xl border border-dashed border-[#dcdfed] bg-[#fafbff] p-4 text-[13px] text-[#6f7282]">
        <ShieldCheck className="mb-1 size-5 text-[#5566f6]" />
        Начните писать — здесь появится проверка: фирменный стиль, чек-лист (фото, контакты, бренд, кнопка), заспамленность и
        сила продажи.
      </div>
    );
  }

  const verdict = report ? VERDICT[report.verdict] : null;
  const problems = report?.items.filter((i) => i.status !== "ok") ?? [];
  const oks = report?.items.filter((i) => i.status === "ok") ?? [];

  return (
    <div className="rounded-3xl border border-[#ececf4] bg-white p-4">
      <div className="flex items-center gap-3">
        {report && verdict ? <Ring value={report.score} color={verdict.ring} /> : <Loader2 className="size-8 animate-spin text-[#5566f6]" />}
        <div className="min-w-0 flex-1">
          <div className="text-[12px] font-semibold uppercase tracking-[0.14em] text-[#6f7282]">Проверка качества</div>
          {verdict ? <div className={cn("text-[15px] font-semibold", verdict.tone)}>{verdict.label}</div> : null}
          {loading ? <div className="text-[11px] text-[#9b9fb3]">пересчитываем…</div> : null}
        </div>
      </div>

      {report ? (
        <>
          <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
            <Meter label="Заспамленность" value={report.spamIndex} invert />
            <Meter label="Сила продажи" value={report.salesIndex} />
            {(Object.keys(report.groups) as CheckGroup[])
              .filter((g) => g !== "platform" && g !== "schedule" && g !== "spam" && g !== "sales")
              .map((g) => (
                <Meter key={g} label={GROUP_LABELS[g]} value={report.groups[g]} />
              ))}
          </div>

          {report.fixes.length ? (
            <button
              type="button"
              onClick={() => onText(applyAllFixes(post, WESETUP_BRAND))}
              className="mt-3 inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-xl bg-[#5566f6] px-3 text-[13px] font-medium text-white hover:bg-[#4a5bf0]"
            >
              <Wand2 className="size-4" /> Починить всё автоматически
            </button>
          ) : null}

          <ul className="mt-3 space-y-1.5">
            {problems.map((item) => (
              <li key={item.id} className="rounded-2xl bg-[#fafbff] px-3 py-2">
                <div className="flex items-start gap-2">
                  {item.status === "fail" ? (
                    <AlertOctagon className="mt-0.5 size-4 shrink-0 text-[#dc4b3e]" />
                  ) : (
                    <CircleAlert className="mt-0.5 size-4 shrink-0 text-[#e59b00]" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium text-[#0b1024]">
                      {item.label}
                      {item.blocking ? <span className="ml-1.5 rounded-full bg-[#fff4f2] px-1.5 text-[10px] text-[#a13a32]">блокирует</span> : null}
                    </div>
                    {item.hint ? <div className="text-[12px] leading-[1.45] text-[#6f7282]">{item.hint}</div> : null}
                    {item.fix ? (
                      <button type="button" onClick={() => fix(item.fix!)} className="mt-1 text-[12px] font-medium text-[#3848c7] hover:underline">
                        {FIX_LABELS[item.fix]}
                      </button>
                    ) : null}
                  </div>
                  <span className="shrink-0 text-[10px] text-[#b0b3c4]">{item.feature}</span>
                </div>
              </li>
            ))}
          </ul>
          {oks.length ? (
            <button type="button" onClick={() => setShowOk((v) => !v)} className="mt-2 text-[12px] text-[#6f7282] hover:text-[#3848c7]">
              {showOk ? "Скрыть" : "Показать"} пройденные проверки ({oks.length})
            </button>
          ) : null}
          {showOk ? (
            <ul className="mt-1.5 space-y-1">
              {oks.map((item) => (
                <li key={item.id} className="flex items-center gap-2 text-[12px] text-[#3c4053]">
                  <CheckCircle2 className="size-3.5 shrink-0 text-[#16a34a]" /> {item.label}
                </li>
              ))}
            </ul>
          ) : null}
          <div className="mt-2 text-[11px] text-[#9b9fb3]">
            {report.stats.chars} знаков · {report.stats.words} слов · читать ~{report.stats.readingSeconds} с
          </div>
        </>
      ) : null}

      <div className="mt-3 flex gap-2 border-t border-[#ececf4] pt-3">
        <button
          type="button"
          disabled={ai?.status === "running"}
          onClick={() => void runAi("review")}
          className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl border border-[#dcdfed] text-[12px] font-medium text-[#0b1024] hover:bg-[#f5f6ff] disabled:opacity-50"
        >
          {ai?.status === "running" ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4 text-[#5566f6]" />}
          ИИ-рецензия
        </button>
        <button
          type="button"
          disabled={ai?.status === "running"}
          onClick={() => void runAi("rewrite")}
          className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl border border-[#dcdfed] text-[12px] font-medium text-[#0b1024] hover:bg-[#f5f6ff] disabled:opacity-50"
        >
          <Wand2 className="size-4 text-[#5566f6]" /> Переписать по замечаниям
        </button>
      </div>
      {ai?.status === "done" ? (
        <div className="mt-3 rounded-2xl bg-[#f5f6ff] p-3 text-[12px] text-[#3c4053]">
          <div className="flex gap-4 font-medium text-[#0b1024]">
            <span>Тон бренда: {ai.tone}</span>
            <span>Оффер: {ai.offer}</span>
          </div>
          {ai.notes.length ? (
            <ul className="mt-1.5 list-disc space-y-0.5 pl-4">
              {ai.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          ) : null}
          <details className="mt-2">
            <summary className="cursor-pointer text-[#3848c7]">Вариант ИИ</summary>
            <pre className="mt-1 whitespace-pre-wrap font-sans text-[12px] leading-[1.5]">{ai.text}</pre>
          </details>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => {
                onText(ai.text);
                setAi(null);
              }}
              className="rounded-lg bg-[#5566f6] px-3 py-1.5 text-[12px] font-medium text-white"
            >
              Взять текст ИИ
            </button>
            <button type="button" onClick={() => setAi(null)} className="rounded-lg px-3 py-1.5 text-[12px] text-[#6f7282]">
              Закрыть
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
