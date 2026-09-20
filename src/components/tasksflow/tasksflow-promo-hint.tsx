"use client";

import { ExternalLink, Zap } from "lucide-react";
import { toast } from "sonner";
import {
  TASKSFLOW_PROMO_BENEFIT,
  TASKSFLOW_PROMO_CODE,
  tasksflowPromoUrl,
} from "@/lib/tasksflow-promo";
import { useInAppShell } from "@/lib/use-in-app-shell";

/**
 * Промо-подсказка «подключите TasksFlow» под полем телефона.
 *
 * Показывается там, где пользователь вводит номер: именно номер —
 * ключ автосвязки аккаунтов, поэтому объяснение выгоды уместно ровно
 * в этот момент. Если интеграция уже подключена (`hasIntegration`),
 * рекламировать нечего — остаётся только строка про автосвязку.
 */
export function TasksFlowPromoHint({
  campaign,
  hasIntegration = false,
  autolinkNote = "Аккаунт TasksFlow с этим номером свяжется автоматически.",
  compact = false,
  className = "",
}: {
  /** Точка входа для utm_campaign: `staff_add`, `register_nudge`, ... */
  campaign: string;
  hasIntegration?: boolean;
  autolinkNote?: string;
  /**
   * Узкий вариант — когда блок стоит не под полем во всю ширину, а
   * сбоку от него. Тот же смысл в двух строках: что это + промокод со
   * ссылкой. Развёрнутое описание и объяснение про автосвязку убраны:
   * блок стоит в модалке дорегистрации, и каждая его строка добавляет
   * высоты форме, ради которой человек сюда и пришёл.
   */
  compact?: boolean;
  className?: string;
}) {
  // В оболочке приложения (Telegram) рекламу с внешней ссылкой не
  // показываем вовсе: тап по ней выбрасывает человека из Telegram
  // посреди незаполненной анкеты, и введённое теряется.
  const inAppShell = useInAppShell();
  if (inAppShell) {
    return (
      <p className={`text-[11px] leading-snug text-[#6f7282] ${className}`}>
        {autolinkNote}
      </p>
    );
  }

  if (hasIntegration) {
    return (
      <p className={`text-[11px] leading-snug text-[#6f7282] ${className}`}>
        {autolinkNote}
      </p>
    );
  }

  async function copyPromo() {
    try {
      await navigator.clipboard.writeText(TASKSFLOW_PROMO_CODE);
      toast.success("Промокод скопирован");
    } catch {
      toast.error("Не удалось скопировать — выделите код вручную");
    }
  }


  if (compact) {
    return (
      <div
        className={`flex min-w-0 items-start gap-2 rounded-2xl bg-[#f5f6ff] px-3 py-2 text-[11px] leading-[1.4] text-[#3c4053] ${className}`}
      >
        <span className="mt-px flex size-5 shrink-0 items-center justify-center rounded-lg bg-[#eef1ff] text-[#5566f6]">
          <Zap className="size-3" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-[#0b1024]">
            TasksFlow.ru — задачи сотрудникам
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1">
            <button
              type="button"
              onClick={copyPromo}
              title="Скопировать промокод"
              className="rounded-full bg-white px-1.5 py-0.5 font-semibold tracking-[0.04em] text-[#3848c7] ring-1 ring-[#dcdfed] transition-colors hover:bg-[#eef1ff] hover:ring-[#5566f6]/40"
            >
              {TASKSFLOW_PROMO_CODE}
            </button>
            <span className="text-[#6f7282]">{TASKSFLOW_PROMO_BENEFIT}</span>
            <a
              href={tasksflowPromoUrl(campaign)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-medium text-[#5566f6] transition-colors hover:text-[#3848c7]"
            >
              Перейти
              <ExternalLink className="size-3" />
            </a>
          </p>
        </div>
      </div>
    );
  }

  // Развёрнутый вариант. Раньше здесь было пять строк: заголовок,
  // описание, промокод, ссылка и объяснение про автосвязку. Блок стоит
  // в форме, ради которой человек и пришёл, и каждая строка отодвигала
  // кнопку «Добавить». Осталось то, что нельзя выбросить: что это,
  // промокод со скидкой и куда идти.
  return (
    <div className="mt-2 rounded-xl bg-[#f5f6ff] px-3 py-2.5 text-[12px] leading-[1.45] text-[#3c4053]">
      <div className="flex items-start gap-2">
        <span className="mt-px flex size-5 shrink-0 items-center justify-center rounded-lg bg-[#eef1ff] text-[#5566f6]">
          <Zap className="size-3" />
        </span>
        <div className="min-w-0 flex-1">
          <p>
            <span className="font-semibold text-[#0b1024]">TasksFlow.ru</span>
            {" — задачи сотрудникам со ссылкой на журналы. Промокод "}
            <button
              type="button"
              onClick={copyPromo}
              title="Скопировать промокод"
              className="rounded-full bg-white px-1.5 py-0.5 font-semibold tracking-[0.04em] text-[#3848c7] ring-1 ring-[#dcdfed] transition-colors hover:bg-[#eef1ff] hover:ring-[#5566f6]/40"
            >
              {TASKSFLOW_PROMO_CODE}
            </button>
            {` — ${TASKSFLOW_PROMO_BENEFIT}. `}
            <a
              href={tasksflowPromoUrl(campaign)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-medium text-[#5566f6] transition-colors hover:text-[#3848c7]"
            >
              Перейти
              <ExternalLink className="size-3" />
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
