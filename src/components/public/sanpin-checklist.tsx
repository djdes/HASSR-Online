"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, CheckCircle2, CircleAlert, ClipboardCheck } from "lucide-react";

import { DemoRequestButton } from "@/components/public/demo-request-button";
import {
  checklistDemoTopic,
  checklistResult,
  checklistVerdict,
  type ChecklistAnswer,
  type ChecklistAnswers,
  type SanpinChecklistItem,
} from "@/lib/sanpin-checklist";
import { ymGoal } from "@/lib/signup-source";
import { cn } from "@/lib/utils";

export type SanpinChecklistViewItem = SanpinChecklistItem & {
  /** Название журнала из каталога; null — вопрос не про журнал. */
  journalName: string | null;
  href: string | null;
};

const ANSWERS: Array<{ value: ChecklistAnswer; label: string }> = [
  { value: "yes", label: "Да" },
  { value: "no", label: "Нет" },
];

/**
 * «Готовы ли вы к проверке?» на странице СанПиН 2.3/2.4.4282-26: семь
 * вопросов «да/нет», итог и что добавить со ссылками на описание журналов.
 * Ответы в браузере; в Метрику уходит только балл (цель `sanpin_checklist`).
 * Запись на показ — с пробелами в «Что важно показать».
 */
export function SanpinChecklist({ items, trialDays }: { items: SanpinChecklistViewItem[]; trialDays: number }) {
  const [answers, setAnswers] = useState<ChecklistAnswers>({});
  const result = useMemo(() => checklistResult(answers, items), [answers, items]);
  const journalNames = useMemo(
    () => Object.fromEntries(items.flatMap((item) => (item.journalCode && item.journalName ? [[item.journalCode, item.journalName]] : []))),
    [items],
  );
  const reported = useRef(false);

  useEffect(() => {
    if (!result.complete || reported.current) return;
    reported.current = true;
    ymGoal("sanpin_checklist", { score: result.score });
  }, [result.complete, result.score]);

  const viewById = new Map(items.map((item) => [item.id, item]));

  return (
    <section id="checklist" className="scroll-mt-24 rounded-3xl border border-[#ececf4] bg-white p-6 md:p-8" data-testid="sanpin-checklist">
      <span className="inline-flex items-center gap-2 rounded-full bg-[#eef1ff] px-3 py-1 text-[12px] font-semibold uppercase tracking-[0.16em] text-[#3848c7]">
        <ClipboardCheck className="size-3.5" aria-hidden />
        Самопроверка за минуту
      </span>
      <h2 className="mt-3 text-[clamp(1.5rem,1.6vw+1rem,2rem)] font-semibold tracking-[-0.02em]">Готовы ли вы к проверке?</h2>
      <p className="mt-2 max-w-[680px] text-[15px] leading-[1.6] text-[#3c4053]">
        Семь вопросов по журналам, которые ведут по СанПиН 2.3/2.4.4282-26. В конце — что добавить и где об этом
        прочитать.
      </p>

      <ol className="mt-5 space-y-3">
        {items.map((item, index) => {
          const labelId = `sanpin-checklist-${item.id}`;
          return (
            <li key={item.id} className="rounded-2xl border border-[#ececf4] bg-[#fafbff] p-4 sm:flex sm:items-center sm:justify-between sm:gap-4">
              <p id={labelId} className="text-[15px] font-medium leading-[1.5] text-[#0b1024]">
                {index + 1}. {item.question}
              </p>
              <div role="radiogroup" aria-labelledby={labelId} className="mt-3 flex shrink-0 gap-2 sm:mt-0">
                {ANSWERS.map((answer) => {
                  const checked = answers[item.id] === answer.value;
                  return (
                    <button
                      key={answer.value}
                      type="button"
                      role="radio"
                      aria-checked={checked}
                      onClick={() => setAnswers((current) => ({ ...current, [item.id]: answer.value }))}
                      className={cn(
                        "min-h-11 min-w-[72px] rounded-xl border px-4 text-[14px] font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15",
                        checked
                          ? answer.value === "yes"
                            ? "border-[#136b2a] bg-[#136b2a] text-white"
                            : "border-[#d2453b] bg-[#d2453b] text-white"
                          : "border-[#dcdfed] bg-white text-[#0b1024] hover:border-[#5566f6]/40",
                      )}
                    >
                      {answer.label}
                    </button>
                  );
                })}
              </div>
            </li>
          );
        })}
      </ol>

      {result.complete ? (
        <div className="mt-6 rounded-2xl bg-[#f5f6ff] p-5 md:p-6" aria-live="polite" data-testid="sanpin-checklist-result">
          <p className="text-[20px] font-semibold tracking-[-0.01em] text-[#0b1024]">{checklistVerdict(result)}</p>
          {result.gaps.length === 0 ? (
            <p className="mt-2 max-w-[640px] text-[15px] leading-[1.6] text-[#3c4053]">
              Журналы на месте. В WeSetup те же журналы ведут с телефона, а к проверке они собираются одним архивом
              или PDF.
            </p>
          ) : (
            <>
              <p className="mt-2 text-[15px] text-[#3c4053]">Что добавить:</p>
              <ul className="mt-3 space-y-2.5">
                {result.gaps.map((gap) => {
                  const view = viewById.get(gap.id);
                  return (
                    <li key={gap.id} className="flex items-start gap-2.5 text-[14.5px] leading-[1.55] text-[#3c4053]">
                      <CircleAlert className="mt-0.5 size-4 shrink-0 text-[#d2453b]" aria-hidden />
                      <span>
                        {view?.journalName && view.href ? (
                          <Link href={view.href} className="font-medium text-[#3848c7] underline-offset-4 hover:underline">
                            {view.journalName}
                          </Link>
                        ) : null}
                        {view?.journalName ? " — " : null}
                        {gap.gap}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <DemoRequestButton place="sanpin-checklist" variant="primary" topic={checklistDemoTopic(result, journalNames)}>
              Показать, как закрыть, за 15 минут
            </DemoRequestButton>
            <Link
              href="/register"
              className="inline-flex h-12 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-5 text-[15px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
            >
              {trialDays} дней бесплатно <ArrowRight className="size-4" aria-hidden />
            </Link>
          </div>
        </div>
      ) : (
        <p className="mt-4 flex items-center gap-2 text-[13.5px] text-[#6f7282]">
          <CheckCircle2 className="size-4 text-[#9b9fb3]" aria-hidden />
          Ответьте на все вопросы — покажем, что добавить. Отвечено: {result.answered} из {result.total}.
        </p>
      )}
    </section>
  );
}
