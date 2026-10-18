import Link from "next/link";
import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { BellRing, Sparkles } from "lucide-react";
import { ppkBlock, type PpkBlockKey } from "@/lib/ppk/registry";

/**
 * Шапка блока раздела ППК: название блока, пояснение, действия справа и, если
 * у блока есть услуга, тихая ссылка «Помощь специалиста». На телефоне действия
 * уходят под заголовок.
 */
export async function PpkBlockHeader({
  blockKey,
  lead,
  actions,
  reminderHint,
}: {
  blockKey: PpkBlockKey;
  lead: ReactNode;
  actions?: ReactNode;
  /** Тихая строка «Напомним руководству в Telegram…» под пояснением (планы со сроками). */
  reminderHint?: boolean;
}) {
  const nav = await getTranslations("navigation");
  const pc = await getTranslations("productionControl");
  const { serviceKey } = ppkBlock(blockKey);

  return (
    <header className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
      <div className="min-w-0">
        <h1 className="text-[24px] font-semibold tracking-[-0.02em] text-[#0b1024] md:text-[26px]">
          {nav(`shell.menus.productionControl.items.${blockKey}`)}
        </h1>
        <p className="mt-1.5 max-w-[640px] text-[14px] text-[#6f7282]">{lead}</p>
        {reminderHint ? (
          <p className="mt-1.5 flex items-center gap-1.5 text-[13px] text-[#6f7282]">
            <BellRing className="size-3.5 shrink-0" aria-hidden />
            {pc("reminders.hint")}
          </p>
        ) : null}
      </div>
      {actions || serviceKey ? (
        <div className="flex flex-wrap items-center gap-2 md:shrink-0">
          {actions}
          {serviceKey ? (
            <Link
              href={`/settings/services?order=${serviceKey}`}
              className="inline-flex items-center gap-1.5 rounded-xl px-2 py-1 text-[13.5px] font-medium text-[#3848c7] transition-colors duration-150 hover:text-[#5566f6] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
            >
              <Sparkles className="size-4" />
              {pc("specialistHelp")}
            </Link>
          ) : null}
        </div>
      ) : null}
    </header>
  );
}
