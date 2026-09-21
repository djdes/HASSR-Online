"use client";

import { CalendarDays, Copy, KeyRound, Link2Off, RefreshCw, ShieldAlert } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { CalendarEventKind } from "@/lib/calendar/ics";

export type CalendarPreviewGroup = {
  kind: CalendarEventKind;
  label: string;
  total: number;
  overdue: number;
  upcoming: Array<{ date: string; title: string }>;
};

const CARD = "rounded-3xl border border-[#ececf4] bg-white p-6 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]";
const PRIMARY =
  "inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-[#5566f6] px-5 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors hover:bg-[#4a5bf0] disabled:opacity-60";
const SECONDARY =
  "inline-flex h-11 items-center justify-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] disabled:opacity-60";

const HOW_TO: Array<{ title: string; steps: string[] }> = [
  {
    title: "Google Календарь",
    steps: ["На компьютере: слева «Другие календари» → «+» → «По URL».", "Вставьте ссылку и нажмите «Добавить календарь».", "Google обновляет подписки сам, обычно раз в несколько часов, иногда до суток."],
  },
  {
    title: "iPhone и Mac",
    steps: ["iPhone: Настройки → Календарь → Учётные записи → Добавить → Другое → «Подписной календарь».", "Mac: Календарь → Файл → «Новая подписка на календарь».", "Вставьте ссылку; обновление — «Автоматически» или раз в день."],
  },
  {
    title: "Outlook",
    steps: ["Outlook в браузере: «Добавить календарь» → «Подписаться из Интернета».", "В программе Outlook: Календарь → «Открыть календарь» → «Из Интернета».", "Вставьте ссылку и задайте имя календаря."],
  },
];

function formatDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("ru-RU", { timeZone: "UTC", day: "2-digit", month: "2-digit", year: "numeric" });
}

export function CalendarClient({
  initialToken,
  initialUrl,
  groups,
  previewDays,
}: {
  initialToken: string | null;
  initialUrl: string | null;
  groups: CalendarPreviewGroup[];
  previewDays: number;
}) {
  const [url, setUrl] = useState<string | null>(initialUrl);
  const [hasToken, setHasToken] = useState(Boolean(initialToken));
  const [busy, setBusy] = useState(false);
  const [rotateOpen, setRotateOpen] = useState(false);
  const [revokeOpen, setRevokeOpen] = useState(false);

  async function rotate() {
    setBusy(true);
    try {
      const response = await fetch("/api/settings/calendar-token", { method: "POST" });
      const data = (await response.json().catch(() => null)) as { url?: string; error?: string } | null;
      if (!response.ok || !data?.url) throw new Error(data?.error ?? "Не удалось создать ссылку");
      setUrl(data.url);
      setHasToken(true);
      toast.success(hasToken ? "Ссылка перевыпущена — старая больше не работает" : "Ссылка создана");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ошибка");
    } finally {
      setBusy(false);
      setRotateOpen(false);
    }
  }

  async function revoke() {
    setBusy(true);
    try {
      const response = await fetch("/api/settings/calendar-token", { method: "DELETE" });
      if (!response.ok) throw new Error("Не удалось отключить");
      setUrl(null);
      setHasToken(false);
      toast.success("Ссылка отключена");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ошибка");
    } finally {
      setBusy(false);
      setRevokeOpen(false);
    }
  }

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Ссылка скопирована");
    } catch {
      toast.error("Не удалось скопировать — выделите ссылку вручную");
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
      <div className="space-y-6">
        <section className={CARD}>
          <div className="flex items-center gap-2 text-[15px] font-semibold text-[#0b1024]">
            <KeyRound className="size-4 text-[#5566f6]" />
            Ссылка на календарь
          </div>
          <p className="mt-1 text-[13px] leading-relaxed text-[#6f7282]">
            Добавьте её как подписной календарь — события появятся сами и будут обновляться. Ссылка личная и работает без входа в кабинет.
          </p>
          {url ? (
            <div className="mt-4 space-y-3">
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  readOnly
                  value={url}
                  data-testid="calendar-url"
                  onFocus={(e) => e.currentTarget.select()}
                  className="h-11 min-w-0 flex-1 rounded-2xl border border-[#dcdfed] bg-[#fafbff] px-4 font-mono text-[12.5px] text-[#0b1024] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
                />
                <button type="button" onClick={copy} className={PRIMARY}>
                  <Copy className="size-4" />
                  Скопировать
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => setRotateOpen(true)} disabled={busy} className={SECONDARY}>
                  <RefreshCw className="size-4 text-[#5566f6]" />
                  Перевыпустить
                </button>
                <button type="button" onClick={() => setRevokeOpen(true)} disabled={busy} className={SECONDARY}>
                  <Link2Off className="size-4 text-[#a13a32]" />
                  Отключить
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-4">
              <button type="button" onClick={() => void rotate()} disabled={busy} className={PRIMARY}>
                <CalendarDays className="size-4" />
                {busy ? "Создаём…" : "Создать ссылку"}
              </button>
            </div>
          )}
          <div className="mt-4 flex items-start gap-2 rounded-2xl bg-[#fff8eb] px-3.5 py-3 text-[12.5px] leading-relaxed text-[#b25f00]">
            <ShieldAlert className="mt-0.5 size-4 shrink-0" />
            <span>
              Ссылка — как пароль: у кого она есть, тот видит сроки медкнижек сотрудников. Не публикуйте её. Утекла — нажмите «Перевыпустить».
            </span>
          </div>
        </section>

        <section className={CARD}>
          <div className="text-[15px] font-semibold text-[#0b1024]">Как подключить</div>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            {HOW_TO.map((item) => (
              <div key={item.title} className="rounded-2xl border border-[#ececf4] bg-[#fafbff] p-4">
                <div className="text-[13.5px] font-semibold text-[#0b1024]">{item.title}</div>
                <ol className="mt-2 list-decimal space-y-1.5 pl-4 text-[12.5px] leading-relaxed text-[#3c4053]">
                  {item.steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
        </section>
      </div>

      <aside className="space-y-6">
        <section className={CARD}>
          <div className="flex items-center gap-2 text-[15px] font-semibold text-[#0b1024]">
            <CalendarDays className="size-4 text-[#5566f6]" />
            Что попадёт в календарь
          </div>
          <p className="mt-1 text-[13px] leading-relaxed text-[#6f7282]">
            Ближайшие {previewDays} дней по разделам. Все события — на весь день, без времени.
          </p>
          {groups.length === 0 ? (
            <div className="mt-4 rounded-2xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-4 py-8 text-center">
              <div className="text-[14px] font-medium text-[#0b1024]">Пока событий нет</div>
              <p className="mx-auto mt-1.5 max-w-[320px] text-[12.5px] text-[#6f7282]">
                Появятся, когда заполните журнал медкнижек, поверок, добавите допуски сотрудникам, партии или задачи CAPA со сроком.
              </p>
            </div>
          ) : (
            <ul className="mt-4 space-y-4">
              {groups.map((group) => (
                <li key={group.kind}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[13.5px] font-semibold text-[#0b1024]">{group.label}</span>
                    <span className="rounded-full bg-[#f5f6ff] px-2.5 py-1 text-[12px] tabular-nums text-[#3848c7]">
                      {group.total} за год{group.overdue > 0 ? ` · просрочено ${group.overdue}` : ""}
                    </span>
                  </div>
                  {group.upcoming.length > 0 ? (
                    <ul className="mt-2 space-y-1.5">
                      {group.upcoming.map((event, index) => (
                        // Дата + название не уникальны (две поверки одного
                        // прибора в день, одноимённые сотрудники) — React
                        // ругался «two children with the same key».
                        <li key={`${event.date}-${event.title}-${index}`} className="flex items-start gap-3 text-[13px] leading-snug">
                          <span className="shrink-0 tabular-nums text-[#6f7282]">{formatDay(event.date)}</span>
                          <span className="min-w-0 text-[#0b1024]">{event.title}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1.5 text-[12.5px] text-[#9b9fb3]">В ближайшие {previewDays} дней — ничего.</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </aside>

      <ConfirmDialog
        open={rotateOpen}
        onClose={() => setRotateOpen(false)}
        variant="warn"
        title="Перевыпустить ссылку?"
        description="Новая ссылка появится сразу, старую нужно будет заменить во всех календарях."
        bullets={[{ label: "Старая ссылка перестанет работать во всех календарях, где она добавлена" }, { label: "Новую нужно добавить заново" }]}
        confirmLabel="Перевыпустить"
        onConfirm={rotate}
        confirmDisabled={busy}
      />
      <ConfirmDialog
        open={revokeOpen}
        onClose={() => setRevokeOpen(false)}
        variant="danger"
        title="Отключить ссылку?"
        description="Календари, в которые она добавлена, перестанут обновляться."
        bullets={[{ label: "Ссылка перестанет открываться" }, { label: "Создать новую можно в любой момент" }]}
        confirmLabel="Отключить"
        onConfirm={revoke}
        confirmDisabled={busy}
      />
    </div>
  );
}
