"use client";

import Link from "next/link";
import { useState } from "react";
import { CheckCircle2, Loader2, Lock, Sparkles, Users } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/ui/page-header";

type Mode = "race" | "shared" | "manual";

const MODES: {
  value: Mode;
  label: string;
  short: string;
  icon: typeof Sparkles;
  pros: string[];
  cons: string[];
}[] = [
  {
    value: "race",
    label: "Гонка (по умолчанию)",
    short: "Кто первый — того и задача",
    icon: Sparkles,
    pros: [
      "Сотрудник видит что свободно и берёт сам",
      "Нет конфликтов — взятую задачу другим уже не взять",
      "У каждого не больше одной задачи в работе — фокус",
    ],
    cons: ["Кто шустрее — нагребает больше", "Менее опытные могут стесняться"],
  },
  {
    value: "shared",
    label: "Свободно",
    short: "Все могут заполнять параллельно",
    icon: Users,
    pros: [
      "Никаких блокировок — берёт кто хочет когда хочет",
      "Подходит для малых команд из 2-3 человек",
    ],
    cons: [
      "Возможно дублирование (двое начали одну задачу)",
      "Правило «одна задача за раз» отключено",
    ],
  },
  {
    value: "manual",
    label: "Только руководитель назначает",
    short: "Сотрудники не берут сами",
    icon: Lock,
    pros: [
      "Жёсткий контроль — задачи распределяют только заведующий производством или руководитель",
      "Подходит для строгих организаций",
    ],
    cons: [
      "Сотрудники не могут себе брать — придётся ждать назначения",
      "Больше работы для руководителя",
    ],
  },
];

export function JournalFlowClient({ initialMode }: { initialMode: Mode }) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<Mode>(initialMode);

  async function save(next: Mode) {
    setSaving(true);
    try {
      const res = await fetch("/api/settings/journal-flow", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskFlowMode: next }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSaved(next);
      setMode(next);
      toast.success("Режим сохранён");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* Тёмный hero снят: выбор режима — три карточки прямо под
          заголовком, и именно их человек пришёл нажимать. */}
      <PageHeader
        title="Режим распределения задач"
        description="Как сотрудники получают задачи. Изменение применяется к ВСЕМ журналам сразу. Можно поменять в любой момент — незавершённые задачи продолжат работать как были взяты."
      />

      <div className="grid gap-3 lg:grid-cols-3">
        {MODES.map((m) => {
          const Icon = m.icon;
          const active = mode === m.value;
          const isSaved = saved === m.value;
          return (
            <button
              key={m.value}
              type="button"
              onClick={() => save(m.value)}
              disabled={saving || isSaved}
              className={`flex flex-col gap-3 rounded-3xl border p-5 text-left transition-all ${
                active
                  ? "border-[#5566f6] bg-[#eef1ff] shadow-[0_0_0_3px_rgba(85,102,246,0.15)]"
                  : "border-[#ececf4] bg-white hover:border-[#5566f6]/40 hover:bg-[#fafbff]"
              }`}
            >
              <div className="flex items-start gap-3">
                <span
                  className={`flex size-10 shrink-0 items-center justify-center rounded-2xl ${
                    active ? "bg-[#5566f6] text-white" : "bg-[#fafbff] text-[#6f7282]"
                  }`}
                >
                  <Icon className="size-5" />
                </span>
                <div>
                  <div className="text-[15px] font-semibold text-[#0b1024]">
                    {m.label}
                  </div>
                  <div className="mt-0.5 text-[12px] text-[#6f7282]">
                    {m.short}
                  </div>
                </div>
                {isSaved ? (
                  <CheckCircle2 className="ml-auto size-5 text-[#136b2a]" />
                ) : null}
              </div>
              <div className="space-y-1.5">
                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#136b2a]">
                  Плюсы
                </div>
                <ul className="ml-4 list-disc space-y-0.5 text-[12px] text-[#3c4053]">
                  {m.pros.map((p, i) => (
                    <li key={i}>{p}</li>
                  ))}
                </ul>
                <div className="mt-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#a13a32]">
                  Минусы
                </div>
                <ul className="ml-4 list-disc space-y-0.5 text-[12px] text-[#3c4053]">
                  {m.cons.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              </div>
              {saving && active ? (
                <div className="inline-flex items-center gap-1.5 text-[11px] text-[#3848c7]">
                  <Loader2 className="size-3 animate-spin" />
                  Сохраняю...
                </div>
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="rounded-2xl border border-[#dcdfed] bg-[#fafbff] p-4 text-[13px] text-[#3c4053]">
        💡 Режим общий для всех журналов организации. Что именно делать в
        каждой задаче, по шагам, настраивается в разделе{" "}
        <Link
          href="/settings/journal-pipelines"
          className="font-medium text-[#3848c7] underline-offset-2 transition-colors hover:text-[#5566f6] hover:underline"
        >
          «Пошаговые инструкции журналов»
        </Link>
        .
      </div>
    </div>
  );
}
