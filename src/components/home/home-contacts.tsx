import type { ReactNode } from "react";

/**
 * Блок «Мы на связи» на главной. Всегда открыт и не сворачивается
 * (владелец, 2026-11-22: «развёрнутым по умолчанию без возможности
 * свернуть»). На телефоне строки заголовка нет — сразу вкладки каналов,
 * название остаётся подписью для экранного диктора; с 768px над вкладками,
 * как раньше, маленький заголовок.
 */
export function HomeContacts({ title, children }: { title: string; children: ReactNode }) {
  return (
    <aside
      aria-label={title}
      className="rounded-3xl border border-[#ececf4] bg-white px-3 py-2.5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] md:p-4"
      data-home-contacts
    >
      <div className="mb-2.5 hidden px-1 text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282] md:block" aria-hidden>
        {title}
      </div>
      {children}
    </aside>
  );
}
