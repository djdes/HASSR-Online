import { renderEmailLayout } from "@/lib/email";
import { escapeTelegramHtml as esc } from "@/lib/telegram";

/** Данные недельной сводки — собирает `build.ts`, рисуют функции ниже. */
export type WeeklyDigestData = {
  orgName: string;
  weekStart: string;
  weekEnd: string;
  compliancePct: number;
  filledSlots: number;
  totalSlots: number;
  bottomTemplates: Array<{ name: string; missed: number }>;
  topEmployeeName: string | null;
  topEmployeeCount: number;
  tfDone: number;
  tfStuck: number;
  incidents: { total: number; open: number };
  /** Сотрудники без единой отметки в журналах здоровья за неделю. */
  absentEmployees: string[];
  /** Ближайшие сроки: медкнижки, поверки, партии, подписка. */
  expiring: Array<{ date: string; title: string }>;
};

function complianceEmoji(pct: number): string {
  return pct >= 90 ? "🟢" : pct >= 60 ? "🟡" : "🔴";
}

function formatDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("ru-RU", { timeZone: "UTC", day: "2-digit", month: "2-digit" });
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Сообщение в Telegram руководству — компактное, с теми же разделами. */
export function renderWeeklyDigestTelegram(d: WeeklyDigestData): string {
  const lines: string[] = [];
  lines.push(`<b>📊 Сводка за неделю · ${esc(d.orgName)}</b>`);
  lines.push("");
  lines.push(`${complianceEmoji(d.compliancePct)} Заполнено: <b>${d.compliancePct}%</b> (${d.filledSlots} из ${d.totalSlots})`);
  if (d.tfDone > 0 || d.tfStuck > 0) lines.push(`🛠 Задачи в программном модуле: ✅ ${d.tfDone} выполнено · ⏳ ${d.tfStuck} активных`);
  if (d.incidents.total > 0) lines.push(`🌡 Отклонения температуры: ${d.incidents.total}${d.incidents.open > 0 ? ` (не закрыто ${d.incidents.open})` : ""}`);
  if (d.topEmployeeName) lines.push(`🏆 Топ исполнитель: <b>${esc(d.topEmployeeName)}</b> (${d.topEmployeeCount} записей)`);
  if (d.bottomTemplates.length > 0) {
    lines.push("");
    lines.push("⚠️ <b>Чаще всего пропускают:</b>");
    for (const t of d.bottomTemplates) lines.push(`  • ${esc(t.name)} — ${t.missed} дн.`);
  }
  if (d.absentEmployees.length > 0) {
    lines.push("");
    lines.push(`👤 <b>Не отмечались всю неделю:</b> ${d.absentEmployees.map(esc).join(", ")}`);
  }
  if (d.expiring.length > 0) {
    lines.push("");
    lines.push("📅 <b>Истекает в ближайшие 14 дней:</b>");
    for (const e of d.expiring.slice(0, 6)) lines.push(`  • ${formatDay(e.date)} — ${esc(e.title)}`);
    if (d.expiring.length > 6) lines.push(`  … и ещё ${d.expiring.length - 6}`);
  }
  lines.push("");
  lines.push("<i>Подробности — на экране «Сегодня». Письмо с этой сводкой отключается в «Настройки → Уведомления».</i>");
  return lines.join("\n");
}

/** Письмо руководителю: тема и HTML в общем шаблоне писем. */
export function renderWeeklyDigestEmail(d: WeeklyDigestData, baseUrl: string): { subject: string; html: string } {
  const subject = `Сводка за неделю · ${d.orgName}: заполнено ${d.compliancePct}%`;
  const rows: string[] = [];
  const stat = (label: string, value: string) =>
    `<tr><td style="padding:6px 0;color:#71717a;font-size:14px">${label}</td><td style="padding:6px 0;text-align:right;font-weight:600;font-size:14px">${value}</td></tr>`;
  rows.push(stat("Заполнено журналов", `${complianceEmoji(d.compliancePct)} ${d.compliancePct}% (${d.filledSlots} из ${d.totalSlots})`));
  if (d.tfDone > 0 || d.tfStuck > 0) rows.push(stat("Задачи в программном модуле", `${d.tfDone} выполнено · ${d.tfStuck} активных`));
  rows.push(stat("Отклонения температуры", d.incidents.total > 0 ? `${d.incidents.total}${d.incidents.open > 0 ? ` (не закрыто ${d.incidents.open})` : ""}` : "не было"));
  if (d.topEmployeeName) rows.push(stat("Больше всех записей", `${escapeHtml(d.topEmployeeName)} — ${d.topEmployeeCount}`));

  const section = (title: string, inner: string) =>
    `<h3 style="margin:20px 0 8px;font-size:15px;color:#18181b">${title}</h3>${inner}`;
  const list = (items: string[]) =>
    `<ul style="margin:0;padding-left:18px;color:#3f3f46;font-size:14px;line-height:1.6">${items.map((i) => `<li>${i}</li>`).join("")}</ul>`;

  const parts: string[] = [];
  parts.push(`<p style="margin:0 0 12px;color:#3f3f46;font-size:14px">Неделя ${formatDay(d.weekStart)} — ${formatDay(d.weekEnd)}.</p>`);
  parts.push(`<table role="presentation" width="100%" style="border-collapse:collapse">${rows.join("")}</table>`);
  if (d.bottomTemplates.length > 0) {
    parts.push(section("Чаще всего пропускали", list(d.bottomTemplates.map((t) => `${escapeHtml(t.name)} — ${t.missed} дн. без записи`))));
  }
  if (d.absentEmployees.length > 0) {
    parts.push(section("Не отмечались всю неделю", list(d.absentEmployees.map(escapeHtml))));
  } else {
    parts.push(section("Не отмечались всю неделю", `<p style="margin:0;color:#71717a;font-size:14px">Все сотрудники отмечались.</p>`));
  }
  if (d.expiring.length > 0) {
    parts.push(section("Истекает в ближайшие 14 дней", list(d.expiring.map((e) => `${formatDay(e.date)} — ${escapeHtml(e.title)}`))));
  } else {
    parts.push(section("Истекает в ближайшие 14 дней", `<p style="margin:0;color:#71717a;font-size:14px">Ничего не истекает.</p>`));
  }
  parts.push(
    `<p style="margin:24px 0 0"><a href="${baseUrl}/dashboard" style="display:inline-block;background:#5566f6;color:#fff;text-decoration:none;padding:12px 20px;border-radius:12px;font-size:14px;font-weight:600">Открыть «Сегодня»</a></p>`
  );
  parts.push(
    `<p style="margin:20px 0 0;color:#a1a1aa;font-size:12px">Письмо приходит по понедельникам в 08:00. Отключить: <a href="${baseUrl}/settings/notifications" style="color:#5566f6">Настройки → Уведомления</a>.</p>`
  );
  return { subject, html: renderEmailLayout(`Сводка за неделю · ${escapeHtml(d.orgName)}`, parts.join("")) };
}
