import type { Niche } from "@/content/niches";
import { buildSpherePublicContent } from "@/lib/sphere-public-content";

/**
 * Вопросы-ответы для отраслевого лендинга `/dlya-*`.
 *
 * Зачем. Съём 2026-09-10: по запросу «хассп для пекарни» Яндекс отдаёт
 * главную страницу, а сама `/dlya-pekarni` стоит на 63-м месте. Замер
 * объясняет почему — у главной 1888 слов, 11 подзаголовков и
 * FAQ-разметка, у ниши 418 слов, 4 подзаголовка и никакой разметки.
 * Ниша проигрывала главной по всем формальным признакам.
 *
 * Ответы собираются из данных самой ниши — её болей, набора журналов и
 * аудитории, — поэтому на двенадцати лендингах получаются разные тексты.
 * Один шаблон на всех дал бы дубликат и усугубил ровно ту проблему,
 * из-за которой поисковик и предпочитал главную.
 */

export type NicheFaqItem = { q: string; a: string };

/** «пекарни» из «Пекарни» — для вопросов «какие журналы нужны …». */
function lower(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

export function buildNicheFaq(niche: Niche): NicheFaqItem[] {
  const who = lower(niche.navLabel);
  const items: NicheFaqItem[] = [];

  // Набор журналов — из правил сферы (SPHERE_RULES), тех же, по которым
  // кабинет включает журналы при регистрации. Ручной список в нише
  // расходился с кабинетом.
  const content = buildSpherePublicContent(niche.sphere);
  if (content.required.length > 0) {
    const required = content.required
      .map((journal) =>
        journal.condition ? `${journal.name} (${journal.condition})` : journal.name,
      )
      .join("; ");
    const recommended = content.recommended
      .slice(0, 4)
      .map((journal) => journal.name)
      .join("; ");
    items.push({
      q: `Какие журналы обязательны для ${who}?`,
      a: `Обязательный минимум для ${who}: ${required}.${
        recommended ? ` Рекомендуем также: ${recommended}.` : ""
      } Условные журналы нужны, только если условие про вас — например, есть соответствующее оборудование.`,
    });
  }

  if (niche.pains.length > 0) {
    items.push({
      q: `Что чаще всего находят проверяющие у ${who}?`,
      a: `${niche.pains.join(". ")}. Все четыре ситуации возникают из-за бумажного учёта: запись делается не в момент события, а вечером или перед проверкой.`,
    });
  }

  items.push({
    q: `Можно ли вести журналы для ${who} в электронном виде?`,
    a: "Да, санитарные правила не требуют бумаги — для общепита это прямо сказано в СанПиН 2.3/2.4.4282-26. Важно, чтобы было видно, кто и когда внёс запись, и чтобы её нельзя было незаметно исправить задним числом. Для проверки журнал выводится на печать за нужный период.",
  });

  items.push({
    q: `Сколько времени занимает переход на электронные журналы?`,
    a: `${niche.promise} Набор журналов подставляется под ${who} сразу, вручную настраивать ничего не нужно.`,
  });

  return items;
}

export function nicheFaqJsonLd(faq: NicheFaqItem[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faq.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: { "@type": "Answer", text: item.a },
    })),
  };
}
