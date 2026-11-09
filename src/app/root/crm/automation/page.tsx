import { Mail, ListTodo } from "lucide-react";

import { requireRoot } from "@/lib/auth-helpers";
import { forecastLifecycle } from "@/lib/crm/lifecycle/queries.server";
import { readLifecycleSettings } from "@/lib/crm/lifecycle/settings.server";
import { listCrmOwners } from "@/lib/crm/queries.server";
import { cn } from "@/lib/utils";
import { CARD, CrmHeader, ZONE_TITLE } from "../crm-ui";
import { AutomationClient } from "./automation-client";

export const dynamic = "force-dynamic";

export const metadata = { title: "Автоворонка — CRM" };

const DAY = new Intl.DateTimeFormat("ru-RU", { weekday: "short", day: "numeric", month: "long", timeZone: "Europe/Moscow" });
const TIME = new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" });

export default async function CrmAutomationPage() {
  const session = await requireRoot();
  const [settings, owners, forecast] = await Promise.all([
    readLifecycleSettings(),
    listCrmOwners({ userId: session.user.id, own: false }),
    forecastLifecycle(7).catch((error) => {
      console.error("[crm-lifecycle] прогноз не построен", error);
      return [];
    }),
  ]);
  const byDay = new Map<string, typeof forecast>();
  for (const item of forecast) {
    const key = DAY.format(new Date(item.at));
    byDay.set(key, [...(byDay.get(key) ?? []), item]);
  }
  return (
    <div className="space-y-6" data-crm-automation>
      <CrmHeader
        active="/root/crm/automation"
        title="Автоворонка"
        description="Кому и когда писать, какие задачи ставить: пробный — за 4 и 2 дня письмо с расчётом по данным аккаунта и счётом, менеджеру — звонок и спец-КП со скидкой; грейс — последний шанс; продление — заранее, со счётом на следующий период. Ниже — прогноз на неделю, если никто не оплатит."
      />
      <AutomationClient initial={settings} people={owners.map((owner) => ({ id: owner.id, name: owner.name }))} />
      <section className="space-y-3" data-automation-forecast>
        <h2 className={ZONE_TITLE}>Прогноз на 7 дней · {forecast.length}</h2>
        {forecast.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-[#dcdfed] bg-white px-6 py-8 text-center text-[14px] text-[#6f7282]">
            {settings.enabled ? "На неделе автоворонке делать нечего." : "Автоворонка выключена."}
          </div>
        ) : null}
        {[...byDay.entries()].map(([day, items]) => (
          <div key={day} className={CARD}>
            <div className="border-b border-[#eef0f6] px-4 py-2.5 text-[14px] font-semibold text-[#0b1024] sm:px-5">{day.charAt(0).toUpperCase() + day.slice(1)}</div>
            <ul className="divide-y divide-[#eef0f6]">
              {items.map((item, index) => (
                <li key={`${item.at}-${index}`} className="flex items-start gap-3 px-4 py-2.5 sm:px-5" data-forecast-item={item.kind}>
                  <span className={cn("mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg", item.kind === "message" ? "bg-[#fff8eb] text-[#7a4a00]" : "bg-[#eef1ff] text-[#3848c7]")}>
                    {item.kind === "message" ? <Mail className="size-3.5" /> : <ListTodo className="size-3.5" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13.5px] leading-snug text-[#0b1024]">{item.title}</div>
                    <div className="mt-0.5 text-[12px] text-[#6f7282]">
                      {TIME.format(new Date(item.at))} · {item.organizationName} · {item.detail}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>
    </div>
  );
}
