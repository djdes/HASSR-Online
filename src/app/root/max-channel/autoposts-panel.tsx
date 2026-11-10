"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, ExternalLink, ImageOff, RefreshCw, Shuffle, Sparkles, XCircle } from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { cn } from "@/lib/utils";

export type AutopostItem = {
  id: string;
  dateKey: string;
  publishAt: string;
  topicTitle: string;
  status: string;
  text: string | null;
  imageUrl: string | null;
  buttonText: string | null;
  buttonUrl: string | null;
  error: string | null;
  posts: Array<{ id: string; status: string; url: string | null; platform: string }>;
};

export type AutopostSettingsView = { enabled: boolean; time: string; daysAhead: number };

const CARD = "rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] md:p-6";
const BTN_SMALL =
  "inline-flex h-9 items-center gap-1.5 rounded-xl border border-[#dcdfed] bg-white px-3 text-[13px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 disabled:opacity-50";

const STATUS: Record<string, { label: string; tone: string }> = {
  queued: { label: "в очереди", tone: "bg-[#f5f6ff] text-[#3848c7]" },
  text: { label: "ИИ пишет текст", tone: "bg-[#eef1ff] text-[#3848c7]" },
  image: { label: "ИИ рисует фото", tone: "bg-[#eef1ff] text-[#3848c7]" },
  scheduled: { label: "запланирован", tone: "bg-[#ecfdf5] text-[#116b2a]" },
  failed: { label: "не подготовлен", tone: "bg-[#fff4f2] text-[#a13a32]" },
  cancelled: { label: "отменён", tone: "bg-[#f4f4f8] text-[#6f7282]" },
};

const POST_STATUS: Record<string, string> = {
  scheduled: "ждёт времени",
  sending: "отправляется",
  sent: "опубликован",
  failed: "ошибка",
  deleted: "удалён",
  draft: "черновик",
};

function dayTitle(dateKey: string, time: string): string {
  const date = new Date(`${dateKey}T12:00:00Z`);
  const label = new Intl.DateTimeFormat("ru-RU", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(date);
  return `${label}, ${time}`;
}

/** **жирный** — как в канале. */
function renderText(text: string): ReactNode[] {
  return text.split("\n").map((line, i) => (
    <span key={i} className="block min-h-[1em]">
      {line.split(/(\*\*[^*]+\*\*)/g).map((part, j) =>
        part.startsWith("**") && part.endsWith("**") ? <strong key={j}>{part.slice(2, -2)}</strong> : <span key={j}>{part}</span>,
      )}
    </span>
  ));
}

async function callJson<T>(url: string, method: string, body: unknown): Promise<T> {
  const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || "Не получилось");
  return data;
}

/**
 * «Автопосты»: каждый день в 10:00 — пост с фото во все каналы. Тему
 * берём из материалов сайта, текст и фото пишет ИИ (шлюз ProjectsFlow)
 * заранее, за несколько дней, — успеваете посмотреть и поправить.
 */
export function AutopostsPanel({
  initialItems,
  initialSettings,
  gatewayConfigured,
}: {
  initialItems: AutopostItem[];
  initialSettings: AutopostSettingsView;
  gatewayConfigured: boolean;
}) {
  const router = useRouter();
  const [items, setItems] = useState(initialItems);
  const [settings, setSettings] = useState(initialSettings);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState<AutopostItem | null>(null);

  async function patch(next: Partial<AutopostSettingsView>) {
    setBusy("settings");
    try {
      const data = await callJson<{ settings: AutopostSettingsView; items: AutopostItem[] }>("/api/root/max-channel/autoposts", "PATCH", next);
      setSettings(data.settings);
      setItems(data.items);
      toast.success(data.settings.enabled ? `Автопосты включены: каждый день в ${data.settings.time}` : "Автопосты выключены — новые не создаются");
      router.refresh();
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function act(item: AutopostItem, action: "regenerate" | "new-topic" | "cancel") {
    setBusy(`${action}-${item.id}`);
    try {
      const data = await callJson<{ items: AutopostItem[] }>(`/api/root/max-channel/autoposts/${item.id}`, "POST", { action });
      setItems(data.items);
      toast.success(
        action === "cancel"
          ? "Автопост отменён — в этот день он не выйдет"
          : "Готовим заново: текст и фото будут через несколько минут",
      );
      router.refresh();
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const upcoming = items.filter((item) => item.publishAt >= new Date(Date.now() - 12 * 3600_000).toISOString());
  const past = items.filter((item) => !upcoming.includes(item));

  return (
    <section className={CARD} data-autoposts>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="flex size-9 items-center justify-center rounded-xl bg-[#eef1ff] text-[#5566f6]">
              <Sparkles className="size-5" />
            </span>
            <h2 className="text-[18px] font-semibold text-[#0b1024]">Автопосты каждый день</h2>
          </div>
          <p className="mt-2 max-w-[640px] text-[13.5px] leading-relaxed text-[#6f7282]">
            Каждый день в {settings.time} по Москве — одинаковый пост с фото в Telegram и MAX. Тема — из материалов сайта:
            журналы, возможности WeSetup, термины ХАССП; кнопка ведёт на нашу страницу. Текст и фото пишет ИИ за {settings.daysAhead}{" "}
            дн. до выхода — здесь их видно заранее, а в «Плане публикаций» любой пост можно поправить или удалить.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex h-9 items-center gap-2 rounded-xl border border-[#dcdfed] bg-white px-3 text-[13px] text-[#0b1024]">
            <CalendarClock className="size-4 text-[#5566f6]" />
            <span>Время</span>
            <input
              type="time"
              value={settings.time}
              disabled={busy !== null}
              onChange={(event) => setSettings({ ...settings, time: event.target.value })}
              onBlur={(event) => event.target.value !== initialSettings.time && patch({ time: event.target.value })}
              className="w-[74px] bg-transparent tabular-nums focus:outline-none"
              aria-label="Время публикации по Москве"
            />
          </label>
          <button
            type="button"
            role="switch"
            aria-checked={settings.enabled}
            disabled={busy !== null}
            onClick={() => patch({ enabled: !settings.enabled })}
            className={cn(
              "inline-flex h-9 items-center gap-2 rounded-xl px-3 text-[13px] font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15",
              settings.enabled ? "bg-[#5566f6] text-white hover:bg-[#4a5bf0]" : "border border-[#dcdfed] bg-white text-[#0b1024] hover:bg-[#f5f6ff]",
            )}
          >
            <span className={cn("size-2 rounded-full", settings.enabled ? "bg-white" : "bg-[#9b9fb3]")} />
            {settings.enabled ? "Включены" : "Выключены"}
          </button>
        </div>
      </div>

      {!gatewayConfigured ? (
        <div className="mt-4 rounded-2xl border border-[#f5d9a8] bg-[#fff8eb] px-4 py-3 text-[13px] text-[#8a5a00]">
          ИИ не подключён: на сервере не задан <code className="font-mono">CODEX_GATEWAY_TOKEN</code> (токен агента ProjectsFlow со scope
          «account»: Профиль → «Доступ для агентов»). Пока его нет, автопосты не готовятся.
        </div>
      ) : null}

      {upcoming.length === 0 ? (
        <p className="mt-4 rounded-2xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-4 py-5 text-center text-[13px] text-[#6f7282]">
          {settings.enabled
            ? "Ближайшие автопосты появятся здесь в течение минуты: крон заводит их на несколько дней вперёд."
            : "Автопосты выключены. Включите — и на ближайшие дни появятся посты с темами."}
        </p>
      ) : (
        <ul className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {upcoming
            .slice()
            .sort((a, b) => a.dateKey.localeCompare(b.dateKey))
            .map((item) => (
              <AutopostCard
                key={item.id}
                item={item}
                time={settings.time}
                busy={busy}
                onRegenerate={() => act(item, "regenerate")}
                onNewTopic={() => act(item, "new-topic")}
                onCancel={() => setConfirmCancel(item)}
              />
            ))}
        </ul>
      )}

      {past.length > 0 ? (
        <details className="mt-5">
          <summary className="cursor-pointer text-[13px] font-medium text-[#3848c7]">Вышедшие за неделю ({past.length})</summary>
          <ul className="mt-3 space-y-2">
            {past.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center gap-2 rounded-2xl border border-[#ececf4] px-4 py-2.5 text-[13px]">
                <span className="tabular-nums text-[#6f7282]">{item.dateKey}</span>
                <span className="font-medium text-[#0b1024]">{item.topicTitle}</span>
                <StatusPill status={item.status} />
                {item.posts.map((post) =>
                  post.url ? (
                    <a key={post.id} href={post.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[#3848c7] hover:underline">
                      {post.platform === "telegram" ? "Telegram" : "MAX"} <ExternalLink className="size-3" />
                    </a>
                  ) : null,
                )}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <ConfirmDialog
        open={confirmCancel !== null}
        onClose={() => setConfirmCancel(null)}
        onConfirm={async () => {
          if (confirmCancel) await act(confirmCancel, "cancel");
          setConfirmCancel(null);
        }}
        icon={XCircle}
        variant="warn"
        title="Отменить автопост?"
        description={confirmCancel ? `«${confirmCancel.topicTitle}» на ${dayTitle(confirmCancel.dateKey, settings.time)}.` : ""}
        bullets={[
          { label: "Пост не выйдет ни в Telegram, ни в MAX" },
          { label: "Новый на этот день не создастся — опубликуйте вручную, если нужно", tone: "info" },
        ]}
        cancelLabel="Оставить"
        confirmLabel="Отменить пост"
      />
    </section>
  );
}

function StatusPill({ status }: { status: string }) {
  const view = STATUS[status] ?? { label: status, tone: "bg-[#f4f4f8] text-[#6f7282]" };
  return <span className={cn("inline-flex rounded-full px-2.5 py-0.5 text-[12px] font-medium", view.tone)}>{view.label}</span>;
}

function AutopostCard({
  item,
  time,
  busy,
  onRegenerate,
  onNewTopic,
  onCancel,
}: {
  item: AutopostItem;
  time: string;
  busy: string | null;
  onRegenerate: () => void;
  onNewTopic: () => void;
  onCancel: () => void;
}) {
  const preparing = item.status === "queued" || item.status === "text" || item.status === "image";
  const published = item.posts.some((post) => post.status === "sent" || post.status === "sending");
  const editable = !published && item.status !== "cancelled";
  return (
    <li className="flex flex-col overflow-hidden rounded-3xl border border-[#ececf4] bg-[#fafbff]">
      <div className="relative aspect-[4/3] bg-[#eef1ff]">
        {item.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- загруженная картинка поста, как в превью канала
          <img src={item.imageUrl} alt={`Фото к посту «${item.topicTitle}»`} className="size-full object-cover" />
        ) : (
          <div className="flex size-full flex-col items-center justify-center gap-2 text-[13px] text-[#6f7282]">
            {preparing ? <RefreshCw className="size-5 animate-spin text-[#5566f6]" /> : <ImageOff className="size-5" />}
            {preparing ? "Фото ещё готовится" : "Без фото"}
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[12.5px] font-semibold text-[#0b1024] first-letter:uppercase">{dayTitle(item.dateKey, time)}</span>
          <StatusPill status={item.status} />
        </div>
        <div className="text-[12.5px] text-[#6f7282]">Тема: {item.topicTitle}</div>
        {item.text ? (
          <div className="text-[13.5px] leading-relaxed text-[#0b1024]">{renderText(item.text)}</div>
        ) : (
          <p className="text-[13px] text-[#9b9fb3]">{preparing ? "ИИ готовит текст — обычно это несколько минут." : "Текста нет."}</p>
        )}
        {item.buttonUrl ? (
          <a
            href={item.buttonUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex w-fit items-center gap-1 rounded-xl bg-white px-3 py-1.5 text-[12.5px] font-medium text-[#3848c7] ring-1 ring-[#dcdfed] hover:bg-[#f5f6ff]"
          >
            Кнопка: {item.buttonText} <ExternalLink className="size-3" />
          </a>
        ) : null}
        {item.error ? <p className="text-[12.5px] text-[#a13a32]">{item.error}</p> : null}
        {item.posts.length > 0 ? (
          <div className="flex flex-wrap gap-1.5 text-[12px] text-[#6f7282]">
            {item.posts.map((post) => (
              <span key={post.id} className="rounded-full bg-white px-2 py-0.5 ring-1 ring-[#ececf4]">
                {post.platform === "telegram" ? "Telegram" : "MAX"}: {POST_STATUS[post.status] ?? post.status}
              </span>
            ))}
          </div>
        ) : null}
        {editable ? (
          <div className="mt-auto flex flex-wrap gap-1.5 pt-2">
            <button type="button" className={BTN_SMALL} disabled={busy !== null || preparing} onClick={onRegenerate} title="Та же тема — новые текст и фото">
              <RefreshCw className="size-3.5" /> Переписать
            </button>
            <button type="button" className={BTN_SMALL} disabled={busy !== null || preparing} onClick={onNewTopic} title="Другая тема из материалов сайта">
              <Shuffle className="size-3.5" /> Другая тема
            </button>
            <button type="button" className={cn(BTN_SMALL, "text-[#a13a32] hover:border-[#a13a32]/40 hover:bg-[#fff4f2]")} disabled={busy !== null} onClick={onCancel}>
              <XCircle className="size-3.5" /> Отменить
            </button>
          </div>
        ) : null}
      </div>
    </li>
  );
}
