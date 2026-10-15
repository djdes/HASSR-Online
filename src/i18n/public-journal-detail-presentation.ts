import { JOURNAL_INFO, type JournalInfo } from "@/content/journal-info";
import { JOURNAL_SEO, type JournalSeo } from "@/content/journal-seo";
import { journalHeadline } from "@/lib/journal-headline";
import type { Locale } from "./locales";
import type { Messages } from "./messages";

type DetailMessages = Pick<Messages,
  "publicJournalDetailInfo" | "publicJournalDetailSeo" | "publicJournalIndex" | "journalInfoTaglines" | "journals"
>;

function ownKey<T extends object>(object: T, key: string): key is keyof T & string {
  return Object.hasOwn(object, key);
}

function item<T extends object>(object: T | undefined, index: number): T[keyof T] {
  const key = `item${index}`;
  if (!object || !ownKey(object, key)) throw new Error(`Unmapped public journal text slot: ${key}`);
  return object[key];
}

/** Project only immutable product content; stored journal records never enter this presenter. */
export function presentPublicJournalDetail(messages: DetailMessages, locale: Locale, code: string) {
  if (!ownKey(JOURNAL_INFO, code)) return null;
  const source = JOURNAL_INFO[code];
  if (!ownKey(messages.publicJournalDetailInfo, code)
    || !ownKey(messages.publicJournalIndex.descriptions, code)
    || !ownKey(messages.journalInfoTaglines, code)
    || !ownKey(messages.journals.names, code)) {
    throw new Error(`Unmapped public journal detail: ${code}`);
  }
  const copy: {
    whatToFill?: Record<string, string>;
    normative?: Record<string, { title: string; pointer?: string }>;
    tips?: Record<string, string>;
  } = messages.publicJournalDetailInfo[code];
  const info: JournalInfo = {
    ...source,
    tagline: messages.journalInfoTaglines[code],
    why: messages.publicJournalIndex.descriptions[code],
    whatToFill: source.whatToFill.map((_, index) => item(copy.whatToFill, index)),
    normative: source.normative.map((norm, index) => {
      const translated = item(copy.normative, index);
      if (norm.pointer && !translated.pointer) throw new Error(`Unmapped public journal normative pointer: ${code}/${index}`);
      return {
        ...norm,
        title: translated.title,
        ...(norm.pointer ? { pointer: translated.pointer } : {}),
      };
    }),
    tips: source.tips.map((_, index) => item(copy.tips, index)),
  };
  let seo: JournalSeo | undefined;
  const sourceSeo = JOURNAL_SEO[code];
  if (sourceSeo) {
    if (!ownKey(messages.publicJournalDetailSeo, code)) throw new Error(`Unmapped public journal SEO: ${code}`);
    const seoCopy = messages.publicJournalDetailSeo[code];
    seo = {
      ...sourceSeo,
      title: seoCopy.title,
      description: seoCopy.description,
      seoIntro: seoCopy.seoIntro,
      keywords: sourceSeo.keywords.map((_, index) => item(seoCopy.keywords, index)),
    };
  }
  const catalogName = messages.journals.names[code];
  const name = locale === "ru" ? journalHeadline(seo?.title, catalogName, info.tagline) : catalogName;
  const related = Object.values(JOURNAL_INFO)
    .filter(candidate => candidate.category === source.category && candidate.code !== code)
    .slice(0, 4)
    .map(candidate => {
      if (!ownKey(messages.journalInfoTaglines, candidate.code)) throw new Error(`Unmapped related journal: ${candidate.code}`);
      return { code: candidate.code, tagline: messages.journalInfoTaglines[candidate.code] };
    });
  return { info, seo, name, catalogName, related };
}
