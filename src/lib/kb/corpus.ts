import { KB_GROUPS, kbPlain, type KbArticle, type KbBlock } from "@/content/kb/articles";
import { KB_SHOTS } from "@/content/kb/shots";

/**
 * Текст базы знаний для «Спросить у ИИ»: все статьи с подписями к меткам
 * снимков. Ответ строится только по нему — ассистент не выдумывает функции.
 */
function blockText(block: KbBlock): string {
  switch (block.t) {
    case "p":
    case "tip":
      return kbPlain(block.text);
    case "h2":
      return `## ${block.text}`;
    case "list":
      return block.items.map((item) => `- ${kbPlain(item)}`).join("\n");
    case "steps":
      return block.items.map((item, index) => `${index + 1}. ${item.title}: ${kbPlain(item.text)}`).join("\n");
    case "cards":
      return block.items.map((item) => `- ${item.title}: ${kbPlain(item.text)}`).join("\n");
    case "guide":
      return `${block.title}: ${block.text}`;
    case "shot":
      return shotText([block.id]);
    case "phones":
      return shotText(block.ids);
  }
}

function shotText(ids: string[]): string {
  return ids
    .flatMap((id) => {
      const shot = KB_SHOTS[id];
      if (!shot) return [];
      const lines = shot.marks.map((mark) => `- [экран] ${mark.title}: ${mark.text}`);
      if (shot.caption) lines.unshift(`- [экран] ${shot.caption}${shot.sub ? `: ${shot.sub}` : ""}`);
      return lines;
    })
    .join("\n");
}

export function kbArticleText(article: KbArticle): string {
  return [`# ${article.title} (/baza-znaniy/${article.slug})`, article.lead, ...article.blocks.map(blockText)].filter(Boolean).join("\n");
}

export function kbCorpus(): string {
  return KB_GROUPS.map((group) => [`=== ${group.title} ===`, ...group.articles.map(kbArticleText)].join("\n\n")).join("\n\n");
}
