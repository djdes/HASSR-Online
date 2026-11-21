/**
 * Предпросмотр писем сайта (задача emails-redesign-2026-11-21): настоящие
 * функции отправки шлют в локальный SMTP-приёмник (127.0.0.1:$SMTP_PORT),
 * функции сборки пишут HTML сразу. Итог — HTML-файлы в каталоге `out`,
 * дальше их снимает Playwright.
 *
 *   SMTP_PORT=2526 npx tsx .agent/tasks/emails-redesign-2026-11-21/raw/preview-emails.ts <out> <eml-dir>
 */
process.env.SMTP_HOST = "127.0.0.1";
process.env.SMTP_PORT = process.env.SMTP_PORT ?? "2526";
process.env.SMTP_FROM = "WeSetup <noreply@wesetup.ru>";

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { simpleParser } from "mailparser";

async function main() {
  const [out, emlDir] = process.argv.slice(2);
  const email = await import("@/lib/email");
  const lifecycle = await import("@/lib/lifecycle/emails");
  const write = (name: string, html: string) => writeFileSync(path.join(out, `${name}.html`), html);
  const to = "chef@example.com";

  // 1. Через настоящую отправку (SMTP-приёмник) — по порядку, имена ниже.
  const sent: string[] = [];
  const send = async (name: string, run: () => Promise<unknown>) => { await run(); sent.push(name); };
  await send("verification", () => email.sendVerificationEmail(to, "481 205"));
  await send("invite-token", () => email.sendInviteTokenEmail({ to, name: "Анна", organizationName: "Кафе «Ромашка»", inviteUrl: "https://wesetup.ru/invite/abc" }));
  await send("invite-password", () => email.sendInviteEmail({ to, name: "Анна", password: "Kx7-pq2", organizationName: "Кафе «Ромашка»" }));
  await send("account-password-blank", () => email.sendAccountPasswordEmail({ to, password: "Kx7-pq2", via: "blank", autoLoginUrl: "https://wesetup.ru/api/auth/magic/abc", autoLoginDays: 3 }));
  await send("password-changed", () => email.sendPasswordChangedEmail({ to, password: "Nw9-zz4" }));
  await send("password-reset", () => email.sendPasswordResetEmail({ to, resetUrl: "https://wesetup.ru/reset/abc" }));
  await send("welcome", () => email.sendWelcomeEmail({ to, name: "Анна", hasAccount: true }));
  await send("new-device", () => email.sendNewDeviceLoginEmail({ to, name: "Анна", when: "21.11.2026 09:14", device: "iPhone · Safari", ip: "203.0.113.7", method: "password" }));
  await send("feedback-received", () => email.sendFeedbackReceivedEmail({ to, ticket: "WS-1042", message: "Не печатается журнал уборки на принтере.", pageUrl: "https://wesetup.ru/journals/cleaning" }));
  await send("feedback-reply", () => email.sendFeedbackReplyEmail({ to, replyMessage: "Исправили — обновите страницу, печать работает.", originalMessage: "Не печатается журнал уборки.", respondedByName: "Алексей" }));
  await send("alert-temperature", () => email.sendTemperatureAlertEmail({ to, equipmentName: "Холодильник №2", temperature: 9.5, tempMin: 2, tempMax: 6, areaName: "Горячий цех", filledBy: "Иванов И." } as Parameters<typeof email.sendTemperatureAlertEmail>[0]));
  await send("alert-compliance", () => email.sendComplianceReminderEmail({ to, missingJournals: ["Гигиенический журнал", "Журнал уборки"], organizationName: "Кафе «Ромашка»" }));
  await send("blank-download", async () => {
    const mail = await email.buildBlankDownloadEmail({ journalTitle: "Журнал уборки", files: [{ label: "Скачать PDF", url: "https://wesetup.ru/api/journal-samples/cleaning/pdf?t=x" }], pageUrl: "https://wesetup.ru/journals-info/cleaning", registerUrl: "https://wesetup.ru/register?source=blank", expiresDays: 7 });
    write("blank-download", mail.html);
  });
  sent.pop(); // blank-download — собран напрямую, без отправки
  const followup = await email.buildBlankFollowupEmail({ journalTitle: "Журнал уборки", tips: ["Отмечайте уборку в день проведения.", "Подпись ответственного — обязательно."], pageUrl: "https://wesetup.ru/journals-info/cleaning", registerUrl: "https://wesetup.ru/register" });
  write("blank-followup", followup.html);

  // 2. Письма пробного периода (как в задании 21.11 — «ИП Волков»).
  const base = {
    orgName: "ИП Волков", recipientName: null, manager: null, payUrl: "https://wesetup.ru/settings/subscription", supportTelegram: "@wesetup_support",
  };
  const idle = lifecycle.composeIdleTrialEmail({ ...base, lastDayLabel: "26 ноября", workdaysLeft: 4, helpUrl: "https://wesetup.ru/journals" });
  write("lifecycle-idle", email.renderEmailLayout(idle.title, idle.html));
  const trial = lifecycle.composeTrialEmail({ ...base, stage: "trial_first", lastDayLabel: "26 ноября", workdaysLeft: 4, seats: 6, journals: 12, points: 1, freeUsers: 1, freeJournals: 1, tierTitle: "Стандарт", monthRub: 2990, yearRub: 23880, invoice: { number: "512", amountRub: 2990, dueLabel: "30 ноября", cycle: "month" }, requisitesUrl: "https://wesetup.ru/settings/subscription" });
  write("lifecycle-trial", email.renderEmailLayout(trial.title, trial.html));

  // 3. Разбор пойманных писем.
  await new Promise((resolve) => setTimeout(resolve, 600));
  const files = readdirSync(emlDir).filter((file) => file.endsWith(".eml")).sort();
  for (const [index, file] of files.entries()) {
    const parsed = await simpleParser(readFileSync(path.join(emlDir, file)));
    write(sent[index] ?? `mail-${index}`, String(parsed.html || ""));
  }
  console.log(`sent ${sent.length}, captured ${files.length}, files in ${out}`);
}

main().catch((error) => { console.error(error); process.exit(1); });
