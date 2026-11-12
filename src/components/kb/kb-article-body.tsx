import Link from "next/link";
import { ArrowRight, Info, TriangleAlert } from "lucide-react";

import type { KbArticle } from "@/content/kb/articles";
import { KbPhones, KbShotFigure } from "@/components/kb/kb-shot";
import { kbInline } from "@/components/kb/kb-inline";

/** Блоки статьи базы знаний: текст, шаги, списки, снимки и подсказки. */
export function KbArticleBody({ article }: { article: KbArticle }) {
  return (
    <div className="text-[15.5px] leading-[1.7] text-[#3c4053]">
      {article.blocks.map((block, index) => {
        switch (block.t) {
          case "h2":
            return (
              <h2 key={index} id={`s-${index}`} className="mb-3 mt-10 scroll-mt-32 text-[22px] font-semibold leading-tight tracking-[-0.02em] text-[#0b1024]">
                {block.text}
              </h2>
            );
          case "p":
            return <p key={index} className="my-4">{kbInline(block.text)}</p>;
          case "list":
            return (
              <ul key={index} className="my-4 space-y-2">
                {block.items.map((item, i) => (
                  <li key={i} className="flex gap-3">
                    <span className="mt-[11px] size-1.5 shrink-0 rounded-full bg-[#5566f6]" />
                    <span>{kbInline(item)}</span>
                  </li>
                ))}
              </ul>
            );
          case "steps":
            return (
              <ol key={index} className="my-5 space-y-0">
                {block.items.map((item, i) => (
                  <li key={i} className="relative flex gap-4 pb-5 last:pb-0">
                    {i < block.items.length - 1 ? <span className="absolute left-[15px] top-9 h-[calc(100%-2.25rem)] w-px bg-[#dcdfed]" /> : null}
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[#eef1ff] text-[14px] font-semibold tabular-nums text-[#3848c7]">{i + 1}</span>
                    <div className="min-w-0 pt-1">
                      <div className="text-[15.5px] font-semibold leading-snug text-[#0b1024]">{item.title}</div>
                      <p className="mt-1 text-[14.5px] leading-[1.6]">{kbInline(item.text)}</p>
                    </div>
                  </li>
                ))}
              </ol>
            );
          case "cards":
            return (
              <div key={index} className="my-5 grid gap-3 sm:grid-cols-2">
                {block.items.map((item, i) => {
                  const inner = (
                    <>
                      <div className="flex items-center justify-between gap-2 text-[15px] font-semibold text-[#0b1024]">
                        {item.title}
                        {item.href ? <ArrowRight className="size-4 shrink-0 text-[#5566f6] transition-transform group-hover:translate-x-0.5" /> : null}
                      </div>
                      <p className="mt-1.5 text-[13.5px] leading-[1.55] text-[#6f7282]">{item.text}</p>
                    </>
                  );
                  const cls = "group block rounded-2xl border border-[#ececf4] bg-white p-4 transition-colors";
                  return item.href ? (
                    <Link key={i} href={item.href} className={`${cls} hover:border-[#5566f6]/40 hover:bg-[#f5f6ff]`}>{inner}</Link>
                  ) : (
                    <div key={i} className={cls}>{inner}</div>
                  );
                })}
              </div>
            );
          case "tip": {
            const warn = block.tone === "warn";
            const Icon = warn ? TriangleAlert : Info;
            return (
              <div key={index} className={`my-5 flex gap-3 rounded-2xl border px-4 py-3.5 text-[14.5px] leading-[1.6] ${warn ? "border-[#f3d6d2] bg-[#fff4f2] text-[#a13a32]" : "border-[#dfe4ff] bg-[#f5f6ff] text-[#3c4053]"}`}>
                <Icon className={`mt-0.5 size-[18px] shrink-0 ${warn ? "text-[#d2453d]" : "text-[#5566f6]"}`} />
                <div>{kbInline(block.text)}</div>
              </div>
            );
          }
          case "shot":
            return <KbShotFigure key={index} id={block.id} title={block.title} />;
          case "phones":
            return <KbPhones key={index} ids={block.ids} />;
        }
      })}
    </div>
  );
}
