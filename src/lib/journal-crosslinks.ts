import { BLOG_RELATED_JOURNALS } from "@/lib/blog-related-journals";
import { SEO_LANDINGS } from "@/content/seo-landings";
import { bundledArticleTranslation } from "@/content/article-translations/catalog";
import type { Locale } from "@/i18n/locales";

const RU_ARTICLE_TITLES: Record<string, string> = {
  "elektronnyj-vs-bumazhnyj-zhurnal": "Электронный или бумажный журнал: что примет инспектор",
  "sanpin-2026-chto-izmenilos": "СанПиН в 2026 году: что изменилось и что осталось прежним",
  "proverka-rospotrebnadzora-chek-list": "Проверка Роспотребнадзора: чек-лист за день до визита",
  "xaccp-za-30-minut": "ХАССП за 30 минут: как внедрить систему в небольшом кафе",
  "vnutrennyaya-vs-vneshnyaya-dokumentatsiya-xaccp": "ХАССП: внутренняя и внешняя документация — чем отличаются",
  "uxod-ot-formalnogo-ucheta": "Журналы «для галочки» больше не работают: требования 2026",
  "zhurnal-dezinfektsii": "Журнал дезинфекции: что писать и как хранить акты",
  "zhurnal-temperatur-oborudovaniya": "Журнал температуры холодильников: как вести без штрафов",
  "uchet-friturnyx-zhirov": "Учёт фритюрных жиров: когда менять масло и что писать",
  "tri-vida-uborki": "Текущая и генеральная уборка: что писать в журнал",
  "zhurnal-otxodov": "Учёт пищевых отходов: движение, утилизация, акты",
  "zhurnal-proslezhivaemosti": "Прослеживаемость: как за 20 минут найти путь партии",
  "vnutrennij-audit-otchet": "Внутренний аудит ХАССП: как составить полезный отчёт",
  "mojka-i-dezinfektsiya-oborudovaniya": "Мойка и дезинфекция оборудования: как оформить без претензий",
  "uf-baktericidnyie-lampy": "УФ-лампы: как вести учёт работы и не превысить ресурс",
  "sanpin-bez-byurokratii": "Санитарные нормы для общепита: реально нужный минимум",
  "brakerazhnyi-zhurnal": "Бракеражный журнал: как вести и не ошибиться с партией",
  "obyazatelnyie-zhurnaly-dlya-obshchepita": "Обязательные журналы для общепита: минимальный набор",
  "temperatura-xolodilnikov-vitrin": "Температура холодильников и витрин: нормы и контроль",
  "xaccp-dlya-restoratorov": "ХАССП для рестораторов: три страницы, которые спасают бизнес",
  "sinxronizatciya-iiko-1c": "Синхронизация с iiko и 1С: что заполняется автоматически",
  "chek-list-priemki-syrya-v-restorane": "Чек-лист приёмки сырья в ресторане и кафе по СанПиН 2.3/2.4.4282-26",
  "programma-proizvodstvennogo-kontrolya-obshchepit": "Программа производственного контроля (ППК) для общепита в 2026 году",
  "markirovka-produktov-i-zagotovok-na-kuhne": "Маркировка продуктов, заготовок и уборочного инвентаря на кухне по СанПиН",
  "usloviya-i-sroki-hraneniya-produktov-obshchepit": "Товарное соседство и условия хранения продуктов в холодильниках общепита",
  "obrabotka-yaic-i-sutochnye-proby-sanpin": "Обработка яиц и отбор суточных проб в общепите по СанПиН 2.3/2.4.4282-26",
};

export type RelatedBlogArticleLink = {
  slug: string;
  title: string;
};

/**
 * Pure static cross-link lookup from a journal catalog code to related blog
 * articles in the active locale (never touches Prisma/DB).
 * Ranks primary/dedicated matches (earlier position in `codes` and narrower
 * journal list) ahead of broad multi-journal overview articles.
 */
export function relatedBlogArticlesForJournal(
  code: string,
  locale: Locale,
  limit = 5,
): RelatedBlogArticleLink[] {
  const candidates: Array<{
    slug: string;
    title: string;
    rank: number;
    breadth: number;
  }> = [];
  for (const [slug, codes] of Object.entries(BLOG_RELATED_JOURNALS)) {
    const rank = codes.indexOf(code);
    if (rank === -1) continue;
    const title =
      locale === "ru"
        ? RU_ARTICLE_TITLES[slug]
        : bundledArticleTranslation(slug, locale)?.title;
    if (!title) continue;
    candidates.push({ slug, title, rank, breadth: codes.length });
  }
  candidates.sort((a, b) => a.rank - b.rank || a.breadth - b.breadth);
  return candidates.slice(0, limit).map(({ slug, title }) => ({ slug, title }));
}

/**
 * Returns the commercial SEO landing slug matching a journal catalog code
 * (if one exists in SEO_LANDINGS).
 */
export function primarySeoLandingSlugForJournal(code: string): string | null {
  for (const landing of Object.values(SEO_LANDINGS)) {
    if (landing.relatedCode === code) return landing.slug;
  }
  return null;
}
