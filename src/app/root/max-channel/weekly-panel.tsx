"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, ImageOff, Mail, Newspaper, RefreshCw, ShieldCheck, Sparkles, XCircle } from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { WeeklyIssueView, WeeklyView } from "@/lib/weekly-issue/service.server";

const CARD = "rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] md:p-6";
const BTN_SMALL =
  "inline-flex h-9 items-center gap-1.5 rounded-xl border border-[#dcdfed] bg-white px-3 text-[13px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 disabled:opacity-50";
const BTN_PRIMARY =
  "inline-flex h-9 items-center gap-1.5 rounded-xl bg-[#5566f6] px-3.5 text-[13px] font-semibold text-white shadow-[0_8px_20px_-10px_rgba(85,102,246,0.8)] transition-colors duration-150 hover:bg-[#4a5bf0] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 disabled:opacity-50";

const STATUS: Record<string, { label: string; tone: string }> = {
  queued: { label: "собираем факты", tone: "bg-[#f5f6ff] text-[#3848c7]" },
  text: { label: "ИИ пишет текст", tone: "bg-[#eef1ff] text-[#3848c7]" },
  image: { label: "ИИ рисует картинку", tone: "bg-[#eef1ff] text-[#3848c7]" },
  scheduled: { label: "запланирован", tone: "bg-[#ecfdf5] text-[#116b2a]" },
  review: { label: "ждёт согласования", tone: "bg-[#fff8eb] text-[#8a5a00]" },
  published: { label: "вышел", tone: "bg-[#ecfdf5] text-[#116b2a]" },
  failed: { label: "не собран", tone: "bg-[#fff4f2] text-[#a13a32]" },
  cancelled: { label: "отменён", tone: "bg-[#f4f4f8] text-[#6f7282]" },
};

const POST_STATUS: Record<string, string> = {
  scheduled: "ждёт времени",
  review: "на согласовании",
  sending: "отправляется",
  sent: "опубликован",
  failed: "ошибка",
  deleted: "удалён",
  draft: "черновик",
};

const VERDICT: Record<string, { label: string; tone: string }> = {
  ready: { label: "готов", tone: "bg-[#ecfdf5] text-[#116b2a] ring-[#bfe8cf]" },
  improve: { label: "можно лучше", tone: "bg-[#fff8eb] text-[#8a5a00] ring-[#f5d9a8]" },
  block: { label: "на согласование", tone: "bg-[#fff4f2] text-[#a13a32] ring-[#f3c9c3]" },
};

function emailLine(issue: WeeklyIssueView): string {
  const n = issue.email.recipients;
  const who = n === null ? "" : ` · ${n} ${plural(n, "получатель", "получателя", "получателей")}`;
  if (issue.email.status === "draft") return `Письмо подписанным клиентам${who} — уйдёт сразу после выхода поста`;
  if (issue.email.status === "sent") return `Письмо отправлено${who}`;
  if (issue.email.status === "skipped") return "Письмо не отправлено — пост не вышел";
  return "Письмо появится, когда выпуск соберётся";
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
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

async function callJson<T>(url: string, method: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || "Не получилось");
  return data;
}

function StatusPill({ status }: { status: string }) {
  const view = STATUS[status] ?? { label: status, tone: "bg-[#f4f4f8] text-[#6f7282]" };
  return <span className={cn("inline-flex rounded-full px-2.5 py-0.5 text-[12px] font-medium", view.tone)}>{view.label}</span>;
}

/**
 * «Еженедельный выпуск»: каждую среду в 09:00 — пост-напоминание в
 * Telegram и MAX и то же письмом подписанным клиентам. Собирается в
 * понедельник утром (или по кнопке); до выхода его видно здесь и в «Плане
 * публикаций», где пост можно поправить.
 */
export function WeeklyPanel({ initial }: { initial: WeeklyView }) {
  const router = useRouter();
  const [view, setView] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmRebuild, setConfirmRebuild] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [preview, setPreview] = useState<{ subject: string; html: string } | null>(null);
  const issue = view.current;
  const preparing = issue ? ["queued", "text", "image"].includes(issue.status) : false;
  const out = issue ? issue.status === "published" || issue.posts.some((p) => p.status === "sent" || p.status === "sending") : false;

  async function toggle() {
    setBusy("toggle");
    try {
      const data = await callJson<WeeklyView>("/api/root/max-channel/weekly", "PATCH", { enabled: !view.settings.enabled });
      setView(data);
      toast.success(data.settings.enabled ? "Еженедельный выпуск включён: собираем по понедельникам, выходит по средам в 09:00" : "Еженедельный выпуск выключен — новые не собираются");
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function build() {
    setBusy("build");
    try {
      const data = await callJson<WeeklyView & { rebuilt: boolean }>("/api/root/max-channel/weekly", "POST");
      setView(data);
      toast.success(data.rebuilt ? "Пересобираем выпуск: текст и картинка будут через несколько минут" : "Собираем выпуск: текст и картинка будут через несколько минут");
      router.refresh();
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function refresh() {
    setBusy("refresh");
    try {
      setView(await callJson<WeeklyView>("/api/root/max-channel/weekly", "GET"));
      router.refresh();
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function cancel() {
    if (!issue) return;
    setBusy("cancel");
    try {
      setView(await callJson<WeeklyView>(`/api/root/max-channel/weekly/${issue.id}`, "POST", { action: "cancel" }));
      toast.success("Выпуск отменён — на этой неделе он не выйдет");
      router.refresh();
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function openPreview() {
    if (!issue) return;
    setBusy("preview");
    try {
      setPreview(await callJson<{ subject: string; html: string }>(`/api/root/max-channel/weekly/${issue.id}/email-preview`, "GET"));
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const willRebuild = Boolean(issue && issue.weekKey === view.nextWeekKey && !out);

  return (
    <section className={CARD} data-weekly-issue>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="flex size-9 items-center justify-center rounded-xl bg-[#eef1ff] text-[#5566f6]">
              <Newspaper className="size-5" />
            </span>
            <h2 className="text-[18px] font-semibold text-[#0b1024]">Еженедельный выпуск</h2>
          </div>
          <p className="mt-2 max-w-[640px] text-[13.5px] leading-relaxed text-[#6f7282]">
            По средам в 09:00 — напоминание о сервисе в Telegram и MAX и то же письмом клиентам. Собирается в понедельник утром.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            role="switch"
            aria-checked={view.settings.enabled}
            disabled={busy !== null}
            onClick={toggle}
            className={cn(
              "inline-flex h-9 items-center gap-2 rounded-xl px-3 text-[13px] font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15",
              view.settings.enabled ? "border border-[#5566f6]/30 bg-[#eef1ff] text-[#3848c7] hover:bg-[#e4e8ff]" : "border border-[#dcdfed] bg-white text-[#0b1024] hover:bg-[#f5f6ff]",
            )}
          >
            <span className={cn("size-2 rounded-full", view.settings.enabled ? "bg-[#5566f6]" : "bg-[#9b9fb3]")} />
            {view.settings.enabled ? "Включён" : "Выключен"}
          </button>
          <button
            type="button"
            className={BTN_PRIMARY}
            disabled={busy !== null || !view.gatewayConfigured || preparing}
            onClick={() => (willRebuild ? setConfirmRebuild(true) : build())}
            title={`Выпуск на ${view.nextWeekTitle}, 09:00`}
          >
            {busy === "build" ? <RefreshCw className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
            Собрать выпуск на среду
          </button>
        </div>
      </div>

      {!view.gatewayConfigured ? (
        <div className="mt-4 rounded-2xl border border-[#f5d9a8] bg-[#fff8eb] px-4 py-3 text-[13px] text-[#8a5a00]">
          ИИ не подключён: на сервере не задан <code className="font-mono">CODEX_GATEWAY_TOKEN</code>. Пока его нет, выпуск не собирается.
        </div>
      ) : null}

      {!issue ? (
        <p className="mt-4 rounded-2xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-4 py-5 text-center text-[13px] text-[#6f7282]">
          {view.settings.enabled
            ? `Выпуск на ${view.nextWeekTitle} соберётся в понедельник в 08:00. Нужен раньше — нажмите «Собрать выпуск на среду».`
            : "Еженедельный выпуск выключен. Собрать его можно и вручную — кнопкой выше."}
        </p>
      ) : (
        <IssueCard
          issue={issue}
          busy={busy}
          preparing={preparing}
          out={out}
          onPreview={openPreview}
          onRefresh={refresh}
          onCancel={() => setConfirmCancel(true)}
        />
      )}

      {view.past.length > 0 ? (
        <details className="mt-5">
          <summary className="cursor-pointer text-[13px] font-medium text-[#3848c7]">Прошлые выпуски ({view.past.length})</summary>
          <ul className="mt-3 space-y-2">
            {view.past.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center gap-2 rounded-2xl border border-[#ececf4] px-4 py-2.5 text-[13px]">
                <span className="tabular-nums text-[#6f7282]">{item.weekKey}</span>
                <span className="font-medium text-[#0b1024]">{item.subject ?? "—"}</span>
                <StatusPill status={item.status} />
                {item.qualityScore !== null ? <span className="text-[#6f7282]">{item.qualityScore}/100</span> : null}
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
        open={confirmRebuild}
        onClose={() => setConfirmRebuild(false)}
        onConfirm={async () => {
          setConfirmRebuild(false);
          await build();
        }}
        icon={RefreshCw}
        variant="warn"
        title="Пересобрать выпуск?"
        description={`Выпуск на ${view.nextWeekTitle} соберётся заново.`}
        bullets={[
          { label: "Текст и картинку ИИ напишет заново — правки в «Плане публикаций» пропадут" },
          { label: "Факты возьмём свежие: изменения сайта, акции, праздники", tone: "info" },
        ]}
        cancelLabel="Оставить"
        confirmLabel="Пересобрать"
      />
      <ConfirmDialog
        open={confirmCancel}
        onClose={() => setConfirmCancel(false)}
        onConfirm={async () => {
          setConfirmCancel(false);
          await cancel();
        }}
        icon={XCircle}
        variant="warn"
        title="Отменить выпуск?"
        description={issue ? `Выпуск на ${issue.weekTitle}, 09:00.` : ""}
        bullets={[
          { label: "Пост не выйдет ни в Telegram, ни в MAX, письмо не уйдёт" },
          { label: "Собрать заново можно кнопкой «Собрать выпуск на среду»", tone: "info" },
        ]}
        cancelLabel="Оставить"
        confirmLabel="Отменить выпуск"
      />
      <Dialog open={preview !== null} onOpenChange={(open) => !open && setPreview(null)}>
        <DialogContent className="max-h-[92dvh] overflow-hidden p-0 sm:max-w-[720px]">
          <DialogHeader className="border-b border-[#ececf4] px-5 py-4">
            <DialogTitle className="text-[16px]">Письмо выпуска</DialogTitle>
            <DialogDescription className="text-[13px]">Тема: {preview?.subject} · пример получателя: Иван Петров, Кафе «Ромашка»</DialogDescription>
          </DialogHeader>
          {preview ? <iframe title="Превью письма" srcDoc={preview.html} sandbox="" className="h-[72dvh] w-full bg-[#f4f6ff]" /> : null}
        </DialogContent>
      </Dialog>
    </section>
  );
}

function IssueCard({
  issue,
  busy,
  preparing,
  out,
  onPreview,
  onRefresh,
  onCancel,
}: {
  issue: WeeklyIssueView;
  busy: string | null;
  preparing: boolean;
  out: boolean;
  onPreview: () => void;
  onRefresh: () => void;
  onCancel: () => void;
}) {
  const verdict = issue.qualityVerdict ? VERDICT[issue.qualityVerdict] : null;
  const facts = issue.facts;
  return (
    <div className="mt-5 grid gap-5 overflow-hidden rounded-3xl border border-[#ececf4] bg-[#fafbff] md:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
      <div className="relative aspect-[4/3] bg-[#eef1ff] md:aspect-auto md:min-h-[320px]">
        {issue.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- загруженная картинка поста, как в превью канала
          <img src={issue.imageUrl} alt="Картинка выпуска" className="size-full object-cover" />
        ) : (
          <div className="flex size-full flex-col items-center justify-center gap-2 text-[13px] text-[#6f7282]">
            {preparing ? <RefreshCw className="size-5 animate-spin text-[#5566f6]" /> : <ImageOff className="size-5" />}
            {preparing ? "Картинка ещё готовится" : "Без картинки"}
          </div>
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-3 p-4 md:py-5 md:pr-5 md:pl-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[14px] font-semibold text-[#0b1024] first-letter:uppercase">{issue.weekTitle}, 09:00</span>
          <StatusPill status={issue.status} />
          {issue.qualityScore !== null ? (
            <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[12px] font-semibold ring-1", verdict?.tone ?? "bg-white text-[#0b1024] ring-[#dcdfed]")}>
              <ShieldCheck className="size-3.5" /> {issue.qualityScore}/100 · {verdict?.label ?? issue.qualityVerdict}
            </span>
          ) : null}
        </div>
        {issue.subject ? <div className="text-[12.5px] text-[#6f7282]">Тема письма: <span className="text-[#0b1024]">{issue.subject}</span></div> : null}
        {issue.text ? (
          <div className="rounded-2xl bg-white p-4 text-[13.5px] leading-relaxed text-[#0b1024] ring-1 ring-[#ececf4]">{renderText(issue.text)}</div>
        ) : (
          <p className="text-[13px] text-[#9b9fb3]">{preparing ? "ИИ собирает факты и пишет текст — обычно это несколько минут." : "Текста нет."}</p>
        )}
        {issue.buttonUrl ? (
          <a href={issue.buttonUrl} target="_blank" rel="noreferrer" className="inline-flex w-fit items-center gap-1 rounded-xl bg-white px-3 py-1.5 text-[12.5px] font-medium text-[#3848c7] ring-1 ring-[#dcdfed] hover:bg-[#f5f6ff]">
            Кнопка: {issue.buttonText} <ExternalLink className="size-3" />
          </a>
        ) : null}
        {issue.status === "review" ? (
          <p className="rounded-2xl border border-[#f5d9a8] bg-[#fff8eb] px-3 py-2 text-[12.5px] text-[#8a5a00]">
            Проверка качества не пропустила пост: сам он не выйдет. Поправьте и утвердите его в «Плане публикаций» ниже.
          </p>
        ) : null}
        {issue.error ? <p className="text-[12.5px] text-[#a13a32]">{issue.error}</p> : null}
        {issue.posts.length > 0 ? (
          <div className="flex flex-wrap gap-1.5 text-[12px] text-[#6f7282]">
            {issue.posts.map((post) => (
              <span key={post.id} className="rounded-full bg-white px-2 py-0.5 ring-1 ring-[#ececf4]">
                {post.platform === "telegram" ? "Telegram" : "MAX"}: {POST_STATUS[post.status] ?? post.status}
              </span>
            ))}
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-white px-3 py-2 text-[12.5px] text-[#0b1024] ring-1 ring-[#ececf4]">
          <Mail className="size-4 shrink-0 text-[#5566f6]" />
          <span className="min-w-0 flex-1">{emailLine(issue)}</span>
          {issue.email.campaignId ? (
            <button type="button" className={BTN_SMALL} disabled={busy !== null} onClick={onPreview}>
              {busy === "preview" ? <RefreshCw className="size-3.5 animate-spin" /> : <Mail className="size-3.5" />} Превью письма
            </button>
          ) : null}
        </div>
        {facts ? (
          <details className="text-[12.5px] text-[#6f7282]">
            <summary className="cursor-pointer font-medium text-[#3848c7]">Из чего собран выпуск</summary>
            <div className="mt-2 space-y-2">
              <FactList title="Изменения сайта за неделю" items={facts.changes} empty={facts.changesSource === "github" ? "нет заметных" : "история изменений недоступна"} />
              <FactList title="Новое в «Что нового»" items={facts.changelog} empty="нет" />
              <FactList title="Статьи блога" items={facts.articles.map((a) => a.title)} empty="нет" />
              <FactList title="Акции" items={facts.promotions.map((p) => `${p.title} — ${p.percent}% до ${p.until}`)} empty="нет" />
              <FactList title="Посты в канале на две недели" items={facts.upcomingPosts.map((p) => `${p.date}: ${p.title}`)} empty="нет" />
              <FactList title="Праздники и поводы" items={facts.occasions.map((o) => `${o.dateKey}: ${o.title}`)} empty="нет" />
            </div>
          </details>
        ) : null}
        <div className="mt-auto flex flex-wrap gap-1.5 pt-1">
          {preparing ? (
            <button type="button" className={BTN_SMALL} disabled={busy !== null} onClick={onRefresh}>
              <RefreshCw className={cn("size-3.5", busy === "refresh" && "animate-spin")} /> Обновить
            </button>
          ) : null}
          {!out && issue.status !== "cancelled" ? (
            <button type="button" className={cn(BTN_SMALL, "text-[#a13a32] hover:border-[#a13a32]/40 hover:bg-[#fff4f2]")} disabled={busy !== null} onClick={onCancel}>
              <XCircle className="size-3.5" /> Отменить выпуск
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function FactList({ title, items, empty }: { title: string; items: string[]; empty: string }) {
  return (
    <div>
      <div className="font-medium text-[#0b1024]">{title}</div>
      {items.length ? (
        <ul className="mt-0.5 list-disc space-y-0.5 pl-5">
          {items.slice(0, 8).map((item, i) => (
            <li key={i}>{item}</li>
          ))}
          {items.length > 8 ? <li>…и ещё {items.length - 8}</li> : null}
        </ul>
      ) : (
        <div>— {empty}</div>
      )}
    </div>
  );
}
