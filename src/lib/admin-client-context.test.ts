import assert from "node:assert/strict";
import test from "node:test";

import { adminCrmContactUrl, adminOrganizationUrl, appendAdminClientLines } from "@/lib/admin-client-context";

/** Хвост уведомления: место клиента и «Открыть» (спека tg-client-location-2026-11, AC3/AC4). */

test("дописывает место и «Открыть» на клиента", () => {
  const text = appendAdminClientLines("🆕 Регистрация\nПочта: a@b.ru", {
    location: "🇷🇺 Россия, Барнаул · 09:29",
    adminUrl: "https://wesetup.ru/root/organizations/org1",
  });
  assert.equal(
    text,
    '🆕 Регистрация\nПочта: a@b.ru\n🇷🇺 Россия, Барнаул · 09:29\n<a href="https://wesetup.ru/root/organizations/org1">Открыть</a>',
  );
});

test("своя ссылка в тексте — наша подписана «Открыть клиента»; без данных — текст как есть", () => {
  const text = appendAdminClientLines('Обращение\n<a href="https://x/root/feedback">Открыть панель обращений</a>', {
    location: null,
    adminUrl: "https://x/root/organizations/o",
  });
  assert.ok(text.endsWith('<a href="https://x/root/organizations/o">Открыть клиента</a>'));
  // Место — перед ссылками в конце текста.
  assert.equal(
    appendAdminClientLines('Обращение\n<a href="https://x/root/feedback">Панель</a>', { location: "🇷🇺 Россия · 09:29", adminUrl: null }),
    'Обращение\n🇷🇺 Россия · 09:29\n<a href="https://x/root/feedback">Панель</a>',
  );
  assert.equal(appendAdminClientLines("Текст", { location: null, adminUrl: null }), "Текст");
  assert.equal(appendAdminClientLines("Текст", null), "Текст");
});

test("не дублирует место и ссылку, экранирует город", () => {
  const info = { location: "🇷🇺 Россия, <b> · 09:29", adminUrl: "https://x/root/crm/contacts/c1" };
  const once = appendAdminClientLines("Т", info);
  assert.ok(once.includes("&lt;b&gt;"));
  assert.equal(appendAdminClientLines(once, info), once);
});

test("адреса карточек", () => {
  assert.match(adminOrganizationUrl("o 1"), /\/root\/organizations\/o%201$/);
  assert.match(adminCrmContactUrl("c1"), /\/root\/crm\/contacts\/c1$/);
});
