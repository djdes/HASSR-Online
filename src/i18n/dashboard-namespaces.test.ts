import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { loadMessages } from "./messages";
import { DASHBOARD_SITE_NAMESPACES } from "./dashboard-namespaces";

const layout = readFileSync("src/app/(dashboard)/layout.tsx", "utf8");

test("сайт и оболочка Mini App дают страницам кабинета одни и те же пространства сообщений (П-3)", () => {
  // Сайт: весь кабинет обёрнут общим списком.
  assert.match(layout, /<DomainMessagesBoundary namespaces=\{DASHBOARD_SITE_NAMESPACES\}>/);
  // Оболочка Mini App: свои пространства навигации + тот же список.
  const shell = layout.slice(layout.indexOf("async function MiniShellDashboard"));
  assert.match(shell, /<DomainMessagesBoundary namespaces=\{\[[^\]]*\.\.\.DASHBOARD_SITE_NAMESPACES\]\}>/);
});

test("в общем списке — «Сегодня» (dashboardUi), и все пространства есть в каталоге", async () => {
  assert.ok((DASHBOARD_SITE_NAMESPACES as readonly string[]).includes("dashboardUi"));
  const messages = (await loadMessages("ru")) as Record<string, unknown>;
  for (const namespace of DASHBOARD_SITE_NAMESPACES) {
    assert.equal(typeof messages[namespace], "object", namespace);
  }
});
