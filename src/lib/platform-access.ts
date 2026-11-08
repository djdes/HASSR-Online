/**
 * Delegated access to the platform panel (/root).
 *
 * The owner is a superadmin (`User.isRoot`) and sees everything. Other people
 * get sections: an SEO specialist — blog and SEO, sales — clients and
 * proposals, support — feedback, and so on (owner's request 2026-10-29).
 * Sections live in `User.platformSections`; presets are just named sets.
 *
 * Access is decided by the request path (pages AND API), so a page or route
 * never has to name its section: `requireRoot()` maps the path through
 * `PLATFORM_RULES`. Pure module — the proxy imports it too.
 */

export const PLATFORM_SECTION_KEYS = [
  "crm",
  "clients",
  "billing",
  "sales",
  "partners",
  "edo",
  "support",
  "assistant",
  "content",
  "seo",
  "translations",
  "monitoring",
] as const;

export type PlatformSectionKey = (typeof PLATFORM_SECTION_KEYS)[number];

/** Who may open a path: a section, only the superadmin, or any panel user. */
export type PlatformGate = PlatformSectionKey | "superadmin" | "self";

export type PlatformSection = {
  key: PlatformSectionKey;
  title: string;
  hint: string;
  /** Where a person with only this section lands. */
  home: string;
};

export const PLATFORM_SECTIONS: readonly PlatformSection[] = [
  { key: "crm", title: "CRM", hint: "Обращения и лиды, переписка, напоминания, почта", home: "/root/crm" },
  { key: "clients", title: "Клиенты", hint: "Список клиентов, карточка, контакты, договор и КП", home: "/root" },
  { key: "billing", title: "Оплаты и тарифы", hint: "Тарифы, счета, отметка оплаты, баллы, реквизиты", home: "/root/tariffs" },
  { key: "sales", title: "Продажи", hint: "КП, рассылки, услуги и заявки, промокоды и акции", home: "/root/proposals" },
  { key: "partners", title: "Партнёры", hint: "Заявки партнёров, клиенты, выплаты", home: "/root/partners" },
  { key: "edo", title: "ЭДО", hint: "Отправка договоров, счетов и УПД через Saby", home: "/root/edo" },
  { key: "support", title: "Обратная связь", hint: "Обращения, отзывы, идеи, NPS", home: "/root/feedback" },
  { key: "assistant", title: "Ассистент", hint: "Журнал вопросов и настройки ассистента", home: "/root/assistant" },
  { key: "content", title: "Блог", hint: "Статьи и их переводы", home: "/root/blog" },
  { key: "seo", title: "SEO и реклама", hint: "Здоровье сайта, позиции, ссылки GoGetLinks, Яндекс Директ", home: "/root/seo" },
  { key: "translations", title: "Переводы", hint: "Каталог переводов и переводчики", home: "/root/translations" },
  { key: "monitoring", title: "Мониторинг", hint: "Статус, журналы, аудит, тайминги, ограничитель", home: "/root/status" },
];

export type PlatformPresetKey = "admin" | "sales" | "support" | "seo" | "finance" | "analyst";

export type PlatformPreset = {
  key: PlatformPresetKey;
  title: string;
  hint: string;
  sections: readonly PlatformSectionKey[];
};

export const PLATFORM_PRESETS: readonly PlatformPreset[] = [
  {
    key: "admin",
    title: "Администратор",
    hint: "Все разделы панели. Вход под клиента, удаление организаций и команда — только у владельца.",
    sections: PLATFORM_SECTION_KEYS,
  },
  { key: "sales", title: "Продажи", hint: "CRM, клиенты, КП и рассылки, партнёры, ЭДО", sections: ["crm", "clients", "sales", "partners", "edo"] },
  { key: "support", title: "Поддержка", hint: "Клиенты, обращения и отзывы, ассистент", sections: ["clients", "support", "assistant"] },
  { key: "seo", title: "SEO и контент", hint: "Блог, SEO и реклама, переводы", sections: ["content", "seo", "translations"] },
  { key: "finance", title: "Бухгалтерия", hint: "Клиенты, оплаты и тарифы, ЭДО", sections: ["clients", "billing", "edo"] },
  { key: "analyst", title: "Аналитика", hint: "Клиенты и мониторинг платформы", sections: ["clients", "monitoring"] },
];

type Rule = {
  /** Path pattern; `*` matches exactly one segment. */
  pattern: string;
  gate: PlatformGate;
  /**
   * Shows every client or lead at once (inbox, health, funnel) or reassigns
   * them: a person whose role sees only their own clients («свои») is refused.
   */
  allScope?: true;
  /** Match the path itself only, not its children. */
  exact?: boolean;
  /** Restrict to these HTTP methods (upper case). */
  methods?: readonly string[];
};

/**
 * The most specific rule wins (more segments; a method-bound rule beats a
 * method-free one of the same length). Paths that match nothing are
 * superadmin-only — a new page stays closed until someone classifies it
 * (`platform-access.test.ts` walks every /root page and API route).
 */
export const PLATFORM_RULES: readonly Rule[] = [
  // Clients: the list, the card, contacts, contracts.
  { pattern: "/root", gate: "clients", exact: true },
  { pattern: "/root/organizations", gate: "clients" },
  { pattern: "/root/health", gate: "clients", allScope: true },
  // Воронка регистраций — про клиентов: продажи и аналитика её видят.
  { pattern: "/root/funnel", gate: "clients", allScope: true },
  // Закрепить клиента за менеджером — тот, кто видит всех (РОП, директор).
  { pattern: "/api/root/organizations/*/manager", gate: "clients", allScope: true },
  { pattern: "/api/root/organizations", gate: "clients" },
  { pattern: "/api/root/organizations/*", gate: "billing", methods: ["PATCH", "PUT"] },
  { pattern: "/api/root/organizations/*", gate: "superadmin", methods: ["DELETE"] },
  { pattern: "/api/root/organizations/*/balance", gate: "billing" },
  // «Документы клиенту»: счёт — деньги, КП — продажи (договор — в разделе «Клиенты»).
  { pattern: "/api/root/organizations/*/invoices", gate: "billing" },
  { pattern: "/api/root/organizations/*/proposal", gate: "sales" },

  // Money.
  { pattern: "/root/tariffs", gate: "billing" },
  { pattern: "/root/requisites", gate: "billing" },
  // Счета по ИНН без регистрации — отметка оплаты, как в карточке клиента.
  { pattern: "/root/invoices", gate: "billing" },
  { pattern: "/root/sber", gate: "billing" },
  { pattern: "/api/root/sber", gate: "billing" },
  { pattern: "/api/root/tariffs", gate: "billing" },
  { pattern: "/api/root/legal-requisites", gate: "billing" },
  { pattern: "/api/root/orders", gate: "billing" },
  { pattern: "/api/root/billing-period", gate: "billing" },
  { pattern: "/api/root/lifetime-discounts", gate: "billing" },

  // CRM — all inquiries in one place. The company inbox, its filters and
  // mailbox settings are not «own clients»: whole-team scope only; mailbox
  // credentials — owner only.
  { pattern: "/root/crm", gate: "crm" },
  { pattern: "/api/root/crm", gate: "crm" },
  { pattern: "/root/crm/mail", gate: "crm", allScope: true },
  { pattern: "/api/root/crm/mailboxes", gate: "crm", allScope: true },
  { pattern: "/api/root/crm/mailboxes", gate: "superadmin", methods: ["POST", "PUT", "DELETE"] },
  { pattern: "/api/root/crm/filtered", gate: "crm", allScope: true },
  { pattern: "/api/root/crm/rules", gate: "crm", allScope: true },

  // Sales.
  { pattern: "/root/proposals", gate: "sales" },
  { pattern: "/root/mailing", gate: "sales" },
  { pattern: "/root/services", gate: "sales" },
  { pattern: "/root/service-requests", gate: "sales" },
  { pattern: "/root/blank-downloads", gate: "sales" },
  { pattern: "/root/promotions", gate: "sales" },
  { pattern: "/root/promo-codes", gate: "sales" },
  { pattern: "/api/root/proposals", gate: "sales" },
  { pattern: "/api/root/mailing", gate: "sales" },
  { pattern: "/api/root/services", gate: "sales" },
  { pattern: "/api/root/service-requests", gate: "sales" },
  { pattern: "/api/root/promotions", gate: "sales" },
  { pattern: "/api/root/promo-codes", gate: "sales" },
  { pattern: "/api/root/seed-demo-org", gate: "sales" },

  { pattern: "/root/partners", gate: "partners" },
  { pattern: "/api/root/partners", gate: "partners" },

  { pattern: "/root/edo", gate: "edo" },
  { pattern: "/api/root/edo", gate: "edo" },

  // Voice of the customer.
  { pattern: "/root/feedback", gate: "support" },
  { pattern: "/root/reviews", gate: "support" },
  { pattern: "/root/ideas", gate: "support" },
  { pattern: "/root/nps", gate: "support" },
  { pattern: "/api/root/feedback", gate: "support" },
  { pattern: "/api/root/support", gate: "support" },
  { pattern: "/api/root/reviews", gate: "support" },
  { pattern: "/api/root/ideas", gate: "support" },
  { pattern: "/api/root/nps", gate: "support" },

  { pattern: "/root/assistant", gate: "assistant" },
  { pattern: "/api/root/assistant-integration", gate: "assistant" },

  // Site.
  { pattern: "/root/blog", gate: "content" },
  { pattern: "/api/root/articles", gate: "content" },
  // СММ: посты в канал MAX.
  { pattern: "/root/max-channel", gate: "content" },
  { pattern: "/api/root/max-channel", gate: "content" },
  { pattern: "/root/seo", gate: "seo" },
  { pattern: "/root/yandex-direct", gate: "seo" },
  { pattern: "/api/root/seo-health", gate: "seo" },
  { pattern: "/api/root/topvisor", gate: "seo" },
  { pattern: "/api/root/yandex-direct", gate: "seo" },
  { pattern: "/api/root/gogetlinks/account", gate: "superadmin", methods: ["POST", "PUT", "DELETE"] },
  { pattern: "/api/root/gogetlinks", gate: "seo" },
  { pattern: "/root/translations", gate: "translations" },
  { pattern: "/api/root/translators", gate: "translations" },

  // Platform health.
  { pattern: "/root/status", gate: "monitoring" },
  { pattern: "/root/telegram-logs", gate: "monitoring" },
  { pattern: "/root/audit", gate: "monitoring" },
  { pattern: "/root/audit-impersonations", gate: "monitoring" },
  { pattern: "/root/timings", gate: "monitoring" },
  { pattern: "/root/page-limit", gate: "monitoring" },
  { pattern: "/api/root/status", gate: "monitoring" },

  // Owner only: who has access, impersonation, bot setup.
  { pattern: "/root/team", gate: "superadmin" },
  { pattern: "/api/root/team", gate: "superadmin" },
  { pattern: "/api/root/impersonate", gate: "superadmin" },
  { pattern: "/api/root/telegram", gate: "superadmin" },

  // Personal settings (own sending mailbox) — every panel user.
  { pattern: "/root/me", gate: "self" },
  { pattern: "/api/root/me", gate: "self" },
];

function segments(path: string): string[] {
  return path.split("?")[0].split("/").filter(Boolean);
}

function ruleMatches(rule: Rule, pathSegments: string[], method: string): boolean {
  if (rule.methods && !rule.methods.includes(method)) return false;
  const pattern = segments(rule.pattern);
  if (rule.exact ? pattern.length !== pathSegments.length : pattern.length > pathSegments.length) return false;
  return pattern.every((part, index) => part === "*" || part === pathSegments[index]);
}

export function isPlatformPath(path: string): boolean {
  const parts = segments(path);
  return parts[0] === "root" || (parts[0] === "api" && parts[1] === "root");
}

/** The most specific rule for a path, or null when no rule matches. */
export function matchPlatformRule(path: string, method = "GET"): Rule | null {
  const parts = segments(path);
  const verb = method.toUpperCase();
  let best: { rule: Rule; score: number } | null = null;
  for (const rule of PLATFORM_RULES) {
    if (!ruleMatches(rule, parts, verb)) continue;
    const score = segments(rule.pattern).length * 2 + (rule.methods ? 1 : 0);
    if (!best || score > best.score) best = { rule, score };
  }
  return best ? best.rule : null;
}

/** Gate for a /root or /api/root path; null for anything outside the panel. */
export function platformGateFor(path: string, method = "GET"): PlatformGate | null {
  if (!isPlatformPath(path)) return null;
  return matchPlatformRule(path, method)?.gate ?? "superadmin";
}

/** Known section keys only, de-duplicated, in registry order. */
export function normalizePlatformSections(value: unknown): PlatformSectionKey[] {
  if (!Array.isArray(value)) return [];
  const wanted = new Set(value.filter((item): item is string => typeof item === "string"));
  return PLATFORM_SECTION_KEYS.filter((key) => wanted.has(key));
}

/** Охват данных роли: все клиенты и лиды или только закреплённые (+ свободные лиды). */
export type PlatformScope = "all" | "own";

export function normalizePlatformScope(value: unknown): PlatformScope {
  return value === "own" ? "own" : "all";
}

export type PlatformViewer = {
  /** `User.isRoot`: everything, including team, impersonation, deletion. */
  superadmin: boolean;
  sections: readonly PlatformSectionKey[];
  /** Охват из роли; нет роли («свой набор») или владелец — «all». */
  scope?: PlatformScope;
};

export function hasPlatformPanel(viewer: PlatformViewer): boolean {
  return viewer.superadmin || viewer.sections.length > 0;
}

export function canUsePlatformSection(viewer: PlatformViewer, section: PlatformSectionKey): boolean {
  return viewer.superadmin || viewer.sections.includes(section);
}

export function canAccessPlatformPath(viewer: PlatformViewer, path: string, method = "GET"): boolean {
  const gate = platformGateFor(path, method);
  if (gate === null) return false;
  if (viewer.superadmin) return true;
  if (gate === "superadmin") return false;
  if (gate === "self") return viewer.sections.length > 0;
  if (!viewer.sections.includes(gate)) return false;
  if (viewer.scope === "own" && matchPlatformRule(path, method)?.allScope) return false;
  return true;
}

/** Что в адресе — конкретный клиент или лид: для охвата «свои» его надо проверить. */
export type ScopedTarget = { kind: "organization" | "contact"; id: string };

export function scopedTargetOf(path: string): ScopedTarget | null {
  const parts = segments(path);
  const rest = parts[0] === "api" ? parts.slice(2) : parts.slice(1);
  if (!(parts[0] === "root" || (parts[0] === "api" && parts[1] === "root"))) return null;
  if (rest[0] === "organizations" && rest[1]) return { kind: "organization", id: rest[1] };
  if (rest[0] === "crm" && rest[1] === "contacts" && rest[2]) return { kind: "contact", id: rest[2] };
  return null;
}

/** Landing page for a delegated user: the first section they have. */
export function platformHomeHref(viewer: PlatformViewer): string {
  if (viewer.superadmin) return "/root";
  const first = PLATFORM_SECTIONS.find((section) => viewer.sections.includes(section.key));
  return first ? first.home : "/root/me";
}

/** Preset whose sections equal the given set, else null («Свой набор»). */
export function matchPlatformPreset(sections: readonly PlatformSectionKey[]): PlatformPresetKey | null {
  const set = new Set(sections);
  const preset = PLATFORM_PRESETS.find(
    (item) => item.sections.length === set.size && item.sections.every((key) => set.has(key)),
  );
  return preset ? preset.key : null;
}

/**
 * «Администратор платформы» для служебных уведомлений: владелец (`isRoot`)
 * или человек с полным набором разделов (пресет «Администратор»). Им идут
 * регистрации, оплаты, обращения и сбои — на почту и в Telegram.
 */
export function isPlatformAdministrator(user: { isRoot: boolean; platformSections: readonly string[] }): boolean {
  return user.isRoot || PLATFORM_SECTION_KEYS.every((key) => user.platformSections.includes(key));
}
