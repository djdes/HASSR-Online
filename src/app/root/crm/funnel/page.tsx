import Link from "next/link";

import { requireRoot } from "@/lib/auth-helpers";
import { listTaskAssignees } from "@/lib/crm/tasks.server";
import { listDeals } from "@/lib/lifecycle/deals.server";
import { platformViewerForSession } from "@/lib/platform-access.server";
import { cn } from "@/lib/utils";
import { CrmHeader } from "../crm-ui";
import { FunnelBoard } from "./funnel-board";

export const dynamic = "force-dynamic";

export const metadata = { title: "Воронка продаж — CRM" };

type Search = Record<string, string | string[] | undefined>;

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Воронка продаж (2026-11-10): каждый клиент на пробном и каждое продление —
 * карточка. Сценарий сам двигает её по колонкам (договор в ЭДО, письмо,
 * звонок, оплата, переход на бесплатный); менеджер — перетаскиванием.
 * Охват «свои» — свои и свободные сделки.
 */
export default async function CrmFunnelPage({ searchParams }: { searchParams: Promise<Search> }) {
  const session = await requireRoot();
  const viewer = await platformViewerForSession(session);
  const own = viewer.scope === "own";
  const params = await searchParams;
  const kind = one(params.kind) === "trial" || one(params.kind) === "renewal" ? one(params.kind)! : null;
  const owner = one(params.owner) ?? null;
  const soon = one(params.soon) === "1";
  const [cards, people] = await Promise.all([
    listDeals({ ownScopeId: own ? session.user.id : null, kind, ownerId: owner === "me" ? session.user.id : owner, dueSoon: soon }),
    own ? Promise.resolve([]) : listTaskAssignees(),
  ]);
  const link = (patch: Record<string, string | null>) => {
    const next = { kind, owner, soon: soon ? "1" : null, ...patch };
    const query = new URLSearchParams(Object.entries(next).filter(([, value]) => value) as [string, string][]);
    return `/root/crm/funnel${query.size ? `?${query}` : ""}`;
  };
  const chip = (active: boolean) =>
    cn("inline-flex h-8 shrink-0 items-center rounded-xl px-3 text-[13px] transition-colors", active ? "bg-[#0b1024] font-medium text-white" : "border border-[#ececf4] bg-white text-[#3c4053] hover:border-[#5566f6]/40");
  return (
    <div className="space-y-5" data-crm-funnel-page>
      <CrmHeader
        active="/root/crm/funnel"
        title="Воронка продаж"
        description="Каждый клиент на пробном и каждое продление — карточка. Сценарий сам двигает её: договор подписан в ЭДО, письмо ушло, звонок был, оплатили, перешли на бесплатный. Перетащите карточку или выберите колонку — она зафиксируется."
      />
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" data-crm-funnel-filters>
        <Link className={chip(!kind)} href={link({ kind: null })}>
          Все
        </Link>
        <Link className={chip(kind === "trial")} href={link({ kind: "trial" })}>
          Пробные
        </Link>
        <Link className={chip(kind === "renewal")} href={link({ kind: "renewal" })}>
          Продления
        </Link>
        <span className="mx-1 w-px shrink-0 self-stretch bg-[#ececf4]" aria-hidden />
        <Link className={chip(soon)} href={link({ soon: soon ? null : "1" })}>
          Срок за 7 дней
        </Link>
        <span className="mx-1 w-px shrink-0 self-stretch bg-[#ececf4]" aria-hidden />
        {!own ? (
          <Link className={chip(!owner)} href={link({ owner: null })}>
            Все менеджеры
          </Link>
        ) : null}
        <Link className={chip(owner === "me")} href={link({ owner: owner === "me" && own ? null : "me" })}>
          Мои
        </Link>
        <Link className={chip(owner === "none")} href={link({ owner: owner === "none" ? null : "none" })}>
          Без ответственного
        </Link>
        {people
          .filter((person) => person.id !== session.user.id)
          .slice(0, 8)
          .map((person) => (
            <Link key={person.id} className={chip(owner === person.id)} href={link({ owner: person.id })}>
              {person.name}
            </Link>
          ))}
      </div>
      <FunnelBoard cards={cards} nowIso={new Date().toISOString()} />
    </div>
  );
}
