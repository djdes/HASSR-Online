"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowUp, BookOpen, Loader2, Menu, Search, Sparkles, X } from "lucide-react";

import { KB_ARTICLES, KB_GROUPS } from "@/content/kb/articles";
import { kbInline } from "@/components/kb/kb-inline";
import { kbArticleText } from "@/lib/kb/corpus";
import { cn } from "@/lib/utils";

/**
 * Оболочка базы знаний в духе документации (developers.oxylabs.io):
 * полоса «База знаний · поиск · Спросить у ИИ», слева — разделы, справа —
 * «На этой странице». На телефоне разделы открываются кнопкой-бургером.
 */
export function KbShell({ current = null, toc = [], children }: { current?: string | null; toc?: { id: string; text: string }[]; children: ReactNode }) {
  const [navOpen, setNavOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [askOpen, setAskOpen] = useState(false);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if ((event.key === "k" && (event.metaKey || event.ctrlKey)) || (event.key === "/" && !typing)) {
        event.preventDefault();
        setSearchOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const locked = navOpen || searchOpen || askOpen;
    document.documentElement.style.overflow = locked ? "hidden" : "";
    return () => {
      document.documentElement.style.overflow = "";
    };
  }, [navOpen, searchOpen, askOpen]);

  return (
    <div className="kb-shell">
      <div className="border-b border-[#ececf4] bg-[#fafbff]">
        <div className="mx-auto flex max-w-[1320px] items-center gap-2 px-4 py-3 sm:gap-3 sm:px-6">
          <button type="button" onClick={() => setNavOpen(true)} aria-label="Разделы базы знаний" className="inline-flex size-10 shrink-0 items-center justify-center rounded-2xl border border-[#dcdfed] bg-white text-[#0b1024] transition-colors hover:bg-[#f5f6ff] lg:hidden">
            <Menu className="size-[18px]" />
          </button>
          <Link href="/baza-znaniy" className="hidden shrink-0 items-center gap-2 text-[15px] font-semibold text-[#0b1024] sm:inline-flex">
            <span className="flex size-8 items-center justify-center rounded-xl bg-[#eef1ff] text-[#5566f6]">
              <BookOpen className="size-4" />
            </span>
            База знаний
          </Link>
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-3.5 text-left text-[14px] text-[#9b9fb3] transition-colors hover:border-[#5566f6]/40 sm:ml-4 sm:max-w-[420px]"
          >
            <Search className="size-4 shrink-0 text-[#6f7282]" />
            <span className="min-w-0 flex-1 truncate">Поиск по базе знаний</span>
            <kbd className="hidden rounded-md border border-[#ececf4] bg-[#fafbff] px-1.5 text-[11px] font-medium text-[#9b9fb3] sm:inline">Ctrl K</kbd>
          </button>
          <button
            type="button"
            onClick={() => setAskOpen(true)}
            data-kb-ask
            className="inline-flex h-10 shrink-0 items-center gap-2 rounded-2xl bg-[#5566f6] px-3.5 text-[14px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors hover:bg-[#4a5bf0] sm:ml-auto sm:px-4"
          >
            <Sparkles className="size-4" />
            <span className="hidden min-[400px]:inline">Спросить у ИИ</span>
            <span className="min-[400px]:hidden">ИИ</span>
          </button>
        </div>
      </div>

      <div className="mx-auto flex max-w-[1320px] gap-10 px-4 sm:px-6">
        <aside className="hidden w-[250px] shrink-0 lg:block">
          <div className="sticky top-24 max-h-[calc(100vh-7rem)] overflow-y-auto py-8 pr-2">
            <KbNav current={current} />
          </div>
        </aside>
        <main className="min-w-0 flex-1 py-8 sm:py-10">{children}</main>
        {toc.length ? (
          <aside className="hidden w-[210px] shrink-0 xl:block">
            <div className="sticky top-24 py-10">
              <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#9b9fb3]">На этой странице</div>
              <ul className="space-y-2 border-l border-[#ececf4]">
                {toc.map((item) => (
                  <li key={item.id}>
                    <a href={`#${item.id}`} className="-ml-px block border-l border-transparent pl-3 text-[13.5px] leading-snug text-[#6f7282] transition-colors hover:border-[#5566f6] hover:text-[#0b1024]">
                      {item.text}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </aside>
        ) : null}
      </div>

      {navOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Разделы базы знаний">
          <button type="button" aria-label="Закрыть" className="absolute inset-0 bg-[#0b1024]/40" onClick={() => setNavOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-[min(320px,88vw)] flex-col bg-white shadow-[0_20px_60px_-30px_rgba(11,16,36,0.55)]">
            <div className="flex items-center justify-between border-b border-[#ececf4] px-4 py-3">
              <Link href="/baza-znaniy" onClick={() => setNavOpen(false)} className="inline-flex items-center gap-2 text-[15px] font-semibold text-[#0b1024]">
                <span className="flex size-8 items-center justify-center rounded-xl bg-[#eef1ff] text-[#5566f6]">
                  <BookOpen className="size-4" />
                </span>
                База знаний
              </Link>
              <button type="button" onClick={() => setNavOpen(false)} aria-label="Закрыть" className="rounded-xl p-2 text-[#6f7282] hover:bg-[#f5f6ff]">
                <X className="size-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-5">
              <KbNav current={current} onNavigate={() => setNavOpen(false)} />
            </div>
          </div>
        </div>
      ) : null}
      {searchOpen ? <KbSearch onClose={() => setSearchOpen(false)} onAsk={() => { setSearchOpen(false); setAskOpen(true); }} /> : null}
      {askOpen ? <KbAsk onClose={() => setAskOpen(false)} /> : null}
    </div>
  );
}

function KbNav({ current, onNavigate }: { current: string | null; onNavigate?: () => void }) {
  return (
    <nav className="space-y-6" aria-label="Разделы базы знаний">
      {KB_GROUPS.map((group) => (
        <div key={group.id}>
          <div className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#9b9fb3]">{group.title}</div>
          <ul className="space-y-0.5">
            {group.articles.map((article) => {
              const active = article.slug === current;
              return (
                <li key={article.slug}>
                  <Link
                    href={`/baza-znaniy/${article.slug}`}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "block rounded-xl px-3 py-1.5 text-[14px] leading-snug transition-colors",
                      active ? "bg-[#eef1ff] font-medium text-[#3848c7]" : "text-[#3c4053] hover:bg-[#f5f6ff] hover:text-[#0b1024]",
                    )}
                  >
                    {article.nav ?? article.title}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function Overlay({ onClose, label, children, wide = false }: { onClose: () => void; label: string; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center sm:px-4 sm:pt-[10vh]" role="dialog" aria-modal="true" aria-label={label}>
      <button type="button" aria-label="Закрыть" className="absolute inset-0 bg-[#0b1024]/40" onClick={onClose} />
      <div className={cn("relative flex h-full w-full flex-col overflow-hidden bg-white shadow-[0_24px_60px_-24px_rgba(11,16,36,0.45)] sm:h-auto sm:max-h-[78vh] sm:rounded-3xl sm:border sm:border-[#ececf4]", wide ? "sm:max-w-[680px]" : "sm:max-w-[600px]")}>
        {children}
      </div>
    </div>
  );
}

const SEARCH_INDEX = KB_ARTICLES.map((article) => ({ article, text: kbArticleText(article).toLowerCase() }));

function snippet(text: string, word: string): string {
  const plain = text.replace(/^#.*$/gm, "").replace(/\s+/g, " ").trim();
  const at = plain.toLowerCase().indexOf(word);
  if (at < 0) return plain.slice(0, 140);
  const start = Math.max(0, at - 50);
  return `${start > 0 ? "…" : ""}${plain.slice(start, start + 150)}…`;
}

function KbSearch({ onClose, onAsk }: { onClose: () => void; onAsk: () => void }) {
  const [query, setQuery] = useState("");
  const words = query.toLowerCase().split(/\s+/).filter((word) => word.length > 1);
  const results = !words.length
    ? []
    : SEARCH_INDEX.map(({ article, text }) => {
      if (!words.every((word) => text.includes(word))) return null;
      const title = article.title.toLowerCase();
      const score = words.reduce((sum, word) => sum + (title.includes(word) ? 10 : 0) + text.split(word).length, 0);
      return { article, score, text: kbArticleText(article) };
    })
      .filter((row): row is NonNullable<typeof row> => row !== null)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);
  return (
    <Overlay onClose={onClose} label="Поиск по базе знаний">
      <div className="flex items-center gap-3 border-b border-[#ececf4] px-4 py-3">
        <Search className="size-5 shrink-0 text-[#5566f6]" />
        <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Например: PIN, холодильник, проверка" className="h-10 min-w-0 flex-1 bg-transparent text-[16px] text-[#0b1024] outline-none placeholder:text-[#9b9fb3]" />
        <button type="button" onClick={onClose} aria-label="Закрыть" className="rounded-xl p-2 text-[#6f7282] hover:bg-[#f5f6ff]">
          <X className="size-5" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {!words.length ? (
          <div className="px-3 py-6 text-[14px] text-[#6f7282]">Введите слово или фразу — ищем по всем статьям и подписям к снимкам.</div>
        ) : results.length ? (
          <ul>
            {results.map(({ article, text }) => (
              <li key={article.slug}>
                <Link href={`/baza-znaniy/${article.slug}`} onClick={onClose} className="block rounded-2xl px-3 py-2.5 transition-colors hover:bg-[#f5f6ff]">
                  <div className="text-[14.5px] font-semibold text-[#0b1024]">{article.title}</div>
                  <div className="mt-0.5 line-clamp-2 text-[13px] leading-[1.5] text-[#6f7282]">{snippet(text, words[0])}</div>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <div className="px-3 py-6 text-[14px] text-[#6f7282]">Ничего не нашлось.</div>
        )}
      </div>
      <button type="button" onClick={onAsk} className="flex items-center gap-2 border-t border-[#ececf4] px-5 py-3.5 text-left text-[14px] font-medium text-[#3848c7] transition-colors hover:bg-[#f5f6ff]">
        <Sparkles className="size-4 text-[#5566f6]" />
        Не нашли? Спросите у ИИ
      </button>
    </Overlay>
  );
}

type Turn = { role: "user" | "assistant"; content: string; error?: boolean };

const SUGGESTIONS = [
  "С чего начать работу в WeSetup?",
  "Как сотрудник заполняет журнал с телефона?",
  "Что делать, если пришла проверка?",
  "Сколько стоит и как оплатить?",
];

/** Ответ ассистента: абзацы и списки, `**жирный**`, ссылки на статьи. */
function AnswerText({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/);
  return (
    <div className="space-y-2.5">
      {blocks.map((block, index) => {
        const lines = block.split("\n").filter((line) => line.trim());
        const isList = lines.length > 0 && lines.every((line) => /^\s*([-•*]|\d+[.)])\s+/.test(line));
        if (isList) {
          return (
            <ul key={index} className="space-y-1.5">
              {lines.map((line, i) => (
                <li key={i} className="flex gap-2.5">
                  <span className="mt-[9px] size-1.5 shrink-0 rounded-full bg-[#5566f6]" />
                  <span>{kbInline(line.replace(/^\s*([-•*]|\d+[.)])\s+/, ""))}</span>
                </li>
              ))}
            </ul>
          );
        }
        return <p key={index}>{kbInline(lines.join(" "))}</p>;
      })}
    </div>
  );
}

function KbAsk({ onClose }: { onClose: () => void }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns, busy]);

  async function ask(question: string) {
    const text = question.trim();
    if (text.length < 3 || busy) return;
    const history = turns.filter((turn) => !turn.error).slice(-6).map(({ role, content }) => ({ role, content }));
    setTurns((prev) => [...prev, { role: "user", content: text }]);
    setDraft("");
    setBusy(true);
    try {
      const response = await fetch("/api/kb/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: text, history }) });
      const data = (await response.json().catch(() => ({}))) as { answer?: string; error?: string };
      setTurns((prev) => [...prev, data.answer ? { role: "assistant", content: data.answer } : { role: "assistant", content: data.error ?? "Не удалось получить ответ. Попробуйте ещё раз.", error: true }]);
    } catch {
      setTurns((prev) => [...prev, { role: "assistant", content: "Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.", error: true }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Overlay onClose={onClose} label="Спросить у ИИ" wide>
      <div className="flex items-center gap-3 border-b border-[#ececf4] px-5 py-3.5">
        <span className="flex size-9 items-center justify-center rounded-xl bg-[#eef1ff] text-[#5566f6]">
          <Sparkles className="size-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-semibold text-[#0b1024]">Спросить у ИИ</div>
          <div className="text-[12.5px] text-[#6f7282]">Отвечает по материалам базы знаний WeSetup</div>
        </div>
        <button type="button" onClick={onClose} aria-label="Закрыть" className="rounded-xl p-2 text-[#6f7282] hover:bg-[#f5f6ff]">
          <X className="size-5" />
        </button>
      </div>
      <div className="min-h-[200px] flex-1 overflow-y-auto px-5 py-4 text-[14.5px] leading-[1.6] text-[#3c4053]">
        {!turns.length ? (
          <div>
            <p className="text-[#6f7282]">Задайте вопрос о работе с сервисом — например:</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {SUGGESTIONS.map((suggestion) => (
                <button key={suggestion} type="button" onClick={() => ask(suggestion)} className="rounded-full border border-[#dcdfed] bg-white px-3 py-1.5 text-left text-[13px] text-[#3848c7] transition-colors hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]">
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {turns.map((turn, index) =>
              turn.role === "user" ? (
                <div key={index} className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-[#5566f6] px-3.5 py-2 text-white">{turn.content}</div>
              ) : (
                <div key={index} className={cn("max-w-[95%] rounded-2xl rounded-bl-md px-4 py-3", turn.error ? "bg-[#fff4f2] text-[#a13a32]" : "bg-[#f5f6ff]")}>
                  <AnswerText text={turn.content} />
                </div>
              ),
            )}
            {busy ? (
              <div className="flex items-center gap-2 text-[13.5px] text-[#6f7282]">
                <Loader2 className="size-4 animate-spin text-[#5566f6]" />
                Ассистент читает базу знаний — обычно 10–40 секунд
              </div>
            ) : null}
          </div>
        )}
        <div ref={endRef} />
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void ask(draft);
        }}
        className="flex items-end gap-2 border-t border-[#ececf4] p-3"
      >
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void ask(draft);
            }
          }}
          rows={1}
          maxLength={600}
          autoFocus
          placeholder="Ваш вопрос"
          className="max-h-32 min-h-11 flex-1 resize-none rounded-2xl border border-[#dcdfed] bg-white px-4 py-2.5 text-[15px] text-[#0b1024] placeholder:text-[#9b9fb3] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
        />
        <button type="submit" disabled={busy || draft.trim().length < 3} aria-label="Отправить" className="inline-flex size-11 shrink-0 items-center justify-center rounded-2xl bg-[#5566f6] text-white transition-colors hover:bg-[#4a5bf0] disabled:bg-[#dcdfed]">
          <ArrowUp className="size-5" />
        </button>
      </form>
    </Overlay>
  );
}
