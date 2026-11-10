import Link from "next/link";
import { CheckCircle2, FileText, ListTodo, Mail } from "lucide-react";

import { requireRoot } from "@/lib/auth-helpers";
import { CRM_TASK_KIND_LABELS, listTaskAssignees, readLifecycleSettings } from "@/lib/crm/tasks.server";
import { forecastLifecycle, type LifecyclePreview } from "@/lib/lifecycle/job.server";
import { cn } from "@/lib/utils";
import { CARD, CrmHeader, ZONE_TITLE } from "../crm-ui";
import { LifecycleSettingsForm } from "./automation-client";

export const dynamic = "force-dynamic";

export const metadata = { title: "Автоворонка — CRM" };

const DAY = new Intl.DateTimeFormat("ru-RU", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

const EMAIL_LABELS: Record<string, string> = {
  trial: "письмо со счётом",
  trial_idle: "письмо «поможем начать, продлим пробный»",
  grace_last: "письмо «последние дни» со счётом",
  renewal_early: "письмо «оплатите заранее» со счётом",
};

/**
 * Автоворонка (2026-11-10): настройки сценария «пробный и оплата» и прогноз
 * на неделю — кому уйдёт письмо и какая задача появится, если никто не
 * оплатит. Только тем, кто видит всех клиентов.
 */
export default async function CrmAutomationPage() {
  await requireRoot();
  const [settings, people, forecast] = await Promise.all([
    readLifecycleSettings(),
    listTaskAssignees(),
    forecastLifecycle(7).catch((error) => {
      console.error("[lifecycle] forecast failed", error);
      return [] as { day: string; items: LifecyclePreview[] }[];
    }),
  ]);
  const names = new Map(people.map((person) => [person.id, person.name]));
  const total = forecast.reduce((sum, day) => sum + day.items.filter((item) => !item.done).length, 0);
  const shown = forecast.reduce((sum, day) => sum + day.items.length, 0);
  return (
    <div className="space-y-8" data-crm-automation>
      <CrmHeader
        active="/root/crm/automation"
        title="Автоворонка"
        description="Что сценарий делает сам: пробный — за 4 и 2 рабочих дня письмо с расчётом по аккаунту и счётом, менеджеру — звонок и КП со скидкой; отсрочка — последний шанс; годовым — «оплатите заранее»; по безналу — счёт на продление. Ниже — прогноз на неделю, если никто не оплатит."
      />

      <section className="space-y-3" data-automation-forecast>
        <h2 className={ZONE_TITLE}>Прогноз на 7 дней · {total}</h2>
        {!settings.enabled ? (
          <div className="rounded-3xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-6 py-8 text-center text-[14px] text-[#6f7282]">Сценарий выключен — писем и задач не будет.</div>
        ) : shown === 0 ? (
          <div className="rounded-3xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-6 py-8 text-center text-[14px] text-[#6f7282]">На неделе сценарию делать нечего.</div>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {forecast
              .filter((day) => day.items.length)
              .map((day) => (
                <div key={day.day} className={CARD}>
                  <div className="border-b border-[#eef0f6] px-4 py-2.5 text-[14px] font-semibold text-[#0b1024] first-letter:uppercase sm:px-5">{DAY.format(new Date(`${day.day}T12:00:00Z`))}</div>
                  <ul className="divide-y divide-[#eef0f6]">
                    {day.items.map((item) => (
                      <li key={`${day.day}-${item.unitKey}`} className="flex items-start gap-3 px-4 py-2.5 sm:px-5" data-forecast-item={item.stage}>
                        <span className={cn("mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg", item.done ? "bg-[#eef8f0] text-[#116b2a]" : item.email ? "bg-[#fff8eb] text-[#7a4a00]" : "bg-[#eef1ff] text-[#3848c7]")}>
                          {item.done ? <CheckCircle2 className="size-3.5" /> : item.email ? <Mail className="size-3.5" /> : item.invoice ? <FileText className="size-3.5" /> : <ListTodo className="size-3.5" />}
                        </span>
                        <div className="min-w-0 flex-1">
                          <Link href={`/root/organizations/${item.organizationId}`} className="text-[13.5px] font-medium leading-snug text-[#0b1024] hover:underline">
                            {item.organizationName}
                          </Link>
                          <div className="mt-0.5 text-[12.5px] leading-snug text-[#6f7282]">
                            {item.stageLabel}
                            {item.email ? ` · ${EMAIL_LABELS[item.email] ?? "письмо"}` : item.invoice ? " · счёт на продление" : ""}
                            {item.task ? ` · задача «${CRM_TASK_KIND_LABELS[item.task] ?? item.task}» — ${item.assigneeId ? (names.get(item.assigneeId) ?? "менеджеру") : "РОП"}` : ""}
                            {item.done ? " · уже сделано" : ""}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
          </div>
        )}
      </section>

      <section className={cn(CARD, "p-5 sm:p-6")} data-crm-lifecycle-settings>
        <div className={ZONE_TITLE}>Настройки сценария</div>
        <p className="mt-2 max-w-[760px] text-[13.5px] leading-relaxed text-[#6f7282]">
          Задача менеджеру — только по живым аккаунтам: за неделю есть записи в журналах. Кто журналы не начал вести, получает письмо «поможем начать, продлим пробный» без счёта. Письма уходят от имени ответственного: его подпись, ответ клиента придёт ему.
        </p>
        <LifecycleSettingsForm settings={settings} people={people} />
      </section>
    </div>
  );
}
