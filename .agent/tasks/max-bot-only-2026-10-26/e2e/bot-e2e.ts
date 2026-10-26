/**
 * End-to-end run of the MAX bot against a real PostgreSQL database with the
 * MAX HTTP API stubbed. Writes a transcript of every bot screen.
 *
 *   DATABASE_URL=postgresql://…/wesetup_maxbot npx tsx .agent/tasks/max-bot-only-2026-10-26/e2e/bot-e2e.ts
 */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import path from "node:path";

process.env.MAX_BOT_TOKEN = "test-token";
process.env.MAX_BOT_USERNAME = "wesetup_test_bot";
process.env.MAX_WEBHOOK_SECRET = "x".repeat(40);
process.env.MAX_SITE_URL = "http://localhost:3002";
process.env.MAX_API_BASE_URL = "https://platform-api2.max.ru";
process.env.EQUIPMENT_QR_TOKEN_SECRET ||= "e2e-qr-secret-".padEnd(48, "x");

type Sent = { to: string; kind: "message" | "answer"; text: string; buttons: Array<Array<{ type: string; text: string; payload?: string; url?: string }>> };
const sent: Sent[] = [];
const transcript: string[] = [];
const realFetch = globalThis.fetch;
let answerFails = false;
let callbackChat = new Map<string, string>();

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(String(input));
  if (url.hostname !== "platform-api2.max.ru") return realFetch(input, init);
  assert.equal((init?.headers as Record<string, string>).Authorization, "test-token");
  const body = init?.body ? JSON.parse(String(init.body)) : {};
  const record = (kind: Sent["kind"], to: string, message: { text?: string; attachments?: Array<{ payload: { buttons: Sent["buttons"] } }> }) => {
    const buttons = message.attachments?.[0]?.payload.buttons ?? [];
    sent.push({ to, kind, text: message.text ?? "", buttons });
    transcript.push(`**бот → ${to}** (${kind === "answer" ? "замена сообщения" : "новое сообщение"})\n\n\`\`\`\n${message.text}\n\`\`\`\n${buttons.map((row) => "  " + row.map((b) => `[${b.text}]`).join(" ")).join("\n")}\n`);
  };
  if (url.pathname === "/messages" && init?.method === "POST") {
    record("message", url.searchParams.get("chat_id")!, body);
    return Response.json({ message: { body: { mid: "m" } } });
  }
  if (url.pathname === "/answers") {
    if (answerFails) return Response.json({ success: false });
    if (body.message) record("answer", callbackChat.get(url.searchParams.get("callback_id")!) ?? "?", body.message);
    return Response.json({ success: true });
  }
  return Response.json({ success: true });
}) as typeof fetch;

async function main() {
  const { db } = await import("../../../../src/lib/db");
  const { handleMaxUpdate } = await import("../../../../src/lib/max/bot");
  const { ensureQrPeriodDocuments } = await import("../../../../src/lib/journal-qr-rollover");
  const { todayKeyFor } = await import("../../../../src/lib/journal-fill");

  const stamp = Date.now().toString(36);
  const org = await db.organization.create({ data: { name: `Кафе «Ромашка» ${stamp}`, type: "restaurant", timezone: "Europe/Moscow" } });
  const manager = await db.user.create({ data: { organizationId: org.id, name: "Олег Руководитель", email: `boss-${stamp}@test.local`, role: "manager", passwordHash: "x" } });
  const cook = await db.user.create({ data: { organizationId: org.id, name: "Анна Петрова", email: `cook-${stamp}@test.local`, role: "cook", passwordHash: "x", journalAccessMigrated: false } });
  const todayKey = todayKeyFor(org.timezone);
  for (const code of ["hygiene", "finished_product"]) {
    const result = await ensureQrPeriodDocuments({ organizationId: org.id, templateCode: code, todayKey, allowFirstDocument: true, source: "e2e" });
    assert.notEqual(result.status, "none", `document for ${code}`);
  }
  // Manager linked on the site earlier (personal link flow is unchanged).
  const base = 10_000 + Math.floor(Math.random() * 1_000_000) * 10;
  const boss = { id: String(base + 1), chat: String(base + 5), name: "Олег (руководитель)" };
  const anna = { id: String(base + 2), chat: String(base + 6), name: "Анна (повар)" };
  const stranger = { id: String(base + 3), chat: String(base + 7), name: "Незнакомец" };
  await db.maxIdentity.create({ data: { userId: manager.id, maxUserId: boss.id, privateChatId: boss.chat, displayName: "Oleg", activeOrganizationId: org.id } });

  let seq = 0;
  const step = (title: string) => transcript.push(`\n### ${title}\n`);
  async function press(user: { id: string; chat: string; name: string }, payload: string) {
    const callbackId = `cb-${base}-${++seq}`;
    callbackChat.set(callbackId, user.chat);
    transcript.push(`**${user.name} нажимает** \`${payload}\`\n`);
    await handleMaxUpdate({ update_type: "message_callback", timestamp: Date.now(), callback: { callback_id: callbackId, user: { user_id: user.id, first_name: user.name }, payload }, message: { recipient: { chat_id: user.chat, chat_type: "dialog" }, body: { mid: `mid-${base}-${seq}` } } });
    return sent.at(-1)!;
  }
  async function say(user: { id: string; chat: string; name: string }, text: string) {
    transcript.push(`**${user.name} пишет:** ${text}\n`);
    await handleMaxUpdate({ update_type: "message_created", timestamp: Date.now(), message: { sender: { user_id: user.id, first_name: user.name }, recipient: { chat_id: user.chat, chat_type: "dialog" }, body: { mid: `msg-${base}-${++seq}`, text } } });
    return sent.at(-1)!;
  }
  async function start(user: { id: string; chat: string; name: string }, payload: string | null) {
    transcript.push(`**${user.name} открывает бота**${payload ? ` по ссылке \`start=${payload.slice(0, 8)}…\`` : ""}\n`);
    await handleMaxUpdate({ update_type: "bot_started", timestamp: Date.now() + ++seq, user: { user_id: user.id, first_name: user.name }, chat_id: user.chat, payload });
    return sent.at(-1)!;
  }
  const btn = (screen: Sent, starts: string) => {
    const button = screen.buttons.flat().find((item) => item.text.startsWith(starts));
    assert.ok(button?.payload, `button «${starts}» in:\n${screen.text}\n${JSON.stringify(screen.buttons)}`);
    return button.payload!;
  };

  step("1. Неподключённый человек открывает бота");
  let screen = await start(stranger, null);
  assert.match(screen.text, /попросите руководителя прислать личную ссылку/);
  assert.equal(screen.buttons.flat()[0].type, "link");

  step("2. Руководитель: меню и подключение сотрудника");
  screen = await start(boss, null);
  assert.match(screen.text, /Для руководителя/);
  screen = await press(boss, btn(screen, "👥 Подключить сотрудника"));
  assert.match(screen.text, /Уже в MAX: 1 из 2/);
  screen = await press(boss, btn(screen, "Анна Петрова"));
  const forward = sent.at(-1)!;
  assert.equal(forward.kind, "message");
  const token = /inv_[A-Za-z0-9_-]{32}/.exec(forward.text)?.[0];
  assert.ok(token, "invite token in the forwardable message");
  assert.ok(forward.text.includes(`https://max.ru/wesetup_test_bot?start=${token}`));
  assert.equal(await db.maxInvite.count({ where: { userId: cook.id, usedAt: null } }), 1);

  step("3. Сотрудник нажимает ссылку-приглашение");
  const beforeClaim = sent.length;
  screen = await start(anna, token!);
  const welcome = sent[beforeClaim];
  assert.match(welcome.text, /Готово, Анна Петрова/);
  assert.match(welcome.text, /Сегодня заполнено 0 из/);
  assert.ok(sent.slice(beforeClaim).some((item) => item.to === boss.chat && /Сотрудник подключён к MAX: Анна Петрова/.test(item.text)), "manager notified");
  assert.equal((await db.maxIdentity.findUnique({ where: { userId: cook.id } }))?.maxUserId, anna.id);
  screen = await start(stranger, token!);
  assert.match(screen.text, /уже использована/);

  step("4. Гигиенический журнал кнопками");
  screen = await press(anna, btn(welcome, "✍️ Заполнить: Гигиен"));
  assert.match(screen.text, /Шаг 1 из/);
  let guard = 0;
  while (!/Проверьте запись/.test(screen.text) && guard++ < 10) {
    const first = screen.buttons.flat().find((button) => button.payload?.includes(":p:"));
    assert.ok(first, screen.text);
    screen = await press(anna, first.payload!);
  }
  assert.match(screen.text, /Проверьте запись/);
  const staleSave = btn(screen, "✅");
  screen = await press(anna, btn(screen, "✏️ Изменить"));
  screen = await press(anna, screen.buttons.flat()[0].payload!);
  assert.ok(screen.buttons.flat().some((button) => button.text === "‹ К проверке"));
  screen = await press(anna, screen.buttons.flat().find((button) => button.payload?.includes(":p:"))!.payload!);
  assert.match(screen.text, /Проверьте запись/);
  // A Save button from an older message must not write.
  screen = await press(anna, staleSave);
  assert.match(screen.text, /из прошлого шага/);
  const writes = () => db.auditLog.count({ where: { organizationId: org.id, action: "journal.qr_fill" } });
  assert.equal(await writes(), 0);
  const save = btn(screen, "✅");
  screen = await press(anna, save);
  assert.match(screen.text, /✅ Записано/);
  assert.equal(await writes(), 1);
  const hygieneDoc = await db.journalDocument.findFirst({ where: { organizationId: org.id, template: { code: "hygiene" } } });
  const entry = await db.journalDocumentEntry.findFirst({ where: { documentId: hygieneDoc!.id, employeeId: cook.id, date: new Date(`${todayKey}T00:00:00.000Z`) } });
  transcript.push(`\n_Запись гигиены за сегодня:_ \`${JSON.stringify(entry?.data)}\`\n`);
  assert.ok(entry, "today's hygiene entry");
  // Double tap on the same Save does nothing.
  screen = await press(anna, save);
  assert.match(screen.text, /уже закончено/);
  assert.equal(await writes(), 1);
  const audit = await db.auditLog.findFirst({ where: { organizationId: org.id, action: "journal.qr_fill" }, orderBy: { createdAt: "desc" } });
  assert.equal((audit?.details as { channel?: string })?.channel, "max");

  step("5. Бракераж готовой продукции: ответы сообщениями, отклонение от нормы");
  screen = await press(anna, "jr:0");
  assert.match(screen.text, /Журналы/);
  screen = await press(anna, btn(screen, "Журнал бракеража готовой"));
  guard = 0;
  while (!/Проверьте запись/.test(screen.text) && guard++ < 25) {
    if (/Что вы сделали/.test(screen.text)) { screen = await say(anna, "Довели до нужной температуры"); continue; }
    if (/Наименование|блюд/i.test(screen.text.split("\n").find((line) => /Шаг \d+ из/.test(line)) ? screen.text.split(/Шаг \d+ из \d+\n/)[1] ?? "" : "") && /Напишите|сообщением/.test(screen.text)) {
      screen = await say(anna, "Борщ");
      continue;
    }
    if (/Температур/i.test(screen.text) && /Напишите число/.test(screen.text)) { screen = await say(anna, "40"); continue; }
    const pick = screen.buttons.flat().find((button) => button.payload?.includes(":p:"));
    if (pick) { screen = await press(anna, pick.payload!); continue; }
    if (/Напишите число/.test(screen.text)) { screen = await say(anna, "1"); continue; }
    screen = await say(anna, "Борщ");
  }
  assert.match(screen.text, /Проверьте запись/);
  screen = await press(anna, btn(screen, "✅"));
  assert.match(screen.text, /✅ Записано: Журнал бракеража/);
  assert.ok(screen.buttons.flat().some((button) => button.text === "➕ Добавить ещё"));
  const fpDoc = await db.journalDocument.findFirst({ where: { organizationId: org.id, template: { code: "finished_product" } }, select: { config: true } });
  transcript.push(`\n_Строки документа бракеража после записи:_ \`${JSON.stringify((fpDoc?.config as { rows?: unknown[] })?.rows?.slice(-1))}\`\n`);
  assert.ok(JSON.stringify(fpDoc?.config).includes("Борщ"), "dish row written");

  step("6. Ошибочный ввод и отмена");
  screen = await press(anna, btn(screen, "➕ Добавить ещё"));
  const before = sent.length;
  screen = await say(anna, "привет");
  screen = sent.at(-1)!;
  assert.ok(sent.length > before);
  screen = await press(anna, btn(screen, "✖ Отменить"));
  assert.match(screen.text, /ничего не записано/);

  step("7. Руководитель: сводка и напоминание");
  screen = await press(boss, "menu");
  screen = await press(boss, btn(screen, "📊 Сводка"));
  assert.match(screen.text, /Сводка за/);
  screen = await press(boss, "rem");
  if (/Отправить напоминание/.test(screen.text)) {
    const beforeRemind = sent.length;
    screen = await press(boss, btn(screen, "✅ Отправить"));
    assert.match(screen.text, /Напоминание отправлено: 1/);
    assert.ok(sent.slice(beforeRemind).some((item) => item.to === anna.chat && /Напоминание от руководителя/.test(item.text)));
    screen = await press(boss, "remok");
    assert.match(screen.text, /через \d+ мин/);
  } else {
    transcript.push("_Все журналы Анны на сегодня заполнены — напоминать некому._\n");
  }

  step("8. Сотрудник не видит разделов руководителя");
  screen = await press(anna, "sum");
  assert.match(screen.text, /доступен руководителю/);

  step("9. Ответ на нажатие не принят — экран приходит новым сообщением");
  answerFails = true;
  const beforeFallback = sent.length;
  screen = await press(anna, "help");
  answerFails = false;
  assert.equal(sent.length, beforeFallback + 1);
  assert.equal(sent.at(-1)!.kind, "message");

  step("10. Незаконченное заполнение: меню предлагает продолжить");
  screen = await press(anna, "go:finished_product");
  screen = await say(anna, "Котлета");
  assert.match(screen.text, /Шаг 2 из/);
  screen = await say(anna, "/menu");
  assert.match(screen.text, /Незаконченное заполнение/);
  screen = await press(anna, btn(screen, "▶️ Продолжить"));
  assert.match(screen.text, /Шаг 2 из/);
  screen = await press(anna, btn(screen, "‹ Назад"));
  assert.match(screen.text, /Шаг 1 из/);
  assert.ok(screen.buttons.flat().some((button) => button.text.startsWith("Оставить: Котлета")));
  screen = await press(anna, btn(screen, "✖ Отменить"));

  step("11. Организация отключила MAX — бот не пускает");
  await db.maxOrganizationIntegration.upsert({ where: { organizationId: org.id }, create: { organizationId: org.id, enabled: false }, update: { enabled: false } });
  screen = await press(anna, "go:hygiene");
  assert.match(screen.text, /отключила доступ через MAX/);
  await db.maxOrganizationIntegration.update({ where: { organizationId: org.id }, data: { enabled: true } });

  step("12. Остановка бота удаляет привязку");
  await handleMaxUpdate({ update_type: "bot_stopped", timestamp: Date.now() + ++seq, user: { user_id: anna.id, first_name: anna.name }, chat_id: anna.chat });
  assert.equal(await db.maxIdentity.count({ where: { userId: cook.id } }), 0);
  screen = await say(anna, "/menu");
  assert.match(screen.text, /попросите руководителя прислать личную ссылку/);

  const out = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "raw", "e2e-transcript.md");
  writeFileSync(out, `# MAX бот — сквозной прогон (${new Date().toISOString()})\n\nMAX API подменён, БД и ядро записи настоящие.\n${transcript.join("\n")}\n`);
  console.log(`E2E PASS — ${sent.length} bot screens, transcript: ${out}`);
  await db.$disconnect();
}

main().catch((error) => {
  console.error(error);
  writeFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), "..", "raw", "e2e-transcript.md"), `# FAILED\n\n${String(error?.stack ?? error)}\n\n${transcript.join("\n")}`);
  process.exit(1);
});
