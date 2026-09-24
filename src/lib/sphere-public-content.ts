import { ACTIVE_JOURNAL_CATALOG } from "@/lib/journal-catalog";
import { JOURNAL_INFO } from "@/content/journal-info";
import { defaultChecklistFor } from "@/lib/checklist-defaults";
import { findOrderTemplate } from "@/lib/orders/catalog";
import {
  paperJournalsFor,
  rulesFor,
  type LawRef,
  type PaperJournal,
  type RuleBasis,
} from "@/lib/sphere-journal-rules";
import type { OrgSphere } from "@/lib/org-profile";

/**
 * Содержимое публичной страницы сферы `/dlya-*` — из `SPHERE_RULES`.
 *
 * Раньше у каждой ниши был свой ручной список журналов, и он расходился
 * с тем, что кабинет реально включает при регистрации: страница обещала
 * одно, настройки показывали другое. Теперь и страница, и настройки
 * журналов, и начальная настройка читают одни правила.
 *
 * Модуль чистый (без базы): его вызывает серверный компонент лендинга и
 * тест согласованности.
 */

export type PublicJournal = {
  code: string;
  name: string;
  /** Ссылка на описание, если у журнала есть страница /journals-info. */
  href: string | null;
  basisLabel: string | null;
  law: LawRef | null;
  condition: string | null;
  /** Уточнение для посетителя — без служебных пометок для юристов. */
  note: string | null;
};

export type PublicOrder = { code: string; title: string; purpose: string };

export type PublicChecklist = {
  code: string;
  name: string;
  /** 2–3 пункта типового чек-листа — пример того, что увидит сотрудник. */
  examples: string[];
  total: number;
};

export type SpherePublicContent = {
  sphere: OrgSphere;
  intro: string;
  introLaw: LawRef;
  required: PublicJournal[];
  recommended: PublicJournal[];
  paper: PaperJournal[];
  ordersRequired: PublicOrder[];
  ordersRecommended: PublicOrder[];
  checklists: PublicChecklist[];
};

const BASIS_LABEL: Record<RuleBasis, string> = {
  sanpin: "Требование санитарных правил",
  haccp: "Запись по ХАССП",
  practice: "Спрашивают при проверках",
};

const NAME_BY_CODE = new Map<string, string>(
  ACTIVE_JOURNAL_CATALOG.map((item) => [item.code, item.name]),
);

export function journalName(code: string): string {
  return NAME_BY_CODE.get(code) ?? code;
}

/**
 * Пометки вида «требует юр-сверки» / «проверить формулировку у юриста»
 * адресованы нам, а не посетителю: в кабинете они честно показывают
 * степень уверенности, но на публичной странице выглядят как черновик.
 * Убираем такие фрагменты, остальное оставляем.
 */
const INTERNAL_NOTE_RE = /юр-?сверк|юрист/i;

export function publicNote(note: string | undefined): string | null {
  if (!note) return null;
  const kept = note
    .split(/;\s+/)
    .map((segment) =>
      segment
        .split(/\s+—\s+/)
        .filter((part) => !INTERNAL_NOTE_RE.test(part))
        .join(" — "),
    )
    .filter((segment) => segment.trim().length > 0);
  const text = kept.join("; ").trim();
  return text.length > 0 ? text : null;
}

function journalHref(code: string): string | null {
  return JOURNAL_INFO[code] ? `/journals-info/${code}` : null;
}

function toOrder(code: string): PublicOrder | null {
  const template = findOrderTemplate(code);
  return template
    ? { code, title: template.title, purpose: template.purpose }
    : null;
}

export function buildSpherePublicContent(
  sphere: OrgSphere,
): SpherePublicContent {
  const rules = rulesFor(sphere);
  return {
    sphere: rules.sphere,
    intro: rules.intro,
    introLaw: rules.introLaw,
    required: rules.electronicRequired.map((rule) => ({
      code: rule.code,
      name: journalName(rule.code),
      href: journalHref(rule.code),
      basisLabel: rule.basis ? BASIS_LABEL[rule.basis] : null,
      law: rule.law ?? null,
      condition: rule.condition ?? null,
      note: publicNote(rule.note),
    })),
    recommended: rules.electronicRecommended.map((code) => ({
      code,
      name: journalName(code),
      href: journalHref(code),
      basisLabel: null,
      law: null,
      condition: null,
      note: null,
    })),
    paper: paperJournalsFor(sphere),
    ordersRequired: rules.ordersRequired
      .map(toOrder)
      .filter((order): order is PublicOrder => order !== null),
    ordersRecommended: rules.ordersRecommended
      .map(toOrder)
      .filter((order): order is PublicOrder => order !== null),
    checklists: rules.checklistJournals.map((code) => {
      const items = defaultChecklistFor(code);
      return {
        code,
        name: journalName(code),
        examples: items.slice(0, 3).map((item) => item.title),
        total: items.length,
      };
    }),
  };
}
