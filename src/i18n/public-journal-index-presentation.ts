import { JOURNAL_INFO, type JournalInfo } from "@/content/journal-info";
import { NICHES } from "@/content/niches";
import { SEO_LANDINGS } from "@/content/seo-landings";
import type { Messages } from "./messages";

export const PUBLIC_JOURNAL_CATEGORY_ORDER = ["sanpin_daily", "sanpin_periodic", "haccp"] as const satisfies readonly JournalInfo["category"][];
type IndexMessages = Pick<Messages, "publicJournalIndex" | "journalInfoTaglines" | "journals">;

function ownKey<T extends object>(object: T, key: string): key is keyof T & string {
  return Object.hasOwn(object, key);
}

/** Only product-owned index data enters this projection. IDs and source objects stay intact. */
export function presentPublicJournalIndex(messages: IndexMessages) {
  const copy = messages.publicJournalIndex;
  const all = Object.values(JOURNAL_INFO).map((source) => {
    const code = source.code;
    if (!ownKey(copy.descriptions, code) || !ownKey(messages.journalInfoTaglines, code) || !ownKey(messages.journals.names, code)) {
      throw new Error(`Unmapped public journal: ${code}`);
    }
    return { ...source, name: messages.journals.names[code], tagline: messages.journalInfoTaglines[code], why: copy.descriptions[code] };
  });
  return {
    count: all.length,
    grouped: PUBLIC_JOURNAL_CATEGORY_ORDER.map(category => ({
      category, label: copy.categories[category], items: all.filter(item => item.category === category),
    })),
    niches: Object.values(NICHES).map(source => {
      if (!ownKey(copy.nicheLinks, source.slug)) throw new Error(`Unmapped public journal niche: ${source.slug}`);
      return { ...source, audience: copy.nicheLinks[source.slug] };
    }),
    seo: Object.values(SEO_LANDINGS).slice(0, 7).map(source => {
      if (!ownKey(copy.seoLinks, source.slug)) throw new Error(`Unmapped public journal SEO link: ${source.slug}`);
      return { ...source, hero: copy.seoLinks[source.slug] };
    }),
  };
}
