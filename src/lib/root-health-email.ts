import { db } from "@/lib/db";
import { renderEmailLayout, sendRawEmail } from "@/lib/email";
import { getPlatformAdminEmails } from "@/lib/platform-admin";
import { collectClientHealth } from "@/lib/root-health";

const SETTING_KEY = "root.health.sentAt";
const MIN_GAP_MS = 6 * 24 * 60 * 60 * 1000;

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function adminEmail(): string | null {
  return process.env.PLATFORM_ADMIN_EMAIL?.split(",")[0]?.trim() || process.env.FEEDBACK_ADMIN_EMAIL?.split(",")[0]?.trim() || null;
}

/**
 * Письмо ROOT «здоровье клиентов»: раз в неделю вместе с недельным
 * дайджестом (тот же крон, слот понедельник 08:00 МСК). `force` — для проверки.
 * Адресаты — все администраторы платформы (и env), `to` — только он.
 */
export async function sendRootHealthEmail(input: { now: Date; force?: boolean; to?: string | null }): Promise<{ sent: boolean; reason: string; risky?: number }> {
  const recipients = input.to ? [input.to] : await getPlatformAdminEmails();
  if (!recipients.length) return { sent: false, reason: "no-admin-email" };
  if (!input.force) {
    const row = await db.platformSetting.findUnique({ where: { key: SETTING_KEY } });
    const last = row ? new Date(row.value) : null;
    if (last && !Number.isNaN(last.getTime()) && input.now.getTime() - last.getTime() < MIN_GAP_MS) return { sent: false, reason: "sent-recently" };
  }
  const rows = (await collectClientHealth(input.now)).filter((r) => r.flags.length > 0);
  const table = rows.length
    ? `<table role="presentation" width="100%" style="border-collapse:collapse;font-size:13px">${rows
        .slice(0, 40)
        .map(
          (r) =>
            `<tr><td style="padding:6px 8px 6px 0;border-bottom:1px solid #e4e4e7"><a href="https://wesetup.ru/root/organizations/${r.id}" style="color:#5566f6">${escapeHtml(r.name)}</a></td><td style="padding:6px 0;border-bottom:1px solid #e4e4e7;color:#3f3f46">${r.flags.map((f) => escapeHtml(f.label)).join(", ")}</td></tr>`
        )
        .join("")}</table>`
    : `<p style="margin:0;color:#71717a;font-size:14px">Рисков не найдено.</p>`;
  const html = renderEmailLayout(
    "Здоровье клиентов за неделю",
    `<p style="margin:0 0 12px;color:#3f3f46;font-size:14px">Организаций с признаками ухода: <b>${rows.length}</b>. Полный список — <a href="https://wesetup.ru/root/health" style="color:#5566f6">/root/health</a>.</p>${table}`
  );
  const results = await Promise.all(
    recipients.map((to) => sendRawEmail(to, `Здоровье клиентов: ${rows.length} с рисками`, html).catch(() => false))
  );
  const sent = results.some(Boolean);
  if (sent && !input.force) {
    await db.platformSetting.upsert({ where: { key: SETTING_KEY }, create: { key: SETTING_KEY, value: input.now.toISOString() }, update: { value: input.now.toISOString() } });
  }
  return { sent, reason: sent ? "sent" : "smtp-failed", risky: rows.length };
}
