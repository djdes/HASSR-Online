import type { ReactNode } from "react";
import { db } from "@/lib/db";
import { currentOrgSnapshot } from "@/lib/orders/store";
import type { OrderOrgSnapshot } from "@/lib/orders/render";
import { PrintJournalButton } from "@/components/journals/print-journal-button";

/** Организация для шапки печатного листа: логотип и реквизиты. */
export type PpkPrintOrg = {
  logoUrl: string | null;
  orgName: string;
  orgInn: string | null;
  orgAddress: string | null;
  /** Полный снимок реквизитов (директор нужен для строки «Утверждаю»). */
  snapshot: OrderOrgSnapshot | null;
};

/** Логотип и реквизиты организации — данные для `PpkPrintSheet`. */
export async function loadPpkPrintOrg(organizationId: string): Promise<PpkPrintOrg> {
  const [org, snapshot] = await Promise.all([
    db.organization.findUnique({ where: { id: organizationId }, select: { name: true, logoUrl: true } }),
    currentOrgSnapshot(organizationId),
  ]);
  return {
    logoUrl: org?.logoUrl ?? null,
    orgName: snapshot?.orgName || org?.name || "",
    orgInn: snapshot?.orgInn ?? null,
    orgAddress: snapshot?.orgAddress ?? null,
    snapshot,
  };
}

/**
 * Печатный лист A4 блоков ППК: на экране белая карточка, в печати — чистая
 * страница. Над листом (только на экране) — кнопка печати.
 */
export function PpkPrintSheet({
  org,
  title,
  subtitle,
  children,
}: {
  org: PpkPrintOrg;
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  const requisites = [org.orgInn ? `ИНН ${org.orgInn}` : null, org.orgAddress].filter(Boolean).join(", ");
  return (
    <div className="space-y-4">
      <div className="flex justify-end print:hidden">
        <PrintJournalButton />
      </div>
      <article className="mx-auto w-full max-w-[794px] rounded-3xl border border-[#ececf4] bg-white p-6 text-[14px] leading-[1.6] text-[#0b1024] shadow-[0_20px_60px_-40px_rgba(11,16,36,0.35)] sm:p-12 print:max-w-none print:rounded-none print:border-0 print:p-0 print:shadow-none">
        <header className="mb-6 flex items-center gap-4">
          {org.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={org.logoUrl} alt="" className="h-12 w-auto max-w-[160px] object-contain" />
          ) : null}
          <div className="min-w-0">
            <div className="font-semibold">{org.orgName}</div>
            {requisites ? <div className="text-[12.5px] text-[#6f7282]">{requisites}</div> : null}
          </div>
        </header>
        <h1 className="text-center text-[20px] font-semibold">{title}</h1>
        {subtitle ? <p className="mt-1 text-center text-[#6f7282]">{subtitle}</p> : null}
        <div className="mt-6">{children}</div>
      </article>
    </div>
  );
}
