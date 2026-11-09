import Link from "next/link";

import { requireRoot } from "@/lib/auth-helpers";
import { loadFunnel } from "@/lib/crm/lifecycle/queries.server";
import { listCrmOwners } from "@/lib/crm/queries.server";
import { platformViewerForSession } from "@/lib/platform-access.server";
import { cn } from "@/lib/utils";
import { CrmHeader } from "../crm-ui";
import { FunnelBoard } from "./funnel-board";

export const dynamic = "force-dynamic";

export const metadata = { title: "Воронка сделок — CRM" };

type Search = Record<string, string | string[] | undefined>;

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function CrmFunnelPage({ searchParams }: { searchParams: Promise<Search> }) {
  const session = await requireRoot();
  const viewer = await platformViewerForSession(session);
  const own = viewer.scope === "own";
  const params = await searchParams;
  const filters = { kind: one(params.kind), owner: one(params.owner) ?? (own ? "me" : "all"), closing: one(params.closing) };
  const [{ cards }, owners] = await Promise.all([loadFunnel(filters, { userId: session.user.id, own }), listCrmOwners({ userId: session.user.id, own })]);
  const link = (patch: Partial<typeof filters>) => {
    const next = { ...filters, ...patch };
    const query = new URLSearchParams(Object.entries(next).filter(([, value]) => value && value !== "all") as [string, string][]);
    return `/root/crm/funnel${query.size ? `?${query}` : ""}`;
  };
  const chip = (active: boolean) =>
    cn(
      "inline-flex h-8 items-center rounded-xl px-3 text-[13px] transition-colors",
      active ? "bg-[#0b1024] font-medium text-white" : "border border-[#ececf4] bg-white text-[#3c4053] hover:border-[#5566f6]/40",
    );
  return (
    <div className="space-y-5" data-crm-funnel-page>
      <CrmHeader
        active="/root/crm/funnel"
        own={own}
        title="Воронка сделок"
        description="Каждый клиент на пробном и каждое продление — карточка. Автоворонка сама двигает её по колонкам: договор подписан в ЭДО, письмо ушло, звонок был, оплатили. Перетащите карточку, чтобы поставить колонку руками; клик по названию — переписка."
      />
      <div className="flex flex-wrap items-center gap-2">
        <Link className={chip(!filters.kind)} href={link({ kind: undefined })}>
          Все
        </Link>
        <Link className={chip(filters.kind === "trial")} href={link({ kind: "trial" })}>
          Новые клиенты
        </Link>
        <Link className={chip(filters.kind === "renewal")} href={link({ kind: "renewal" })}>
          Продления
        </Link>
        <span className="mx-1 h-5 w-px bg-[#ececf4]" />
        <Link className={chip(filters.closing === "7")} href={link({ closing: filters.closing === "7" ? undefined : "7" })}>
          Срок за 7 дней
        </Link>
        {!own ? (
          <>
            <span className="mx-1 h-5 w-px bg-[#ececf4]" />
            <Link className={chip(filters.owner === "all")} href={link({ owner: "all" })}>
              Все менеджеры
            </Link>
            <Link className={chip(filters.owner === "me")} href={link({ owner: "me" })}>
              Мои
            </Link>
            <Link className={chip(filters.owner === "none")} href={link({ owner: "none" })}>
              Без ответственного
            </Link>
            {owners
              .filter((owner) => owner.id !== session.user.id)
              .slice(0, 8)
              .map((owner) => (
                <Link key={owner.id} className={chip(filters.owner === owner.id)} href={link({ owner: owner.id })}>
                  {owner.name}
                </Link>
              ))}
          </>
        ) : null}
      </div>
      <FunnelBoard cards={cards} nowIso={new Date().toISOString()} />
    </div>
  );
}
