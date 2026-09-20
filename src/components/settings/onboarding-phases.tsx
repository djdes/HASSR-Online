import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  Lock,
  XCircle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * Общие типы и карточки «Быстрого старта». Живут отдельно, потому что
 * их делят две страницы: базовая `/settings/onboarding` (3 этапа) и
 * `/settings/onboarding/advanced` (полный набор этапов). Чтобы правки
 * визуала не расходились, обе страницы рендерят один и тот же PhaseCard.
 */

export type State = "complete" | "partial" | "empty";

export type SetupItem = {
  title: string;
  /**
   * Пояснение под заголовком. На базовой странице не задаём — там
   * оставлен только заголовок + счётчик, чтобы экран читался за секунду.
   */
  description?: string;
  href: string;
  icon: LucideIcon;
  state: State;
  metric?: string;
  /** Красная подсказка «что не так». Только для advanced-страницы. */
  issue?: string;
  /** Если true — пункт необязателен и не блокирует переход на следующий этап. */
  optional?: boolean;
};

export type Phase = {
  id: string;
  number: number;
  title: string;
  /** Подзаголовок этапа. На базовой странице опущен. */
  subtitle?: string;
  icon: LucideIcon;
  items: SetupItem[];
  /**
   * Если этап «логически» завершён — показывается финальный блок (CTA
   * или информационный). Например, в этапе «Документы» это OnboardingFinishCta,
   * в этапе «TasksFlow» — кнопка «Открыть дашборд → отправить задачи».
   */
  finalNode?: React.ReactNode;
};

// ─────────────────────────────────────────────────────────────────────

export function PhaseCard({
  phase,
  status,
  isActive,
  isLocked,
  isLast,
}: {
  phase: Phase;
  status: "complete" | "active" | "locked";
  isActive: boolean;
  isLocked: boolean;
  isLast: boolean;
}) {
  const Icon = phase.icon;
  const required = phase.items.filter((i) => !i.optional);
  const requiredDone = required.filter((i) => i.state === "complete").length;

  // Тон карточки.
  const tone =
    status === "complete"
      ? {
          card: "border-[#c8f0d5] bg-[#ecfdf5]/40",
          numBg: "bg-[#136b2a] text-white",
          numRing: "ring-[#136b2a]/30",
          iconBg: "bg-[#d9f4e1]",
          iconClr: "text-[#136b2a]",
          titleClr: "text-[#0b1024]",
          connector: "bg-[#136b2a]/30",
        }
      : isActive
        ? {
            card: "border-[#5566f6]/40 bg-gradient-to-br from-white to-[#f5f6ff] shadow-[0_14px_36px_-18px_rgba(85,102,246,0.45)]",
            numBg: "bg-gradient-to-br from-[#5566f6] to-[#7a5cff] text-white",
            numRing: "ring-[#5566f6]/30",
            iconBg: "bg-[#eef1ff]",
            iconClr: "text-[#5566f6]",
            titleClr: "text-[#0b1024]",
            connector: "bg-[#dcdfed]",
          }
        : {
            card: "border-[#ececf4] bg-[#fafbff] opacity-70",
            numBg: "bg-[#dcdfed] text-[#6f7282]",
            numRing: "ring-transparent",
            iconBg: "bg-[#fafbff]",
            iconClr: "text-[#9b9fb3]",
            titleClr: "text-[#6f7282]",
            connector: "bg-[#dcdfed]",
          };

  // Завершённые этапы свёрнуты по умолчанию, но раскрываются кликом
  // (нативный <details>). Активные и заблокированные раскрыты сразу.
  const defaultOpen = status !== "complete";
  const hasContent = phase.items.length > 0 || phase.finalNode;

  return (
    <li className="relative">
      <div className="flex gap-2.5 sm:gap-4">
        {/* Number column with connector line */}
        <div className="relative flex flex-col items-center self-stretch">
          <div
            className={`flex size-11 shrink-0 items-center justify-center rounded-full text-[15px] font-semibold shadow-[0_8px_22px_-10px_rgba(11,16,36,0.25)] ring-4 ${tone.numBg} ${tone.numRing}`}
          >
            {status === "complete" ? (
              <CheckCircle2 className="size-5" />
            ) : isLocked ? (
              <Lock className="size-4" />
            ) : (
              phase.number
            )}
          </div>
          {!isLast ? (
            <div className={`mt-1 w-px flex-1 ${tone.connector}`} />
          ) : null}
        </div>

        {/* Body */}
        <details
          open={defaultOpen}
          className={`group min-w-0 flex-1 rounded-3xl border p-4 sm:p-5 ${tone.card}`}
        >
          <summary
            // items-center: у этапа обычно одна строка заголовка, и при
            // выравнивании по верху она стояла выше середины иконки.
            className={`flex items-center gap-4 list-none [&::-webkit-details-marker]:hidden ${
              hasContent ? "cursor-pointer" : "cursor-default"
            }`}
          >
            <span
              className={`flex size-10 shrink-0 items-center justify-center rounded-2xl ${tone.iconBg} ${tone.iconClr}`}
            >
              <Icon className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3
                  className={`text-[16px] font-semibold leading-tight ${tone.titleClr}`}
                >
                  Этап {phase.number}. {phase.title}
                </h3>
                {status === "complete" ? (
                  <span className="rounded-full bg-[#136b2a] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                    Готово
                  </span>
                ) : isActive ? (
                  <span className="rounded-full bg-[#5566f6] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                    Сейчас
                  </span>
                ) : null}
                {required.length > 0 ? (
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                      status === "complete"
                        ? "bg-[#ecfdf5] text-[#136b2a]"
                        : "bg-[#eef1ff] text-[#3848c7]"
                    }`}
                  >
                    {requiredDone}/{required.length}
                  </span>
                ) : null}
                {hasContent ? (
                  <ChevronDown
                    className={`ml-auto size-4 transition-transform group-open:rotate-180 ${
                      status === "complete" ? "text-[#136b2a]" : "text-[#9b9fb3]"
                    }`}
                  />
                ) : null}
              </div>
              {phase.subtitle ? (
                <p className="mt-1.5 text-[13px] leading-relaxed text-[#6f7282]">
                  {phase.subtitle}
                </p>
              ) : null}
            </div>
          </summary>

          {phase.items.length > 0 ? (
            <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {phase.items.map((item) => (
                <SetupCard key={item.title} item={item} />
              ))}
            </div>
          ) : null}

          {phase.finalNode ? (
            <div className="mt-5">{phase.finalNode}</div>
          ) : null}
        </details>
      </div>
    </li>
  );
}

// ─────────────────────────────────────────────────────────────────────

export function SetupCard({ item }: { item: SetupItem }) {
  const Icon = item.icon;
  const stateMeta =
    item.state === "complete"
      ? {
          border: "border-[#c8f0d5]",
          iconBg: "bg-[#d9f4e1]",
          iconClr: "text-[#136b2a]",
          stateIcon: CheckCircle2,
          stateClr: "text-[#136b2a]",
        }
      : item.state === "partial"
        ? {
            border: "border-[#ffe9b0]",
            iconBg: "bg-[#fff8eb]",
            iconClr: "text-[#a13a32]",
            stateIcon: AlertTriangle,
            stateClr: "text-[#a13a32]",
          }
        : {
            border: item.optional ? "border-[#ececf4]" : "border-[#ffd2cd]",
            iconBg: item.optional ? "bg-[#fafbff]" : "bg-[#fff4f2]",
            iconClr: item.optional ? "text-[#9b9fb3]" : "text-[#a13a32]",
            stateIcon: XCircle,
            stateClr: item.optional ? "text-[#9b9fb3]" : "text-[#a13a32]",
          };
  const StateIcon = stateMeta.stateIcon;
  return (
    <Link
      href={item.href}
      className={`group flex items-start gap-3 rounded-2xl border ${stateMeta.border} bg-white p-4 transition-all hover:shadow-[0_8px_24px_-12px_rgba(85,102,246,0.18)]`}
    >
      <span
        className={`flex size-10 shrink-0 items-center justify-center rounded-2xl ${stateMeta.iconBg} ${stateMeta.iconClr}`}
      >
        <Icon className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-[14px] font-semibold leading-tight text-[#0b1024]">
              {item.title}
              {item.optional ? (
                <span className="rounded-full bg-[#fafbff] px-1.5 py-0.5 text-[10px] font-medium text-[#9b9fb3]">
                  по желанию
                </span>
              ) : null}
            </div>
            {item.description ? (
              <div className="mt-0.5 text-[12px] leading-snug text-[#6f7282]">
                {item.description}
              </div>
            ) : null}
          </div>
          <StateIcon className={`size-4 shrink-0 ${stateMeta.stateClr}`} />
        </div>
        {item.metric || item.issue ? (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
            {item.metric ? (
              <span
                className={`rounded-full px-2 py-0.5 font-medium ${
                  item.state === "complete"
                    ? "bg-[#ecfdf5] text-[#136b2a]"
                    : item.state === "partial"
                      ? "bg-[#fff8eb] text-[#a13a32]"
                      : "bg-[#fff4f2] text-[#a13a32]"
                }`}
              >
                {item.metric}
              </span>
            ) : null}
            {item.issue ? (
              <span className="text-[#a13a32]">{item.issue}</span>
            ) : null}
          </div>
        ) : null}
      </div>
      <ArrowRight className="size-4 shrink-0 self-center text-[#9b9fb3] transition-transform group-hover:translate-x-0.5 group-hover:text-[#5566f6]" />
    </Link>
  );
}
