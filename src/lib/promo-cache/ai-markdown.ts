import { CITIES } from "@/content/cities";
import { COMPARISONS, COMPARISON_ORDER } from "@/content/comparisons";
import { FEATURES_INFO, FEATURES_ORDER } from "@/content/features";
import { GLOSSARY } from "@/content/glossary";
import { JOURNAL_INFO } from "@/content/journal-info";
import { JOURNAL_SEO } from "@/content/journal-seo";
import { KB_ARTICLES, KB_GROUPS, kbArticle, kbGroupOf, kbNeighbours, type KbBlock } from "@/content/kb/articles";
import { NICHES } from "@/content/niches";
import { SEO_LANDINGS } from "@/content/seo-landings";
import type { Locale } from "@/i18n/locales";
import { loadBaseMessages, type Messages } from "@/i18n/messages";
import { presentPublicJournalDetail } from "@/i18n/public-journal-detail-presentation";
import { publicJournalDetailFaq } from "@/i18n/public-journal-detail-faq";
import { presentPublicJournalIndex } from "@/i18n/public-journal-index-presentation";
import { localizedHref, publicLocaleRoute } from "@/i18n/site-locale";
import { isArticleBlockArray, type ArticleBlock } from "@/lib/article-blocks";
import { COMPANY_EMAIL, COMPANY_PHONE, COMPANY_TELEGRAM } from "@/lib/company-contacts";
import { JOURNALS_TOTAL } from "@/lib/journal-catalog";
import { buildNicheFaq } from "@/lib/niche-faq";
import { applyPromotion } from "@/lib/promo/promotions";
import { isPublicCacheablePage } from "@/lib/robots-txt";
import { groupServices } from "@/lib/services/constants";
import { buildSpherePublicContent } from "@/lib/sphere-public-content";
import {
  PAID_TIERS,
  SEATS_PER_POINT,
  TRIAL_DAYS,
  planMonthlyRub,
} from "@/lib/tariff-plans";
import { formatRub } from "@/lib/tariffs";
import { applyOverrides } from "@/lib/translations/catalog";

import {
  readPromoActivePromotion,
  readPromoActiveServices,
  readPromoBlogArticleDetail,
  readPromoJournalUsageCount,
  readPromoPartnerRewardRule,
  readPromoPlanPricing,
  readPromoPublicReviews,
  readPromoPublishedArticles,
  readPromoTranslationOverrides,
} from "./datasets";

export {
  alternateMarkdownPath,
  prefersMarkdown,
  resolvePromoMarkdownTarget,
} from "./markdown-negotiation";

const SITE = "https://wesetup.ru";

async function loadCachedMessages(locale: Locale, dir?: string): Promise<Messages> {
  const base = await loadBaseMessages(locale);
  const overrides = await readPromoTranslationOverrides({ dir });
  const forLocale = overrides
    .filter((row) => row.locale === locale)
    .map((row): [string, string] => [row.key, row.value]);
  return forLocale.length > 0 ? applyOverrides(base, forLocale) : base;
}

function renderArticleBlocksMd(blocks: readonly ArticleBlock[]): string {
  const out: string[] = [];
  for (const block of blocks) {
    switch (block.type) {
      case "p":
        out.push(block.text);
        break;
      case "h2":
        out.push(`## ${block.text}`);
        break;
      case "h3":
        out.push(`### ${block.text}`);
        break;
      case "ul":
        out.push(block.items.map((it) => `- ${it}`).join("\n"));
        break;
      case "ol":
        out.push(block.items.map((it, idx) => `${idx + 1}. ${it}`).join("\n"));
        break;
      case "quote":
        out.push(`> ${block.text}${block.author ? `\n> — *${block.author}*` : ""}`);
        break;
      case "callout":
        out.push(`> **${block.title ?? "Примечание"}:** ${block.text}`);
        break;
      case "faq":
        out.push("## Вопросы и ответы");
        for (const item of block.items) {
          out.push(`### ${item.q}\n\n${item.a}`);
        }
        break;
    }
  }
  return out.join("\n\n");
}

function renderKbBlocksMd(blocks: readonly KbBlock[]): string {
  const out: string[] = [];
  for (const block of blocks) {
    switch (block.t) {
      case "p":
        out.push(block.text);
        break;
      case "h2":
        out.push(`## ${block.text}`);
        break;
      case "list":
        out.push(block.items.map((it) => `- ${it}`).join("\n"));
        break;
      case "steps":
        out.push(
          block.items
            .map((step, i) => `${i + 1}. **${step.title}** — ${step.text}`)
            .join("\n"),
        );
        break;
      case "cards":
        out.push(
          block.items
            .map((card) =>
              card.href
                ? `- **[${card.title}](${SITE}${card.href})** — ${card.text}`
                : `- **${card.title}** — ${card.text}`,
            )
            .join("\n"),
        );
        break;
      case "tip":
        out.push(`> ${block.text}`);
        break;
      case "guide":
        out.push(`> **${block.title}:** ${block.text}`);
        break;
      case "shot":
      case "phones":
        break;
    }
  }
  return out.join("\n\n");
}

export type RenderedPromoMarkdown = {
  markdown: string;
  canonicalUrl: string;
  locale: Locale;
};

export async function renderPromoMarkdown(
  rawPathname: string,
  options?: { dir?: string; now?: Date },
): Promise<RenderedPromoMarkdown | null> {
  const now = options?.now ?? new Date();
  const dir = options?.dir;
  const normalized =
    rawPathname.length > 1 ? rawPathname.replace(/\/+$/, "") : rawPathname;
  if (!isPublicCacheablePage(normalized)) return null;

  const localized = publicLocaleRoute(normalized);
  const locale: Locale = localized?.locale ?? "ru";
  const basePath = localized ? localized.pathname : normalized;
  const canonicalUrl = `${SITE}${localizedHref(basePath, locale)}`;

  const headerMeta = (title: string, description?: string) => [
    `# ${title}`,
    ...(description ? [`> ${description}`] : []),
    `Canonical: ${canonicalUrl}`,
  ];

  // 1. Landing `/` (`/en`, `/uz`)
  if (basePath === "/") {
    const [pricing, promotion, reviews, messages] = await Promise.all([
      readPromoPlanPricing({ dir }),
      readPromoActivePromotion(now, { dir }),
      readPromoPublicReviews(6, { dir }),
      loadCachedMessages(locale, dir),
    ]);
    const stdYear = applyPromotion(planMonthlyRub(pricing.rates, "standard", "year"), promotion);
    const premYear = applyPromotion(planMonthlyRub(pricing.rates, "premium", "year"), promotion);
    const vipYear = applyPromotion(planMonthlyRub(pricing.rates, "vip", "year"), promotion);

    const lines: string[] = [
      ...headerMeta(
        messages.landing.metadata.title,
        messages.landing.seo.softwareDescription.replace("{journalCount}", String(JOURNALS_TOTAL)),
      ),
      "",
      "## Ключевые возможности",
      `- Заполнение по QR-коду с телефона сотрудника за секунды (${SITE}/features/qr)`,
      `- Автозаполнение регулярных замеров по расписанию (${SITE}/avtozapolnenie)`,
      `- ${JOURNALS_TOTAL} готовых журналов СанПиН 2.3/2.4.4282-26 и ХАССП (${SITE}/journals-info)`,
      `- Интеграция с iiko, 1С и IoT-датчиками температуры (${SITE}/features/sync-iiko-1c)`,
      `- Мгновенная выгрузка PDF с подписями для проверки Роспотребнадзора`,
      "",
      "## Тарифы",
      `- **Бесплатный**: первые ${TRIAL_DAYS} дней полный доступ без карты, далее 1 сотрудник и 1 журнал — 0 ₽`,
      `- **Стандарт** (до ${SEATS_PER_POINT.standard} сотрудников на точку): от ${formatRub(stdYear.priceRub)}/мес при оплате за год (${formatRub(planMonthlyRub(pricing.rates, "standard", "month"))}/мес помесячно)`,
      `- **Премиум** (до ${SEATS_PER_POINT.premium} сотрудников на точку): от ${formatRub(premYear.priceRub)}/мес при оплате за год (${formatRub(planMonthlyRub(pricing.rates, "premium", "month"))}/мес помесячно)`,
      `- **ВИП** (до ${SEATS_PER_POINT.vip} сотрудников на точку): от ${formatRub(vipYear.priceRub)}/мес при оплате за год (${formatRub(planMonthlyRub(pricing.rates, "vip", "month"))}/мес помесячно)`,
    ];

    if (reviews.length > 0) {
      lines.push("", "## Отзывы клиентов");
      for (const r of reviews) {
        lines.push(`- «${r.quote}» — *${r.author}${r.place ? `, ${r.place}` : ""}*`);
      }
    }

    lines.push(
      "",
      "## Отраслевые решения",
      ...Object.values(NICHES).map((n) => `- [${n.navLabel}](${SITE}/${n.slug}) — ${n.audience}`),
      "",
      "## Контакты",
      `- Сайт: ${SITE}`,
      `- Телефон: ${COMPANY_PHONE.display}`,
      `- Почта: ${COMPANY_EMAIL}`,
      `- Telegram: ${COMPANY_TELEGRAM.url}`,
    );

    return { markdown: `${lines.join("\n")}\n`, canonicalUrl, locale };
  }

  // 2. Pricing `/pricing`
  if (basePath === "/pricing") {
    const [pricing, promotion] = await Promise.all([
      readPromoPlanPricing({ dir }),
      readPromoActivePromotion(now, { dir }),
    ]);
    const lines: string[] = [
      ...headerMeta(
        "Тарифы и цены WeSetup на электронные журналы СанПиН и ХАССП",
        `Первые ${TRIAL_DAYS} дней бесплатно без привязки карты. Все ${JOURNALS_TOTAL} журналов включены.`,
      ),
      "",
      "| Тариф | Сотрудников на точку | За год (в месяц) | Помесячно |",
      "|---|---|---|---|",
      `| Бесплатный | 1 (после ${TRIAL_DAYS} дней) | 0 ₽ | 0 ₽ |`,
      ...PAID_TIERS.map((tier) => {
        const yearPrice = applyPromotion(planMonthlyRub(pricing.rates, tier, "year"), promotion);
        const monthPrice = applyPromotion(planMonthlyRub(pricing.rates, tier, "month"), promotion);
        const label = { standard: "Стандарт", premium: "Премиум", vip: "ВИП" }[tier];
        return `| ${label} | до ${SEATS_PER_POINT[tier]} | ${formatRub(yearPrice.priceRub)} | ${formatRub(monthPrice.priceRub)} |`;
      }),
    ];
    if (promotion) {
      lines.push("", `> Акция «${promotion.title}»: скидка ${promotion.percent}% действует до ${promotion.endsAt.slice(0, 10)}.`);
    }
    return { markdown: `${lines.join("\n")}\n`, canonicalUrl, locale };
  }

  // 3. Partners `/partners`
  if (basePath === "/partners") {
    const [rule, pricing] = await Promise.all([
      readPromoPartnerRewardRule({ dir }),
      readPromoPlanPricing({ dir }),
    ]);
    const stdMonth = planMonthlyRub(pricing.rates, "standard", "month");
    const lines = [
      ...headerMeta(
        "Партнёрская программа WeSetup",
        `Вознаграждение ${rule.subscriptionPercent}% с оплат подписки клиента (${rule.subscriptionMonths} мес.) и ${rule.hardwarePercent}% с оборудования.`,
      ),
      "",
      "## Условия вознаграждения",
      `- **Доля с подписки**: ${rule.subscriptionPercent}% в течение ${rule.subscriptionMonths} месяцев (пример со «Стандарта» ${formatRub(stdMonth)}/мес)`,
      `- **Доля с оборудования**: ${rule.hardwarePercent}%`,
      `- **Бонус за запуск клиента**: ${formatRub(rule.bonusAmountRub)} после ${rule.bonusAfterPayments}-й оплаты`,
      `- **Минимальная сумма вывода**: ${formatRub(rule.minPayoutRub)}`,
      `- Подать заявку: ${SITE}/register?next=%2Fsettings%2Fpartner`,
    ];
    return { markdown: `${lines.join("\n")}\n`, canonicalUrl, locale };
  }

  // 4. Services `/uslugi`
  if (basePath === "/uslugi") {
    const services = await readPromoActiveServices({ dir });
    const groups = groupServices(services);
    const lines = [
      ...headerMeta(
        "Услуги по пищевой безопасности: аудит, ХАССП и ППК — WeSetup",
        "Аудит перед проверкой Роспотребнадзора, разработка документации ХАССП и ППК, консультации и обучение персонала.",
      ),
    ];
    for (const group of groups) {
      lines.push("", `## ${group.label}`);
      for (const item of group.items) {
        lines.push(`### ${item.title}\n\n${item.summary}\n\n${item.description}`);
      }
    }
    return { markdown: `${lines.join("\n")}\n`, canonicalUrl, locale };
  }

  // 5. Blog Index `/blog`
  if (basePath === "/blog") {
    const articles = await readPromoPublishedArticles(locale, now, { dir });
    const lines = [
      ...headerMeta(
        "Блог WeSetup о СанПиН, ХАССП и проверках Роспотребнадзора",
        "Практические руководства, разборы санитарных правил и чек-листы для общепита и пищевого производства.",
      ),
      "",
      "## Опубликованные статьи",
      ...articles.map(
        (a) =>
          `- [${a.title}](${SITE}${localizedHref(`/blog/${a.slug}`, locale)}) (${a.publishedAt.toISOString().slice(0, 10)}, ${a.readMinutes} мин) — ${a.excerpt}`,
      ),
    ];
    return { markdown: `${lines.join("\n")}\n`, canonicalUrl, locale };
  }

  // 6. Blog Article `/blog/[slug]`
  if (basePath.startsWith("/blog/")) {
    const slug = basePath.slice("/blog/".length);
    if (!slug || slug.includes("/")) return null;
    const detail = await readPromoBlogArticleDetail(slug, locale, now, { dir });
    if (!detail) return null;
    const { article, related } = detail;
    const blocks = isArticleBlockArray(article.body) ? article.body : [];
    const lines = [
      ...headerMeta(article.title, article.excerpt),
      `Published: ${article.publishedAt.toISOString().slice(0, 10)} · Reading time: ${article.readMinutes} min · Tags: ${article.displayTags.join(", ")}`,
      "",
      renderArticleBlocksMd(blocks),
    ];
    if (related.length > 0) {
      lines.push(
        "",
        "## Похожие статьи",
        ...related.map((r) => `- [${r.title}](${SITE}${localizedHref(`/blog/${r.slug}`, locale)}) — ${r.excerpt}`),
      );
    }
    return { markdown: `${lines.join("\n")}\n`, canonicalUrl, locale: article.contentLocale };
  }

  // 7. Knowledge Base `/baza-znaniy` & `/baza-znaniy/[slug]`
  if (basePath === "/baza-znaniy") {
    const lines = [
      ...headerMeta(
        "База знаний WeSetup",
        "Как начать работу и пользоваться WeSetup: кабинет руководителя, журналы СанПиН и ХАССП, телефон сотрудника, чек-листы, ППК и проверка.",
      ),
    ];
    for (const group of KB_GROUPS) {
      lines.push("", `## ${group.title}`);
      for (const a of group.articles) {
        lines.push(`- [${a.title}](${SITE}/baza-znaniy/${a.slug}) — ${a.lead}`);
      }
    }
    return { markdown: `${lines.join("\n")}\n`, canonicalUrl, locale: "ru" };
  }

  if (basePath.startsWith("/baza-znaniy/")) {
    const slug = basePath.slice("/baza-znaniy/".length);
    const article = kbArticle(slug);
    if (!article) return null;
    const group = kbGroupOf(slug);
    const { prev, next } = kbNeighbours(slug);
    const lines = [
      ...headerMeta(article.title, article.lead),
      ...(group ? [`Раздел: ${group.title}`] : []),
      "",
      renderKbBlocksMd(article.blocks),
    ];
    if (prev || next) {
      lines.push("", "## Навигация по базе знаний");
      if (prev) lines.push(`- Назад: [${prev.title}](${SITE}/baza-znaniy/${prev.slug})`);
      if (next) lines.push(`- Далее: [${next.title}](${SITE}/baza-znaniy/${next.slug})`);
    }
    return { markdown: `${lines.join("\n")}\n`, canonicalUrl, locale: "ru" };
  }

  // 8. Journals Catalog `/journals-info` & `/journals-info/[code]`
  if (basePath === "/journals-info") {
    const messages = await loadCachedMessages(locale, dir);
    const { grouped, count } = presentPublicJournalIndex(messages);
    const lines = [
      ...headerMeta(
        `Каталог ${count} электронных журналов СанПиН и ХАССП — WeSetup`,
        "Нормативная база, состав граф и образцы заполнения каждого журнала.",
      ),
    ];
    for (const group of grouped) {
      lines.push("", `## ${group.label}`);
      for (const item of group.items) {
        lines.push(`- [${item.name}](${SITE}${localizedHref(`/journals-info/${item.code}`, locale)}) — ${item.tagline}`);
      }
    }
    return { markdown: `${lines.join("\n")}\n`, canonicalUrl, locale };
  }

  if (basePath.startsWith("/journals-info/")) {
    const code = basePath.slice("/journals-info/".length);
    if (!code || code.includes("/")) return null;
    const [messages, usageCount] = await Promise.all([
      loadCachedMessages(locale, dir),
      readPromoJournalUsageCount(code, { dir }),
    ]);
    const detail = presentPublicJournalDetail(messages, locale, code);
    if (!detail) return null;
    const faq = publicJournalDetailFaq(detail.info, detail.name, locale, messages);
    const lines = [
      ...headerMeta(detail.seo?.title ?? detail.name, detail.seo?.description ?? detail.info.tagline),
      ...(usageCount > 0 ? [`Организаций, ведущих этот журнал в WeSetup: ${usageCount}`] : []),
      "",
      "## Назначение журнала",
      detail.info.why,
      "",
      "## Что фиксируется (графы журнала)",
      ...detail.info.whatToFill.map((col) => `- ${col}`),
      "",
      "## Нормативная база",
      ...detail.info.normative.map((n) => `- ${n.title}${n.pointer ? ` (${n.pointer})` : ""}`),
      "",
      "## Рекомендации по ведению",
      ...detail.info.tips.map((tip) => `- ${tip}`),
    ];
    if (faq.length > 0) {
      lines.push("", "## Вопросы и ответы");
      for (const item of faq) {
        lines.push(`### ${item.q}\n\n${item.a}`);
      }
    }
    return { markdown: `${lines.join("\n")}\n`, canonicalUrl, locale };
  }

  // 9. Features `/features` & `/features/[slug]`
  if (basePath === "/features") {
    const lines = [
      ...headerMeta("Возможности платформы WeSetup", "Автоматизация журналов СанПиН и ХАССП, QR-коды, напоминания и выгрузка для проверок."),
      "",
      ...FEATURES_ORDER.map((slug) => {
        const f = FEATURES_INFO[slug];
        return f ? `- **[${f.title}](${SITE}${localizedHref(`/features/${slug}`, locale)})** — ${f.tagline}` : "";
      }).filter(Boolean),
    ];
    return { markdown: `${lines.join("\n")}\n`, canonicalUrl, locale };
  }

  if (basePath.startsWith("/features/")) {
    const slug = basePath.slice("/features/".length);
    const f = FEATURES_INFO[slug];
    if (!f) return null;
    const lines = [
      ...headerMeta(f.title, f.tagline),
      "",
      renderArticleBlocksMd(f.body),
    ];
    return { markdown: `${lines.join("\n")}\n`, canonicalUrl, locale };
  }

  // 10. Industry Niche Landings `/<dlya-*>`
  const rootSlug = basePath.slice(1);
  if (rootSlug && !rootSlug.includes("/") && Object.hasOwn(NICHES, rootSlug)) {
    const niche = NICHES[rootSlug];
    const sphereContent = buildSpherePublicContent(niche.sphere);
    const faq = buildNicheFaq(niche);
    const lines = [
      ...headerMeta(niche.hero, niche.promise),
      `Аудитория: ${niche.audience}`,
      "",
      "## Задачи, которые закрывает сервис",
      ...niche.pains.map((p) => `- ${p}`),
      "",
      "## Обязательные и рекомендуемые электронные журналы",
      ...[...sphereContent.required, ...sphereContent.recommended].map((j) => {
        const details = [j.basisLabel, j.condition, j.note].filter(Boolean).join("; ");
        const link = j.href ? `[${j.name}](${SITE}${j.href})` : j.name;
        return details ? `- ${link} — ${details}` : `- ${link}`;
      }),
      "",
      "## Вопросы и ответы",
      ...faq.map((f) => `### ${f.q}\n\n${f.a}`),
    ];
    return { markdown: `${lines.join("\n")}\n`, canonicalUrl, locale: "ru" };
  }

  // 11. Commercial SEO Journal Landings `/<zhurnal-*>`
  if (rootSlug && !rootSlug.includes("/") && Object.hasOwn(SEO_LANDINGS, rootSlug)) {
    const seoLanding = SEO_LANDINGS[rootSlug];
    const lines = [
      ...headerMeta(seoLanding.hero, seoLanding.metaDescription),
      "",
      seoLanding.intro,
      "",
      "## Обязательные графы и реквизиты",
      ...seoLanding.fields.map((f) => `- ${f}`),
      "",
      "## Преимущества электронного ведения в WeSetup",
      seoLanding.weSetupBenefit,
    ];
    if (seoLanding.faq?.length) {
      lines.push("", "## Вопросы и ответы");
      for (const item of seoLanding.faq) {
        lines.push(`### ${item.q}\n\n${item.a}`);
      }
    }
    return { markdown: `${lines.join("\n")}\n`, canonicalUrl, locale: "ru" };
  }

  // 12. Glossary `/glossary` & `/glossary/[slug]`
  if (basePath === "/glossary") {
    const lines = [
      ...headerMeta("Глоссарий терминов ХАССП и СанПиН — WeSetup", "Краткие определения ключевых понятий пищевой безопасности."),
      "",
      ...GLOSSARY.map((g) => `- **[${g.term}](${SITE}/glossary/${g.slug})** — ${g.short}`),
    ];
    return { markdown: `${lines.join("\n")}\n`, canonicalUrl, locale: "ru" };
  }

  if (basePath.startsWith("/glossary/")) {
    const slug = basePath.slice("/glossary/".length);
    const term = GLOSSARY.find((g) => g.slug === slug);
    if (!term) return null;
    const lines = [...headerMeta(term.term, term.short), "", term.body];
    return { markdown: `${lines.join("\n")}\n`, canonicalUrl, locale: "ru" };
  }

  // 13. Comparisons `/compare` & `/compare/[slug]`
  if (basePath === "/compare") {
    const lines = [
      ...headerMeta("Сравнение WeSetup с бумажными журналами, таблицами и альтернативами"),
      "",
      ...COMPARISON_ORDER.map((slug) => {
        const c = COMPARISONS[slug];
        return c ? `- **[${c.title}](${SITE}/compare/${c.slug})** — ${c.metaDescription}` : "";
      }).filter(Boolean),
    ];
    return { markdown: `${lines.join("\n")}\n`, canonicalUrl, locale: "ru" };
  }

  if (basePath.startsWith("/compare/")) {
    const slug = basePath.slice("/compare/".length);
    const comp = COMPARISONS[slug];
    if (!comp) return null;
    const lines = [
      ...headerMeta(comp.title, comp.metaDescription),
      "",
      comp.intro,
      "",
      `| Критерий | ${comp.rival} | WeSetup |`,
      "|---|---|---|",
      ...comp.rows.map((r) => `| ${r.criterion} | ${r.rival} | ${r.wesetup} |`),
      "",
      `## Вывод\n\n${comp.verdict}`,
    ];
    return { markdown: `${lines.join("\n")}\n`, canonicalUrl, locale: "ru" };
  }

  // 14. Cities `/v/[city]`
  if (basePath.startsWith("/v/")) {
    const citySlug = basePath.slice("/v/".length);
    const city = CITIES[citySlug];
    if (!city) return null;
    const lines = [
      ...headerMeta(
        `Электронные журналы ХАССП и СанПиН ${city.inCity} — WeSetup`,
        `${JOURNALS_TOTAL} готовых журналов СанПиН 2.3/2.4.4282-26 и ХАССП для общепита, магазинов и пищевых производств ${city.inCity}.`,
      ),
      "",
      `- Первые ${TRIAL_DAYS} дней бесплатно без карты: ${SITE}/register`,
      `- Полный каталог журналов: ${SITE}/journals-info`,
    ];
    return { markdown: `${lines.join("\n")}\n`, canonicalUrl, locale: "ru" };
  }

  // 15. Core standalone info pages
  const standaloneInfo: Record<string, { title: string; summary: string }> = {
    "/avtozapolnenie": {
      title: "Автозаполнение электронных журналов СанПиН и ХАССП — WeSetup",
      summary: "Генерация регулярных замеров по расписанию с естественным разбросом для холодильников, складов, фритюра и уборок.",
    },
    "/sanpin-2-3-2-4-4282-26": {
      title: "СанПиН 2.3/2.4.4282-26 для общепита с 1 сентября 2026 года — разбор WeSetup",
      summary: "Что изменилось по сравнению с СанПиН 2.3/2.4.3590-20 и какие журналы обязательны.",
    },
    "/blanki": {
      title: "Бланки журналов СанПиН и ХАССП для скачивания (PDF, DOCX) — WeSetup",
      summary: "Готовые печатные формы обязательных журналов с образцами заполнения.",
    },
    "/prikazy": {
      title: "Образцы приказов по ХАССП, СанПиН и переходу на электронные журналы — WeSetup",
      summary: "Шаблоны приказов о назначении ответственных и ведении журналов в электронном виде.",
    },
    "/about": {
      title: "О платформе WeSetup",
      summary: "Российский облачный сервис электронных журналов ХАССП и СанПиН (в реестре российского ПО).",
    },
    "/security": {
      title: "Безопасность и хранение данных в WeSetup",
      summary: "Резервное копирование, разграничение прав, аудит действий и защита персональных данных.",
    },
    "/developers": {
      title: "API и интеграции WeSetup для разработчиков",
      summary: "REST API внешних записей, интеграция с учётными системами и IoT-датчиками температуры.",
    },
  };

  if (Object.hasOwn(standaloneInfo, basePath)) {
    const info = standaloneInfo[basePath];
    return {
      markdown: `${headerMeta(info.title, info.summary).join("\n")}\n`,
      canonicalUrl,
      locale,
    };
  }

  return null;
}

/**
 * Dynamic `/llms.txt` built 100% from promo JSON snapshots + static catalogs (0 DB SELECTs).
 */
export async function renderLlmsTxt(options?: {
  dir?: string;
  now?: Date;
}): Promise<string> {
  const now = options?.now ?? new Date();
  const dir = options?.dir;
  const [pricing, promotion, articles] = await Promise.all([
    readPromoPlanPricing({ dir }),
    readPromoActivePromotion(now, { dir }),
    readPromoPublishedArticles("ru", now, { dir }),
  ]);
  const stdYear = applyPromotion(planMonthlyRub(pricing.rates, "standard", "year"), promotion);
  const premYear = applyPromotion(planMonthlyRub(pricing.rates, "premium", "year"), promotion);
  const vipYear = applyPromotion(planMonthlyRub(pricing.rates, "vip", "year"), promotion);

  const lines: string[] = [
    "# WeSetup (wesetup.ru)",
    "",
    `> Облачный сервис электронных журналов ХАССП и СанПиН 2.3/2.4.4282-26 (в реестре российского ПО) для общепита, пекарен, столовых, магазинов, отелей и пищевых производств. ${JOURNALS_TOTAL} готовых журналов с заполнением по QR-коду с телефона, автозаполнением по расписанию, IoT-датчиками и выгрузкой PDF для проверок Роспотребнадзора.`,
    "",
    `Любая страница продвижения доступна в чистом Markdown: добавьте суффикс \`.md\` (например, \`${SITE}/pricing.md\`, \`${SITE}/baza-znaniy/registraciya.md\`, \`${SITE}/blog/<slug>.md\`) или передайте заголовок \`Accept: text/markdown\`. Полная сводка в одном файле: [llms-full.txt](${SITE}/llms-full.txt).`,
    "",
    "## Ключевые разделы",
    "",
    `- [Главная страница](${SITE}/): обзор платформы, QR-сценарий, сферы и тарифы (Стандарт от ${formatRub(stdYear.priceRub)}/мес, Премиум от ${formatRub(premYear.priceRub)}/мес, ВИП от ${formatRub(vipYear.priceRub)}/мес; первые ${TRIAL_DAYS} дней бесплатно).`,
    `- [База знаний WeSetup](${SITE}/baza-znaniy): пошаговые инструкции по запуску кабинета, QR-замерам, чек-листам, ППК и режиму проверки.`,
    `- [Каталог ${JOURNALS_TOTAL} журналов СанПиН и ХАССП](${SITE}/journals-info): графы таблиц, нормативная база и образцы заполнения.`,
    `- [Тарифы и калькулятор](${SITE}/pricing): актуальные цены помесячно и за год, скидки на сеть точек.`,
    `- [Возможности платформы](${SITE}/features): QR-коды, автозаполнение, синхронизация с iiko и 1С, ролевой доступ, Telegram-уведомления.`,
    `- [Автозаполнение журналов](${SITE}/avtozapolnenie): регулярные записи по расписанию для холодильников, складов, фритюра и уборок.`,
    `- [СанПиН 2.3/2.4.4282-26](${SITE}/sanpin-2-3-2-4-4282-26): разбор актуальных санитарных правил для общепита.`,
    `- [Услуги экспертов ХАССП и ППК](${SITE}/uslugi): аудит перед проверкой РПН и разработка документации под ключ.`,
    `- [Партнёрская программа](${SITE}/partners): условия для консультантов ХАССП, интеграторов iiko/1С и поставщиков.`,
    `- [Блог о СанПиН и ХАССП](${SITE}/blog): практические разборы проверок и нормативов.`,
    `- [Полная сводка для ИИ (llms-full.txt)](${SITE}/llms-full.txt): развёрнутая документация продукта, тарифов, журналов и базы знаний.`,
    "",
    "## База знаний (основные руководства)",
    "",
    ...KB_ARTICLES.slice(0, 12).map(
      (kb) => `- [${kb.title}](${SITE}/baza-znaniy/${kb.slug}): ${kb.lead}`,
    ),
    "",
    "## Основные журналы в каталоге",
    "",
    ...["hygiene", "health_check", "cold_equipment_control", "climate_control", "finished_product", "perishable_rejection", "incoming_control", "fryer_oil", "general_cleaning", "uv_lamp_runtime"]
      .filter((code) => Boolean(JOURNAL_INFO[code]))
      .map((code) => {
        const title = JOURNAL_SEO[code]?.title ?? JOURNAL_INFO[code].tagline;
        return `- [${title}](${SITE}/journals-info/${code}): ${JOURNAL_INFO[code].tagline}`;
      }),
    "",
    "## Отраслевые страницы",
    "",
    ...Object.values(NICHES).map(
      (n) => `- [${n.hero}](${SITE}/${n.slug}): ${n.audience}`,
    ),
  ];

  if (articles.length > 0) {
    lines.push(
      "",
      "## Свежие статьи блога",
      "",
      ...articles.slice(0, 15).map(
        (a) => `- [${a.title}](${SITE}/blog/${a.slug}): ${a.excerpt}`,
      ),
    );
  }

  lines.push(
    "",
    "## Контакты",
    "",
    `- Сайт: ${SITE}`,
    `- Почта: ${COMPANY_EMAIL}`,
    `- Телефон: ${COMPANY_PHONE.display}`,
    `- Языки интерфейса: русский (\`/\`), английский (\`/en\`), узбекский (\`/uz\`).`,
  );

  return `${lines.join("\n")}\n`;
}

/**
 * Comprehensive `/llms-full.txt` built 100% from promo JSON snapshots + static catalogs (0 DB SELECTs).
 */
export async function renderLlmsFullTxt(options?: {
  dir?: string;
  now?: Date;
}): Promise<string> {
  const now = options?.now ?? new Date();
  const dir = options?.dir;
  const [indexTxt, services, articles] = await Promise.all([
    renderLlmsTxt({ dir, now }),
    readPromoActiveServices({ dir }),
    readPromoPublishedArticles("ru", now, { dir }),
  ]);

  const sections: string[] = [indexTxt.trimEnd(), "", "---", "", "## Полное содержание базы знаний"];
  for (const kb of KB_ARTICLES) {
    sections.push(
      "",
      `### ${kb.title} (${SITE}/baza-znaniy/${kb.slug})`,
      "",
      kb.lead,
      "",
      renderKbBlocksMd(kb.blocks),
    );
  }

  if (services.length > 0) {
    sections.push("", "---", "", "## Каталог услуг по пищевой безопасности");
    for (const svc of services) {
      sections.push("", `### ${svc.title}`, "", `${svc.summary} ${svc.description}`);
    }
  }

  if (articles.length > 0) {
    sections.push("", "---", "", "## Статьи блога (краткое содержание)");
    for (const art of articles.slice(0, 25)) {
      sections.push(
        "",
        `### ${art.title} (${SITE}/blog/${art.slug})`,
        "",
        art.excerpt,
      );
    }
  }

  return `${sections.join("\n")}\n`;
}
