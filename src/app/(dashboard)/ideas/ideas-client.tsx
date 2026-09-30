"use client";

import { Lightbulb, MessageSquareQuote, Plus, ThumbsUp } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SkeletonList } from "@/components/ui/skeleton";
import {
  IDEA_DESCRIPTION_MAX,
  IDEA_STATUS_HINT,
  IDEA_STATUS_LABEL,
  IDEA_TITLE_MAX,
  type IdeaFilter,
  type IdeaSort,
  type IdeaStatus,
} from "@/lib/ideas/rules";

type Idea = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  votes: number;
  adminNote: string | null;
  createdAt: string;
  statusChangedAt: string | null;
  mine: boolean;
  voted: boolean;
};

const STATUS_TONE: Record<IdeaStatus, string> = {
  new: "bg-[#f5f6ff] text-[#3848c7]",
  planned: "bg-[#fff8eb] text-[#b25f00]",
  in_progress: "bg-[#eef1ff] text-[#3848c7]",
  done: "bg-[#ecfdf5] text-[#116b2a]",
  declined: "bg-[#f4f4f7] text-[#6f7282]",
};

const CHIP = "inline-flex h-9 items-center rounded-full border px-3.5 text-[13px] font-medium transition-colors";
const CHIP_ON = `${CHIP} border-[#5566f6] bg-[#5566f6] text-white`;
const CHIP_OFF = `${CHIP} border-[#dcdfed] bg-white text-[#0b1024] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]`;
const INPUT =
  "w-full rounded-2xl border border-[#dcdfed] bg-white px-4 text-[15px] text-[#0b1024] placeholder:text-[#9b9fb3] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function IdeasClient() {
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [doneCount, setDoneCount] = useState(0);
  const [canPost, setCanPost] = useState(false);
  const [sort, setSort] = useState<IdeaSort>("top");
  const [filter, setFilter] = useState<IdeaFilter>("open");
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [voting, setVoting] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/ideas?sort=${sort}&filter=${filter}`);
      const data = (await response.json()) as { ideas: Idea[]; doneCount: number; canPost: boolean };
      setIdeas(data.ideas ?? []);
      setDoneCount(data.doneCount ?? 0);
      setCanPost(Boolean(data.canPost));
    } catch {
      toast.error("Не удалось загрузить идеи");
    } finally {
      setLoading(false);
    }
  }, [sort, filter]);

  useEffect(() => {
    void load();
  }, [load]);

  async function vote(idea: Idea) {
    setVoting(idea.id);
    try {
      const response = await fetch(`/api/ideas/${idea.id}/vote`, { method: "POST" });
      const data = (await response.json().catch(() => null)) as { voted?: boolean; votes?: number; error?: string } | null;
      if (!response.ok) throw new Error(data?.error ?? "Не удалось проголосовать");
      setIdeas((prev) => prev.map((i) => (i.id === idea.id ? { ...i, voted: Boolean(data?.voted), votes: data?.votes ?? i.votes } : i)));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ошибка");
    } finally {
      setVoting(null);
    }
  }

  async function submit() {
    setSubmitting(true);
    try {
      const response = await fetch("/api/ideas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, description }),
      });
      const data = (await response.json().catch(() => null)) as { idea?: Idea; error?: string } | null;
      if (!response.ok || !data?.idea) throw new Error(data?.error ?? "Не удалось отправить");
      toast.success("Идея отправлена — спасибо! Голос за неё уже ваш.");
      setOpen(false);
      setTitle("");
      setDescription("");
      setSort("new");
      setFilter("open");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ошибка");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-2" role="tablist" aria-label="Сортировка">
          <button type="button" role="tab" aria-selected={sort === "top"} onClick={() => setSort("top")} className={sort === "top" ? CHIP_ON : CHIP_OFF}>
            Популярные
          </button>
          <button type="button" role="tab" aria-selected={sort === "new"} onClick={() => setSort("new")} className={sort === "new" ? CHIP_ON : CHIP_OFF}>
            Новые
          </button>
        </div>
        <span className="mx-1 hidden h-6 w-px bg-[#ececf4] sm:block" />
        <div className="flex gap-2" role="tablist" aria-label="Фильтр">
          <button type="button" role="tab" aria-selected={filter === "open"} onClick={() => setFilter("open")} className={filter === "open" ? CHIP_ON : CHIP_OFF}>
            Открытые
          </button>
          <button type="button" role="tab" aria-selected={filter === "done"} onClick={() => setFilter("done")} className={filter === "done" ? CHIP_ON : CHIP_OFF}>
            Сделано{doneCount > 0 ? ` · ${doneCount}` : ""}
          </button>
          <button type="button" role="tab" aria-selected={filter === "all"} onClick={() => setFilter("all")} className={filter === "all" ? CHIP_ON : CHIP_OFF}>
            Все
          </button>
        </div>
        {canPost ? (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="ml-auto inline-flex h-10 items-center gap-2 rounded-2xl bg-[#5566f6] px-4 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors hover:bg-[#4a5bf0]"
          >
            <Plus className="size-4" />
            Предложить идею
          </button>
        ) : null}
      </div>

      {loading ? (
        // Скелет карточек идей — как у остальных разделов, вместо строки
        // «Загружаем…», которую сменял список другой высоты.
        <div aria-busy="true" aria-live="polite">
          <span className="sr-only">Загружаем идеи…</span>
          <SkeletonList rows={4} height={104} className="space-y-3" />
        </div>
      ) : ideas.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-6 py-14 text-center">
          <div className="text-[15px] font-medium text-[#0b1024]">
            {filter === "done" ? "Сделанных по идеям пока нет" : "Идей пока нет — будьте первым"}
          </div>
          <p className="mx-auto mt-1.5 max-w-[360px] text-[13px] text-[#6f7282]">
            Нажмите «Предложить идею»: что бы вы добавили или поменяли в WeSetup.
          </p>
        </div>
      ) : (
        <ul className="grid gap-3">
          {ideas.map((idea) => {
            const status = idea.status as IdeaStatus;
            const closed = status === "done" || status === "declined";
            return (
              <li key={idea.id} data-testid="idea-card" className="rounded-3xl border border-[#ececf4] bg-white p-5 shadow-[0_0_0_1px_rgba(240,240,250,0.45)]">
                <div className="flex items-start gap-4">
                  <button
                    type="button"
                    onClick={() => void vote(idea)}
                    disabled={closed || voting === idea.id}
                    aria-pressed={idea.voted}
                    aria-label={idea.voted ? "Снять голос" : "Поддержать идею"}
                    title={closed ? "Голосование закрыто" : idea.voted ? "Вы поддержали — нажмите, чтобы снять голос" : "Поддержать идею"}
                    className={`flex w-16 shrink-0 flex-col items-center justify-center gap-0.5 rounded-2xl border py-2.5 transition-colors disabled:opacity-60 ${
                      idea.voted
                        ? "border-[#5566f6] bg-[#5566f6] text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)]"
                        : "border-[#dcdfed] bg-white text-[#0b1024] hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
                    }`}
                  >
                    <ThumbsUp className="size-4" />
                    <span className="text-[15px] font-semibold tabular-nums">{idea.votes}</span>
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-[15px] font-semibold text-[#0b1024]">{idea.title}</h3>
                      <span className={`rounded-full px-2.5 py-0.5 text-[12px] font-medium ${STATUS_TONE[status] ?? STATUS_TONE.new}`} title={IDEA_STATUS_HINT[status]}>
                        {IDEA_STATUS_LABEL[status] ?? idea.status}
                      </span>
                      {idea.mine ? <span className="rounded-full bg-[#ecfdf5] px-2.5 py-0.5 text-[12px] text-[#116b2a]">ваша идея</span> : null}
                    </div>
                    {idea.description ? (
                      <p className="mt-1.5 whitespace-pre-wrap text-[13.5px] leading-relaxed text-[#3c4053]">{idea.description}</p>
                    ) : null}
                    {idea.adminNote ? (
                      <div className="mt-2.5 flex items-start gap-2 rounded-2xl bg-[#fafbff] px-3.5 py-2.5 text-[13px] leading-relaxed text-[#3c4053]">
                        <MessageSquareQuote className="mt-0.5 size-4 shrink-0 text-[#5566f6]" />
                        <span>
                          <span className="font-medium text-[#0b1024]">WeSetup:</span> {idea.adminNote}
                        </span>
                      </div>
                    ) : null}
                    <div className="mt-2 text-[12px] text-[#9b9fb3]">
                      {formatDate(idea.createdAt)}
                      {idea.statusChangedAt ? ` · статус от ${formatDate(idea.statusChangedAt)}` : ""}
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-[520px] rounded-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-[18px] font-semibold text-[#0b1024]">
              <Lightbulb className="size-5 text-[#5566f6]" />
              Предложить идею
            </DialogTitle>
            <DialogDescription className="text-[13.5px] text-[#6f7282]">
              Идею увидят все клиенты и смогут поддержать голосом. Название организации не показываем.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value.slice(0, IDEA_TITLE_MAX))}
              placeholder="Коротко: что добавить или поменять"
              aria-label="Название идеи"
              className={`h-12 ${INPUT}`}
              autoFocus
            />
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value.slice(0, IDEA_DESCRIPTION_MAX))}
              placeholder="Зачем это нужно и как вы это себе представляете (необязательно)"
              aria-label="Описание идеи"
              rows={5}
              className={`py-3 ${INPUT}`}
            />
            <div className="text-right text-[12px] text-[#9b9fb3]">
              {title.length}/{IDEA_TITLE_MAX} · {description.length}/{IDEA_DESCRIPTION_MAX}
            </div>
          </div>
          <DialogFooter className="gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="inline-flex h-11 items-center justify-center rounded-2xl border border-[#dcdfed] bg-white px-4 text-[14px] font-medium text-[#0b1024] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]"
            >
              Отмена
            </button>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={submitting || title.trim().length < 5}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl bg-[#5566f6] px-5 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors hover:bg-[#4a5bf0] disabled:opacity-50"
            >
              {submitting ? "Отправляем…" : "Отправить"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
