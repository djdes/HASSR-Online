import assert from "node:assert/strict";
import test from "node:test";

import {
  TELEGRAM_COMMANDS,
  buildTelegramLinkedStartReply,
  buildTelegramUnlinkedStartReply,
} from "@/lib/bot/start-response";

/**
 * Сообщения уходят с parse_mode: "HTML", поэтому проверяем разметку,
 * а не голый текст. Сверять целиком всю фразу не нужно — копирайт
 * правят часто, и тест, падающий от каждой запятой, чинить перестают.
 * Проверяем то, что несёт смысл: подставленные данные и кнопку.
 */

test("buildTelegramLinkedStartReply mentions the next action for staff", () => {
  const reply = buildTelegramLinkedStartReply(
    {
      name: "Иван",
      role: "cook",
      isRoot: false,
      kind: "staff",
      nextActionLabel: "Входной контроль",
    },
    "https://wesetup.ru/mini/o/obl_1"
  );

  assert.match(reply.text, /<b>Иван<\/b>/);
  assert.match(reply.text, /Следующее действие: <b>Входной контроль<\/b>/);
  assert.match(reply.buttonLabel ?? "", /Открыть задачу/);
  assert.equal(reply.buttonUrl, "https://wesetup.ru/mini/o/obl_1");
});

test("buildTelegramLinkedStartReply escapes HTML in user-supplied names", () => {
  const reply = buildTelegramLinkedStartReply(
    {
      name: "<b>Иван</b>",
      role: "cook",
      isRoot: false,
      kind: "staff",
      nextActionLabel: "Гигиена & контроль",
    },
    "https://wesetup.ru/mini"
  );

  // Имя приходит из профиля, который человек редактирует сам. Незаэкранированный
  // тег ломает parse_mode и Telegram отвечает 400 — сообщение не доходит вообще.
  assert.match(reply.text, /&lt;b&gt;Иван&lt;\/b&gt;/);
  assert.match(reply.text, /Гигиена &amp; контроль/);
});

test("buildTelegramLinkedStartReply returns completed-today copy for staff without next action", () => {
  const reply = buildTelegramLinkedStartReply(
    {
      name: "Анна",
      role: "waiter",
      isRoot: false,
      kind: "staff",
      nextActionLabel: null,
    },
    "https://wesetup.ru/mini"
  );

  assert.match(reply.text, /обязательные журналы уже закрыты/);
  assert.match(reply.buttonLabel ?? "", /Мои журналы/);
  assert.equal(reply.buttonUrl, "https://wesetup.ru/mini");
});

test("buildTelegramLinkedStartReply includes a manager summary", () => {
  const reply = buildTelegramLinkedStartReply(
    {
      name: "Ольга",
      role: "manager",
      isRoot: false,
      kind: "manager",
      pendingCount: 4,
      employeesWithPending: 2,
    },
    "https://wesetup.ru/mini"
  );

  assert.match(reply.text, /Открыто задач: <b>4<\/b>/);
  assert.match(reply.text, /сотрудников с задачами: <b>2<\/b>/);
  assert.match(reply.buttonLabel ?? "", /Открыть Кабинет/);
  assert.equal(reply.buttonUrl, "https://wesetup.ru/mini");
});

test("buildTelegramLinkedStartReply congratulates a manager with nothing pending", () => {
  const reply = buildTelegramLinkedStartReply(
    {
      name: "Ольга",
      role: "manager",
      isRoot: false,
      kind: "manager",
      pendingCount: 0,
      employeesWithPending: 0,
    },
    "https://wesetup.ru/mini"
  );

  // «Открыто задач: 0» — тревожная формулировка на пустом месте.
  assert.doesNotMatch(reply.text, /Открыто задач/);
  assert.match(reply.text, /Все задачи на сегодня закрыты/);
});

test("buildTelegramLinkedStartReply offers view-only copy for readonly access", () => {
  const reply = buildTelegramLinkedStartReply(
    { name: "Пётр", role: "cook", isRoot: false, kind: "readonly" },
    "https://wesetup.ru/mini"
  );

  assert.match(reply.text, /режим просмотра/);
  assert.match(reply.text, /обратитесь к руководителю/);
  assert.equal(reply.buttonUrl, "https://wesetup.ru/mini");
});

test("buildTelegramLinkedStartReply falls back when mini app is unavailable", () => {
  const reply = buildTelegramLinkedStartReply(
    {
      name: "Анна",
      role: "waiter",
      isRoot: false,
      kind: "staff",
      nextActionLabel: "Гигиена",
    },
    null
  );

  assert.match(reply.text, /Мини-приложение пока не настроено/);
  // Кнопки нет — вести человека некуда, и пустая кнопка в Telegram даёт 400.
  assert.equal(reply.buttonLabel, undefined);
  assert.equal(reply.buttonUrl, undefined);
});

test("buildTelegramUnlinkedStartReply explains how to get linked", () => {
  const reply = buildTelegramUnlinkedStartReply();

  assert.match(reply.text, /не привязан/);
  assert.match(reply.text, /ссылку-приглашение/);
  assert.equal(reply.buttonUrl, undefined);
});

test("TELEGRAM_COMMANDS registers the start and unlink commands", () => {
  const byName = new Map(TELEGRAM_COMMANDS.map((c) => [c.command, c.description]));

  assert.match(byName.get("start") ?? "", /Открыть WeSetup/);
  assert.match(byName.get("stop") ?? "", /Отвязать/);
  assert.ok(byName.has("journals"));
  assert.ok(byName.has("help"));
});

test("TELEGRAM_COMMANDS stays within Telegram setMyCommands limits", () => {
  // Telegram молча отвергает весь список целиком, если хоть один пункт
  // нарушает формат: имя — до 32 символов [a-z0-9_], описание — до 256,
  // всего не больше 100 команд. Проверить это можно только тут.
  assert.ok(TELEGRAM_COMMANDS.length <= 100);
  assert.equal(
    new Set(TELEGRAM_COMMANDS.map((c) => c.command)).size,
    TELEGRAM_COMMANDS.length,
    "дубли команд Telegram не примет"
  );
  for (const { command, description } of TELEGRAM_COMMANDS) {
    assert.match(command, /^[a-z0-9_-]{1,32}$/, `плохое имя команды: ${command}`);
    assert.ok(
      description.length > 0 && description.length <= 256,
      `плохое описание команды ${command}`
    );
  }
});

test("команды бота — только латиница, цифры и _ (иначе Telegram отвергает всё меню)", () => {
  for (const item of TELEGRAM_COMMANDS) {
    assert.match(item.command, /^[a-z0-9_]{1,32}$/, item.command);
    assert.ok(item.description.length >= 1 && item.description.length <= 256, item.command);
  }
});
