import Link from "next/link";
import { AlertTriangle, ExternalLink, Eye, Heart, MessageCircle, RefreshCw } from "lucide-react";

import { requireRoot } from "@/lib/auth-helpers";
import { loadAvitoOverview } from "@/lib/avito/account.server";
import { AVITO_ITEM_STATUS_LABELS, formatRub } from "@/lib/avito/notify";
import { readAvitoNotify } from "@/lib/avito/notify.server";
import { listSalesHeads } from "@/lib/crm/notify.server";
import { platformViewerForSession } from "@/lib/platform-access.server";
import { cn } from "@/lib/utils";
import { CARD, CrmHeader, SECONDARY_BUTTON, ZONE_TITLE } from "../crm-ui";
import { AvitoNotifyForm } from "./avito-notify-form";

export const dynamic = "force-dynamic";

export const metadata = { title: "CRM: Авито" };

const STATUS_TONE: Record<string, string> = {
  active: "bg-[#e7f8ee] text-[#167a3e]",
  rejected: "bg-[#fdecec] text-[#b42318]",
  blocked: "bg-[#fdecec] text-[#b42318]",
  old: "bg-[#fff4e0] text-[#9a5b00]",
  removed: "bg-[#f1f2f6] text-[#6f7282]",
};

const number = new Intl.NumberFormat("ru-RU");

export default async function CrmAvitoPage({ searchParams }: { searchParams: Promise<{ refresh?: string }> }) {
  const session = await requireRoot();
  const { refresh } = await searchParams;
  const [data, settings, viewer, heads] = await Promise.all([
    loadAvitoOverview(refresh === "1"),
    readAvitoNotify(),
    platformViewerForSession(session),
    listSalesHeads(),
  ]);
  const { balances, crm } = data;
  const low = balances.advanceRub !== null && settings.lowBalanceRub > 0 && balances.advanceRub < settings.lowBalanceRub;
  const active = data.items.filter((item) => item.status === "active").length;
  const totals = data.items.reduce((sum, item) => ({ views: sum.views + item.views, contacts: sum.contacts + item.contacts }), { views: 0, contacts: 0 });
  const loadedAt = new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", hour: "2-digit", minute: "2-digit" }).format(new Date(data.loadedAt));

  return (
    <div className="space-y-6" data-crm-avito>
      <CrmHeader
        active="/root/crm/avito"
        title="Авито"
        description="Объявления, их статус и баланс кабинета Авито. Каждое новое сообщение в чатах Авито заводит лид в CRM («Новый», без ответственного) и сразу приходит в Telegram."
        actions={
          <Link href="/root/crm/avito?refresh=1" className={SECONDARY_BUTTON} prefetch={false}>
            <RefreshCw className="size-4" />
            Обновить · {loadedAt}
          </Link>
        }
      />

      {!data.configured ? (
        <div className={cn(CARD, "p-5 text-[14px] text-[#6f7282]")}>Ключи API Авито не настроены (AVITO_CLIENT_ID / AVITO_CLIENT_SECRET в .env сервера).</div>
      ) : null}

      {data.errors.length ? (
        <div className="flex gap-2 rounded-2xl border border-[#f5c2c0] bg-[#fff5f5] px-4 py-3 text-[13.5px] text-[#b42318]">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>Авито ответил не на всё: {data.errors.join("; ")}</span>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className={cn(CARD, "p-5", low && "border-[#f5c2c0] bg-[#fff8f7]")}>
          <div className={ZONE_TITLE}>Аванс</div>
          <div className={cn("mt-2 text-[28px] font-semibold tracking-[-0.02em]", low ? "text-[#b42318]" : "text-[#0b1024]")}>
            {balances.advanceRub === null ? "—" : formatRub(balances.advanceRub)}
          </div>
          <p className="mt-1 text-[12.5px] leading-snug text-[#6f7282]">
            {low ? "Ниже порога — пополните, иначе объявления снимут с показов." : "Списывается за просмотры и целевые действия."}
          </p>
        </div>
        <div className={cn(CARD, "p-5")}>
          <div className={ZONE_TITLE}>Кошелёк</div>
          <div className="mt-2 text-[28px] font-semibold tracking-[-0.02em] text-[#0b1024]">{balances.walletRub === null ? "—" : formatRub(balances.walletRub)}</div>
          <p className="mt-1 text-[12.5px] leading-snug text-[#6f7282]">
            На платные услуги продвижения{balances.bonusRub ? ` · бонусы ${formatRub(balances.bonusRub)}` : ""}.{" "}
            <a href="https://www.avito.ru/profile" target="_blank" rel="noreferrer" className="text-[#5566f6] hover:underline">
              Пополнить в кабинете
            </a>
          </p>
        </div>
        <div className={cn(CARD, "p-5")}>
          <div className={ZONE_TITLE}>Объявления</div>
          <div className="mt-2 text-[28px] font-semibold tracking-[-0.02em] text-[#0b1024]">
            {active}
            <span className="text-[16px] font-normal text-[#9b9fb3]"> из {data.items.length} активны</span>
          </div>
          <p className="mt-1 text-[12.5px] leading-snug text-[#6f7282]">
            За {data.statsDays} дней: {number.format(totals.views)} просмотров, {number.format(totals.contacts)} контактов.
          </p>
        </div>
        <div className={cn(CARD, "p-5")}>
          <div className={ZONE_TITLE}>Лиды с Авито</div>
          <div className="mt-2 text-[28px] font-semibold tracking-[-0.02em] text-[#0b1024]">
            {crm.newUnassigned}
            <span className="text-[16px] font-normal text-[#9b9fb3]"> не разобраны</span>
          </div>
          <p className="mt-1 text-[12.5px] leading-snug text-[#6f7282]">
            Всего {crm.contacts}, за неделю новых {crm.last7}, ждут ответа {crm.awaiting}.{" "}
            <Link href="/root/crm/contacts?channel=avito&stage=new&owner=none" className="text-[#5566f6] hover:underline">
              Открыть
            </Link>
          </p>
        </div>
      </div>

      <section className={cn(CARD, "overflow-hidden")}>
        <div className="flex items-center justify-between gap-3 border-b border-[#ececf4] px-5 py-4">
          <h2 className="text-[16px] font-semibold text-[#0b1024]">Объявления</h2>
          <span className="text-[12.5px] text-[#9b9fb3]">просмотры, контакты и избранное — уникальные, за {data.statsDays} дней</span>
        </div>
        {data.items.length === 0 ? (
          <p className="px-5 py-6 text-[14px] text-[#6f7282]">Объявлений нет{data.configured ? "" : " — API не подключён"}.</p>
        ) : (
          <ul className="divide-y divide-[#f1f2f6]">
            {data.items.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5">
                <span className={cn("inline-flex shrink-0 rounded-full px-2 py-0.5 text-[11.5px] font-medium", STATUS_TONE[item.status] ?? STATUS_TONE.removed)}>
                  {AVITO_ITEM_STATUS_LABELS[item.status] ?? item.status}
                </span>
                <a href={item.url} target="_blank" rel="noreferrer" className="group min-w-0 flex-1 basis-[280px]">
                  <span className="text-[14px] font-medium text-[#0b1024] group-hover:text-[#5566f6]">{item.title}</span>
                  <ExternalLink className="ml-1 inline size-3.5 text-[#9b9fb3]" />
                  <span className="block text-[12px] text-[#9b9fb3]">
                    {[item.category, item.address, item.price !== null ? formatRub(item.price) : null, `№ ${item.id}`].filter(Boolean).join(" · ")}
                  </span>
                </a>
                <span className="flex shrink-0 items-center gap-4 text-[13px] tabular-nums text-[#3c4053]">
                  <span className="inline-flex items-center gap-1" title="Просмотры">
                    <Eye className="size-3.5 text-[#9b9fb3]" />
                    {number.format(item.views)}
                  </span>
                  <span className="inline-flex items-center gap-1" title="Контакты">
                    <MessageCircle className="size-3.5 text-[#9b9fb3]" />
                    {number.format(item.contacts)}
                  </span>
                  <span className="inline-flex items-center gap-1" title="В избранном">
                    <Heart className="size-3.5 text-[#9b9fb3]" />
                    {number.format(item.favorites)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <AvitoNotifyForm
        initial={settings}
        canEdit={viewer.superadmin}
        heads={heads.map((head) => ({ name: head.name, telegram: Boolean(head.telegramChatId) }))}
      />
    </div>
  );
}
