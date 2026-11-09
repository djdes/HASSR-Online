import Link from "next/link";
import { Building2, Search } from "lucide-react";

import { requireRoot } from "@/lib/auth-helpers";
import { CRM_STAGES, isCrmStage } from "@/lib/crm/constants";
import { listCrmContacts } from "@/lib/crm/queries.server";
import { platformViewerForSession } from "@/lib/platform-access.server";
import { cn } from "@/lib/utils";
import { CARD, ChannelBadge, CrmHeader, INPUT, StageBadge } from "../crm-ui";
import { channelLabel, displayName, formatAgo, formatDue } from "../crm-format";
import { AddLeadButton, SyncButton } from "../crm-toolbar";

export const dynamic = "force-dynamic";

export const metadata = { title: "CRM: контакты" };

type SearchParams = { q?: string; queue?: string; stage?: string; channel?: string; owner?: string; page?: string };

const QUEUES = [
  { key: "all", label: "Все" },
  { key: "awaiting", label: "Ждут ответа" },
  { key: "next", label: "Шаг на сегодня" },
  { key: "waiting", label: "Ждём клиента" },
  { key: "leads", label: "Лиды" },
  { key: "clients", label: "Клиенты платформы" },
];

function hrefWith(params: SearchParams, patch: Partial<SearchParams>): string {
  const next = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...params, ...patch, ...(patch.page ? {} : { page: undefined }) })) {
    if (value && !(key === "queue" && value === "all")) next.set(key, value);
  }
  const query = next.toString();
  return query ? `/root/crm/contacts?${query}` : "/root/crm/contacts";
}

const CHIP = "inline-flex h-8 shrink-0 items-center rounded-full border px-3 text-[13px] transition-colors duration-150";
const CHIP_ON = "border-[#5566f6] bg-[#eef1ff] font-medium text-[#3848c7]";
const CHIP_OFF = "border-[#ececf4] bg-white text-[#3c4053] hover:border-[#5566f6]/40";

export default async function CrmContactsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const session = await requireRoot();
  const params = await searchParams;
  const now = new Date();
  const queue = QUEUES.some((item) => item.key === params.queue) ? params.queue! : "all";
  const viewer = await platformViewerForSession(session);
  const list = await listCrmContacts({ ...params, queue, page: Number(params.page) || 1 }, session.user.id, now, viewer.scope === "own");

  return (
    <div className="space-y-6" data-crm-contacts>
      <CrmHeader
        active="/root/crm/contacts"
        own={viewer.scope === "own"}
        title="Контакты и переписка"
        description="Каждый человек — одна карточка со всей перепиской: почта, чат, бот, заявки, звонки и заметки. Клиент, который ждёт ответа, — сверху очереди «Ждут ответа»."
        actions={
          <>
            <SyncButton />
            <AddLeadButton primary />
          </>
        }
      />

      <div className="space-y-3">
        <form action="/root/crm/contacts" className="relative max-w-[520px]">
          {queue !== "all" ? <input type="hidden" name="queue" value={queue} /> : null}
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-[#9b9fb3]" />
          <input name="q" defaultValue={params.q ?? ""} placeholder="Имя, компания, почта или телефон" className={cn(INPUT, "pl-10")} data-crm-search />
        </form>
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
          {QUEUES.map((item) => (
            <Link key={item.key} href={hrefWith(params, { queue: item.key })} className={cn(CHIP, queue === item.key ? CHIP_ON : CHIP_OFF)}>
              {item.label}
            </Link>
          ))}
          <span className="mx-1 w-px shrink-0 bg-[#ececf4]" />
          <Link href={hrefWith(params, { owner: params.owner === "me" ? undefined : "me" })} className={cn(CHIP, params.owner === "me" ? CHIP_ON : CHIP_OFF)}>
            Мои
          </Link>
          <Link href={hrefWith(params, { owner: params.owner === "none" ? undefined : "none" })} className={cn(CHIP, params.owner === "none" ? CHIP_ON : CHIP_OFF)}>
            {viewer.scope === "own" ? "Свободные" : "Без ответственного"}
          </Link>
          <span className="mx-1 w-px shrink-0 bg-[#ececf4]" />
          {CRM_STAGES.map((stage) => (
            <Link key={stage} href={hrefWith(params, { stage: params.stage === stage ? undefined : stage })} className={cn(CHIP, params.stage === stage ? CHIP_ON : CHIP_OFF)}>
              <StageBadge stage={stage} />
            </Link>
          ))}
        </div>
        {params.channel ? (
          <p className="text-[13px] text-[#6f7282]">
            Канал первого обращения: <b className="text-[#0b1024]">{channelLabel(params.channel)}</b> ·{" "}
            <Link href={hrefWith(params, { channel: undefined })} className="text-[#3848c7] hover:underline">
              сбросить
            </Link>
          </p>
        ) : null}
      </div>

      <section className={CARD}>
        <div className="flex items-baseline justify-between gap-3 border-b border-[#eef0f6] px-4 py-3 sm:px-5">
          <span className="text-[15px] font-semibold text-[#0b1024]">{QUEUES.find((item) => item.key === queue)?.label}</span>
          <span className="text-[13px] tabular-nums text-[#6f7282]">{list.total}</span>
        </div>
        {list.rows.length ? (
          <ul className="divide-y divide-[#eef0f6]">
            {list.rows.map((row) => {
              const due = formatDue(row.nextActionAt, now);
              const overdue = row.awaitingSince ? now.getTime() - new Date(row.awaitingSince).getTime() >= 4 * 60 * 60 * 1000 : false;
              return (
                <li key={row.id} data-crm-contact-row={row.id}>
                  <Link href={`/root/crm/contacts/${row.id}`} className="grid gap-1.5 px-4 py-3 transition-colors hover:bg-[#fafbff] sm:px-5 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1.6fr)_auto] md:items-center md:gap-4">
                    <span className="min-w-0">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-[14.5px] font-medium text-[#0b1024]">{displayName(row)}</span>
                        <StageBadge stage={row.stage} />
                        {row.organizationId ? <Building2 className="size-3.5 shrink-0 text-[#5566f6]" aria-label="Клиент платформы" /> : null}
                      </span>
                      <span className="mt-0.5 block truncate text-[12.5px] text-[#6f7282]">
                        {[row.company !== row.name ? row.company : null, row.phone, row.email].filter((value) => value && value !== displayName(row)).join(" · ") || "—"}
                      </span>
                    </span>
                    <span className="min-w-0 text-[13px] text-[#3c4053]">
                      <span className="flex items-center gap-2">
                        <ChannelBadge channel={row.last?.channel ?? row.source} />
                        <span className="text-[12px] text-[#9b9fb3]">{row.last ? `${row.last.direction === "out" ? "мы, " : ""}${formatAgo(row.last.occurredAt, now)} назад` : ""}</span>
                      </span>
                      <span className="mt-1 block truncate">{row.last?.body ?? ""}</span>
                    </span>
                    <span className="flex flex-wrap items-center gap-1.5 md:justify-end">
                      {row.awaitingSince ? (
                        <span className={cn("rounded-full px-2 py-0.5 text-[12px] font-medium", overdue ? "bg-[#fff4f2] text-[#a13a32]" : "bg-[#fff8eb] text-[#7a4a00]")}>
                          ждёт {formatAgo(row.awaitingSince, now)}
                        </span>
                      ) : null}
                      {due ? (
                        <span className={cn("rounded-full px-2 py-0.5 text-[12px]", due.tone === "overdue" ? "bg-[#fff4f2] text-[#a13a32]" : "bg-[#f5f6ff] text-[#3848c7]")}>
                          шаг: {due.label}
                        </span>
                      ) : null}
                      <span className="text-[12px] text-[#9b9fb3]">{row.ownerName ?? "без ответственного"}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="px-5 py-8 text-center text-[13.5px] text-[#6f7282]">Здесь пусто. {queue === "awaiting" ? "Всем ответили." : "Измените фильтр или нажмите «Обновить сейчас»."}</p>
        )}
        {list.pages > 1 ? (
          <div className="flex items-center justify-between gap-3 border-t border-[#eef0f6] px-4 py-3 text-[13px] sm:px-5">
            {list.page > 1 ? (
              <Link href={hrefWith(params, { page: String(list.page - 1) })} className="text-[#3848c7] hover:underline">
                ← Назад
              </Link>
            ) : (
              <span />
            )}
            <span className="text-[#6f7282]">
              {list.page} из {list.pages}
            </span>
            {list.page < list.pages ? (
              <Link href={hrefWith(params, { page: String(list.page + 1) })} className="text-[#3848c7] hover:underline">
                Дальше →
              </Link>
            ) : (
              <span />
            )}
          </div>
        ) : null}
      </section>
      {params.stage && !isCrmStage(params.stage) ? <p className="text-[12px] text-[#9b9fb3]">Неизвестная стадия в адресе — показаны все.</p> : null}
    </div>
  );
}
