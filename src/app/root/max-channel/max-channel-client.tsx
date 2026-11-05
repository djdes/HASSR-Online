"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Bold,
  CalendarClock,
  CheckCircle2,
  ExternalLink,
  ImagePlus,
  Italic,
  Link2,
  Loader2,
  Pencil,
  RefreshCw,
  Save,
  Send,
  Sparkles,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  MAX_POST_IMAGES_LIMIT,
  MAX_POST_STATUS_LABELS,
  MAX_POST_TEMPLATES,
  MAX_POST_TEXT_LIMIT,
  defaultCampaign,
  type MaxPostStatus,
} from "@/lib/max/channel-post";
import { cn } from "@/lib/utils";

export type ChannelView = {
  id: string;
  chatId: string;
  title: string;
  link: string | null;
  botIsAdmin: boolean;
  removed: boolean;
  announceBlog: boolean;
};

export type PostView = {
  id: string;
  channelId: string;
  text: string;
  images: string[];
  buttonText: string | null;
  buttonUrl: string | null;
  campaign: string | null;
  status: MaxPostStatus;
  scheduledAt: string | null;
  sentAt: string | null;
  url: string | null;
  error: string | null;
  source: string;
  createdAt: string;
};

type Props = {
  bot: { name: string; username: string } | null;
  tokenConfigured: boolean;
  separateBot: boolean;
  channels: ChannelView[];
  posts: PostView[];
  articles: Array<{ slug: string; title: string; excerpt: string }>;
};

type Draft = {
  editingId: string | null;
  editingStatus: MaxPostStatus | null;
  channelId: string;
  text: string;
  images: string[];
  buttonText: string;
  buttonUrl: string;
  campaign: string;
  scheduledAt: string;
};

const CARD = "rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)] md:p-6";
const SECTION_LABEL = "mb-3 text-[12px] font-semibold uppercase tracking-[0.16em] text-[#6f7282]";
const INPUT =
  "h-11 w-full rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] text-[#0b1024] placeholder:text-[#9b9fb3] transition-colors duration-150 focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15";
const BTN_PRIMARY =
  "inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-[#5566f6] px-5 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors duration-150 hover:bg-[#4a5bf0] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 disabled:cursor-not-allowed disabled:opacity-50";
const BTN_OUTLINE =
  "inline-flex h-11 items-center justify-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15 disabled:cursor-not-allowed disabled:opacity-50";
const BTN_SMALL =
  "inline-flex h-9 items-center gap-1.5 rounded-xl border border-[#dcdfed] bg-white px-3 text-[13px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] disabled:opacity-50";

const STATUS_TONE: Record<MaxPostStatus, string> = {
  draft: "bg-[#f5f6ff] text-[#3848c7]",
  scheduled: "bg-[#eef1ff] text-[#3848c7]",
  sending: "bg-[#eef1ff] text-[#3848c7]",
  sent: "bg-[#ecfdf5] text-[#116b2a]",
  failed: "bg-[#fff4f2] text-[#a13a32]",
  deleted: "bg-[#f4f4f8] text-[#6f7282]",
};

function emptyDraft(channelId: string): Draft {
  return {
    editingId: null,
    editingStatus: null,
    channelId,
    text: "",
    images: [],
    buttonText: "",
    buttonUrl: "",
    campaign: defaultCampaign(),
    scheduledAt: "",
  };
}

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatWhen(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
}

async function callJson(url: string, method: string, body?: unknown): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "Не получилось — повторите позже.");
  return data;
}

export function MaxChannelClient({ bot, tokenConfigured, separateBot, channels, posts, articles }: Props) {
  const router = useRouter();
  const usable = channels.filter((channel) => !channel.removed);
  const defaultChannelId = usable[0]?.id ?? "";
  const [draft, setDraft] = useState<Draft>(() => emptyDraft(defaultChannelId));
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<null | { kind: "publish" } | { kind: "delete"; post: PostView }>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  const channelId = draft.channelId || defaultChannelId;
  const channel = usable.find((item) => item.id === channelId) ?? null;
  const editingSent = draft.editingStatus === "sent";

  function patch(next: Partial<Draft>) {
    setDraft((current) => ({ ...current, ...next }));
  }

  function applyTemplate(template: { text: string; buttonText: string; buttonUrl: string; campaign: string }) {
    patch({ text: template.text, buttonText: template.buttonText, buttonUrl: template.buttonUrl, campaign: template.campaign });
    textRef.current?.focus();
  }

  function wrapSelection(before: string, after = before, placeholder = "текст") {
    const area = textRef.current;
    if (!area) return;
    const { selectionStart: start, selectionEnd: end, value } = area;
    const selected = value.slice(start, end) || placeholder;
    const next = value.slice(0, start) + before + selected + after + value.slice(end);
    patch({ text: next });
    requestAnimationFrame(() => {
      area.focus();
      area.setSelectionRange(start + before.length, start + before.length + selected.length);
    });
  }

  async function uploadImages(files: FileList | null) {
    if (!files?.length) return;
    const room = MAX_POST_IMAGES_LIMIT - draft.images.length;
    if (room <= 0) {
      toast.error(`Не больше ${MAX_POST_IMAGES_LIMIT} картинок в посте`);
      return;
    }
    setBusy("upload");
    try {
      const added: string[] = [];
      for (const file of Array.from(files).slice(0, room)) {
        const form = new FormData();
        form.append("file", file);
        const response = await fetch("/api/root/max-channel/images", { method: "POST", body: form });
        const data = (await response.json().catch(() => ({}))) as { path?: string; error?: string };
        if (!response.ok || !data.path) throw new Error(data.error ?? "Картинка не загрузилась");
        added.push(data.path);
      }
      setDraft((current) => ({ ...current, images: [...current.images, ...added] }));
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(null);
    }
  }

  function payload(action?: "draft" | "schedule" | "publish") {
    return {
      ...(action ? { action } : {}),
      channelId,
      text: draft.text,
      images: draft.images,
      buttonText: draft.buttonText || null,
      buttonUrl: draft.buttonUrl || null,
      campaign: draft.campaign || null,
      scheduledAt: action === "schedule" && draft.scheduledAt ? new Date(draft.scheduledAt).toISOString() : null,
    };
  }

  async function submit(action: "draft" | "schedule" | "publish") {
    if (action === "schedule" && !draft.scheduledAt) {
      toast.error("Выберите дату и время публикации");
      return;
    }
    setBusy(action);
    try {
      if (draft.editingId) {
        await callJson(`/api/root/max-channel/posts/${draft.editingId}`, "PATCH", {
          ...payload(),
          scheduledAt: action === "schedule" ? new Date(draft.scheduledAt).toISOString() : null,
        });
        if (action === "publish" && !editingSent) {
          await callJson(`/api/root/max-channel/posts/${draft.editingId}/publish`, "POST");
        }
      } else {
        await callJson("/api/root/max-channel/posts", "POST", payload(action));
      }
      toast.success(
        editingSent
          ? "Пост изменён в канале"
          : action === "publish"
            ? "Пост опубликован в канале"
            : action === "schedule"
              ? `Пост выйдет ${formatWhen(new Date(draft.scheduledAt).toISOString())}`
              : "Черновик сохранён",
      );
      setDraft(emptyDraft(channelId));
      router.refresh();
    } catch (error) {
      toast.error((error as Error).message);
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  function startEdit(post: PostView) {
    setDraft({
      editingId: post.id,
      editingStatus: post.status,
      channelId: post.channelId,
      text: post.text,
      images: post.images,
      buttonText: post.buttonText ?? "",
      buttonUrl: post.buttonUrl ?? "",
      campaign: post.campaign ?? "",
      scheduledAt: post.status === "scheduled" ? toLocalInput(post.scheduledAt) : "",
    });
    composerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function publishExisting(post: PostView) {
    setBusy(`publish-${post.id}`);
    try {
      await callJson(`/api/root/max-channel/posts/${post.id}/publish`, "POST");
      toast.success("Пост опубликован в канале");
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(null);
      router.refresh();
    }
  }

  async function removePost(post: PostView) {
    setBusy(`delete-${post.id}`);
    try {
      const data = await callJson(`/api/root/max-channel/posts/${post.id}`, "DELETE");
      toast.success(data.removedFromChannel ? "Пост удалён из канала" : "Пост удалён");
      if (draft.editingId === post.id) setDraft(emptyDraft(channelId));
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(null);
      router.refresh();
    }
  }

  async function discover() {
    setBusy("discover");
    try {
      const data = await callJson("/api/root/max-channel/channels", "POST", { action: "discover" });
      const found = Number(data.found ?? 0);
      toast.success(found ? `Найдено событий о каналах: ${found}` : "Список каналов обновлён");
      router.refresh();
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function toggleAnnounce(item: ChannelView) {
    setBusy(`announce-${item.id}`);
    try {
      await callJson(`/api/root/max-channel/channels/${item.id}`, "PATCH", { announceBlog: !item.announceBlog });
      toast.success(item.announceBlog ? "Автоанонс статей выключен" : "Новые статьи блога будут выходить в канале");
      router.refresh();
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const textLength = draft.text.length;
  const canSubmit = Boolean(channel) && draft.text.trim().length > 0 && textLength <= MAX_POST_TEXT_LIMIT && !busy;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[26px] font-semibold tracking-[-0.02em] text-[#0b1024]">Канал MAX</h1>
        <p className="mt-1 text-[14px] text-[#6f7282]">
          Посты для продвижения WeSetup в канале мессенджера MAX: сразу, по расписанию или черновиком. Ссылки на wesetup.ru
          получают UTM-метки — переходы видно в Метрике.
        </p>
      </div>

      <ConnectionCard
        bot={bot}
        tokenConfigured={tokenConfigured}
        separateBot={separateBot}
        channels={channels}
        busy={busy}
        onDiscover={discover}
        onToggleAnnounce={toggleAnnounce}
      />

      <div ref={composerRef} className="grid scroll-mt-6 gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <section className={CARD}>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <div className={cn(SECTION_LABEL, "mb-0")}>
              {draft.editingId ? (editingSent ? "Правка опубликованного поста" : "Правка поста") : "Новый пост"}
            </div>
            {draft.editingId ? (
              <button type="button" className={BTN_SMALL} onClick={() => setDraft(emptyDraft(channelId))}>
                <X className="size-4" /> Отменить правку
              </button>
            ) : null}
          </div>

          {!draft.editingId ? (
            <div className="mb-5">
              <div className="mb-2 flex items-center gap-1.5 text-[13px] text-[#6f7282]">
                <Sparkles className="size-4 text-[#5566f6]" /> Начать с шаблона — текст можно править
              </div>
              <div className="flex flex-wrap gap-2">
                {MAX_POST_TEMPLATES.map((template) => (
                  <button
                    key={template.key}
                    type="button"
                    onClick={() => applyTemplate(template)}
                    className="rounded-full bg-[#f5f6ff] px-3 py-1.5 text-[13px] text-[#3848c7] transition-colors duration-150 hover:bg-[#eef1ff]"
                  >
                    {template.title}
                  </button>
                ))}
                {articles.length ? (
                  <select
                    aria-label="Анонс статьи блога"
                    value=""
                    onChange={(event) => {
                      const article = articles.find((item) => item.slug === event.target.value);
                      if (!article) return;
                      applyTemplate({
                        text: `**${article.title}**\n\n${article.excerpt}`,
                        buttonText: "Читать статью",
                        buttonUrl: `https://wesetup.ru/blog/${article.slug}`,
                        campaign: `blog-${article.slug}`.slice(0, 60),
                      });
                    }}
                    className="h-[34px] rounded-full border-0 bg-[#f5f6ff] px-3 text-[13px] text-[#3848c7] transition-colors duration-150 hover:bg-[#eef1ff] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
                  >
                    <option value="">Анонс статьи блога…</option>
                    {articles.map((article) => (
                      <option key={article.slug} value={article.slug}>
                        {article.title}
                      </option>
                    ))}
                  </select>
                ) : null}
              </div>
            </div>
          ) : null}

          {usable.length > 1 && !draft.editingId ? (
            <label className="mb-4 block">
              <span className="mb-1.5 block text-[13px] font-medium text-[#3c4053]">Канал</span>
              <select className={INPUT} value={channelId} onChange={(event) => patch({ channelId: event.target.value })}>
                {usable.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="text-[13px] font-medium text-[#3c4053]">Текст поста</span>
            <div className="flex gap-1">
              <FormatButton label="Жирный" onClick={() => wrapSelection("**")}>
                <Bold className="size-4" />
              </FormatButton>
              <FormatButton label="Курсив" onClick={() => wrapSelection("*")}>
                <Italic className="size-4" />
              </FormatButton>
              <FormatButton label="Ссылка" onClick={() => wrapSelection("[", "](https://wesetup.ru/)", "текст ссылки")}>
                <Link2 className="size-4" />
              </FormatButton>
            </div>
          </div>
          <textarea
            ref={textRef}
            value={draft.text}
            onChange={(event) => patch({ text: event.target.value })}
            rows={9}
            placeholder={"**Заголовок поста**\n\nО чём рассказать подписчикам: польза, новинка, акция…"}
            className="w-full resize-y rounded-2xl border border-[#dcdfed] bg-white px-4 py-3 text-[14px] leading-[1.6] text-[#0b1024] placeholder:text-[#9b9fb3] transition-colors duration-150 focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
          />
          <div className="mt-1 flex justify-between text-[12px] text-[#9b9fb3]">
            <span>**жирный**, *курсив*, [текст](ссылка)</span>
            <span className={cn("tabular-nums", textLength > MAX_POST_TEXT_LIMIT && "font-medium text-[#a13a32]")}>
              {textLength} / {MAX_POST_TEXT_LIMIT}
            </span>
          </div>

          <div className="mt-5">
            <span className="mb-1.5 block text-[13px] font-medium text-[#3c4053]">Картинки</span>
            <div className="flex flex-wrap gap-2">
              {draft.images.map((path) => (
                <div key={path} className="group relative size-20 overflow-hidden rounded-2xl border border-[#ececf4] bg-[#fafbff]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/uploads/${path}`} alt="" className="size-full object-cover" />
                  <button
                    type="button"
                    aria-label="Убрать картинку"
                    onClick={() => patch({ images: draft.images.filter((item) => item !== path) })}
                    className="absolute right-1 top-1 rounded-full bg-[#0b1024]/70 p-1 text-white opacity-90 transition-opacity duration-150 hover:opacity-100"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              ))}
              {draft.images.length < MAX_POST_IMAGES_LIMIT ? (
                <label className="flex size-20 cursor-pointer flex-col items-center justify-center gap-1 rounded-2xl border border-dashed border-[#dcdfed] bg-[#fafbff] text-[11px] text-[#6f7282] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]">
                  {busy === "upload" ? <Loader2 className="size-5 animate-spin text-[#5566f6]" /> : <ImagePlus className="size-5 text-[#5566f6]" />}
                  Добавить
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    multiple
                    className="sr-only"
                    disabled={busy === "upload"}
                    onChange={(event) => {
                      void uploadImages(event.target.files);
                      event.target.value = "";
                    }}
                  />
                </label>
              ) : null}
            </div>
            <p className="mt-1.5 text-[12px] text-[#9b9fb3]">JPG, PNG, WebP или GIF до 10 МБ, до {MAX_POST_IMAGES_LIMIT} штук.</p>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-[13px] font-medium text-[#3c4053]">Кнопка под постом</span>
              <input className={INPUT} value={draft.buttonText} maxLength={64} placeholder="Попробовать бесплатно" onChange={(event) => patch({ buttonText: event.target.value })} />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[13px] font-medium text-[#3c4053]">Куда ведёт кнопка</span>
              <input className={INPUT} value={draft.buttonUrl} placeholder="https://wesetup.ru/register" onChange={(event) => patch({ buttonUrl: event.target.value })} />
            </label>
          </div>

          <label className="mt-3 block">
            <span className="mb-1.5 block text-[13px] font-medium text-[#3c4053]">Метка кампании (utm_campaign)</span>
            <input className={INPUT} value={draft.campaign} maxLength={60} placeholder="intro" onChange={(event) => patch({ campaign: event.target.value.replace(/[^a-z0-9_-]/gi, "") })} />
            <span className="mt-1 block text-[12px] text-[#9b9fb3]">
              Ссылки на wesetup.ru получат utm_source=max, utm_medium=social и эту метку.
            </span>
          </label>

          <div className="mt-6 flex flex-col gap-3 border-t border-[#ececf4] pt-5">
            {editingSent ? (
              <button type="button" className={BTN_PRIMARY} disabled={!canSubmit} onClick={() => void submit("publish")}>
                {busy === "publish" ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                Сохранить изменения в канале
              </button>
            ) : (
              <>
                <button type="button" className={BTN_PRIMARY} disabled={!canSubmit} onClick={() => setConfirm({ kind: "publish" })}>
                  {busy === "publish" ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                  Опубликовать сейчас
                </button>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input
                    type="datetime-local"
                    aria-label="Дата и время публикации"
                    className={cn(INPUT, "sm:flex-1")}
                    value={draft.scheduledAt}
                    min={toLocalInput(new Date().toISOString())}
                    onChange={(event) => patch({ scheduledAt: event.target.value })}
                  />
                  <button type="button" className={BTN_OUTLINE} disabled={!canSubmit} onClick={() => void submit("schedule")}>
                    {busy === "schedule" ? <Loader2 className="size-4 animate-spin" /> : <CalendarClock className="size-4 text-[#5566f6]" />}
                    Запланировать
                  </button>
                  <button type="button" className={BTN_OUTLINE} disabled={!canSubmit} onClick={() => void submit("draft")}>
                    {busy === "draft" ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4 text-[#5566f6]" />}
                    {draft.editingId ? "Сохранить черновиком" : "В черновики"}
                  </button>
                </div>
              </>
            )}
            {!channel ? (
              <p className="text-[13px] text-[#a13a32]">Публиковать некуда: сначала подключите канал (блок выше).</p>
            ) : (
              <p className="text-[12px] text-[#6f7282]">
                {editingSent
                  ? "Текст, картинки и кнопка заменятся в уже вышедшем посте — подписчики увидят новую версию."
                  : `Пост выйдет в канале «${channel.title}» от имени канала. Запланированные публикуются автоматически в выбранную минуту.`}
              </p>
            )}
          </div>
        </section>

        <aside className="lg:sticky lg:top-6 lg:self-start">
          <div className={SECTION_LABEL}>Как увидят подписчики</div>
          <PostPreview channelTitle={channel?.title ?? "Канал WeSetup"} draft={draft} />
        </aside>
      </div>

      <section className={CARD}>
        <div className={SECTION_LABEL}>Посты</div>
        {posts.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-6 py-12 text-center">
            <div className="text-[15px] font-medium text-[#0b1024]">Постов пока нет</div>
            <p className="mx-auto mt-1.5 max-w-[380px] text-[13px] text-[#6f7282]">
              Напишите первый пост выше или начните с шаблона — он появится здесь вместе со статусом публикации.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-[#ececf4]">
            {posts.map((post) => (
              <PostRow
                key={post.id}
                post={post}
                channelTitle={channels.find((item) => item.id === post.channelId)?.title ?? ""}
                showChannel={channels.length > 1}
                busy={busy}
                onEdit={() => startEdit(post)}
                onPublish={() => void publishExisting(post)}
                onDelete={() => setConfirm({ kind: "delete", post })}
              />
            ))}
          </ul>
        )}
      </section>

      <ConfirmDialog
        open={confirm?.kind === "publish"}
        onClose={() => setConfirm(null)}
        onConfirm={async () => {
          setConfirm(null);
          await submit("publish");
        }}
        title="Опубликовать пост сейчас?"
        variant="info"
        icon={Send}
        bullets={[
          { label: `Пост сразу выйдет в канале «${channel?.title ?? ""}»`, tone: "info" },
          { label: "Подписчики получат уведомление" },
          { label: "Потом пост можно исправить или удалить отсюда же" },
        ]}
        confirmLabel="Опубликовать"
      />
      <ConfirmDialog
        open={confirm?.kind === "delete"}
        onClose={() => setConfirm(null)}
        onConfirm={async () => {
          const target = confirm?.kind === "delete" ? confirm.post : null;
          setConfirm(null);
          if (target) await removePost(target);
        }}
        title={confirm?.kind === "delete" && confirm.post.status === "sent" ? "Удалить пост из канала?" : "Удалить пост?"}
        variant="danger"
        icon={Trash2}
        bullets={
          confirm?.kind === "delete" && confirm.post.status === "sent"
            ? [
                { label: "Пост исчезнет из канала MAX у всех подписчиков", tone: "warn" },
                { label: "В истории здесь он останется с отметкой «Удалён из канала»" },
              ]
            : [{ label: "Черновик пропадёт без возможности восстановить", tone: "warn" }]
        }
        confirmLabel="Удалить"
      />
    </div>
  );
}

function FormatButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="inline-flex size-8 items-center justify-center rounded-xl text-[#3c4053] transition-colors duration-150 hover:bg-[#f5f6ff] hover:text-[#3848c7]"
    >
      {children}
    </button>
  );
}

function ConnectionCard({
  bot,
  tokenConfigured,
  separateBot,
  channels,
  busy,
  onDiscover,
  onToggleAnnounce,
}: {
  bot: Props["bot"];
  tokenConfigured: boolean;
  separateBot: boolean;
  channels: ChannelView[];
  busy: string | null;
  onDiscover: () => void;
  onToggleAnnounce: (channel: ChannelView) => void;
}) {
  const ready = channels.some((channel) => !channel.removed && channel.botIsAdmin);
  return (
    <section className={CARD}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className={SECTION_LABEL}>Подключение</div>
          <div className="flex items-center gap-2 text-[15px] font-medium text-[#0b1024]">
            {bot ? <CheckCircle2 className="size-5 text-[#116b2a]" /> : <TriangleAlert className="size-5 text-[#a13a32]" />}
            {bot ? `Бот «${bot.name}»${bot.username ? ` (@${bot.username})` : ""}` : tokenConfigured ? "MAX не принял токен бота" : "Бот MAX не подключён"}
          </div>
          <p className="mt-1 text-[13px] text-[#6f7282]">
            {bot
              ? separateBot
                ? "Отдельный бот для канала (MAX_CHANNEL_BOT_TOKEN)."
                : "Публикует основной бот WeSetup в MAX. Отдельный — переменная MAX_CHANNEL_BOT_TOKEN на сервере."
              : "Нужен токен бота MAX на сервере: MAX_CHANNEL_BOT_TOKEN (или основной MAX_BOT_TOKEN)."}
          </p>
        </div>
        <button type="button" className={BTN_SMALL} disabled={!bot || busy === "discover"} onClick={onDiscover}>
          {busy === "discover" ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4 text-[#5566f6]" />}
          Найти канал
        </button>
      </div>

      {channels.length ? (
        <ul className="mt-4 space-y-2">
          {channels.map((channel) => (
            <li key={channel.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#ececf4] bg-[#fafbff] px-4 py-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-[14px] font-medium text-[#0b1024]">{channel.title}</span>
                  <span
                    className={cn(
                      "rounded-full px-2.5 py-0.5 text-[12px]",
                      channel.removed
                        ? "bg-[#fff4f2] text-[#a13a32]"
                        : channel.botIsAdmin
                          ? "bg-[#ecfdf5] text-[#116b2a]"
                          : "bg-[#fff4f2] text-[#a13a32]",
                    )}
                  >
                    {channel.removed ? "Бот удалён из канала" : channel.botIsAdmin ? "Можно публиковать" : "Бот не администратор"}
                  </span>
                </div>
                {channel.link ? (
                  <a href={channel.link} target="_blank" rel="noreferrer" className="mt-0.5 inline-flex items-center gap-1 text-[12px] text-[#3848c7] hover:underline">
                    {channel.link} <ExternalLink className="size-3" />
                  </a>
                ) : null}
              </div>
              {!channel.removed ? (
                <label className="flex cursor-pointer items-center gap-2 text-[13px] text-[#3c4053]">
                  <input
                    type="checkbox"
                    className="size-4 accent-[#5566f6]"
                    checked={channel.announceBlog}
                    disabled={busy === `announce-${channel.id}`}
                    onChange={() => onToggleAnnounce(channel)}
                  />
                  Анонсировать новые статьи блога
                </label>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {!ready ? (
        <ol className="mt-4 space-y-1.5 rounded-2xl bg-[#f5f6ff] px-4 py-3 text-[13px] leading-[1.55] text-[#3c4053]">
          <li>
            1. В MAX откройте канал → «Настройки» → «Администраторы» → «Добавить» и найдите бота
            {bot?.username ? <b> @{bot.username}</b> : " (имя появится после подключения токена)"}.
          </li>
          <li>2. Разрешите ему публиковать, изменять и удалять сообщения.</li>
          <li>
            3. {separateBot ? "Нажмите «Найти канал»" : "Канал появится здесь сам через пару секунд — обновите страницу или нажмите «Найти канал»"}.
          </li>
        </ol>
      ) : null}
    </section>
  );
}

function PostRow({
  post,
  channelTitle,
  showChannel,
  busy,
  onEdit,
  onPublish,
  onDelete,
}: {
  post: PostView;
  channelTitle: string;
  showChannel: boolean;
  busy: string | null;
  onEdit: () => void;
  onPublish: () => void;
  onDelete: () => void;
}) {
  const when =
    post.status === "sent" || post.status === "deleted"
      ? post.sentAt && `вышел ${formatWhen(post.sentAt)}`
      : post.status === "scheduled"
        ? `выйдет ${formatWhen(post.scheduledAt)}`
        : `создан ${formatWhen(post.createdAt)}`;
  const firstLine = post.text.split("\n").find((line) => line.trim())?.replace(/\*\*|\*|`/g, "") ?? "";
  const canPublish = post.status === "draft" || post.status === "scheduled" || post.status === "failed";
  const canEdit = post.status !== "sending" && post.status !== "deleted";
  return (
    <li className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 md:flex-row md:items-center md:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn("rounded-full px-2.5 py-0.5 text-[12px]", STATUS_TONE[post.status])}>{MAX_POST_STATUS_LABELS[post.status]}</span>
          <span className="text-[12px] text-[#6f7282]">{when}</span>
          {post.source === "blog" ? <span className="rounded-full bg-[#f5f6ff] px-2.5 py-0.5 text-[12px] text-[#3848c7]">Автоанонс блога</span> : null}
          {showChannel && channelTitle ? <span className="text-[12px] text-[#9b9fb3]">· {channelTitle}</span> : null}
        </div>
        <div className="mt-1 truncate text-[14px] font-medium text-[#0b1024]">{firstLine || "Без текста"}</div>
        {post.images.length ? <div className="text-[12px] text-[#9b9fb3]">Картинок: {post.images.length}</div> : null}
        {post.error ? <div className="mt-1 text-[13px] text-[#a13a32]">{post.error}</div> : null}
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        {post.url ? (
          <a href={post.url} target="_blank" rel="noreferrer" className={BTN_SMALL}>
            <ExternalLink className="size-4 text-[#5566f6]" /> В MAX
          </a>
        ) : null}
        {canPublish ? (
          <button type="button" className={BTN_SMALL} disabled={Boolean(busy)} onClick={onPublish}>
            {busy === `publish-${post.id}` ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4 text-[#5566f6]" />}
            {post.status === "failed" ? "Повторить" : "Опубликовать"}
          </button>
        ) : null}
        {canEdit ? (
          <button type="button" className={BTN_SMALL} disabled={Boolean(busy)} onClick={onEdit}>
            <Pencil className="size-4 text-[#5566f6]" /> Изменить
          </button>
        ) : null}
        {post.status !== "sending" && post.status !== "deleted" ? (
          <button
            type="button"
            className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-[#f3d2cd] bg-[#fff4f2] px-3 text-[13px] font-medium text-[#a13a32] transition-colors duration-150 hover:bg-[#ffe9e5] disabled:opacity-50"
            disabled={Boolean(busy)}
            onClick={onDelete}
          >
            {busy === `delete-${post.id}` ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
            Удалить
          </button>
        ) : null}
      </div>
    </li>
  );
}

/** Упрощённый показ markdown MAX: **жирный**, *курсив*, `код`, [текст](ссылка). */
function renderInline(line: string, keyPrefix: string): ReactNode[] {
  const parts = line.split(/(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/g);
  return parts.map((part, index) => {
    const key = `${keyPrefix}-${index}`;
    if (/^\*\*[^*]+\*\*$/.test(part)) return <strong key={key}>{part.slice(2, -2)}</strong>;
    if (/^\*[^*]+\*$/.test(part)) return <em key={key}>{part.slice(1, -1)}</em>;
    if (/^`[^`]+`$/.test(part)) return <code key={key} className="rounded bg-black/5 px-1 text-[13px]">{part.slice(1, -1)}</code>;
    const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(part);
    if (link) return <span key={key} className="text-[#3848c7] underline">{link[1]}</span>;
    return <span key={key}>{part}</span>;
  });
}

function PostPreview({ channelTitle, draft }: { channelTitle: string; draft: Draft }) {
  const lines = useMemo(() => draft.text.split("\n"), [draft.text]);
  const hasButton = draft.buttonText.trim() && draft.buttonUrl.trim();
  return (
    <div className="rounded-3xl border border-[#ececf4] bg-[#eef0f6] p-4">
      <div className="overflow-hidden rounded-2xl bg-white shadow-[0_8px_24px_-16px_rgba(11,16,36,0.35)]">
        {draft.images.length ? (
          <div className={cn("grid gap-0.5", draft.images.length > 1 && "grid-cols-2")}>
            {draft.images.slice(0, 4).map((path) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={path} src={`/uploads/${path}`} alt="" className="aspect-[4/3] w-full object-cover" />
            ))}
          </div>
        ) : null}
        <div className="px-4 py-3">
          <div className="mb-1 text-[13px] font-semibold text-[#3848c7]">{channelTitle}</div>
          {draft.text.trim() ? (
            <div className="whitespace-pre-wrap break-words text-[14px] leading-[1.5] text-[#0b1024]">
              {lines.map((line, index) => (
                <div key={index} className={line ? undefined : "h-[1.5em]"}>
                  {renderInline(line, String(index))}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-[14px] text-[#9b9fb3]">Здесь появится текст поста</div>
          )}
          <div className="mt-2 text-right text-[11px] text-[#9b9fb3]">
            {new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}
          </div>
        </div>
      </div>
      {hasButton ? (
        <div className="mt-1.5 rounded-xl bg-white/80 py-2.5 text-center text-[14px] font-medium text-[#3848c7]">{draft.buttonText}</div>
      ) : null}
      {draft.images.length > 4 ? <p className="mt-2 text-center text-[12px] text-[#6f7282]">и ещё {draft.images.length - 4} картинки</p> : null}
    </div>
  );
}
