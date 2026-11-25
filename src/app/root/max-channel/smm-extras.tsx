"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarDays, Copy, FileUp, History, ImagePlus, Loader2, ThumbsDown, ThumbsUp, TriangleAlert } from "lucide-react";

import { WESETUP_BRAND } from "@/lib/smm/brand-profile";
import type { PlanReport } from "@/lib/smm/quality";
import { TEMPLATES, titleFromPost, type TemplateKey } from "@/lib/smm/templates";
import { cn } from "@/lib/utils";

const CHIP = "rounded-full px-3 py-1.5 text-[12px] transition-colors duration-150";
const FIELD =
  "h-10 w-full rounded-xl border border-[#dcdfed] bg-white px-3 text-[13px] text-[#0b1024] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15";

export type SendOptions = {
  silent: boolean;
  pin: boolean;
  disablePreview: boolean;
  protect: boolean;
  deleteAt: string;
  needsApproval: boolean;
};

/** Рубрика поста (A18) — задаёт коридор длины, хэштег и что обязательно. */
export function RubricPicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div>
      <span className="mb-1.5 block text-[13px] font-medium text-[#3c4053]">Рубрика</span>
      <div className="flex flex-wrap gap-1.5">
        {WESETUP_BRAND.rubrics.map((rubric) => (
          <button
            key={rubric.key}
            type="button"
            onClick={() => onChange(value === rubric.key ? "" : rubric.key)}
            className={cn(CHIP, value === rubric.key ? "bg-[#5566f6] text-white" : "bg-[#f5f6ff] text-[#3848c7] hover:bg-[#eef1ff]")}
            title={rubric.kind === "selling" ? "Продающая рубрика" : "Полезная рубрика"}
          >
            {rubric.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Параметры отправки (A30), автоудаление (A11), согласование (A24). */
export function SendOptionsBox({ value, onChange, editingSent }: { value: SendOptions; onChange: (next: Partial<SendOptions>) => void; editingSent: boolean }) {
  const toggles: Array<[keyof SendOptions, string]> = [
    ["silent", "Без звука"],
    ["pin", "Закрепить"],
    ["disablePreview", "Без превью ссылок"],
    ["protect", "Запретить пересылку (Telegram)"],
  ];
  return (
    <details className="mt-4 rounded-2xl border border-[#ececf4] bg-[#fafbff] px-4 py-3">
      <summary className="cursor-pointer text-[13px] font-medium text-[#3c4053]">Параметры отправки, автоудаление, согласование</summary>
      <div className="mt-3 flex flex-wrap gap-2">
        {toggles.map(([key, label]) => (
          <label key={key} className="inline-flex items-center gap-2 text-[13px] text-[#3c4053]">
            <input
              type="checkbox"
              checked={Boolean(value[key])}
              disabled={editingSent && key !== "disablePreview"}
              onChange={(event) => onChange({ [key]: event.target.checked } as Partial<SendOptions>)}
              className="size-4 accent-[#5566f6]"
            />
            {label}
          </label>
        ))}
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-[12px] text-[#6f7282]">Удалить из канала (например, конец акции)</span>
          <input type="datetime-local" className={FIELD} value={value.deleteAt} onChange={(event) => onChange({ deleteAt: event.target.value })} />
        </label>
        {!editingSent ? (
          <label className="flex items-end gap-2 pb-2 text-[13px] text-[#3c4053]">
            <input
              type="checkbox"
              checked={value.needsApproval}
              onChange={(event) => onChange({ needsApproval: event.target.checked })}
              className="size-4 accent-[#5566f6]"
            />
            Отправить на согласование, а не в канал
          </label>
        ) : null}
      </div>
    </details>
  );
}

/** Картинка по шаблону бренда (A23): фото из поста + заголовок, рубрика, логотип. */
export function TemplateBuilder({
  text,
  images,
  rubricLabel,
  onCreated,
}: {
  text: string;
  images: string[];
  rubricLabel: string;
  onCreated: (path: string) => void;
}) {
  const [template, setTemplate] = useState<TemplateKey>("photo-band");
  const [title, setTitle] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [offer, setOffer] = useState("");
  const [deadline, setDeadline] = useState("");
  const [photo, setPhoto] = useState("");
  const [busy, setBusy] = useState(false);
  const def = TEMPLATES.find((t) => t.key === template)!;
  const photos = images.filter((path) => !path.split("/").pop()?.startsWith("tpl-"));

  async function create() {
    setBusy(true);
    try {
      const response = await fetch("/api/root/max-channel/images/template", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          template,
          title: title.trim() || titleFromPost(text) || "WeSetup",
          subtitle: subtitle || undefined,
          rubric: rubricLabel || undefined,
          offer: offer || undefined,
          deadline: deadline || undefined,
          photoPath: photo || photos[0] || null,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as { path?: string; error?: string };
      if (!response.ok || !data.path) throw new Error(data.error ?? "Картинка не собралась");
      onCreated(data.path);
      toast.success("Картинка по шаблону добавлена в пост");
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="mt-3 rounded-2xl border border-[#ececf4] bg-[#fafbff] px-4 py-3">
      <summary className="cursor-pointer text-[13px] font-medium text-[#3c4053]">Собрать картинку по шаблону бренда</summary>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {TEMPLATES.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTemplate(t.key)}
            className={cn(CHIP, template === t.key ? "bg-[#5566f6] text-white" : "bg-white text-[#3848c7] ring-1 ring-[#dcdfed] hover:bg-[#eef1ff]")}
          >
            {t.label}
          </button>
        ))}
      </div>
      <p className="mt-2 text-[12px] text-[#6f7282]">
        {def.description} {def.width}×{def.height}.
      </p>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <input className={FIELD} placeholder={titleFromPost(text) || "Заголовок картинки"} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} />
        {def.fields.includes("subtitle") ? (
          <input className={FIELD} placeholder="Подзаголовок" value={subtitle} onChange={(e) => setSubtitle(e.target.value)} maxLength={240} />
        ) : null}
        {def.fields.includes("offer") ? <input className={FIELD} placeholder="Выгода: −20%" value={offer} onChange={(e) => setOffer(e.target.value)} maxLength={24} /> : null}
        {def.fields.includes("deadline") ? (
          <input className={FIELD} placeholder="Срок: до 30 ноября" value={deadline} onChange={(e) => setDeadline(e.target.value)} maxLength={40} />
        ) : null}
      </div>
      {photos.length > 1 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {photos.map((path) => (
            <button key={path} type="button" onClick={() => setPhoto(path)} className={cn("size-12 overflow-hidden rounded-lg ring-2", (photo || photos[0]) === path ? "ring-[#5566f6]" : "ring-transparent")}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/uploads/${path}`} alt="" className="size-full object-cover" />
            </button>
          ))}
        </div>
      ) : null}
      {def.needsPhoto && !photos.length ? <p className="mt-2 text-[12px] text-[#9a6200]">Загрузите фото выше — без него шаблон будет на фирменном фоне.</p> : null}
      <button
        type="button"
        disabled={busy}
        onClick={() => void create()}
        className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-xl bg-[#5566f6] px-3 text-[13px] font-medium text-white hover:bg-[#4a5bf0] disabled:opacity-50"
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : <ImagePlus className="size-4" />} Собрать и добавить в пост
      </button>
    </details>
  );
}

type CalendarPost = { id: string; text: string; scheduledAt: string | null; sentAt: string | null; status: string; rubric: string | null; channelId: string };

function moscowDay(iso: string): string {
  return new Date(new Date(iso).getTime() + 3 * 3_600_000).toISOString().slice(0, 10);
}

/** Календарь недели (A06), разбор плана (B21, B22) и свободные слоты (A07). */
export function WeekPlan({
  posts,
  onEdit,
  onSlot,
}: {
  posts: CalendarPost[];
  onEdit: (id: string) => void;
  onSlot: (iso: string) => void;
}) {
  const [plan, setPlan] = useState<PlanReport | null>(null);
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    void fetch("/api/root/max-channel/quality", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "", plan: true }),
    })
      .then((r) => r.json())
      .then((data: { plan?: PlanReport }) => setPlan(data.plan ?? null))
      .catch(() => undefined);
  }, [posts.length]);

  const today = moscowDay(new Date().toISOString());
  const start = new Date(Date.parse(`${today}T00:00:00Z`) + offset * 7 * 86_400_000);
  const days = Array.from({ length: 7 }, (_, i) => new Date(start.getTime() + i * 86_400_000).toISOString().slice(0, 10));
  const live = posts.filter((p) => p.status !== "deleted" && (p.scheduledAt || p.sentAt));
  // Один пост в несколько каналов — одна плашка.
  const unique = new Map<string, CalendarPost>();
  for (const p of live) unique.set(`${p.text}|${(p.scheduledAt ?? p.sentAt)!.slice(0, 16)}`, p);
  const rubricLabel = (key: string | null) => WESETUP_BRAND.rubrics.find((r) => r.key === key);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[13px] font-medium text-[#0b1024]">
          <CalendarDays className="size-4 text-[#5566f6]" /> Неделя с {new Date(`${days[0]}T12:00:00Z`).toLocaleDateString("ru-RU", { day: "numeric", month: "long" })}
        </div>
        <div className="flex gap-1">
          <button type="button" className="rounded-lg px-2 py-1 text-[12px] text-[#3848c7] hover:bg-[#f5f6ff]" onClick={() => setOffset((o) => o - 1)}>
            ←
          </button>
          <button type="button" className="rounded-lg px-2 py-1 text-[12px] text-[#3848c7] hover:bg-[#f5f6ff]" onClick={() => setOffset(0)}>
            Сегодня
          </button>
          <button type="button" className="rounded-lg px-2 py-1 text-[12px] text-[#3848c7] hover:bg-[#f5f6ff]" onClick={() => setOffset((o) => o + 1)}>
            →
          </button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {days.map((day) => {
          const items = [...unique.values()]
            .filter((p) => moscowDay((p.scheduledAt ?? p.sentAt)!) === day)
            .sort((a, b) => (a.scheduledAt ?? a.sentAt ?? "").localeCompare(b.scheduledAt ?? b.sentAt ?? ""));
          const over = items.length > WESETUP_BRAND.maxPostsPerDay;
          return (
            <div key={day} className={cn("min-h-[110px] rounded-2xl border p-2", day === today ? "border-[#5566f6]/50 bg-[#f5f6ff]" : "border-[#ececf4] bg-[#fafbff]")}>
              <div className={cn("mb-1.5 text-[11px] font-semibold uppercase tracking-wide", over ? "text-[#a13a32]" : "text-[#6f7282]")}>
                {new Date(`${day}T12:00:00Z`).toLocaleDateString("ru-RU", { weekday: "short", day: "numeric" })}
                {over ? " · много" : ""}
              </div>
              <ul className="space-y-1">
                {items.map((p) => {
                  const rubric = rubricLabel(p.rubric);
                  return (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => onEdit(p.id)}
                        className={cn(
                          "w-full rounded-lg px-1.5 py-1 text-left text-[11px] leading-tight",
                          p.status === "sent" ? "bg-[#ecfdf5] text-[#116b2a]" : p.status === "review" ? "bg-[#fff8e6] text-[#9a6200]" : "bg-white text-[#0b1024] ring-1 ring-[#e4e6f1]",
                        )}
                      >
                        <span className="font-semibold tabular-nums">
                          {new Date((p.scheduledAt ?? p.sentAt)!).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" })}
                        </span>{" "}
                        {rubric ? <span className={rubric.kind === "selling" ? "text-[#c2410c]" : "text-[#3848c7]"}>{rubric.label} · </span> : null}
                        <span className="line-clamp-2">{p.text.replace(/\*\*/g, "").split("\n")[0]}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
      {plan ? (
        <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_auto]">
          <div>
            {plan.issues.length ? (
              <ul className="space-y-1">
                {plan.issues.slice(0, 8).map((issue, i) => (
                  <li key={`${issue.text}-${i}`} className="flex items-start gap-2 text-[12px] text-[#9a6200]">
                    <TriangleAlert className="mt-0.5 size-3.5 shrink-0" /> {issue.text}
                    <span className="text-[10px] text-[#b0b3c4]">{issue.feature}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[12px] text-[#116b2a]">План ровный: без перегруза, повторов и перекоса в продажи.</p>
            )}
            <p className="mt-1.5 text-[12px] text-[#6f7282]">
              Доля продающих за ±7 дней: {Math.round(plan.rubricShare.selling * 100)}% (норма до {Math.round(WESETUP_BRAND.maxSellingShare * 100)}%)
            </p>
          </div>
          {plan.freeSlots.length ? (
            <div>
              <div className="mb-1 text-[12px] font-medium text-[#3c4053]">Свободные слоты</div>
              <div className="flex flex-wrap gap-1.5">
                {plan.freeSlots.map((slot) => {
                  const iso = typeof slot === "string" ? slot : new Date(slot).toISOString();
                  return (
                    <button key={iso} type="button" onClick={() => onSlot(iso)} className={cn(CHIP, "bg-[#f5f6ff] text-[#3848c7] hover:bg-[#eef1ff]")}>
                      {new Date(iso).toLocaleString("ru-RU", { weekday: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" })}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Импорт плана из CSV (A20). */
export function CsvImport({ channelIds }: { channelIds: string[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function upload(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("channelIds", channelIds.join(","));
      const response = await fetch("/api/root/max-channel/import", { method: "POST", body: form });
      const data = (await response.json().catch(() => ({}))) as { scheduled?: number; drafts?: number; errors?: string[]; error?: string };
      if (!response.ok) throw new Error(data.error ?? "Импорт не удался");
      toast.success(`В плане: ${data.scheduled ?? 0}, черновиков: ${data.drafts ?? 0}`);
      if (data.errors?.length) toast.error(`Пропущено: ${data.errors.slice(0, 4).join("; ")}`);
      router.refresh();
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <label className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-xl border border-[#dcdfed] bg-white px-3 text-[13px] font-medium text-[#0b1024] hover:bg-[#f5f6ff]">
      {busy ? <Loader2 className="size-4 animate-spin" /> : <FileUp className="size-4 text-[#5566f6]" />}
      Импорт CSV
      <input
        type="file"
        accept=".csv,text/csv"
        className="sr-only"
        disabled={busy || !channelIds.length}
        onChange={(event) => {
          void upload(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
    </label>
  );
}

/** Действия над постом в списке: согласование (A24), копии/повтор (A19), история (A25). */
export function PostExtraActions({ post, onRestored }: { post: { id: string; status: string; approval?: string | null }; onRestored?: () => void }) {
  const router = useRouter();
  const [versions, setVersions] = useState<null | Array<{ id: string; text: string; createdAt: string }>>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function act(body: Record<string, unknown>, ok: string) {
    setBusy(String(body.action));
    try {
      let response = await fetch(`/api/root/max-channel/posts/${post.id}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      let data = (await response.json().catch(() => ({}))) as { error?: string; gate?: boolean };
      if (response.status === 422 && data.gate && window.confirm(`${data.error}\n\nУтвердить всё равно?`)) {
        response = await fetch(`/api/root/max-channel/posts/${post.id}/actions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...body, force: true }),
        });
        data = (await response.json().catch(() => ({}))) as { error?: string };
      }
      if (!response.ok) throw new Error(data.error ?? "Не получилось");
      toast.success(ok);
      router.refresh();
      onRestored?.();
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function loadVersions() {
    if (versions) {
      setVersions(null);
      return;
    }
    const data = (await fetch(`/api/root/max-channel/posts/${post.id}/actions`).then((r) => r.json())) as { versions?: Array<{ id: string; text: string; createdAt: string }> };
    setVersions(data.versions ?? []);
  }

  const small = "inline-flex h-8 items-center gap-1 rounded-lg border border-[#dcdfed] bg-white px-2 text-[12px] text-[#0b1024] hover:bg-[#f5f6ff] disabled:opacity-50";
  return (
    <div className="mt-2">
      <div className="flex flex-wrap gap-1.5">
        {post.status === "review" ? (
          <>
            <button type="button" className={small} disabled={Boolean(busy)} onClick={() => void act({ action: "approve" }, "Пост утверждён")}>
              <ThumbsUp className="size-3.5 text-[#16a34a]" /> Утвердить
            </button>
            <button
              type="button"
              className={small}
              disabled={Boolean(busy)}
              onClick={() => {
                const comment = window.prompt("Что поправить?") ?? undefined;
                void act({ action: "reject", comment }, "Пост возвращён на доработку");
              }}
            >
              <ThumbsDown className="size-3.5 text-[#dc4b3e]" /> На доработку
            </button>
          </>
        ) : null}
        <button type="button" className={small} disabled={Boolean(busy)} onClick={() => void act({ action: "duplicate", repeatWeeks: 0 }, "Копия в черновиках")}>
          <Copy className="size-3.5" /> Копия
        </button>
        <button
          type="button"
          className={small}
          disabled={Boolean(busy)}
          onClick={() => {
            const weeks = Number(window.prompt("Повторять каждую неделю — сколько раз? (1–12)", "4"));
            if (Number.isInteger(weeks) && weeks >= 1 && weeks <= 12) void act({ action: "duplicate", repeatWeeks: weeks }, `Запланировано повторов: ${weeks}`);
          }}
        >
          <CalendarDays className="size-3.5" /> Повторять еженедельно
        </button>
        <button type="button" className={small} onClick={() => void loadVersions()}>
          <History className="size-3.5" /> История
        </button>
      </div>
      {versions ? (
        versions.length ? (
          <ul className="mt-2 space-y-1.5">
            {versions.map((v) => (
              <li key={v.id} className="rounded-xl bg-[#fafbff] p-2 text-[12px]">
                <div className="flex items-center justify-between gap-2 text-[#6f7282]">
                  <span>{new Date(v.createdAt).toLocaleString("ru-RU")}</span>
                  {post.status !== "sent" && post.status !== "sending" ? (
                    <button type="button" className="text-[#3848c7] hover:underline" onClick={() => void act({ action: "restore", versionId: v.id }, "Версия восстановлена")}>
                      Вернуть
                    </button>
                  ) : null}
                </div>
                <pre className="mt-1 line-clamp-4 whitespace-pre-wrap font-sans text-[#0b1024]">{v.text}</pre>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-[12px] text-[#6f7282]">Правок ещё не было.</p>
        )
      ) : null}
    </div>
  );
}
