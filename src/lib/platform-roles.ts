/**
 * Роли панели платформы (владелец, 2026-11-08: «роль менеджера, чтобы
 * закреплённые пользователи были за ним, РОП по всем, ропов может быть много…
 * настройка ролей доступов к разделам админки»). Чистый модуль: встроенные
 * роли и форма. Хранятся роли в `PlatformRole`, настраиваются в /root/team.
 */

import { z } from "zod";

import { PLATFORM_SECTION_KEYS, normalizePlatformSections, type PlatformScope, type PlatformSectionKey } from "@/lib/platform-access";

export type BuiltinRole = {
  key: string;
  title: string;
  description: string;
  sections: readonly PlatformSectionKey[];
  scope: PlatformScope;
  salesHead: boolean;
  signatureTitle: string | null;
  sort: number;
};

/**
 * Создаются сидом, если их нет; правки владельца сид не перезаписывает.
 * Первые совпадают с прежними наборами разделов — люди с этими наборами
 * получают роль без изменения доступа.
 */
export const BUILTIN_ROLES: readonly BuiltinRole[] = [
  {
    key: "admin",
    title: "Администратор",
    description: "Все разделы. Вход под клиента, удаление организаций и команда — только у владельца.",
    sections: PLATFORM_SECTION_KEYS,
    scope: "all",
    salesHead: false,
    signatureTitle: null,
    sort: 10,
  },
  {
    key: "commercial_director",
    title: "Коммерческий директор",
    description: "Все разделы, все клиенты и лиды, все заявки и эскалации CRM как у РОП.",
    sections: PLATFORM_SECTION_KEYS,
    scope: "all",
    salesHead: true,
    signatureTitle: "Коммерческий директор",
    sort: 20,
  },
  {
    key: "sales_head",
    title: "РОП",
    description: "Руководитель отдела продаж: все клиенты и лиды, распределяет их по менеджерам, получает все заявки и эскалации.",
    sections: ["crm", "clients", "sales", "partners", "edo"],
    scope: "all",
    salesHead: true,
    signatureTitle: "Руководитель отдела продаж",
    sort: 30,
  },
  {
    key: "sales_manager",
    title: "Менеджер по продажам",
    description: "Только закреплённые за ним клиенты и лиды и свободные лиды, которые можно взять себе.",
    sections: ["crm", "clients", "sales"],
    scope: "own",
    salesHead: false,
    signatureTitle: "Менеджер по работе с клиентами",
    sort: 40,
  },
  {
    key: "sales",
    title: "Продажи",
    description: "CRM, клиенты, КП и рассылки, партнёры, ЭДО — все клиенты.",
    sections: ["crm", "clients", "sales", "partners", "edo"],
    scope: "all",
    salesHead: false,
    signatureTitle: "Менеджер по работе с клиентами",
    sort: 50,
  },
  {
    key: "support",
    title: "Поддержка",
    description: "Клиенты, обращения и отзывы, ассистент.",
    sections: ["clients", "support", "assistant"],
    scope: "all",
    salesHead: false,
    signatureTitle: "Служба поддержки",
    sort: 60,
  },
  {
    key: "seo",
    title: "SEO и контент",
    description: "Блог, SEO и реклама, переводы.",
    sections: ["content", "seo", "translations"],
    scope: "all",
    salesHead: false,
    signatureTitle: null,
    sort: 70,
  },
  {
    key: "finance",
    title: "Бухгалтерия",
    description: "Клиенты, оплаты и тарифы, ЭДО.",
    sections: ["clients", "billing", "edo"],
    scope: "all",
    salesHead: false,
    signatureTitle: "Бухгалтерия",
    sort: 80,
  },
  {
    key: "analyst",
    title: "Аналитика",
    description: "Клиенты и мониторинг платформы.",
    sections: ["clients", "monitoring"],
    scope: "all",
    salesHead: false,
    signatureTitle: null,
    sort: 90,
  },
];

export const roleInputSchema = z.object({
  title: z.string().trim().min(2, "Назовите роль").max(80),
  description: z.string().trim().max(300).optional().nullable(),
  sections: z.array(z.string().max(40)).max(30),
  scope: z.enum(["all", "own"]),
  salesHead: z.boolean(),
  signatureTitle: z.string().trim().max(120).optional().nullable(),
  /** Скидка в спец-КП без согласования, %; пусто — по умолчанию роли. */
  discountLimit: z.number().int().min(0, "Скидка — от 0 до 90 %").max(90, "Скидка — от 0 до 90 %").optional().nullable(),
});

export type RoleInput = z.infer<typeof roleInputSchema>;

export type RoleView = {
  id: string;
  key: string;
  title: string;
  description: string | null;
  sections: PlatformSectionKey[];
  scope: PlatformScope;
  salesHead: boolean;
  signatureTitle: string | null;
  /** Свой лимит скидки; null — по умолчанию роли (`defaultDiscount`). */
  discountLimit: number | null;
  /** Лимит по умолчанию для встроенной роли (коммерческий директор 25, РОП 15, менеджер 10). */
  defaultDiscount: number;
  system: boolean;
  members: number;
};

/** Ключ новой роли из названия: латиница/цифры, иначе «role-<время>». */
export function roleKeyFrom(title: string, now = Date.now()): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return slug ? `${slug}_${now.toString(36)}` : `role_${now.toString(36)}`;
}

/** РОП работает в CRM: роль с флагом РОП без раздела CRM — ошибка формы. */
export function validateRoleShape(input: { sections: readonly string[]; salesHead: boolean }): string | null {
  const sections = normalizePlatformSections(input.sections);
  if (!sections.length) return "Отметьте хотя бы один раздел";
  if (input.salesHead && !sections.includes("crm")) return "РОП работает в CRM — отметьте раздел «CRM»";
  return null;
}

/**
 * Должность в подписи КП и писем клиенту. Личная (её задаёт владелец) важнее
 * «Моей почты» (её человек пишет сам), та — должности из роли; последней —
 * должность в кабинете организации.
 */
export function signaturePosition(args: {
  platformTitle?: string | null;
  mailboxPosition?: string | null;
  role?: { title: string; signatureTitle: string | null } | null;
  positionTitle?: string | null;
}): string | null {
  const pick = (value: string | null | undefined) => (value && value.trim() ? value.trim() : null);
  return (
    pick(args.platformTitle) ??
    pick(args.mailboxPosition) ??
    (args.role ? (pick(args.role.signatureTitle) ?? pick(args.role.title)) : null) ??
    pick(args.positionTitle)
  );
}
