// Generated from validated, version-bound article translations. No database writes.
import type { ArticleTranslationContent } from "@/lib/article-localization";
import type { Locale } from "@/i18n/locales";
import en0 from "./en/elektronnyj-vs-bumazhnyj-zhurnal.json";
import uz0 from "./uz/elektronnyj-vs-bumazhnyj-zhurnal.json";
import en1 from "./en/sanpin-2026-chto-izmenilos.json";
import uz1 from "./uz/sanpin-2026-chto-izmenilos.json";
import en2 from "./en/proverka-rospotrebnadzora-chek-list.json";
import uz2 from "./uz/proverka-rospotrebnadzora-chek-list.json";
import en3 from "./en/xaccp-za-30-minut.json";
import uz3 from "./uz/xaccp-za-30-minut.json";
import en4 from "./en/vnutrennyaya-vs-vneshnyaya-dokumentatsiya-xaccp.json";
import uz4 from "./uz/vnutrennyaya-vs-vneshnyaya-dokumentatsiya-xaccp.json";
import en5 from "./en/uxod-ot-formalnogo-ucheta.json";
import uz5 from "./uz/uxod-ot-formalnogo-ucheta.json";
import en6 from "./en/zhurnal-dezinfektsii.json";
import uz6 from "./uz/zhurnal-dezinfektsii.json";
import en7 from "./en/zhurnal-temperatur-oborudovaniya.json";
import uz7 from "./uz/zhurnal-temperatur-oborudovaniya.json";
import en8 from "./en/uchet-friturnyx-zhirov.json";
import uz8 from "./uz/uchet-friturnyx-zhirov.json";
import en9 from "./en/tri-vida-uborki.json";
import uz9 from "./uz/tri-vida-uborki.json";
import en10 from "./en/zhurnal-otxodov.json";
import uz10 from "./uz/zhurnal-otxodov.json";
import en11 from "./en/zhurnal-proslezhivaemosti.json";
import uz11 from "./uz/zhurnal-proslezhivaemosti.json";
import en12 from "./en/vnutrennij-audit-otchet.json";
import uz12 from "./uz/vnutrennij-audit-otchet.json";
import en13 from "./en/mojka-i-dezinfektsiya-oborudovaniya.json";
import uz13 from "./uz/mojka-i-dezinfektsiya-oborudovaniya.json";
import en14 from "./en/uf-baktericidnyie-lampy.json";
import uz14 from "./uz/uf-baktericidnyie-lampy.json";
import en15 from "./en/sanpin-bez-byurokratii.json";
import uz15 from "./uz/sanpin-bez-byurokratii.json";
import en16 from "./en/brakerazhnyi-zhurnal.json";
import uz16 from "./uz/brakerazhnyi-zhurnal.json";
import en17 from "./en/obyazatelnyie-zhurnaly-dlya-obshchepita.json";
import uz17 from "./uz/obyazatelnyie-zhurnaly-dlya-obshchepita.json";
import en18 from "./en/temperatura-xolodilnikov-vitrin.json";
import uz18 from "./uz/temperatura-xolodilnikov-vitrin.json";
import en19 from "./en/xaccp-dlya-restoratorov.json";
import uz19 from "./uz/xaccp-dlya-restoratorov.json";
import en20 from "./en/sinxronizatciya-iiko-1c.json";
import uz20 from "./uz/sinxronizatciya-iiko-1c.json";
const catalog: Record<string, Partial<Record<Locale, ArticleTranslationContent>>> = {
  "elektronnyj-vs-bumazhnyj-zhurnal": { en: en0, uz: uz0 },
  "sanpin-2026-chto-izmenilos": { en: en1, uz: uz1 },
  "proverka-rospotrebnadzora-chek-list": { en: en2, uz: uz2 },
  "xaccp-za-30-minut": { en: en3, uz: uz3 },
  "vnutrennyaya-vs-vneshnyaya-dokumentatsiya-xaccp": { en: en4, uz: uz4 },
  "uxod-ot-formalnogo-ucheta": { en: en5, uz: uz5 },
  "zhurnal-dezinfektsii": { en: en6, uz: uz6 },
  "zhurnal-temperatur-oborudovaniya": { en: en7, uz: uz7 },
  "uchet-friturnyx-zhirov": { en: en8, uz: uz8 },
  "tri-vida-uborki": { en: en9, uz: uz9 },
  "zhurnal-otxodov": { en: en10, uz: uz10 },
  "zhurnal-proslezhivaemosti": { en: en11, uz: uz11 },
  "vnutrennij-audit-otchet": { en: en12, uz: uz12 },
  "mojka-i-dezinfektsiya-oborudovaniya": { en: en13, uz: uz13 },
  "uf-baktericidnyie-lampy": { en: en14, uz: uz14 },
  "sanpin-bez-byurokratii": { en: en15, uz: uz15 },
  "brakerazhnyi-zhurnal": { en: en16, uz: uz16 },
  "obyazatelnyie-zhurnaly-dlya-obshchepita": { en: en17, uz: uz17 },
  "temperatura-xolodilnikov-vitrin": { en: en18, uz: uz18 },
  "xaccp-dlya-restoratorov": { en: en19, uz: uz19 },
  "sinxronizatciya-iiko-1c": { en: en20, uz: uz20 },
};
export function bundledArticleTranslation(slug: string, locale: Locale): ArticleTranslationContent | undefined {
  return Object.hasOwn(catalog, slug) ? catalog[slug][locale] : undefined;
}
