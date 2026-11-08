"use client";
import { BodyScrollLock } from "@/lib/use-body-scroll-lock";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import {
  ExternalLink,
  Pencil,
  Plus,
  Trash2,
  Eye,
  EyeOff,
} from "lucide-react";

type ArticleRow = {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  body: unknown;
  coverIcon: string | null;
  tags: string[];
  readMinutes: number;
  publishedAt: string | null;
};

const EMPTY_BODY = `[
  { "type": "p", "text": "Введите текст первого абзаца." }
]`;

export function BlogAdminClient({ articles }: { articles: ArticleRow[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<ArticleRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [isPending, startTransition] = useTransition();

  function refresh() {
    startTransition(() => router.refresh());
  }

  async function togglePublish(a: ArticleRow) {
    const res = await fetch(`/api/root/articles/${a.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        publishedAt: a.publishedAt ? null : new Date().toISOString(),
      }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      toast.error(j.error || "Не удалось обновить");
      return;
    }
    toast.success(a.publishedAt ? "Снято с публикации" : "Опубликовано");
    refresh();
  }

  async function remove(a: ArticleRow) {
    if (!confirm(`Удалить «${a.title}»? Это действие необратимо.`)) return;
    const res = await fetch(`/api/root/articles/${a.id}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      toast.error("Не удалось удалить");
      return;
    }
    toast.success("Удалено");
    refresh();
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div className="text-[14px] text-[#6f7282]">
          Всего статей: {articles.length}
        </div>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="inline-flex items-center gap-2 rounded-2xl bg-[#5566f6] px-4 py-2 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors hover:bg-[#4a5bf0]"
        >
          <Plus className="size-4" />
          Новая статья
        </button>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-[#e2e5ef] bg-white">
        <table className="w-full min-w-[720px] border-collapse text-[14px]">
          <thead>
            <tr className="bg-[#f4f5fb] text-left text-[12px] uppercase tracking-wider text-[#6f7282]">
              <th className="px-4 py-3">Заголовок</th>
              <th className="px-4 py-3">Slug</th>
              <th className="px-4 py-3">Теги</th>
              <th className="px-4 py-3">Публикация</th>
              <th className="px-4 py-3 text-right">Действия</th>
            </tr>
          </thead>
          <tbody>
            {articles.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-10 text-center text-[14px] text-[#6f7282]"
                >
                  Пока нет статей. Нажмите «Новая статья».
                </td>
              </tr>
            ) : (
              articles.map((a) => (
                <tr
                  key={a.id}
                  className="border-t border-[#e2e5ef] hover:bg-[#fafbff]"
                >
                  <td className="px-4 py-3">
                    <div className="font-medium">{a.title}</div>
                    <div className="mt-0.5 line-clamp-1 text-[12px] text-[#6f7282]">
                      {a.excerpt}
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono text-[12px] text-[#6f7282]">
                    {a.slug}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {a.tags.slice(0, 3).map((t) => (
                        <span
                          key={t}
                          className="rounded-full bg-[#f5f6ff] px-2 py-0.5 text-[11px] text-[#3848c7]"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {a.publishedAt ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-[#ecfdf5] px-2 py-0.5 text-[12px] text-[#116b2a]">
                        <Eye className="size-3" />
                        {new Date(a.publishedAt).toLocaleDateString("ru-RU")}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-[#f4f5fb] px-2 py-0.5 text-[12px] text-[#6f7282]">
                        <EyeOff className="size-3" />
                        Черновик
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      {a.publishedAt && (
                        <Link
                          href={`/blog/${a.slug}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="rounded-lg p-1.5 text-[#6f7282] hover:bg-[#f5f6ff] hover:text-[#3848c7]"
                          title="Открыть"
                        >
                          <ExternalLink className="size-4" />
                        </Link>
                      )}
                      <button
                        type="button"
                        onClick={() => togglePublish(a)}
                        disabled={isPending}
                        className="rounded-lg p-1.5 text-[#6f7282] hover:bg-[#f5f6ff] hover:text-[#116b2a]"
                        title={a.publishedAt ? "Снять" : "Опубликовать"}
                      >
                        {a.publishedAt ? (
                          <EyeOff className="size-4" />
                        ) : (
                          <Eye className="size-4" />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditing(a)}
                        className="rounded-lg p-1.5 text-[#6f7282] hover:bg-[#f5f6ff] hover:text-[#3848c7]"
                        title="Редактировать"
                      >
                        <Pencil className="size-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => remove(a)}
                        className="rounded-lg p-1.5 text-[#6f7282] hover:bg-[#fff4f2] hover:text-[#a13a32]"
                        title="Удалить"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {(editing || creating) && (
        <ArticleEditor
          article={editing}
          onClose={() => {
            setEditing(null);
            setCreating(false);
          }}
          onSaved={() => {
            setEditing(null);
            setCreating(false);
            refresh();
          }}
        />
      )}
    </div>
  );
}

function ArticleEditor({
  article,
  onClose,
  onSaved,
}: {
  article: ArticleRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isCreate = !article;
  const [slug, setSlug] = useState(article?.slug ?? "");
  const [title, setTitle] = useState(article?.title ?? "");
  const [excerpt, setExcerpt] = useState(article?.excerpt ?? "");
  const [tags, setTags] = useState((article?.tags ?? []).join(", "));
  const [coverIcon, setCoverIcon] = useState(article?.coverIcon ?? "");
  const [readMinutes, setReadMinutes] = useState(article?.readMinutes ?? 5);
  const [publishedAt, setPublishedAt] = useState(
    article?.publishedAt ? article.publishedAt.slice(0, 10) : ""
  );
  const [bodyJson, setBodyJson] = useState(
    article ? JSON.stringify(article.body, null, 2) : EMPTY_BODY
  );
  const [saving, setSaving] = useState(false);

  async function save() {
    let parsed: unknown;
    try {
      parsed = JSON.parse(bodyJson);
    } catch {
      toast.error("Тело статьи — не валидный JSON");
      return;
    }
    setSaving(true);
    const payload = {
      slug: slug.trim(),
      title: title.trim(),
      excerpt: excerpt.trim(),
      body: parsed,
      coverIcon: coverIcon.trim() || null,
      tags: tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
      readMinutes: Number(readMinutes) || 5,
      publishedAt: publishedAt ? new Date(publishedAt).toISOString() : null,
    };
    const res = await fetch(
      isCreate ? "/api/root/articles" : `/api/root/articles/${article.id}`,
      {
        method: isCreate ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );
    setSaving(false);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      toast.error(j.error || "Не удалось сохранить");
      return;
    }
    toast.success(isCreate ? "Статья создана" : "Сохранено");
    onSaved();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#0b1024]/40 p-4"
      onClick={onClose}
    >
      <BodyScrollLock />
      <div
        className="flex max-h-[90vh] supports-[height:100dvh]:max-h-[90dvh] w-full max-w-[calc(100vw-1rem)] flex-col overflow-hidden rounded-3xl bg-white shadow-2xl sm:max-w-[900px]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-[#e2e5ef] px-6 py-4">
          <h2 className="text-[18px] font-semibold">
            {isCreate ? "Новая статья" : "Редактировать статью"}
          </h2>
        </div>
        <div className="grid flex-1 gap-4 overflow-y-auto p-6 md:grid-cols-2">
          <label className="flex flex-col gap-1 text-[13px]">
            <span className="font-medium text-[#0b1024]">Slug (URL)</span>
            <input
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              className="rounded-xl border border-[#dcdfed] bg-white px-3 py-2 font-mono text-[13px] focus:border-[#5566f6] focus:outline-none"
              placeholder="my-new-article"
            />
          </label>
          <label className="flex flex-col gap-1 text-[13px]">
            <span className="font-medium text-[#0b1024]">Дата публикации</span>
            <input
              type="date"
              value={publishedAt}
              onChange={(e) => setPublishedAt(e.target.value)}
              className="rounded-xl border border-[#dcdfed] bg-white px-3 py-2 focus:border-[#5566f6] focus:outline-none"
            />
          </label>
          <label className="flex flex-col gap-1 text-[13px] md:col-span-2">
            <span className="font-medium text-[#0b1024]">Заголовок</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="rounded-xl border border-[#dcdfed] bg-white px-3 py-2 focus:border-[#5566f6] focus:outline-none"
            />
          </label>
          <label className="flex flex-col gap-1 text-[13px] md:col-span-2">
            <span className="font-medium text-[#0b1024]">Краткое описание</span>
            <textarea
              value={excerpt}
              onChange={(e) => setExcerpt(e.target.value)}
              rows={2}
              className="rounded-xl border border-[#dcdfed] bg-white px-3 py-2 focus:border-[#5566f6] focus:outline-none"
            />
          </label>
          <label className="flex flex-col gap-1 text-[13px]">
            <span className="font-medium text-[#0b1024]">
              Теги (через запятую)
            </span>
            <input
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              className="rounded-xl border border-[#dcdfed] bg-white px-3 py-2 focus:border-[#5566f6] focus:outline-none"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-[13px]">
              <span className="font-medium text-[#0b1024]">Иконка</span>
              <input
                value={coverIcon}
                onChange={(e) => setCoverIcon(e.target.value)}
                className="rounded-xl border border-[#dcdfed] bg-white px-3 py-2 focus:border-[#5566f6] focus:outline-none"
                placeholder="ShieldCheck"
              />
            </label>
            <label className="flex flex-col gap-1 text-[13px]">
              <span className="font-medium text-[#0b1024]">Время, мин</span>
              <input
                type="number" inputMode="decimal"
                min={1}
                value={readMinutes}
                onChange={(e) => setReadMinutes(Number(e.target.value))}
                className="rounded-xl border border-[#dcdfed] bg-white px-3 py-2 focus:border-[#5566f6] focus:outline-none"
              />
            </label>
          </div>
          <label className="flex flex-col gap-1 text-[13px] md:col-span-2">
            <span className="font-medium text-[#0b1024]">
              Тело (JSON ArticleBlock[])
            </span>
            <textarea
              value={bodyJson}
              onChange={(e) => setBodyJson(e.target.value)}
              rows={14}
              spellCheck={false}
              className="rounded-xl border border-[#dcdfed] bg-[#fafbff] p-3 font-mono text-[12px] focus:border-[#5566f6] focus:outline-none"
            />
            <span className="text-[11px] text-[#6f7282]">
              Типы: p, h2, h3, ul, ol, quote, callout (tone: info|warn|tip).
            </span>
          </label>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-[#e2e5ef] bg-[#fafbff] px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-[#dcdfed] bg-white px-4 py-2 text-[13px] font-medium text-[#0b1024] hover:bg-[#f5f6ff]"
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-xl bg-[#5566f6] px-4 py-2 text-[13px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] hover:bg-[#4a5bf0] disabled:opacity-60"
          >
            {saving ? "Сохранение…" : "Сохранить"}
          </button>
        </div>
      </div>
    </div>
  );
}
