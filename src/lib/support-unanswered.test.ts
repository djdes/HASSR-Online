import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  UNANSWERED_AFTER_MS,
  UNANSWERED_GIVE_UP_MS,
  composeUnansweredPing,
  needsUnansweredPing,
  unansweredPingKey,
} from "@/lib/support-unanswered";

const now = new Date("2026-11-02T12:00:00Z");
const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);
const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

describe("чат без ответа — повторный сигнал админу", () => {
  it("через 15 минут после сообщения клиента и не позже суток; ответ оператора — молчим", () => {
    assert.equal(UNANSWERED_AFTER_MS, 15 * 60_000);
    assert.equal(UNANSWERED_GIVE_UP_MS, 24 * 60 * 60_000);
    assert.equal(needsUnansweredPing({ lastAuthor: "client", lastMessageAt: minutesAgo(14) }, now), false);
    assert.equal(needsUnansweredPing({ lastAuthor: "client", lastMessageAt: minutesAgo(15) }, now), true);
    assert.equal(needsUnansweredPing({ lastAuthor: "client", lastMessageAt: minutesAgo(24 * 60) }, now), true);
    assert.equal(needsUnansweredPing({ lastAuthor: "client", lastMessageAt: minutesAgo(24 * 60 + 1) }, now), false);
    assert.equal(needsUnansweredPing({ lastAuthor: "operator", lastMessageAt: minutesAgo(30) }, now), false);
    assert.equal(unansweredPingKey("msg1"), "support-unanswered:msg1");
  });

  it("текст: сколько ждёт, кто, метка ветки для ответа свайпом, всё экранировано", () => {
    const text = composeUnansweredPing({
      threadId: "thr_1",
      preview: "Как подключить <датчик>?",
      minutes: 17,
      userName: "Анна",
      userEmail: "anna@x.ru",
      organizationName: "Кафе & Ко",
      phone: null,
      escape,
      appUrl: "https://wesetup.ru",
    });
    assert.match(text, /^<b>⏰ Чат без ответа 17 мин<\/b>/);
    assert.match(text, /Как подключить &lt;датчик&gt;\?/);
    assert.match(text, /👤 Анна · anna@x\.ru/);
    assert.match(text, /🏢 Кафе &amp; Ко/);
    assert.doesNotMatch(text, /📞/);
    assert.match(text, /#chat_thr_1/);
    assert.doesNotMatch(text, /\n\n\n/);
  });

  it("крон: по секрету, окно 15 минут — сутки, пропуск уже отправленного, строка crontab без «*/»", () => {
    const route = readFileSync(new URL("../app/api/cron/support-unanswered/route.ts", import.meta.url), "utf8");
    assert.match(route, /const cronAuth = checkCronSecret\(request\);/);
    assert.match(route, /unreadForStaff: \{ gt: 0 \}/);
    assert.match(route, /db\.telegramLog\.findFirst\(\{\s*where: \{ status: "sent", createdAt: \{ gte: last\.createdAt \}, dedupeKey \}/);
    assert.match(route, /if \(already\) continue;/);
    assert.match(route, /0-59\/5 \* \* \* \* curl -s -H "Authorization: Bearer \$CRON_SECRET" https:\/\/wesetup\.ru\/api\/cron\/support-unanswered/);
  });
});
