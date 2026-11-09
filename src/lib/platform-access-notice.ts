import { escapeHtml } from "@/lib/html-escape";
import {
  PLATFORM_PANEL_ENTRY,
  PLATFORM_PRESETS,
  PLATFORM_SECTIONS,
  matchPlatformPreset,
  normalizePlatformSections,
  type PlatformSectionKey,
} from "@/lib/platform-access";

/**
 * Оповещение человеку, которому владелец открыл разделы панели платформы
 * («Команда и доступы», владелец 2026-11-06: «дай доступ админа и оповести
 * его»). Чистый модуль: что изменилось и текст письма и Telegram; отправка —
 * `platform-access-notice.server.ts`.
 */

/** Вход в панель: обновляет разделы в сессии и открывает первый доступный. */
export { PLATFORM_PANEL_ENTRY };

/** Разделы, которые изменение открыло впервые. Пусто — сообщать не о чем. */
export function addedPlatformSections(before: unknown, after: unknown): PlatformSectionKey[] {
  const had = new Set(normalizePlatformSections(before));
  return normalizePlatformSections(after).filter((key) => !had.has(key));
}

/** Название роли: пресет («Администратор», «Продажи»…) или свой набор. */
export function platformRoleTitle(sections: readonly PlatformSectionKey[]): string {
  const preset = matchPlatformPreset(sections);
  return PLATFORM_PRESETS.find((item) => item.key === preset)?.title ?? "Свой набор разделов";
}

export type PlatformAccessNotice = {
  subject: string;
  /** Заголовок в письме (уже экранирован). */
  title: string;
  /** Тело письма для `renderEmailLayout`. */
  html: string;
  /** Сообщение в Telegram (parse_mode HTML). */
  telegram: string;
};

export function buildPlatformAccessNotice(input: {
  name: string;
  /** Все разделы человека после изменения. */
  sections: readonly PlatformSectionKey[];
  /** До изменения доступа не было. */
  firstGrant: boolean;
  /** Кто выдал. */
  grantedBy: string | null;
  /** Почта для входа — подсказка, под какой учётной записью входить. */
  loginEmail: string | null;
  appUrl: string;
}): PlatformAccessNotice {
  const role = platformRoleTitle(input.sections);
  const preset = PLATFORM_PRESETS.find((item) => item.title === role);
  const sectionTitles = PLATFORM_SECTIONS.filter((section) => input.sections.includes(section.key)).map((section) => section.title);
  const url = `${input.appUrl.replace(/\/+$/, "")}${PLATFORM_PANEL_ENTRY}`;
  const name = input.name.trim().split(/\s+/)[0] ?? "";
  const greeting = name ? `Здравствуйте, ${escapeHtml(name)}!` : "Здравствуйте!";
  const lead = input.firstGrant ? "Вам открыт доступ к панели платформы WeSetup." : "Вам открыты новые разделы панели платформы WeSetup.";

  const P = 'style="margin:0 0 16px;color:#3f3f46;line-height:1.6"';
  const LABEL = 'style="padding:8px 0;border-bottom:1px solid #e4e4e7;color:#71717a;font-size:13px;width:120px;vertical-align:top"';
  const VALUE = 'style="padding:8px 0;border-bottom:1px solid #e4e4e7;color:#18181b;line-height:1.5"';
  const NOTE = 'style="margin:20px 0 0;color:#6f7282;line-height:1.6;font-size:13px"';
  const BUTTON =
    'style="display:inline-block;background:#5566f6;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;font-size:14px"';

  const rows: Array<[string, string]> = [
    ["Роль", escapeHtml(role) + (preset ? `<br><span style="color:#71717a;font-size:13px">${escapeHtml(preset.hint)}</span>` : "")],
    ["Разделы", escapeHtml(sectionTitles.join(" · "))],
  ];
  if (input.grantedBy?.trim()) rows.push(["Выдал(а)", escapeHtml(input.grantedBy.trim())]);

  const html =
    `<p ${P}>${greeting} ${lead}</p>` +
    `<table style="width:100%;border-collapse:collapse;margin:0 0 24px">` +
    rows.map(([label, value]) => `<tr><td ${LABEL}>${label}</td><td ${VALUE}>${value}</td></tr>`).join("") +
    `</table>` +
    `<a href="${escapeHtml(url)}" ${BUTTON}>Открыть панель</a>` +
    `<p ${NOTE}>Войдите в WeSetup${input.loginEmail ? ` под ${escapeHtml(input.loginEmail)}` : " под своей учётной записью"} — панель откроется по кнопке выше или по пункту «Панель платформы» в меню кабинета.</p>`;

  const telegram = [
    `🔑 <b>${escapeHtml(lead)}</b>`,
    `Роль: ${escapeHtml(role)}`,
    `Разделы: ${escapeHtml(sectionTitles.join(" · "))}`,
    `Открыть: ${escapeHtml(url)}`,
  ].join("\n");

  return {
    subject: input.firstGrant ? "Вам открыт доступ к панели WeSetup" : "Новые разделы панели WeSetup",
    title: input.firstGrant ? "Доступ к панели платформы" : "Новые разделы панели",
    html,
    telegram,
  };
}
