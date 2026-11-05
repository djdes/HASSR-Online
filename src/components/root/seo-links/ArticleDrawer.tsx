"use client";

import { useEffect, useMemo, useState } from "react";
import { Code2, ExternalLink, Eye, FileText, Loader2, Save, X } from "lucide-react";
import { toast } from "sonner";
import type { GglAnchorKind } from "@/lib/seo/gogetlinks-planner";
import {
  formatAnchorKindLabel,
  formatPlacementFormatLabel,
  formatRub,
  sanitizeArticleHtmlForPreview,
} from "@/lib/seo/gogetlinks-ui-format";
import {
  formatRuShortDate,
  type GglPlannedSlotDto,
  SEO_BTN_OUTLINE_CLASS,
  SEO_BTN_PRIMARY_CLASS,
  SEO_INPUT_CLASS,
  SEO_TEXTAREA_CLASS,
  shortWesetupPath,
} from "./types";

export interface ArticleDrawerProps {
  slot: GglPlannedSlotDto | null;
  readOnly?: boolean;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}

export function ArticleDrawer({
  slot,
  readOnly = false,
  onClose,
  onSaved,
}: ArticleDrawerProps) {
  useEffect(() => {
    if (!slot) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [slot, onClose]);

  if (!slot) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-[#0b1024]/40 backdrop-blur-[1px]"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <ArticleDrawerInner
        key={`${slot.id}:${slot.updatedAt ?? ""}`}
        slot={slot}
        readOnly={readOnly}
        onClose={onClose}
        onSaved={onSaved}
      />
    </div>
  );
}

function ArticleDrawerInner({
  slot,
  readOnly,
  onClose,
  onSaved,
}: {
  slot: GglPlannedSlotDto;
  readOnly: boolean;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const locked =
    readOnly || slot.status === "ordered" || slot.status === "approved_sending";

  const [anchor, setAnchor] = useState(
    slot.anchor ?? slot.article?.anchor ?? "wesetup.ru",
  );
  const [anchorKind, setAnchorKind] = useState<GglAnchorKind>(
    slot.anchorKind === "exact" ||
      slot.anchorKind === "diluted" ||
      slot.anchorKind === "url_brand"
      ? slot.anchorKind
      : "url_brand",
  );
  const [title, setTitle] = useState(slot.article?.title ?? "");
  const [announcement, setAnnouncement] = useState(
    slot.article?.announcement ?? "",
  );
  const [bodyHtml, setBodyHtml] = useState(slot.article?.bodyHtml ?? "");
  const [briefText, setBriefText] = useState(slot.briefText ?? "");
  const [editorTab, setEditorTab] = useState<"preview" | "html">(
    slot.article?.bodyHtml ? "preview" : "html",
  );
  const [saving, setSaving] = useState(false);

  const safePreviewHtml = useMemo(
    () => sanitizeArticleHtmlForPreview(bodyHtml),
    [bodyHtml],
  );

  const targetHref = slot.targetUrl
    ? slot.targetUrl.startsWith("http")
      ? slot.targetUrl
      : `https://wesetup.ru${slot.targetUrl.startsWith("/") ? "" : "/"}${slot.targetUrl}`
    : null;

  async function handleSave() {
    if (locked) return;
    const cleanAnchor = anchor.trim();
    if (!cleanAnchor) {
      toast.error("Укажите текст анкора");
      return;
    }

    const cleanTitle = title.trim();
    const cleanAnnouncement = announcement.trim();
    const cleanBody = bodyHtml.trim();

    if ((cleanTitle || cleanBody) && cleanTitle.length < 3) {
      toast.error("Заголовок статьи должен быть не короче 3 символов");
      return;
    }
    if ((cleanTitle || cleanBody) && cleanBody.length < 10) {
      toast.error("Текст статьи (HTML) должен содержать минимум 10 символов");
      return;
    }

    const articlePatch: Record<string, unknown> = {
      anchor: cleanAnchor,
      anchorKind,
      briefText: briefText.trim(),
    };
    if (cleanTitle.length >= 3) {
      articlePatch.title = cleanTitle;
    }
    if (cleanAnnouncement.length >= 3) {
      articlePatch.announcement = cleanAnnouncement;
    }
    if (cleanBody.length >= 10) {
      articlePatch.bodyHtml = cleanBody;
    }

    setSaving(true);
    try {
      const response = await fetch(
        `/api/root/gogetlinks/slots/${encodeURIComponent(slot.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "update_article",
            articlePatch,
          }),
        },
      );
      const data = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!response.ok) {
        throw new Error(data?.error ?? "Не удалось сохранить статью / ТЗ слота");
      }
      toast.success("Статья, анкор и ТЗ слота сохранены");
      await onSaved();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Ошибка сохранения");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Статья и ТЗ слота GoGetLinks"
      className="flex h-full w-full max-w-[760px] flex-col border-l border-[#dcdfed] bg-white shadow-2xl"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-4 border-b border-[#ececf4] px-6 py-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-[12px] font-medium text-[#6f7282]">
            <FileText className="size-4 text-[#5566f6]" />
            <span>Слот {formatRuShortDate(slot.scheduledDate)}</span>
            <span>·</span>
            <span>{formatPlacementFormatLabel(slot.placementFormat)}</span>
            {slot.donorDomain ? (
              <>
                <span>·</span>
                <span className="font-semibold text-[#0b1024]">
                  {slot.donorDomain}
                </span>
              </>
            ) : null}
            <span>·</span>
            <span>
              {formatRub(slot.estimatedPriceRub ?? slot.maxPriceRub)}
            </span>
          </div>
          <h2 className="mt-1 truncate text-[18px] font-semibold text-[#0b1024]">
            {slot.article?.title || "Статья, анкор и ТЗ для размещения"}
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl border border-[#dcdfed] text-[#6f7282] transition-colors hover:bg-[#f5f6ff] hover:text-[#0b1024]"
          aria-label="Закрыть панель"
        >
          <X className="size-4" />
        </button>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
        {/* Context box */}
        <div className="rounded-2xl border border-[#dcdfed] bg-[#fafbff] p-4 text-[13px]">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <span className="text-[#6f7282]">Целевая страница: </span>
              {targetHref ? (
                <a
                  href={targetHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-medium text-[#3848c7] underline-offset-2 hover:underline"
                >
                  {shortWesetupPath(slot.targetUrl)}
                  <ExternalLink className="size-3.5" />
                </a>
              ) : (
                <span className="font-medium text-[#0b1024]">не назначена</span>
              )}
            </div>
            {slot.targetKeyword ? (
              <div>
                <span className="text-[#6f7282]">Ключевой кластер: </span>
                <span className="font-medium text-[#0b1024]">
                  {slot.targetKeyword}
                </span>
              </div>
            ) : null}
          </div>
          {slot.selectionReason ? (
            <p className="mt-2 text-[12.5px] leading-relaxed text-[#3c4053]">
              {slot.selectionReason}
            </p>
          ) : null}
        </div>

        {/* Anchor & anchor kind */}
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <label className="mb-1.5 block text-[12.5px] font-medium text-[#0b1024]">
              Текст анкора ссылки
            </label>
            <input
              type="text"
              value={anchor}
              disabled={locked}
              onChange={(e) => setAnchor(e.target.value)}
              placeholder="wesetup.ru или естественная фраза"
              className={SEO_INPUT_CLASS}
            />
          </div>
          <div>
            <label className="mb-1.5 block text-[12.5px] font-medium text-[#0b1024]">
              Тип анкора
            </label>
            <select
              value={anchorKind}
              disabled={locked}
              onChange={(e) => setAnchorKind(e.target.value as GglAnchorKind)}
              className={SEO_INPUT_CLASS}
            >
              <option value="url_brand">
                {formatAnchorKindLabel("url_brand")}
              </option>
              <option value="diluted">{formatAnchorKindLabel("diluted")}</option>
              <option value="exact">{formatAnchorKindLabel("exact")}</option>
            </select>
          </div>
        </div>

        {/* Brief / task for webmaster */}
        <div>
          <label className="mb-1.5 block text-[12.5px] font-medium text-[#0b1024]">
            Короткое ТЗ и околоссылочный контекст для вебмастера
          </label>
          <textarea
            rows={3}
            value={briefText}
            disabled={locked}
            onChange={(e) => setBriefText(e.target.value)}
            placeholder="Пожелания по размещению ссылки, тематике абзаца и естественному окружению анкора…"
            className={SEO_TEXTAREA_CLASS}
          />
        </div>

        {/* Article fields */}
        <div className="space-y-3 border-t border-[#ececf4] pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-[13px] font-semibold text-[#0b1024]">
              Готовая экспертная статья (формат «Статья» в GoGetLinks)
            </div>
            <div className="inline-flex rounded-xl border border-[#dcdfed] bg-[#fafbff] p-0.5">
              <button
                type="button"
                onClick={() => setEditorTab("preview")}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1 text-[12px] font-medium transition-colors ${
                  editorTab === "preview"
                    ? "bg-[#eef1ff] text-[#3848c7]"
                    : "text-[#6f7282] hover:text-[#0b1024]"
                }`}
              >
                <Eye className="size-3.5" />
                Превью
              </button>
              <button
                type="button"
                onClick={() => setEditorTab("html")}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1 text-[12px] font-medium transition-colors ${
                  editorTab === "html"
                    ? "bg-[#eef1ff] text-[#3848c7]"
                    : "text-[#6f7282] hover:text-[#0b1024]"
                }`}
              >
                <Code2 className="size-3.5" />
                HTML / Редактор
              </button>
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-[12.5px] font-medium text-[#0b1024]">
              Заголовок статьи
            </label>
            <input
              type="text"
              value={title}
              disabled={locked}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Экспертный заголовок без рекламного шума"
              className={SEO_INPUT_CLASS}
            />
          </div>

          <div>
            <label className="mb-1.5 block text-[12.5px] font-medium text-[#0b1024]">
              Анонс статьи (announcement)
            </label>
            <textarea
              rows={2}
              value={announcement}
              disabled={locked}
              onChange={(e) => setAnnouncement(e.target.value)}
              placeholder="Краткое вступление (1–2 предложения) для карточки статьи в GoGetLinks"
              className={SEO_TEXTAREA_CLASS}
            />
          </div>

          {editorTab === "preview" ? (
            <div className="rounded-2xl border border-[#dcdfed] bg-[#fafbff] p-4">
              {safePreviewHtml ? (
                <div
                  className="prose prose-sm max-w-none text-[13.5px] leading-relaxed text-[#0b1024] [&_a]:font-medium [&_a]:text-primary [&_a]:underline [&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:text-[16px] [&_h2]:font-semibold [&_h3]:mt-3 [&_h3]:mb-1.5 [&_h3]:text-[14.5px] [&_h3]:font-semibold [&_li]:ml-5 [&_li]:list-disc [&_p]:mb-2.5"
                  dangerouslySetInnerHTML={{ __html: safePreviewHtml }}
                />
              ) : (
                <div className="py-8 text-center text-[13px] text-[#6f7282]">
                  Статья ещё не сгенерирована (или для слота выбран формат «Заметка» с ТЗ). Переключитесь на вкладку «HTML / Редактор», чтобы задать текст вручную.
                </div>
              )}
            </div>
          ) : (
            <div>
              <label className="mb-1.5 block text-[12.5px] font-medium text-[#0b1024]">
                HTML-текст статьи (допустимы абзацы, подзаголовки, списки и ссылка &lt;a href=&quot;...&quot;&gt;)
              </label>
              <textarea
                rows={12}
                value={bodyHtml}
                disabled={locked}
                onChange={(e) => setBodyHtml(e.target.value)}
                placeholder="<p>Текст экспертной статьи с органичной ссылкой на <a href=&quot;https://wesetup.ru/...&quot;>wesetup.ru</a>...</p>"
                className={`${SEO_TEXTAREA_CLASS} font-mono text-[12.5px]`}
              />
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between gap-3 border-t border-[#ececf4] bg-[#fafbff] px-6 py-4">
        <div className="text-[12px] text-[#6f7282]">
          {locked
            ? "Слот уже отправлен или находится в режиме чтения"
            : "Правки сохраняются в черновик до подтверждения закупки"}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            className={SEO_BTN_OUTLINE_CLASS}
          >
            Закрыть
          </button>
          {!locked ? (
            <button
              type="button"
              disabled={saving}
              onClick={() => void handleSave()}
              className={SEO_BTN_PRIMARY_CLASS}
            >
              {saving ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Save className="size-4" />
              )}
              {saving ? "Сохранение…" : "Сохранить правки"}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
