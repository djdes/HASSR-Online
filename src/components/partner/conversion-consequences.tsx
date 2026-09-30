import { AlertTriangle, ArrowRight, Coins, CreditCard, KeyRound, Users } from "lucide-react";

import type { Blocker, Consequences } from "@/lib/partners/org-conversion-core";

/**
 * Последствия перевода организации в партнёрский кабинет (и возврата) —
 * группами: оплата, места, вознаграждение, доступ, что дальше. Тексты
 * собирает сервер (`org-conversion-core.ts`) из реальных данных: сроков,
 * числа сотрудников, действующих правил вознаграждения.
 */

const GROUPS: Array<{ key: keyof Consequences; title: string; icon: typeof Coins }> = [
  { key: "payment", title: "Оплата", icon: CreditCard },
  { key: "seats", title: "Места в тарифе", icon: Users },
  { key: "commission", title: "Вознаграждение", icon: Coins },
  { key: "access", title: "Доступ", icon: KeyRound },
  { key: "next", title: "Дальше", icon: ArrowRight },
];

export function ConversionConsequences({ consequences }: { consequences: Consequences }) {
  return (
    <div className="space-y-3" data-testid="conversion-consequences">
      {GROUPS.filter((group) => consequences[group.key].length > 0).map((group) => (
        <div key={group.key} className="rounded-2xl border border-[#ececf4] bg-[#fafbff] px-4 py-3">
          <div className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.12em] text-[#6f7282]">
            <group.icon className="size-3.5 text-[#5566f6]" aria-hidden />
            {group.title}
          </div>
          <ul className="mt-1.5 space-y-1.5 text-[13.5px] leading-[1.5] text-[#3c4053]">
            {consequences[group.key].map((line) => (
              <li key={line} className="flex gap-2">
                <span className="mt-[0.55em] size-1.5 shrink-0 rounded-full bg-[#5566f6]" aria-hidden />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

export function ConversionBlockers({ blockers, title }: { blockers: Blocker[]; title: string }) {
  if (blockers.length === 0) return null;
  return (
    <div className="rounded-2xl border border-[#ffe2a0] bg-[#fff8eb] px-4 py-3" data-testid="conversion-blockers">
      <div className="flex items-center gap-2 text-[13px] font-semibold text-[#9a4a06]">
        <AlertTriangle className="size-4" aria-hidden />
        {title}
      </div>
      <ul className="mt-1.5 space-y-1.5 text-[13px] leading-[1.5] text-[#3c4053]">
        {blockers.map((blocker) => (
          <li key={blocker.code} data-blocker={blocker.code}>
            {blocker.message}
          </li>
        ))}
      </ul>
    </div>
  );
}
